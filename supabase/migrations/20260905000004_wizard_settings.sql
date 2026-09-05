-- ============================================================================
-- HiMitsu L4：租戶精靈＋設定中心
-- 執行位置：Supabase SQL Editor 貼上執行一次（需先跑過 L2、L3 migration）。
-- 鐵律：本檔只建 himitsu schema 內物件，不觸碰 public。
-- 設計依據：EPIC-0 規格 §0-1（開協會精靈）、§0-4（設定中心；AC-7）
-- 設計：settings_catalog＝設定項目錄（預設值/型別/標籤的單一事實來源），
--       org_settings 只存各協會的覆寫值；讀取一律走 get_setting() fallback。
-- ============================================================================

-- ── 設定項目錄（TADA 寫死常數的盤點入冊）────────────────────────────
CREATE TABLE himitsu.settings_catalog (
  key           TEXT PRIMARY KEY,
  category      TEXT NOT NULL,
  label         TEXT NOT NULL,
  description   TEXT,
  value_type    TEXT NOT NULL CHECK (value_type IN ('text','number','boolean','json')),
  default_value JSONB NOT NULL,
  sort          INT NOT NULL DEFAULT 0
);

INSERT INTO himitsu.settings_catalog (key, category, label, description, value_type, default_value, sort) VALUES
 -- 會員編號（AC-7 的主角）
 ('member_no.rule',        '會員編號', '編號規則',     '樣板字串，{seq} 會代入流水號；pad＝補零位數', 'json',   '{"template":"M{seq}","pad":4}', 10),
 ('member_no.next_seq',    '會員編號', '下一個流水號', '新建會員時自動遞增，一般不需手動改',           'number', '1',    11),
 -- 會費
 ('fees.individual_annual','會費',     '個人會員年費', '單位：元',                                     'number', '3000', 20),
 ('fees.group_annual',     '會費',     '團體會員年費', '單位：元',                                     'number', '10000',21),
 ('fees.entry_individual', '會費',     '個人入會費',   '單位：元',                                     'number', '1000', 22),
 ('fees.entry_group',      '會費',     '團體入會費',   '單位：元',                                     'number', '2000', 23),
 -- 章程參數
 ('charter.term_years',            '章程', '每屆任期（年）',     NULL,                       'number', '3',  30),
 ('charter.board_seats',           '章程', '理事席次',           NULL,                       'number', '15', 31),
 ('charter.board_alternate_seats', '章程', '候補理事席次',       NULL,                       'number', '5',  32),
 ('charter.supervisor_seats',      '章程', '監事席次',           NULL,                       'number', '5',  33),
 ('charter.supervisor_alternate_seats','章程','候補監事席次',    NULL,                       'number', '1',  34),
 ('charter.expel_unpaid_years',    '章程', '欠費除籍年限（年）', '連續欠費達此年限得提請除籍','number', '2',  35),
 -- 大會現場（TADA 實戰寫死項的制度化）
 ('assembly.table_capacity',   '大會', '每桌人數',       NULL,                              'number', '10',   40),
 ('assembly.max_tables',       '大會', '桌數上限',       NULL,                              'number', '30',   41),
 ('assembly.kiosk_pin',        '大會', '報到機管理密碼', '現場報到機的管理面板密碼',        'text',   '"0000"', 42),
 ('assembly.welcome_message',  '大會', '報到歡迎詞',     '報到成功畫面顯示的文字',          'text',   '"歡迎蒞臨會員大會"', 43),
 -- 功能開關
 ('features.fees',    '功能開關', '繳費模組',     '關閉後前端隱藏繳費相關功能', 'boolean', 'true',  50),
 ('features.voting',  '功能開關', '選務模組',     NULL,                         'boolean', 'true',  51),
 ('features.checkin', '功能開關', '報到模組',     NULL,                         'boolean', 'true',  52),
 ('features.line_notify','功能開關','LINE 通知',  '需另行設定 LINE 官方帳號',   'boolean', 'false', 53),
 -- 文案
 ('text.org_short_name', '文案', '協會簡稱', '通知與報表用的短名稱', 'text', '""', 60);

ALTER TABLE himitsu.settings_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY catalog_read ON himitsu.settings_catalog FOR SELECT TO authenticated USING (true);
GRANT SELECT ON himitsu.settings_catalog TO authenticated;

-- ── 讀取設定：協會覆寫值 → 目錄預設值 ────────────────────────────────
CREATE OR REPLACE FUNCTION himitsu.get_setting(p_org UUID, p_key TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  IF NOT himitsu.is_org_member(p_org) AND auth.uid() IS NOT NULL THEN
    RETURN NULL;  -- 非成員讀不到（service 情境 auth.uid() 為 NULL 則放行）
  END IF;
  RETURN COALESCE(
    (SELECT value FROM himitsu.org_settings WHERE org_id = p_org AND key = p_key),
    (SELECT default_value FROM himitsu.settings_catalog WHERE key = p_key)
  );
END $$;
GRANT EXECUTE ON FUNCTION himitsu.get_setting(UUID, TEXT) TO authenticated;

-- ── 產生會員編號（AC-7：套用「當下」的規則；流水號 upsert 遞增防併發）─
CREATE OR REPLACE FUNCTION himitsu.next_member_no(p_org UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_rule JSONB;
  v_template TEXT;
  v_pad INT;
  v_seq INT;
BEGIN
  IF NOT himitsu.has_perm(p_org, 'memberships.write') THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;

  v_rule := himitsu.get_setting(p_org, 'member_no.rule');
  v_template := COALESCE(v_rule->>'template', 'M{seq}');
  v_pad := COALESCE((v_rule->>'pad')::int, 4);

  INSERT INTO himitsu.org_settings(org_id, key, value, updated_by)
  VALUES (p_org, 'member_no.next_seq',
          to_jsonb(COALESCE((himitsu.get_setting(p_org, 'member_no.next_seq') #>> '{}')::int, 1) + 1),
          auth.uid())
  ON CONFLICT (org_id, key) DO UPDATE
    SET value = to_jsonb((himitsu.org_settings.value #>> '{}')::int + 1),
        updated_at = NOW(), updated_by = auth.uid()
  RETURNING ((value #>> '{}')::int - 1) INTO v_seq;

  RETURN json_build_object('ok', true, 'member_no',
    replace(v_template, '{seq}', lpad(v_seq::text, GREATEST(v_pad, length(v_seq::text)), '0')),
    'seq', v_seq);
END $$;
GRANT EXECUTE ON FUNCTION himitsu.next_member_no(UUID) TO authenticated;

-- ── 開協會精靈：一次帶入 LOGO 與主題色 ───────────────────────────────
-- 換簽名需先移除舊版（避免 PostgREST 多載混淆）
DROP FUNCTION IF EXISTS himitsu.create_organization(TEXT, TEXT);

CREATE OR REPLACE FUNCTION himitsu.create_organization(
  p_name TEXT, p_slug TEXT, p_logo_url TEXT DEFAULT NULL, p_theme JSONB DEFAULT '{}'::jsonb)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_org UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF jsonb_typeof(COALESCE(p_theme, '{}'::jsonb)) <> 'object' THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_theme');
  END IF;
  INSERT INTO himitsu.organizations(name, slug, logo_url, theme)
  VALUES (btrim(p_name), lower(btrim(p_slug)), NULLIF(btrim(p_logo_url), ''), COALESCE(p_theme, '{}'::jsonb))
    RETURNING id INTO v_org;
  INSERT INTO himitsu.org_users(org_id, user_id, role, email)
  VALUES (v_org, auth.uid(), 'owner', lower(COALESCE(auth.jwt()->>'email', '')));
  RETURN json_build_object('ok', true, 'org_id', v_org, 'slug', lower(btrim(p_slug)));
EXCEPTION WHEN unique_violation THEN
  RETURN json_build_object('ok', false, 'error', 'slug_taken');
END $$;
GRANT EXECUTE ON FUNCTION himitsu.create_organization(TEXT, TEXT, TEXT, JSONB) TO authenticated;
