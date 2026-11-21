-- ============================================================================
-- HiMitsu L22 會員 CSV 匯入測試——結果表格版
-- 用法：Supabase SQL Editor 整段貼上執行，PASS/FAIL 直接顯示在 Results 表格。
-- 前置：需已執行 migration 20261121000014_member_import.sql。
-- 安全性：測試資料用 memtest 前綴、函式內自我清除。
-- ============================================================================

CREATE OR REPLACE FUNCTION pg_temp.himitsu_mem_cleanup()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ids UUID[];
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT array_agg(id) INTO v_ids FROM himitsu.organizations WHERE slug = 'memtest';
  IF v_ids IS NOT NULL THEN
    DELETE FROM himitsu.organizations WHERE id = ANY(v_ids);
    DELETE FROM himitsu.audit_log WHERE org_id = ANY(v_ids);
  END IF;
  DELETE FROM auth.users WHERE email LIKE 'memtest-%@test.local';
END $$;

CREATE OR REPLACE FUNCTION pg_temp.himitsu_mem_as(p_user UUID, p_email TEXT)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'email', p_email)::text, true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.himitsu_mem_test()
RETURNS TABLE(item TEXT, result TEXT) LANGUAGE plpgsql AS $$
DECLARE
  ORG CONSTANT UUID := '99999999-0000-4000-8000-000000000023';
  U_SG CONSTANT UUID := 'ffffffff-0000-4000-8000-000000000231';
  U_SEC CONSTANT UUID := 'ffffffff-0000-4000-8000-000000000232';
  U_STF CONSTANT UUID := 'ffffffff-0000-4000-8000-000000000233';
  j JSON; n INT; v_text TEXT;
BEGIN
  PERFORM pg_temp.himitsu_mem_cleanup();

  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          confirmation_token, recovery_token, email_change, email_change_token_new)
  VALUES
   ('00000000-0000-0000-0000-000000000000', U_SG,'authenticated','authenticated','memtest-sg@test.local','x',NOW(),NOW(),NOW(),'','','',''),
   ('00000000-0000-0000-0000-000000000000', U_SEC,'authenticated','authenticated','memtest-sec@test.local','x',NOW(),NOW(),NOW(),'','','',''),
   ('00000000-0000-0000-0000-000000000000', U_STF,'authenticated','authenticated','memtest-stf@test.local','x',NOW(),NOW(),NOW(),'','','','');
  INSERT INTO himitsu.organizations(id, slug, name) VALUES (ORG, 'memtest', '會員匯入測試');
  INSERT INTO himitsu.org_users(org_id, user_id, role, email) VALUES
   (ORG, U_SG, 'secretary_general', 'memtest-sg@test.local'),
   (ORG, U_SEC, 'secretary', 'memtest-sec@test.local'),
   (ORG, U_STF, 'staff', 'memtest-stf@test.local');
  -- 既有會員：陳大華（二林鎮）已有手機，林阿土（無單位）沒有手機
  INSERT INTO himitsu.persons(org_id, name, affiliation, mobile) VALUES
   (ORG, '陳大華', '二林鎮', '0911000111'), (ORG, '林阿土', NULL, NULL);

  EXECUTE 'SET LOCAL ROLE authenticated';

  -- M1：秘書長匯入——新會員建立、既有會員合併、缺的分類自動建立並勾選
  PERFORM pg_temp.himitsu_mem_as(U_SG, 'memtest-sg@test.local');
  j := himitsu.import_members(ORG, '[
    {"line":2,"name":"陳大華","affiliation":"二林鎮","mobile":"0922000222","categories":["農民"]},
    {"line":3,"name":"林阿土","affiliation":null,"mobile":"0933000333","categories":["農民"]},
    {"line":4,"name":"王貴賓","affiliation":"彰化縣農會","mobile":null,"categories":["貴賓","農會代表"]}]'::jsonb);
  SELECT count(*) INTO n FROM himitsu.person_category_links WHERE org_id = ORG;
  IF (j->>'ok')::boolean AND (j->>'created')::int = 1 AND (j->>'merged')::int = 2
     AND (j->>'categories_created')::int = 3 AND (j->>'links_added')::int = 4 AND n = 4 THEN
    item := 'M1'; result := 'PASS：新增 1、合併 2、自動建 3 個分類、勾選 4 筆';
  ELSE item := 'M1'; result := format('FAIL：%s／勾選 %s', j::text, n); END IF;
  RETURN NEXT;

  -- M2：合併時只補空白手機，不覆蓋原有手機
  SELECT string_agg(name || '=' || COALESCE(mobile, '-'), ',' ORDER BY name) INTO v_text
    FROM himitsu.persons WHERE org_id = ORG AND name IN ('陳大華', '林阿土');
  IF v_text = '林阿土=0933000333,陳大華=0911000111' THEN
    item := 'M2'; result := 'PASS：空白手機補上、既有手機保留';
  ELSE item := 'M2'; result := format('FAIL：%s', v_text); END IF;
  RETURN NEXT;

  -- M3：重匯同一份＝不新增會員、不重複勾選
  j := himitsu.import_members(ORG, '[
    {"line":2,"name":"王貴賓","affiliation":"彰化縣農會","mobile":null,"categories":["貴賓"]}]'::jsonb);
  SELECT count(*) INTO n FROM himitsu.persons WHERE org_id = ORG;
  IF (j->>'created')::int = 0 AND (j->>'links_added')::int = 0 AND n = 3 THEN
    item := 'M3'; result := 'PASS：重匯不重複新增、不重複勾選';
  ELSE item := 'M3'; result := format('FAIL：%s／會員 %s', j::text, n); END IF;
  RETURN NEXT;

  -- M4：秘書可用既有分類匯入；需要新分類時整批被拒（新增分類屬設定權）
  PERFORM pg_temp.himitsu_mem_as(U_SEC, 'memtest-sec@test.local');
  j := himitsu.import_members(ORG, '[{"line":2,"name":"秘書加的","affiliation":null,"mobile":null,"categories":["農民"]}]'::jsonb);
  IF (j->>'ok')::boolean THEN
    j := himitsu.import_members(ORG, '[
      {"line":2,"name":"不該出現","affiliation":null,"mobile":null,"categories":["農民"]},
      {"line":3,"name":"也不該出現","affiliation":null,"mobile":null,"categories":["理監事"]}]'::jsonb);
    SELECT count(*) INTO n FROM himitsu.persons WHERE org_id = ORG AND name IN ('不該出現', '也不該出現');
    IF j->>'error' = 'category_forbidden' AND n = 0 THEN
      item := 'M4'; result := 'PASS：秘書用既有分類成功；要新建分類時整批被拒（' || (j->>'detail') || '）';
    ELSE item := 'M4'; result := format('FAIL：%s／殘留 %s', j::text, n); END IF;
  ELSE item := 'M4'; result := format('FAIL：秘書用既有分類 %s', j::text); END IF;
  RETURN NEXT;

  -- M5：工作人員不可匯入
  PERFORM pg_temp.himitsu_mem_as(U_STF, 'memtest-stf@test.local');
  j := himitsu.import_members(ORG, '[{"line":2,"name":"丁","affiliation":null,"mobile":null,"categories":[]}]'::jsonb);
  IF j->>'error' = 'forbidden' THEN item := 'M5'; result := 'PASS：staff 匯入被拒';
  ELSE item := 'M5'; result := format('FAIL：%s', j::text); END IF;
  RETURN NEXT;

  -- M6：有一列錯（姓名空白）＝整批回滾並指出列號
  PERFORM pg_temp.himitsu_mem_as(U_SG, 'memtest-sg@test.local');
  j := himitsu.import_members(ORG, '[
    {"line":2,"name":"應回滾","affiliation":null,"mobile":null,"categories":["新分類甲"]},
    {"line":3,"name":"  ","affiliation":null,"mobile":null,"categories":[]}]'::jsonb);
  SELECT count(*) INTO n FROM himitsu.persons WHERE org_id = ORG AND name = '應回滾';
  IF NOT (j->>'ok')::boolean AND j->>'detail' = '第 3 列：姓名空白' AND n = 0
     AND NOT EXISTS (SELECT 1 FROM himitsu.person_categories WHERE org_id = ORG AND name = '新分類甲') THEN
    item := 'M6'; result := 'PASS：一列錯整批回滾（含新分類），指出第 3 列';
  ELSE item := 'M6'; result := format('FAIL：%s／殘留 %s', j::text, n); END IF;
  RETURN NEXT;

  PERFORM pg_temp.himitsu_mem_cleanup();
  item := '收尾'; result := 'PASS：測試資料已全部清除'; RETURN NEXT;
END $$;

SELECT * FROM pg_temp.himitsu_mem_test();
