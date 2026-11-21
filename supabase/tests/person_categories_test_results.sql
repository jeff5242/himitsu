-- ============================================================================
-- HiMitsu L21 人員分類測試——結果表格版
-- 用法：Supabase SQL Editor 整段貼上執行，PASS/FAIL 直接顯示在 Results 表格。
-- 前置：需已執行 migration 20261121000013_person_categories.sql。
-- 安全性：測試資料用 cattest 前綴、函式內自我清除。
-- ============================================================================

CREATE OR REPLACE FUNCTION pg_temp.himitsu_cat_cleanup()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ids UUID[];
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT array_agg(id) INTO v_ids FROM himitsu.organizations WHERE slug IN ('cattest', 'cattest-other');
  IF v_ids IS NOT NULL THEN
    DELETE FROM himitsu.organizations WHERE id = ANY(v_ids);
    DELETE FROM himitsu.audit_log WHERE org_id = ANY(v_ids);
  END IF;
  DELETE FROM auth.users WHERE email LIKE 'cattest-%@test.local';
END $$;

CREATE OR REPLACE FUNCTION pg_temp.himitsu_cat_as(p_user UUID, p_email TEXT)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'email', p_email)::text, true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.himitsu_cat_test()
RETURNS TABLE(item TEXT, result TEXT) LANGUAGE plpgsql AS $$
DECLARE
  ORG CONSTANT UUID := '99999999-0000-4000-8000-000000000021';
  ORG2 CONSTANT UUID := '99999999-0000-4000-8000-000000000022';
  U_SG CONSTANT UUID := 'ffffffff-0000-4000-8000-000000000211';
  U_SEC CONSTANT UUID := 'ffffffff-0000-4000-8000-000000000212';
  U_STF CONSTANT UUID := 'ffffffff-0000-4000-8000-000000000213';
  v_farmer UUID; v_vip UUID; v_other_cat UUID;
  p_farmer1 UUID; p_farmer2 UUID; p_vip UUID; p_member UUID; v_identity UUID;
  v_event UUID; j JSON; n INT; v_text TEXT;
BEGIN
  PERFORM pg_temp.himitsu_cat_cleanup();

  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          confirmation_token, recovery_token, email_change, email_change_token_new)
  VALUES
   ('00000000-0000-0000-0000-000000000000', U_SG,'authenticated','authenticated','cattest-sg@test.local','x',NOW(),NOW(),NOW(),'','','',''),
   ('00000000-0000-0000-0000-000000000000', U_SEC,'authenticated','authenticated','cattest-sec@test.local','x',NOW(),NOW(),NOW(),'','','',''),
   ('00000000-0000-0000-0000-000000000000', U_STF,'authenticated','authenticated','cattest-stf@test.local','x',NOW(),NOW(),NOW(),'','','','');
  INSERT INTO himitsu.organizations(id, slug, name) VALUES (ORG, 'cattest', '分類測試'), (ORG2, 'cattest-other', '他協會');
  INSERT INTO himitsu.org_users(org_id, user_id, role, email) VALUES
   (ORG, U_SG, 'secretary_general', 'cattest-sg@test.local'),
   (ORG, U_SEC, 'secretary', 'cattest-sec@test.local'),
   (ORG, U_STF, 'staff', 'cattest-stf@test.local');
  INSERT INTO himitsu.persons(org_id, name, affiliation) VALUES (ORG, '陳大華', '二林鎮') RETURNING id INTO p_farmer1;
  INSERT INTO himitsu.persons(org_id, name, affiliation) VALUES (ORG, '林阿土', NULL) RETURNING id INTO p_farmer2;
  INSERT INTO himitsu.persons(org_id, name, affiliation) VALUES (ORG, '王貴賓', '彰化縣農會') RETURNING id INTO p_vip;
  INSERT INTO himitsu.persons(org_id, name) VALUES (ORG, '會員甲') RETURNING id INTO p_member;
  INSERT INTO himitsu.identities(org_id, person_id, kind) VALUES (ORG, p_member, 'individual_member') RETURNING id INTO v_identity;
  INSERT INTO himitsu.person_categories(org_id, name) VALUES (ORG2, '他協會分類') RETURNING id INTO v_other_cat;
  INSERT INTO himitsu.events(org_id, name, kind) VALUES (ORG, '測試旺年會', 'banquet') RETURNING id INTO v_event;
  INSERT INTO himitsu.event_attendees(org_id, event_id, identity_id, category, source)
   VALUES (ORG, v_event, v_identity, 'member', 'import');

  EXECUTE 'SET LOCAL ROLE authenticated';

  -- C1：秘書長可建分類；秘書不行（分類屬協會設定）
  PERFORM pg_temp.himitsu_cat_as(U_SG, 'cattest-sg@test.local');
  INSERT INTO himitsu.person_categories(org_id, name, sort) VALUES (ORG, '農民', 1) RETURNING id INTO v_farmer;
  INSERT INTO himitsu.person_categories(org_id, name, sort) VALUES (ORG, '貴賓', 0) RETURNING id INTO v_vip;
  PERFORM pg_temp.himitsu_cat_as(U_SEC, 'cattest-sec@test.local');
  BEGIN
    INSERT INTO himitsu.person_categories(org_id, name) VALUES (ORG, '秘書偷建');
    item := 'C1'; result := 'FAIL：secretary 竟可建分類！';
  EXCEPTION WHEN insufficient_privilege THEN
    item := 'C1'; result := 'PASS：秘書長建分類成功、秘書被拒';
  END;
  RETURN NEXT;

  -- C2：同協會分類名稱不可重複
  PERFORM pg_temp.himitsu_cat_as(U_SG, 'cattest-sg@test.local');
  BEGIN
    INSERT INTO himitsu.person_categories(org_id, name) VALUES (ORG, '農民');
    item := 'C2'; result := 'FAIL：同名分類竟可重複！';
  EXCEPTION WHEN unique_violation THEN
    item := 'C2'; result := 'PASS：同名分類被擋';
  END;
  RETURN NEXT;

  -- C3：秘書可替成員勾分類；工作人員不行
  PERFORM pg_temp.himitsu_cat_as(U_SEC, 'cattest-sec@test.local');
  INSERT INTO himitsu.person_category_links(org_id, person_id, category_id) VALUES
    (ORG, p_farmer1, v_farmer), (ORG, p_farmer2, v_farmer), (ORG, p_vip, v_vip), (ORG, p_vip, v_farmer),
    (ORG, p_member, v_farmer);
  PERFORM pg_temp.himitsu_cat_as(U_STF, 'cattest-stf@test.local');
  BEGIN
    INSERT INTO himitsu.person_category_links(org_id, person_id, category_id) VALUES (ORG, p_member, v_vip);
    item := 'C3'; result := 'FAIL：staff 竟可勾分類！';
  EXCEPTION WHEN insufficient_privilege THEN
    item := 'C3'; result := 'PASS：秘書勾分類成功、工作人員被拒';
  END;
  RETURN NEXT;

  -- C4：不可把他協會的分類掛到本協會成員
  PERFORM pg_temp.himitsu_cat_as(U_SEC, 'cattest-sec@test.local');
  BEGIN
    INSERT INTO himitsu.person_category_links(org_id, person_id, category_id) VALUES (ORG, p_farmer1, v_other_cat);
    item := 'C4'; result := 'FAIL：竟可掛他協會的分類！';
  EXCEPTION WHEN OTHERS THEN
    item := 'C4'; result := 'PASS：跨協會分類被擋';
  END;
  RETURN NEXT;

  -- C5：依分類匯入（秘書有名單權）——農民＋貴賓：王貴賓兩分類只算一次、身分取排序前面的「貴賓」；
  --     會員甲已以會員身分在名單上 → 略過
  j := himitsu.import_people_by_category(v_event, ARRAY[v_farmer, v_vip]);
  SELECT guest_tag || '/' || COALESCE(guest_org, '-') INTO v_text
    FROM himitsu.event_attendees WHERE event_id = v_event AND person_id = p_vip;
  SELECT count(*) INTO n FROM himitsu.event_attendees WHERE event_id = v_event AND person_id IS NOT NULL;
  IF (j->>'ok')::boolean AND (j->>'inserted')::int = 3 AND (j->>'skipped')::int = 1 AND n = 3 AND v_text = '貴賓/彰化縣農會' THEN
    item := 'C5'; result := 'PASS：匯入 3 人（身分＝分類、單位＝成員單位）、已在名單的會員略過';
  ELSE item := 'C5'; result := format('FAIL：%s／筆數 %s／王貴賓 %s', j::text, n, v_text); END IF;
  RETURN NEXT;

  -- C6：重匯不重複
  j := himitsu.import_people_by_category(v_event, ARRAY[v_farmer]);
  IF (j->>'inserted')::int = 0 AND (j->>'skipped')::int = 4 THEN
    item := 'C6'; result := 'PASS：重匯全部略過';
  ELSE item := 'C6'; result := format('FAIL：%s', j::text); END IF;
  RETURN NEXT;

  -- C7：工作人員不可匯入；只帶他協會分類＝沒有可用分類
  PERFORM pg_temp.himitsu_cat_as(U_STF, 'cattest-stf@test.local');
  j := himitsu.import_people_by_category(v_event, ARRAY[v_farmer]);
  IF j->>'error' = 'forbidden' THEN
    PERFORM pg_temp.himitsu_cat_as(U_SEC, 'cattest-sec@test.local');
    j := himitsu.import_people_by_category(v_event, ARRAY[v_other_cat]);
    IF j->>'error' = 'no_category' THEN item := 'C7'; result := 'PASS：staff 匯入被拒、他協會分類無效';
    ELSE item := 'C7'; result := format('FAIL：他協會分類 %s', j::text); END IF;
  ELSE item := 'C7'; result := format('FAIL：staff %s', j::text); END IF;
  RETURN NEXT;

  -- C8：刪分類會一併移除勾選，但已匯入的活動名單不受影響
  PERFORM pg_temp.himitsu_cat_as(U_SG, 'cattest-sg@test.local');
  DELETE FROM himitsu.person_categories WHERE id = v_farmer;
  SELECT count(*) INTO n FROM himitsu.person_category_links WHERE category_id = v_farmer;
  IF n = 0 AND (SELECT count(*) FROM himitsu.event_attendees WHERE event_id = v_event AND person_id IS NOT NULL) = 3 THEN
    item := 'C8'; result := 'PASS：刪分類移除勾選、活動名單保留';
  ELSE item := 'C8'; result := format('FAIL：殘留勾選 %s', n); END IF;
  RETURN NEXT;

  PERFORM pg_temp.himitsu_cat_cleanup();
  item := '收尾'; result := 'PASS：測試資料已全部清除'; RETURN NEXT;
END $$;

SELECT * FROM pg_temp.himitsu_cat_test();
