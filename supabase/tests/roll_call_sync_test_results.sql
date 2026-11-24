-- ============================================================================
-- HiMitsu L29 唱名進度同步測試——結果表格版
-- 用法：Supabase SQL Editor 整段貼上執行，PASS/FAIL 直接顯示在 Results 表格。
-- 前置：需已執行 migration 20261124000019_roll_call_sync.sql。
-- 安全性：測試資料用 rcstest 前綴、函式內自我清除。
-- ============================================================================

CREATE OR REPLACE FUNCTION pg_temp.himitsu_rcs_cleanup()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ids UUID[];
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT array_agg(id) INTO v_ids FROM himitsu.organizations WHERE slug = 'rcstest';
  IF v_ids IS NOT NULL THEN
    DELETE FROM himitsu.organizations WHERE id = ANY(v_ids);
    DELETE FROM himitsu.audit_log WHERE org_id = ANY(v_ids);
  END IF;
  DELETE FROM auth.users WHERE email LIKE 'rcstest-%@test.local';
END $$;

CREATE OR REPLACE FUNCTION pg_temp.himitsu_rcs_test()
RETURNS TABLE(item TEXT, result TEXT) LANGUAGE plpgsql AS $$
DECLARE
  ORG CONSTANT UUID := '99999999-0000-4000-8000-000000000029';
  U_STAFF CONSTANT UUID := 'ffffffff-0000-4000-8000-000000000291';
  U_VIEW CONSTANT UUID := 'ffffffff-0000-4000-8000-000000000292';
  v_event UUID; v_a UUID; j JSON; v_first TIMESTAMPTZ; v_again TIMESTAMPTZ;
BEGIN
  PERFORM pg_temp.himitsu_rcs_cleanup();
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          confirmation_token, recovery_token, email_change, email_change_token_new)
  VALUES ('00000000-0000-0000-0000-000000000000', U_STAFF,'authenticated','authenticated','rcstest-staff@test.local','x',NOW(),NOW(),NOW(),'','','',''),
         ('00000000-0000-0000-0000-000000000000', U_VIEW,'authenticated','authenticated','rcstest-view@test.local','x',NOW(),NOW(),NOW(),'','','','');
  INSERT INTO himitsu.organizations(id, slug, name) VALUES (ORG, 'rcstest', '唱名同步測試');
  INSERT INTO himitsu.org_users(org_id, user_id, role, email) VALUES
    (ORG, U_STAFF, 'staff', 'rcstest-staff@test.local'), (ORG, U_VIEW, 'viewer', 'rcstest-view@test.local');
  INSERT INTO himitsu.events(org_id, name, kind) VALUES (ORG, '測試旺年會', 'banquet') RETURNING id INTO v_event;
  INSERT INTO himitsu.event_attendees(org_id, event_id, category, source, guest_name, roll_call)
  VALUES (ORG, v_event, 'guest', 'import', '王董', true) RETURNING id INTO v_a;

  -- R1：viewer 不能標記已唱名
  PERFORM set_config('request.jwt.claims', json_build_object('sub', U_VIEW, 'role','authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := himitsu.set_called(v_a, true);
  IF j->>'error' = 'forbidden' THEN item := 'R1'; result := 'PASS：viewer 標記已唱名被擋';
  ELSE item := 'R1'; result := format('FAIL：%s', j::text); END IF;
  RETURN NEXT;

  -- R2：工作人員標記 → 存進資料庫（另一台裝置讀得到）；重按不改時間
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', U_STAFF, 'role','authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  j := himitsu.set_called(v_a, true);
  SELECT called_at INTO v_first FROM himitsu.event_attendees WHERE id = v_a;
  PERFORM pg_sleep(0.01);
  PERFORM himitsu.set_called(v_a, true);
  SELECT called_at INTO v_again FROM himitsu.event_attendees WHERE id = v_a;
  IF (j->>'ok')::boolean AND v_first IS NOT NULL AND v_first = v_again THEN
    item := 'R2'; result := 'PASS：已唱名存進資料庫，重按不改時間';
  ELSE item := 'R2'; result := format('FAIL：%s／%s／%s', j::text, v_first, v_again); END IF;
  RETURN NEXT;

  -- R3：取消已唱名 → 清空
  j := himitsu.set_called(v_a, false);
  SELECT called_at INTO v_first FROM himitsu.event_attendees WHERE id = v_a;
  IF (j->>'ok')::boolean AND v_first IS NULL THEN item := 'R3'; result := 'PASS：取消已唱名後清空';
  ELSE item := 'R3'; result := format('FAIL：%s／%s', j::text, v_first); END IF;
  RETURN NEXT;

  PERFORM pg_temp.himitsu_rcs_cleanup();
  item := '收尾'; result := 'PASS：測試資料已全部清除'; RETURN NEXT;
END $$;

SELECT * FROM pg_temp.himitsu_rcs_test();
