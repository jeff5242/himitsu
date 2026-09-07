-- ============================================================================
-- HiMitsu L13（EPIC-2）：裝置地基——devices / device_codes＋kiosk 帳號機制
-- 執行位置：Supabase SQL Editor 貼上執行一次（需先跑過 EPIC-1 各支）。
-- 設計依據：EPIC-2 規格 §二（裝置＝kiosk 專用帳號；AC-14/AC-17）
-- ============================================================================

-- ── kiosk 角色：只有 checkin.write（拿到機器也動不了會籍/會費）────────
ALTER TABLE himitsu.org_users DROP CONSTRAINT org_users_role_check;
ALTER TABLE himitsu.org_users ADD CONSTRAINT org_users_role_check CHECK (role IN
  ('owner','secretary_general','secretary','finance','election_officer','staff','viewer','kiosk'));
INSERT INTO himitsu.role_permissions(role, perm) VALUES ('kiosk','checkin.write');

-- 權限矩陣：裝置管理歸帳號管理者（owner/秘書長）
INSERT INTO himitsu.role_permissions(role, perm) VALUES
  ('owner','devices.manage'), ('secretary_general','devices.manage');

-- ── 裝置主檔 ──────────────────────────────────────────────────────────
CREATE TABLE himitsu.devices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES himitsu.organizations(id) ON DELETE CASCADE,
  device_id     TEXT UNIQUE NOT NULL,          -- hostname + MAC 後 6 碼
  label         TEXT,
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- kiosk 帳號
  managed       BOOLEAN NOT NULL DEFAULT true, -- 關閉＝agent 停止快照下載（遙控）
  hostname      TEXT,
  ip            TEXT,
  version       TEXT,
  event_id      UUID REFERENCES himitsu.events(id) ON DELETE SET NULL,  -- 後台綁定場次
  pending_count INT NOT NULL DEFAULT 0,        -- 該機待同步筆數（>0 且不歸零＝去現場）
  last_seen     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_devices_org ON himitsu.devices(org_id);

-- ── 一次性註冊碼（15 分鐘效期）────────────────────────────────────────
CREATE TABLE himitsu.device_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES himitsu.organizations(id) ON DELETE CASCADE,
  code       TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '15 minutes',
  used_at    TIMESTAMPTZ,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── RLS＋審計 ─────────────────────────────────────────────────────────
ALTER TABLE himitsu.devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY devices_read ON himitsu.devices FOR SELECT TO authenticated
  USING (himitsu.is_org_member(org_id));
CREATE POLICY devices_manage ON himitsu.devices FOR ALL TO authenticated
  USING (himitsu.has_perm(org_id, 'devices.manage'))
  WITH CHECK (himitsu.has_perm(org_id, 'devices.manage'));
GRANT SELECT, INSERT, UPDATE, DELETE ON himitsu.devices TO authenticated;

ALTER TABLE himitsu.device_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY devicecodes_manage ON himitsu.device_codes FOR ALL TO authenticated
  USING (himitsu.has_perm(org_id, 'devices.manage'))
  WITH CHECK (himitsu.has_perm(org_id, 'devices.manage'));
GRANT SELECT, INSERT, UPDATE, DELETE ON himitsu.device_codes TO authenticated;

CREATE TRIGGER trg_audit_devices AFTER INSERT OR UPDATE OR DELETE ON himitsu.devices
  FOR EACH ROW EXECUTE FUNCTION himitsu.audit();

-- ── 產生註冊碼（後台按鈕）────────────────────────────────────────────
CREATE OR REPLACE FUNCTION himitsu.create_device_code(p_org UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_code TEXT;
BEGIN
  IF NOT himitsu.has_perm(p_org, 'devices.manage') THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  INSERT INTO himitsu.device_codes(org_id, code) VALUES (p_org, v_code);
  RETURN json_build_object('ok', true, 'code', v_code,
                           'expires_at', NOW() + INTERVAL '15 minutes');
END $$;
GRANT EXECUTE ON FUNCTION himitsu.create_device_code(UUID) TO authenticated;

-- ── 裝置註冊（agent 憑一次性碼呼叫；anon 可呼叫——碼就是通行證）────────
-- 建 kiosk 帳號（auth.users＋auth.identities＋org_users role=kiosk）＋devices 列，
-- 回傳帳密（僅此一次）。同 device_id 重註冊＝輪替密碼（機器重灌情境）。
CREATE OR REPLACE FUNCTION himitsu.register_device(p_code TEXT, p_hostname TEXT, p_mac TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_dc himitsu.device_codes%ROWTYPE;
  v_device_id TEXT;
  v_email TEXT;
  v_password TEXT;
  v_user UUID;
  v_device UUID;
BEGIN
  SELECT * INTO v_dc FROM himitsu.device_codes WHERE code = upper(btrim(p_code));
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'code_not_found'); END IF;
  IF v_dc.used_at IS NOT NULL THEN RETURN json_build_object('ok', false, 'error', 'code_used'); END IF;
  IF v_dc.expires_at < NOW() THEN RETURN json_build_object('ok', false, 'error', 'code_expired'); END IF;
  IF btrim(COALESCE(p_hostname,'')) = '' OR btrim(COALESCE(p_mac,'')) = '' THEN
    RETURN json_build_object('ok', false, 'error', 'hostname_mac_required');
  END IF;

  v_device_id := lower(regexp_replace(btrim(p_hostname), '[^a-zA-Z0-9-]', '', 'g'))
                 || '-' || lower(right(regexp_replace(p_mac, '[^0-9a-fA-F]', '', 'g'), 6));
  v_email := 'kiosk-' || v_device_id || '@kiosk.himitsu.local';
  v_password := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  SELECT user_id, id INTO v_user, v_device FROM himitsu.devices WHERE device_id = v_device_id;

  IF v_device IS NOT NULL THEN
    -- 重註冊：必須同協會；輪替密碼
    IF (SELECT org_id FROM himitsu.devices WHERE id = v_device) <> v_dc.org_id THEN
      RETURN json_build_object('ok', false, 'error', 'device_belongs_to_other_org');
    END IF;
    UPDATE auth.users SET encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf'))
     WHERE id = v_user;
    UPDATE himitsu.devices SET hostname = p_hostname, last_seen = NULL WHERE id = v_device;
  ELSE
    v_user := gen_random_uuid();
    INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at,
                            confirmation_token, recovery_token, email_change, email_change_token_new,
                            raw_app_meta_data, raw_user_meta_data)
    VALUES ('00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
            v_email, extensions.crypt(v_password, extensions.gen_salt('bf')),
            NOW(), NOW(), NOW(), '', '', '', '',
            '{"provider":"email","providers":["email"]}'::jsonb,
            json_build_object('kiosk', true, 'device_id', v_device_id)::jsonb);
    -- GoTrue 密碼登入需要 email identity 列
    INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider,
                                 last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), v_user::text, v_user,
            json_build_object('sub', v_user::text, 'email', v_email,
                              'email_verified', true, 'phone_verified', false)::jsonb,
            'email', NOW(), NOW(), NOW());

    INSERT INTO himitsu.org_users(org_id, user_id, role, email)
    VALUES (v_dc.org_id, v_user, 'kiosk', v_email);

    INSERT INTO himitsu.devices(org_id, device_id, user_id, hostname, label)
    VALUES (v_dc.org_id, v_device_id, v_user, p_hostname, '報到機 ' || v_device_id)
    RETURNING id INTO v_device;
  END IF;

  UPDATE himitsu.device_codes SET used_at = NOW() WHERE id = v_dc.id;

  RETURN json_build_object('ok', true, 'device_id', v_device_id, 'device_uuid', v_device,
                           'email', v_email, 'password', v_password, 'org_id', v_dc.org_id);
END $$;
GRANT EXECUTE ON FUNCTION himitsu.register_device(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ── 心跳（kiosk 帳號呼叫；回傳遙控旗標與綁定場次）────────────────────
CREATE OR REPLACE FUNCTION himitsu.device_heartbeat(
  p_device_id TEXT, p_ip TEXT DEFAULT NULL, p_version TEXT DEFAULT NULL, p_pending INT DEFAULT 0)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_dev himitsu.devices%ROWTYPE; v_event himitsu.events%ROWTYPE; v_slug TEXT;
BEGIN
  SELECT * INTO v_dev FROM himitsu.devices
   WHERE device_id = p_device_id AND user_id = auth.uid();
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'not_registered'); END IF;
  -- 帳號被停用（org_users disabled）時 has_perm 為 false → 心跳即失效
  IF NOT himitsu.has_perm(v_dev.org_id, 'checkin.write') THEN
    RETURN json_build_object('ok', false, 'error', 'disabled');
  END IF;

  UPDATE himitsu.devices
     SET ip = COALESCE(p_ip, ip), version = COALESCE(p_version, version),
         pending_count = COALESCE(p_pending, 0), last_seen = NOW()
   WHERE id = v_dev.id;

  IF v_dev.event_id IS NOT NULL THEN
    SELECT * INTO v_event FROM himitsu.events WHERE id = v_dev.event_id;
  END IF;
  SELECT slug INTO v_slug FROM himitsu.organizations WHERE id = v_dev.org_id;

  RETURN json_build_object('ok', true, 'managed', v_dev.managed,
    'org_id', v_dev.org_id, 'org_slug', v_slug,
    'event_id', v_dev.event_id, 'event_name', v_event.name, 'event_status', v_event.status);
END $$;
GRANT EXECUTE ON FUNCTION himitsu.device_heartbeat(TEXT, TEXT, TEXT, INT) TO authenticated;
