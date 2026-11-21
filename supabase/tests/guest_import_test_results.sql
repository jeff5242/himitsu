-- ============================================================================
-- HiMitsu L17 來賓 CSV 匯入測試——結果表格版
-- 用法：Supabase SQL Editor 整段貼上執行，PASS/FAIL 直接顯示在 Results 表格。
-- 前置：需已執行 migration 20261120000011_guest_import.sql。
-- 安全性：測試資料用 guesttest 前綴、函式內自我清除。
-- ============================================================================

CREATE OR REPLACE FUNCTION pg_temp.himitsu_guest_cleanup()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ids UUID[];
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT array_agg(id) INTO v_ids FROM himitsu.organizations WHERE slug = 'guesttest';
  IF v_ids IS NOT NULL THEN
    DELETE FROM himitsu.organizations WHERE id = ANY(v_ids);
    DELETE FROM himitsu.audit_log WHERE org_id = ANY(v_ids);
  END IF;
  DELETE FROM auth.users WHERE email LIKE 'guesttest-%@test.local';
END $$;

CREATE OR REPLACE FUNCTION pg_temp.himitsu_guest_test()
RETURNS TABLE(item TEXT, result TEXT) LANGUAGE plpgsql AS $$
DECLARE
  ORG CONSTANT UUID := '99999999-0000-4000-8000-000000000017';
  U_SEC CONSTANT UUID := 'ffffffff-0000-4000-8000-000000000171';
  U_STF CONSTANT UUID := 'ffffffff-0000-4000-8000-000000000172';
  v_event UUID; j JSON; n INT; v_tag TEXT; v_tables INT;
BEGIN
  PERFORM pg_temp.himitsu_guest_cleanup();

  -- ── 佈景：秘書＋工作人員、每桌 2 人、宴會一場 ──────────────────
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          confirmation_token, recovery_token, email_change, email_change_token_new)
  VALUES
   ('00000000-0000-0000-0000-000000000000', U_SEC,'authenticated','authenticated','guesttest-sec@test.local','x',NOW(),NOW(),NOW(),'','','',''),
   ('00000000-0000-0000-0000-000000000000', U_STF,'authenticated','authenticated','guesttest-stf@test.local','x',NOW(),NOW(),NOW(),'','','','');
  INSERT INTO himitsu.organizations(id, slug, name) VALUES (ORG, 'guesttest', '來賓匯入測試');
  INSERT INTO himitsu.org_users(org_id, user_id, role, email) VALUES
   (ORG, U_SEC, 'secretary','guesttest-sec@test.local'), (ORG, U_STF, 'staff','guesttest-stf@test.local');
  INSERT INTO himitsu.org_settings(org_id, key, value) VALUES (ORG,'assembly.table_capacity','2');
  INSERT INTO himitsu.events(id, org_id, name, kind) VALUES (gen_random_uuid(), ORG, '測試忘年會', 'banquet')
    RETURNING id INTO v_event;

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', U_SEC, 'role','authenticated','email','guesttest-sec@test.local')::text, true);

  -- ── G1：整批匯入＋自動建桌＋身分標籤 ─────────────────────────────
  j := himitsu.import_guests(v_event, '[
    {"line":2,"name":"王小明","org":"米屋智農","tag":"貴賓","table_no":1},
    {"line":3,"name":"陳大華","org":"後壁","tag":"農民","table_no":1},
    {"line":4,"name":"林阿土","org":null,"tag":"農民","table_no":null}]'::jsonb);
  SELECT guest_tag INTO v_tag FROM himitsu.event_attendees WHERE event_id = v_event AND guest_name = '王小明';
  IF (j->>'ok')::boolean AND (j->>'inserted')::int = 3 AND (j->>'tables_created')::int = 1 AND v_tag = '貴賓' THEN
    item := 'G1'; result := 'PASS：匯入 3 筆、自動建桌 1、身分標籤寫入';
  ELSE item := 'G1'; result := format('FAIL：%s／tag=%s', j::text, v_tag); END IF;
  RETURN NEXT;

  -- ── G2：重匯同一份＝全部略過（冪等）──────────────────────────────
  j := himitsu.import_guests(v_event, '[
    {"line":2,"name":"王小明","org":"米屋智農","tag":"貴賓","table_no":1},
    {"line":4,"name":"林阿土","org":null,"tag":"農民","table_no":null}]'::jsonb);
  SELECT count(*) INTO n FROM himitsu.event_attendees WHERE event_id = v_event;
  IF (j->>'inserted')::int = 0 AND (j->>'skipped')::int = 2 AND n = 3 THEN
    item := 'G2'; result := 'PASS：同姓名＋單位重匯被略過，名單仍 3 筆';
  ELSE item := 'G2'; result := format('FAIL：%s／名單 %s 筆', j::text, n); END IF;
  RETURN NEXT;

  -- ── G3：爆桌整批回滾（含新建的桌也一起回滾）──────────────────────
  j := himitsu.import_guests(v_event, '[
    {"line":2,"name":"甲","table_no":2},{"line":3,"name":"乙","table_no":2},{"line":4,"name":"丙","table_no":2}]'::jsonb);
  SELECT count(*) INTO n FROM himitsu.event_attendees WHERE event_id = v_event;
  SELECT count(*) INTO v_tables FROM himitsu.event_tables WHERE event_id = v_event;
  IF NOT (j->>'ok')::boolean AND n = 3 AND v_tables = 1 AND j->>'detail' LIKE '第 4 列%' THEN
    item := 'G3'; result := 'PASS：爆桌被擋、整批回滾（' || (j->>'detail') || '）';
  ELSE item := 'G3'; result := format('FAIL：%s／名單 %s、桌 %s', j::text, n, v_tables); END IF;
  RETURN NEXT;

  -- ── G4：姓名空白被拒並指出列號 ──────────────────────────────────
  j := himitsu.import_guests(v_event, '[{"line":7,"name":"  ","org":"x"}]'::jsonb);
  IF NOT (j->>'ok')::boolean AND j->>'detail' = '第 7 列：姓名空白' THEN
    item := 'G4'; result := 'PASS：姓名空白被拒（第 7 列）';
  ELSE item := 'G4'; result := format('FAIL：%s', j::text); END IF;
  RETURN NEXT;

  -- ── G5：工作人員（只有報到權）不可匯入 ──────────────────────────
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', U_STF, 'role','authenticated','email','guesttest-stf@test.local')::text, true);
  j := himitsu.import_guests(v_event, '[{"line":2,"name":"丁"}]'::jsonb);
  IF j->>'error' = 'forbidden' THEN
    item := 'G5'; result := 'PASS：staff 匯入被拒';
  ELSE item := 'G5'; result := format('FAIL：%s', j::text); END IF;
  RETURN NEXT;

  -- ── G6：登入者不可直呼核心函式（繞過權限檢查）────────────────────
  BEGIN
    j := himitsu.import_guests_core(v_event, '[{"line":2,"name":"戊"}]'::jsonb);
    item := 'G6'; result := 'FAIL：authenticated 竟能直呼 import_guests_core！';
  EXCEPTION WHEN insufficient_privilege THEN
    item := 'G6'; result := 'PASS：核心函式對 authenticated 關閉';
  END;
  RETURN NEXT;

  -- ── 收尾 ──────────────────────────────────────────────────────────
  PERFORM pg_temp.himitsu_guest_cleanup();
  item := '收尾'; result := 'PASS：測試資料已全部清除'; RETURN NEXT;
END $$;

SELECT * FROM pg_temp.himitsu_guest_test();
