-- ============================================================================
-- HiMitsu L18：貴賓報到——祝福詞＋手寫簽名（祝福牆資料源）
-- 執行位置：Supabase SQL Editor 貼上執行一次（需先跑過 L7/L8 events/checkin）。
-- 鐵律：本檔只建 himitsu schema 內物件，不觸碰 public。
-- 來源：TADA 貴賓報到（guest/index.html＋blessing/index.html）多租戶重寫：
--   TADA 版 RPC 開給 anon、簽名存在名單表；這裡改為登入＋has_perm、獨立一張表
--   （名單 select * 不會連帶拉回簽名圖，報到台與報到機快照不受影響）。
-- ============================================================================

-- ── 設定：祝福詞（報到後讓貴賓選一句；最多 6 句、每句 ≤30 字）──────────
INSERT INTO himitsu.settings_catalog (key, category, label, description, value_type, default_value, sort) VALUES
  ('vip.greeting_phrases', '報到', '貴賓祝福詞',
   '貴賓報到後可選的祝福句（JSON 字串陣列，最多 6 句、每句 30 字內）', 'json',
   '["感謝一路相挺，來年更上層樓","風調雨順，五穀豐收","身體健康，闔家平安"]', 46)
ON CONFLICT (key) DO NOTHING;

-- ── 祝福（一位出席者一筆，可重送覆蓋；hidden_at＝主辦從祝福牆撤下）────────
CREATE TABLE IF NOT EXISTS himitsu.attendee_greetings (
  attendee_id UUID PRIMARY KEY REFERENCES himitsu.event_attendees(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES himitsu.organizations(id) ON DELETE CASCADE,
  event_id    UUID NOT NULL REFERENCES himitsu.events(id) ON DELETE CASCADE,
  greeting    TEXT CHECK (greeting IS NULL OR char_length(greeting) BETWEEN 1 AND 30),
  signature   TEXT CHECK (signature IS NULL OR (
                signature ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$'
                AND char_length(signature) <= 200000)),
  hidden_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (greeting IS NOT NULL OR signature IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_greetings_event ON himitsu.attendee_greetings(event_id, updated_at);

-- 讀：協會成員（祝福牆、後台）；寫：只走下方 RPC（不開 INSERT/UPDATE policy）
ALTER TABLE himitsu.attendee_greetings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS greetings_read ON himitsu.attendee_greetings;
CREATE POLICY greetings_read ON himitsu.attendee_greetings FOR SELECT TO authenticated
  USING (himitsu.is_org_member(org_id));
GRANT SELECT ON himitsu.attendee_greetings TO authenticated;

-- ── 送出祝福（報到權即可；必須已報到、未除名）────────────────────────────
CREATE OR REPLACE FUNCTION himitsu.submit_greeting(p_attendee UUID, p_greeting TEXT, p_signature TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_att himitsu.event_attendees%ROWTYPE;
  v_greeting TEXT := NULLIF(btrim(COALESCE(p_greeting, '')), '');
  v_signature TEXT := NULLIF(btrim(COALESCE(p_signature, '')), '');
BEGIN
  SELECT * INTO v_att FROM himitsu.event_attendees WHERE id = p_attendee;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'not_found'); END IF;
  IF NOT himitsu.has_perm(v_att.org_id, 'checkin.write') THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF v_att.removed_at IS NOT NULL THEN RETURN json_build_object('ok', false, 'error', 'removed'); END IF;
  IF v_att.checked_in_at IS NULL THEN RETURN json_build_object('ok', false, 'error', 'not_checked_in'); END IF;
  IF v_greeting IS NULL AND v_signature IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'empty');
  END IF;

  INSERT INTO himitsu.attendee_greetings(attendee_id, org_id, event_id, greeting, signature)
  VALUES (p_attendee, v_att.org_id, v_att.event_id, v_greeting, v_signature)
  ON CONFLICT (attendee_id) DO UPDATE
    SET greeting = EXCLUDED.greeting, signature = EXCLUDED.signature, updated_at = NOW();
  -- hidden_at 不重設：主辦撤下的祝福，重送也不會自動回到祝福牆
  RETURN json_build_object('ok', true);
EXCEPTION WHEN check_violation THEN
  RETURN json_build_object('ok', false, 'error', 'invalid', 'detail', SQLERRM);
END $$;
REVOKE ALL ON FUNCTION himitsu.submit_greeting(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION himitsu.submit_greeting(UUID, TEXT, TEXT) TO authenticated;

-- ── 祝福牆撤下／恢復（名單編輯權：負責人／秘書長／秘書）──────────────────
CREATE OR REPLACE FUNCTION himitsu.set_greeting_hidden(p_attendee UUID, p_hidden BOOLEAN)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_org UUID;
BEGIN
  SELECT org_id INTO v_org FROM himitsu.attendee_greetings WHERE attendee_id = p_attendee;
  IF v_org IS NULL THEN RETURN json_build_object('ok', false, 'error', 'not_found'); END IF;
  IF NOT himitsu.has_perm(v_org, 'events.write') THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;
  UPDATE himitsu.attendee_greetings
     SET hidden_at = CASE WHEN p_hidden THEN NOW() ELSE NULL END, updated_at = NOW()
   WHERE attendee_id = p_attendee;
  RETURN json_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION himitsu.set_greeting_hidden(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION himitsu.set_greeting_hidden(UUID, BOOLEAN) TO authenticated;
