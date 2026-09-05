-- ============================================================================
-- HiMitsu 設定中心測試（AC-7）——結果表格版
-- 用法：Supabase SQL Editor 整段貼上執行，PASS/FAIL 直接顯示在 Results 表格。
--（新版 SQL Editor 看不到 RAISE NOTICE，故以回傳表格取代 settings_test.sql）
-- 前置：需已執行 L2、L3、L4 三支 migration。
-- 安全性：測試資料用 l4test- 前綴，跑完在函式內自我清除；
--         中途出錯則整條 SELECT 語句自動回滾，同樣不留東西。
--         函式建立在 pg_temp（暫存 schema），連線結束自動消失。
-- ============================================================================

CREATE OR REPLACE FUNCTION pg_temp.himitsu_l4_cleanup()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ids UUID[];
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT array_agg(id) INTO v_ids FROM himitsu.organizations WHERE slug LIKE 'l4test-%';
  IF v_ids IS NOT NULL THEN
    DELETE FROM himitsu.organizations WHERE id = ANY(v_ids);
    DELETE FROM himitsu.audit_log WHERE org_id = ANY(v_ids);
  END IF;
  DELETE FROM auth.users WHERE email LIKE 'l4-%@test.local';
END $$;

CREATE OR REPLACE FUNCTION pg_temp.himitsu_l4_test()
RETURNS TABLE(item TEXT, result TEXT) LANGUAGE plpgsql AS $$
DECLARE
  j JSON; v JSONB; n INT;
  v_org_d UUID; v_org_e UUID;
  v_theme JSONB; v_logo TEXT;
BEGIN
  PERFORM pg_temp.himitsu_l4_cleanup();  -- 清掉上次可能的殘留

  -- 測試使用者：D 協會 owner＋secretary＋staff、E 協會 owner
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          confirmation_token, recovery_token, email_change, email_change_token_new)
  VALUES
   ('00000000-0000-0000-0000-000000000000','dddddddd-0000-4000-8000-000000000001',
    'authenticated','authenticated','l4-own-d@test.local','x',NOW(),NOW(),NOW(),'','','',''),
   ('00000000-0000-0000-0000-000000000000','dddddddd-0000-4000-8000-000000000002',
    'authenticated','authenticated','l4-sec-d@test.local','x',NOW(),NOW(),NOW(),'','','',''),
   ('00000000-0000-0000-0000-000000000000','dddddddd-0000-4000-8000-000000000003',
    'authenticated','authenticated','l4-stf-d@test.local','x',NOW(),NOW(),NOW(),'','','',''),
   ('00000000-0000-0000-0000-000000000000','eeeeeeee-0000-4000-8000-000000000001',
    'authenticated','authenticated','l4-own-e@test.local','x',NOW(),NOW(),NOW(),'','','','');

  -- ── 精靈：以 D 的 owner 身分開協會，帶 LOGO＋主題色 ──────────────
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
    '{"sub":"dddddddd-0000-4000-8000-000000000001","role":"authenticated","email":"l4-own-d@test.local"}', true);

  j := himitsu.create_organization('L4測試協會D','l4test-org-d',
        'https://example.com/logo.png','{"primary_color":"#1e4d2b"}'::jsonb);
  IF (j->>'ok')::boolean THEN
    v_org_d := (j->>'org_id')::uuid;
    SELECT theme, logo_url INTO v_theme, v_logo FROM himitsu.organizations WHERE id = v_org_d;
    IF v_theme->>'primary_color' = '#1e4d2b' AND v_logo = 'https://example.com/logo.png' THEN
      item := '精靈a'; result := 'PASS：開協會一次帶入 LOGO＋主題色'; RETURN NEXT;
    ELSE
      item := '精靈a'; result := format('FAIL：theme=%s logo=%s', v_theme, v_logo); RETURN NEXT;
    END IF;
  ELSE
    item := '精靈a'; result := format('FAIL：建立失敗（%s）', j->>'error'); RETURN NEXT;
  END IF;

  -- ── 設定讀取：無覆寫時回目錄預設值 ───────────────────────────────
  v := himitsu.get_setting(v_org_d, 'fees.individual_annual');
  IF v = to_jsonb(3000) THEN item := '設定a'; result := 'PASS：無覆寫時回目錄預設（個人年費 3000）';
  ELSE item := '設定a'; result := format('FAIL：讀到 %s（應為 3000）', v); END IF;
  RETURN NEXT;

  -- ── AC-7 主軸：D 自訂編號規則 ────────────────────────────────────
  INSERT INTO himitsu.org_settings(org_id, key, value)
  VALUES (v_org_d, 'member_no.rule', '{"template":"TC-{seq}","pad":3}'::jsonb);

  j := himitsu.next_member_no(v_org_d);
  IF j->>'member_no' = 'TC-001' THEN item := 'AC-7a'; result := 'PASS：D 新編號套用自訂規則（TC-001）';
  ELSE item := 'AC-7a'; result := format('FAIL：D 編號＝%s（應為 TC-001）', j::text); END IF;
  RETURN NEXT;

  j := himitsu.next_member_no(v_org_d);
  IF j->>'member_no' = 'TC-002' THEN item := 'AC-7b'; result := 'PASS：流水號正確遞增（TC-002）';
  ELSE item := 'AC-7b'; result := format('FAIL：D 第二筆＝%s', j::text); END IF;
  RETURN NEXT;

  UPDATE himitsu.org_settings SET value = '{"template":"新-{seq}","pad":2}'::jsonb
   WHERE org_id = v_org_d AND key = 'member_no.rule';
  j := himitsu.next_member_no(v_org_d);
  IF j->>'member_no' = '新-03' THEN item := 'AC-7c'; result := 'PASS：改規則後新建會員套用新規則（新-03，流水號延續）';
  ELSE item := 'AC-7c'; result := format('FAIL：改規則後＝%s（應為 新-03）', j::text); END IF;
  RETURN NEXT;

  -- ── E 協會：用預設規則，與 D 完全隔離 ────────────────────────────
  PERFORM set_config('request.jwt.claims',
    '{"sub":"eeeeeeee-0000-4000-8000-000000000001","role":"authenticated","email":"l4-own-e@test.local"}', true);
  j := himitsu.create_organization('L4測試協會E','l4test-org-e');
  v_org_e := (j->>'org_id')::uuid;

  j := himitsu.next_member_no(v_org_e);
  IF j->>'member_no' = 'M0001' THEN item := 'AC-7d'; result := 'PASS：E 用預設規則（M0001），與 D 完全隔離';
  ELSE item := 'AC-7d'; result := format('FAIL：E 編號＝%s（應為 M0001）', j::text); END IF;
  RETURN NEXT;

  IF himitsu.get_setting(v_org_d, 'member_no.rule') IS NULL THEN
    item := 'AC-7e'; result := 'PASS：E 的帳號讀不到 D 的設定';
  ELSE
    item := 'AC-7e'; result := 'FAIL：跨協會讀到設定！';
  END IF;
  RETURN NEXT;

  -- ── 權限：secretary 不可改設定、staff 不可產號 ───────────────────
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO himitsu.org_users(org_id, user_id, role, email) VALUES
   (v_org_d,'dddddddd-0000-4000-8000-000000000002','secretary','l4-sec-d@test.local'),
   (v_org_d,'dddddddd-0000-4000-8000-000000000003','staff','l4-stf-d@test.local');

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
    '{"sub":"dddddddd-0000-4000-8000-000000000002","role":"authenticated","email":"l4-sec-d@test.local"}', true);
  UPDATE himitsu.org_settings SET value = '9999'::jsonb
   WHERE org_id = v_org_d AND key = 'member_no.rule';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN item := '權限a'; result := 'PASS：secretary 改設定被拒（0 列生效）';
  ELSE item := '權限a'; result := format('FAIL：secretary 竟改到 %s 列設定！', n); END IF;
  RETURN NEXT;

  PERFORM set_config('request.jwt.claims',
    '{"sub":"dddddddd-0000-4000-8000-000000000003","role":"authenticated","email":"l4-stf-d@test.local"}', true);
  j := himitsu.next_member_no(v_org_d);
  IF (j->>'ok')::boolean = false AND j->>'error' = 'forbidden' THEN
    item := '權限b'; result := 'PASS：staff 不可產生會員編號';
  ELSE
    item := '權限b'; result := format('FAIL：staff 產號結果＝%s', j::text);
  END IF;
  RETURN NEXT;

  -- ── 收尾：清除全部測試資料 ───────────────────────────────────────
  PERFORM pg_temp.himitsu_l4_cleanup();
  item := '收尾'; result := 'PASS：測試資料已全部清除'; RETURN NEXT;
END $$;

SELECT * FROM pg_temp.himitsu_l4_test();
