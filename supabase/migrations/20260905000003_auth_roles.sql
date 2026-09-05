-- ============================================================================
-- HiMitsu L3：角色權限矩陣＋邀請流程＋RLS 角色細分
-- 執行位置：Supabase SQL Editor 貼上執行一次（需先跑過 L2 core_tables）。
-- 鐵律：本檔只建 himitsu schema 內物件，不觸碰 public。
-- 設計依據：EPIC-0 規格 §0-2（權限矩陣存 DB、RLS 與前端同源引用；AC-3/AC-4）
-- ============================================================================

-- ── 權限矩陣（單一事實來源：RLS 用它判斷，前端也讀它決定 UI）────────
CREATE TABLE himitsu.role_permissions (
  role TEXT NOT NULL,
  perm TEXT NOT NULL,          -- 格式：<資源>.<動作>，如 persons.write
  PRIMARY KEY (role, perm)
);

-- owner / secretary_general：全權
INSERT INTO himitsu.role_permissions(role, perm)
SELECT r, p
FROM unnest(ARRAY['owner','secretary_general']) AS r,
     unnest(ARRAY['orgs.update','org_users.manage',
                  'persons.write','legal_entities.write','identities.write',
                  'memberships.write','rosters.write','roster_entries.write',
                  'org_settings.write','fees.write','checkin.write']) AS p;

-- secretary：會務資料全可寫，但不可管帳號、不可改協會設定
INSERT INTO himitsu.role_permissions(role, perm)
SELECT 'secretary', p
FROM unnest(ARRAY['persons.write','legal_entities.write','identities.write',
                  'memberships.write','rosters.write','roster_entries.write',
                  'checkin.write']) AS p;

-- finance：只能標記繳費（fees 表屬 EPIC-1，先入冊）；不可改會籍（AC-3）
INSERT INTO himitsu.role_permissions VALUES ('finance','fees.write');

-- election_officer：名冊建立與凍結
INSERT INTO himitsu.role_permissions VALUES
  ('election_officer','rosters.write'),
  ('election_officer','roster_entries.write');

-- staff：現場報到（checkin 表屬 EPIC-1）；不可改會員資料（AC-3）
INSERT INTO himitsu.role_permissions VALUES ('staff','checkin.write');

-- viewer：無任何寫入權（讀取權由 is_org_member 提供，不在矩陣內）

ALTER TABLE himitsu.role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY roleperms_read ON himitsu.role_permissions FOR SELECT
  TO authenticated USING (true);
GRANT SELECT ON himitsu.role_permissions TO authenticated;

-- ── 權限判斷函式（RLS 的執行點）──────────────────────────────────────
CREATE OR REPLACE FUNCTION himitsu.has_perm(p_org UUID, p_perm TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM himitsu.org_users ou
    JOIN himitsu.role_permissions rp ON rp.role = ou.role
    WHERE ou.org_id = p_org AND ou.user_id = auth.uid()
      AND ou.status = 'active' AND rp.perm = p_perm
  );
$$;
GRANT EXECUTE ON FUNCTION himitsu.has_perm(UUID, TEXT) TO authenticated;

-- ── RLS 細分：把 L2 的「成員全可寫」換成「讀＝成員、寫＝看矩陣」──────
DO $$ DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['persons','legal_entities','identities','memberships',
                           'rosters','roster_entries','org_settings']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_rw ON himitsu.%I', t, t);
    EXECUTE format('CREATE POLICY %I_read ON himitsu.%I FOR SELECT TO authenticated
                    USING (himitsu.is_org_member(org_id))', t, t);
    EXECUTE format('CREATE POLICY %I_insert ON himitsu.%I FOR INSERT TO authenticated
                    WITH CHECK (himitsu.has_perm(org_id, %L))', t, t, t || '.write');
    EXECUTE format('CREATE POLICY %I_update ON himitsu.%I FOR UPDATE TO authenticated
                    USING (himitsu.has_perm(org_id, %L))
                    WITH CHECK (himitsu.has_perm(org_id, %L))', t, t, t || '.write', t || '.write');
    EXECUTE format('CREATE POLICY %I_delete ON himitsu.%I FOR DELETE TO authenticated
                    USING (himitsu.has_perm(org_id, %L))', t, t, t || '.write');
  END LOOP;
END $$;

-- organizations 的更新也改看矩陣
DROP POLICY IF EXISTS org_update ON himitsu.organizations;
CREATE POLICY org_update ON himitsu.organizations FOR UPDATE TO authenticated
  USING (himitsu.has_perm(id, 'orgs.update'))
  WITH CHECK (himitsu.has_perm(id, 'orgs.update'));

-- ── org_users：帳號管理（L2 只開了讀，這裡補上管理寫入權）────────────
ALTER TABLE himitsu.org_users ADD COLUMN email TEXT;  -- 顯示用（auth.users 不走 REST）

CREATE POLICY orgusers_insert ON himitsu.org_users FOR INSERT TO authenticated
  WITH CHECK (himitsu.has_perm(org_id, 'org_users.manage'));
CREATE POLICY orgusers_update ON himitsu.org_users FOR UPDATE TO authenticated
  USING (himitsu.has_perm(org_id, 'org_users.manage'))
  WITH CHECK (himitsu.has_perm(org_id, 'org_users.manage'));
CREATE POLICY orgusers_delete ON himitsu.org_users FOR DELETE TO authenticated
  USING (himitsu.has_perm(org_id, 'org_users.manage'));

-- owner 保護：owner 角色的授予/異動只有 owner 能做，且不可弄丟最後一位 owner
CREATE OR REPLACE FUNCTION himitsu.guard_org_users()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_org UUID := COALESCE(NEW.org_id, OLD.org_id);
  v_actor_is_owner BOOLEAN;
  v_other_owners INT;
BEGIN
  -- 無 JWT ＝ service/管理情境（SQL Editor、seed 腳本），不受本守衛限制
  IF v_actor IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT EXISTS (SELECT 1 FROM himitsu.org_users
                 WHERE org_id = v_org AND user_id = v_actor
                   AND role = 'owner' AND status = 'active')
    INTO v_actor_is_owner;

  -- 授予 owner：僅 owner 可為之；唯一例外是開新協會的第一筆（bootstrap）
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.role = 'owner' AND NOT v_actor_is_owner THEN
    IF NOT (TG_OP = 'INSERT' AND NEW.user_id = v_actor
            AND NOT EXISTS (SELECT 1 FROM himitsu.org_users WHERE org_id = v_org)) THEN
      RAISE EXCEPTION '只有 owner 能授予 owner 角色';
    END IF;
  END IF;

  IF TG_OP IN ('UPDATE','DELETE') AND OLD.role = 'owner' THEN
    IF NOT v_actor_is_owner THEN
      RAISE EXCEPTION '只有 owner 能異動 owner 的帳號';
    END IF;
    IF TG_OP = 'DELETE' OR NEW.role <> 'owner' OR NEW.status <> 'active' THEN
      SELECT count(*) INTO v_other_owners FROM himitsu.org_users
       WHERE org_id = v_org AND role = 'owner' AND status = 'active'
         AND user_id <> OLD.user_id;
      IF v_other_owners = 0 THEN
        RAISE EXCEPTION '協會至少需保留一位有效的 owner';
      END IF;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER trg_guard_org_users BEFORE INSERT OR UPDATE OR DELETE ON himitsu.org_users
  FOR EACH ROW EXECUTE FUNCTION himitsu.guard_org_users();

-- ── 邀請流程（email 邀請 → 受邀者登入後憑 token 入職）────────────────
CREATE TABLE himitsu.invitations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES himitsu.organizations(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN
              ('secretary_general','secretary','finance','election_officer','staff','viewer')),
  token       UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
              ('pending','accepted','revoked','expired')),
  invited_by  UUID DEFAULT auth.uid(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  accepted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_invitations_org ON himitsu.invitations(org_id, status);

ALTER TABLE himitsu.invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY invitations_manage ON himitsu.invitations FOR ALL TO authenticated
  USING (himitsu.has_perm(org_id, 'org_users.manage'))
  WITH CHECK (himitsu.has_perm(org_id, 'org_users.manage'));
GRANT SELECT, INSERT, UPDATE, DELETE ON himitsu.invitations TO authenticated;

CREATE TRIGGER trg_audit_invitations AFTER INSERT OR UPDATE OR DELETE ON himitsu.invitations
  FOR EACH ROW EXECUTE FUNCTION himitsu.audit();

-- 發出邀請（owner 不可被邀請——移轉 owner 是日後獨立功能）
CREATE OR REPLACE FUNCTION himitsu.invite_user(p_org UUID, p_email TEXT, p_role TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_token UUID; v_email TEXT := lower(btrim(p_email));
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF NOT himitsu.has_perm(p_org, 'org_users.manage') THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_email');
  END IF;
  IF p_role NOT IN ('secretary_general','secretary','finance','election_officer','staff','viewer') THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_role');
  END IF;
  IF EXISTS (SELECT 1 FROM himitsu.org_users
             WHERE org_id = p_org AND lower(email) = v_email) THEN
    RETURN json_build_object('ok', false, 'error', 'already_member');
  END IF;

  -- 同 email 既有的待處理邀請一律作廢重發
  UPDATE himitsu.invitations SET status = 'revoked'
   WHERE org_id = p_org AND lower(email) = v_email AND status = 'pending';

  INSERT INTO himitsu.invitations(org_id, email, role) VALUES (p_org, v_email, p_role)
    RETURNING token INTO v_token;
  RETURN json_build_object('ok', true, 'token', v_token);
END $$;
GRANT EXECUTE ON FUNCTION himitsu.invite_user(UUID, TEXT, TEXT) TO authenticated;

-- 受邀者接受邀請（需已登入，且登入 email 與受邀 email 一致）
CREATE OR REPLACE FUNCTION himitsu.accept_invitation(p_token UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_inv himitsu.invitations%ROWTYPE;
  v_org himitsu.organizations%ROWTYPE;
  v_email TEXT := lower(COALESCE(auth.jwt()->>'email', ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  SELECT * INTO v_inv FROM himitsu.invitations WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_inv.status <> 'pending' THEN
    RETURN json_build_object('ok', false, 'error', v_inv.status);
  END IF;
  IF v_inv.expires_at < NOW() THEN
    UPDATE himitsu.invitations SET status = 'expired' WHERE id = v_inv.id;
    RETURN json_build_object('ok', false, 'error', 'expired');
  END IF;
  IF v_email = '' OR v_email <> lower(v_inv.email) THEN
    RETURN json_build_object('ok', false, 'error', 'email_mismatch');
  END IF;

  INSERT INTO himitsu.org_users(org_id, user_id, role, status, invited_by, email)
  VALUES (v_inv.org_id, auth.uid(), v_inv.role, 'active', v_inv.invited_by, v_email)
  ON CONFLICT (org_id, user_id)
    DO UPDATE SET status = 'active', email = EXCLUDED.email;  -- 已在籍者不改角色

  UPDATE himitsu.invitations SET status = 'accepted', accepted_at = NOW()
   WHERE id = v_inv.id;

  SELECT * INTO v_org FROM himitsu.organizations WHERE id = v_inv.org_id;
  RETURN json_build_object('ok', true, 'org_slug', v_org.slug,
                           'org_name', v_org.name, 'role', v_inv.role);
END $$;
GRANT EXECUTE ON FUNCTION himitsu.accept_invitation(UUID) TO authenticated;

-- 開協會 RPC 補記 email（顯示用）
CREATE OR REPLACE FUNCTION himitsu.create_organization(p_name TEXT, p_slug TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_org UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  INSERT INTO himitsu.organizations(name, slug) VALUES (btrim(p_name), lower(btrim(p_slug)))
    RETURNING id INTO v_org;
  INSERT INTO himitsu.org_users(org_id, user_id, role, email)
  VALUES (v_org, auth.uid(), 'owner', lower(COALESCE(auth.jwt()->>'email', '')));
  RETURN json_build_object('ok', true, 'org_id', v_org);
EXCEPTION WHEN unique_violation THEN
  RETURN json_build_object('ok', false, 'error', 'slug_taken');
END $$;
