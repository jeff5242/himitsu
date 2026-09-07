-- ============================================================================
-- HiMitsu EPIC-2 驗收測試（AC-14/AC-17 的 DB 層）——結果表格版
-- 用法：Supabase SQL Editor 整段貼上執行，PASS/FAIL 顯示在 Results。
-- 前置：需已執行 L13 devices migration（20260907000010）。
-- AC-15/16/18（agent 行為）走本機實測：見 docs/kiosk-deploy.md。
-- ============================================================================

CREATE OR REPLACE FUNCTION pg_temp.himitsu_epic2_cleanup()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ids UUID[];
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT array_agg(id) INTO v_ids FROM himitsu.organizations WHERE slug = 'epic2test';
  IF v_ids IS NOT NULL THEN
    DELETE FROM himitsu.organizations WHERE id = ANY(v_ids);
    DELETE FROM himitsu.audit_log WHERE org_id = ANY(v_ids);
  END IF;
  DELETE FROM auth.identities WHERE user_id IN
    (SELECT id FROM auth.users WHERE email LIKE 'kiosk-epic2test-%@kiosk.himitsu.local'
                                   OR email LIKE 'epic2-%@test.local');
  DELETE FROM auth.users WHERE email LIKE 'kiosk-epic2test-%@kiosk.himitsu.local'
                             OR email LIKE 'epic2-%@test.local';
END $$;

CREATE OR REPLACE FUNCTION pg_temp.himitsu_epic2_test()
RETURNS TABLE(item TEXT, result TEXT) LANGUAGE plpgsql AS $$
DECLARE
  ORG CONSTANT UUID := 'aaaaaaaa-1111-4000-8000-000000000007';
  U_OWN CONSTANT UUID := 'aaaaaaaa-1111-4000-8000-000000000001';
  U_STF CONSTANT UUID := 'aaaaaaaa-1111-4000-8000-000000000002';
  j JSON; v_code TEXT; v_kiosk_user UUID; v_kiosk_email TEXT; n INT;
  v_event UUID;
BEGIN
  PERFORM pg_temp.himitsu_epic2_cleanup();

  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          confirmation_token, recovery_token, email_change, email_change_token_new)
  VALUES
   ('00000000-0000-0000-0000-000000000000', U_OWN,'authenticated','authenticated','epic2-own@test.local','x',NOW(),NOW(),NOW(),'','','',''),
   ('00000000-0000-0000-0000-000000000000', U_STF,'authenticated','authenticated','epic2-stf@test.local','x',NOW(),NOW(),NOW(),'','','','');
  INSERT INTO himitsu.organizations(id, slug, name) VALUES (ORG, 'epic2test', 'EPIC2 測試協會');
  INSERT INTO himitsu.org_users(org_id, user_id, role, email) VALUES
   (ORG, U_OWN, 'owner','epic2-own@test.local'), (ORG, U_STF, 'staff','epic2-stf@test.local');
  INSERT INTO himitsu.events(id, org_id, name, status)
   VALUES ('aaaaaaaa-1111-4000-8000-000000000009', ORG, 'EPIC2 測試活動', 'open');
  v_event := 'aaaaaaaa-1111-4000-8000-000000000009';

  -- ── AC-14a：staff 不可產碼、owner 可 ─────────────────────────────
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', U_STF, 'role','authenticated','email','epic2-stf@test.local')::text, true);
  j := himitsu.create_device_code(ORG);
  IF (j->>'ok')::boolean = false AND j->>'error' = 'forbidden' THEN
    item := 'AC-14a'; result := 'PASS：staff 不可產生註冊碼（需 devices.manage）';
  ELSE item := 'AC-14a'; result := format('FAIL：%s', j::text); END IF;
  RETURN NEXT;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', U_OWN, 'role','authenticated','email','epic2-own@test.local')::text, true);
  j := himitsu.create_device_code(ORG);
  v_code := j->>'code';
  IF (j->>'ok')::boolean AND length(v_code) = 8 THEN
    item := 'AC-14b'; result := 'PASS：owner 產生 8 碼一次性註冊碼';
  ELSE item := 'AC-14b'; result := format('FAIL：%s', j::text); END IF;
  RETURN NEXT;

  -- ── AC-14c：憑碼註冊（anon 情境）→ 建 kiosk 帳號＋裝置列 ─────────
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  EXECUTE 'SET LOCAL ROLE anon';
  j := himitsu.register_device(v_code, 'epic2test', 'AA:BB:CC:DD:EE:FF');
  EXECUTE 'RESET ROLE';
  IF (j->>'ok')::boolean AND j->>'device_id' = 'epic2test-ddeeff' THEN
    item := 'AC-14c'; result := 'PASS：anon 憑碼註冊成功（device_id=epic2test-ddeeff）';
  ELSE item := 'AC-14c'; result := format('FAIL：%s', j::text); END IF;
  RETURN NEXT;
  v_kiosk_email := j->>'email';
  SELECT user_id INTO v_kiosk_user FROM himitsu.devices WHERE device_id = 'epic2test-ddeeff';

  SELECT count(*) INTO n FROM himitsu.org_users
   WHERE org_id = ORG AND user_id = v_kiosk_user AND role = 'kiosk';
  SELECT count(*) + n INTO n FROM auth.identities WHERE user_id = v_kiosk_user;
  IF n = 2 THEN item := 'AC-14d'; result := 'PASS：kiosk 帳號＋identity＋org_users(role=kiosk) 齊備';
  ELSE item := 'AC-14d'; result := format('FAIL：帳號構件缺漏（%s/2）', n); END IF;
  RETURN NEXT;

  -- 同一碼重用被拒
  EXECUTE 'SET LOCAL ROLE anon';
  j := himitsu.register_device(v_code, 'epic2test', 'AA:BB:CC:DD:EE:FF');
  EXECUTE 'RESET ROLE';
  IF (j->>'ok')::boolean = false AND j->>'error' = 'code_used' THEN
    item := 'AC-14e'; result := 'PASS：註冊碼一次性（重用被拒）';
  ELSE item := 'AC-14e'; result := format('FAIL：%s', j::text); END IF;
  RETURN NEXT;

  -- 過期碼被拒
  INSERT INTO himitsu.device_codes(org_id, code, expires_at)
   VALUES (ORG, 'EXPIRED1', NOW() - INTERVAL '1 minute');
  EXECUTE 'SET LOCAL ROLE anon';
  j := himitsu.register_device('EXPIRED1', 'epic2test2', '11:22:33:44:55:66');
  EXECUTE 'RESET ROLE';
  IF (j->>'ok')::boolean = false AND j->>'error' = 'code_expired' THEN
    item := 'AC-14f'; result := 'PASS：過期碼被拒（15 分鐘效期）';
  ELSE item := 'AC-14f'; result := format('FAIL：%s', j::text); END IF;
  RETURN NEXT;

  -- ── AC-17：心跳＋遙控＋場次下發 ──────────────────────────────────
  UPDATE himitsu.devices SET event_id = v_event WHERE device_id = 'epic2test-ddeeff';
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_kiosk_user, 'role','authenticated','email', v_kiosk_email)::text, true);
  j := himitsu.device_heartbeat('epic2test-ddeeff', '192.168.1.50', '1.0.0', 3);
  IF (j->>'ok')::boolean AND (j->>'managed')::boolean AND j->>'event_name' = 'EPIC2 測試活動' THEN
    item := 'AC-17a'; result := 'PASS：心跳成功、回傳受管旗標與綁定場次';
  ELSE item := 'AC-17a'; result := format('FAIL：%s', j::text); END IF;
  RETURN NEXT;
  SELECT pending_count INTO n FROM himitsu.devices WHERE device_id = 'epic2test-ddeeff';
  IF n = 3 THEN item := 'AC-17b'; result := 'PASS：待同步筆數回寫（後台紅字的資料源）';
  ELSE item := 'AC-17b'; result := format('FAIL：pending=%s', n); END IF;
  RETURN NEXT;

  -- 遙控：owner 關 managed → 下一次心跳收到 false
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE himitsu.devices SET managed = false WHERE device_id = 'epic2test-ddeeff';
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_kiosk_user, 'role','authenticated','email', v_kiosk_email)::text, true);
  j := himitsu.device_heartbeat('epic2test-ddeeff');
  IF (j->>'managed')::boolean = false THEN
    item := 'AC-17c'; result := 'PASS：後台關受管 → 心跳回傳 false（agent 據此停快照）';
  ELSE item := 'AC-17c'; result := format('FAIL：%s', j::text); END IF;
  RETURN NEXT;

  -- kiosk 權限邊界：可報到相關、不可動會員資料
  BEGIN
    INSERT INTO himitsu.persons(org_id, name) VALUES (ORG, 'kiosk偷加的人');
    item := 'AC-17d'; result := 'FAIL：kiosk 帳號竟能寫會員資料！';
  EXCEPTION WHEN OTHERS THEN
    item := 'AC-17d'; result := 'PASS：kiosk 帳號只有 checkin.write（寫會員被拒）';
  END;
  RETURN NEXT;

  -- 冒名心跳：別的 kiosk 帳號打不到這台裝置
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', U_STF, 'role','authenticated','email','epic2-stf@test.local')::text, true);
  j := himitsu.device_heartbeat('epic2test-ddeeff');
  IF (j->>'ok')::boolean = false AND j->>'error' = 'not_registered' THEN
    item := 'AC-17e'; result := 'PASS：非本裝置帳號心跳被拒（user_id 綁定）';
  ELSE item := 'AC-17e'; result := format('FAIL：%s', j::text); END IF;
  RETURN NEXT;

  PERFORM pg_temp.himitsu_epic2_cleanup();
  item := '收尾'; result := 'PASS：測試資料已全部清除（含 kiosk 帳號）'; RETURN NEXT;
END $$;

SELECT * FROM pg_temp.himitsu_epic2_test();
