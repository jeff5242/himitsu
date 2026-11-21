-- ============================================================================
-- HiMitsu L18 貴賓祝福／簽名測試——結果表格版
-- 用法：Supabase SQL Editor 整段貼上執行，PASS/FAIL 直接顯示在 Results 表格。
-- 前置：需已執行 migration 20261120000012_vip_greetings.sql。
-- 安全性：測試資料用 viptest 前綴、函式內自我清除。
-- ============================================================================

CREATE OR REPLACE FUNCTION pg_temp.himitsu_vip_cleanup()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ids UUID[];
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT array_agg(id) INTO v_ids FROM himitsu.organizations WHERE slug IN ('viptest', 'viptest-other');
  IF v_ids IS NOT NULL THEN
    DELETE FROM himitsu.organizations WHERE id = ANY(v_ids);
    DELETE FROM himitsu.audit_log WHERE org_id = ANY(v_ids);
  END IF;
  DELETE FROM auth.users WHERE email LIKE 'viptest-%@test.local';
END $$;

CREATE OR REPLACE FUNCTION pg_temp.himitsu_vip_as(p_user UUID, p_email TEXT)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'email', p_email)::text, true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.himitsu_vip_test()
RETURNS TABLE(item TEXT, result TEXT) LANGUAGE plpgsql AS $$
DECLARE
  ORG CONSTANT UUID := '99999999-0000-4000-8000-000000000018';
  ORG2 CONSTANT UUID := '99999999-0000-4000-8000-000000000019';
  U_SEC CONSTANT UUID := 'ffffffff-0000-4000-8000-000000000181';
  U_STF CONSTANT UUID := 'ffffffff-0000-4000-8000-000000000182';
  U_OUT CONSTANT UUID := 'ffffffff-0000-4000-8000-000000000183';
  SIG CONSTANT TEXT := 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  v_event UUID; v_guest UUID; j JSON; n INT; v_text TEXT;
BEGIN
  PERFORM pg_temp.himitsu_vip_cleanup();

  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          confirmation_token, recovery_token, email_change, email_change_token_new)
  VALUES
   ('00000000-0000-0000-0000-000000000000', U_SEC,'authenticated','authenticated','viptest-sec@test.local','x',NOW(),NOW(),NOW(),'','','',''),
   ('00000000-0000-0000-0000-000000000000', U_STF,'authenticated','authenticated','viptest-stf@test.local','x',NOW(),NOW(),NOW(),'','','',''),
   ('00000000-0000-0000-0000-000000000000', U_OUT,'authenticated','authenticated','viptest-out@test.local','x',NOW(),NOW(),NOW(),'','','','');
  INSERT INTO himitsu.organizations(id, slug, name) VALUES (ORG, 'viptest', '貴賓測試'), (ORG2, 'viptest-other', '他協會');
  INSERT INTO himitsu.org_users(org_id, user_id, role, email) VALUES
   (ORG, U_SEC, 'secretary','viptest-sec@test.local'), (ORG, U_STF, 'staff','viptest-stf@test.local'),
   (ORG2, U_OUT, 'owner','viptest-out@test.local');
  INSERT INTO himitsu.events(org_id, name, kind, status) VALUES (ORG, '測試忘年會', 'banquet', 'open') RETURNING id INTO v_event;
  INSERT INTO himitsu.event_attendees(org_id, event_id, category, source, guest_name, guest_tag)
   VALUES (ORG, v_event, 'guest', 'manual', '王貴賓', '貴賓') RETURNING id INTO v_guest;

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM pg_temp.himitsu_vip_as(U_STF, 'viptest-stf@test.local');

  -- V1：未報到不能送祝福
  j := himitsu.submit_greeting(v_guest, '身體健康，闔家平安', NULL);
  IF j->>'error' = 'not_checked_in' THEN item := 'V1'; result := 'PASS：未報到送祝福被拒';
  ELSE item := 'V1'; result := format('FAIL：%s', j::text); END IF;
  RETURN NEXT;

  -- V2：報到後送祝福詞＋簽名
  j := himitsu.check_in(v_guest, 'vip');
  j := himitsu.submit_greeting(v_guest, '身體健康，闔家平安', SIG);
  SELECT count(*) INTO n FROM himitsu.attendee_greetings WHERE attendee_id = v_guest AND signature = SIG;
  IF (j->>'ok')::boolean AND n = 1 THEN item := 'V2'; result := 'PASS：staff 報到後送出祝福＋簽名';
  ELSE item := 'V2'; result := format('FAIL：%s／筆數 %s', j::text, n); END IF;
  RETURN NEXT;

  -- V3：重送覆蓋（仍只有一筆）
  j := himitsu.submit_greeting(v_guest, '風調雨順，五穀豐收', SIG);
  SELECT greeting INTO v_text FROM himitsu.attendee_greetings WHERE attendee_id = v_guest;
  SELECT count(*) INTO n FROM himitsu.attendee_greetings WHERE attendee_id = v_guest;
  IF n = 1 AND v_text = '風調雨順，五穀豐收' THEN item := 'V3'; result := 'PASS：重送覆蓋為新祝福詞（一人一筆）';
  ELSE item := 'V3'; result := format('FAIL：%s 筆／%s', n, v_text); END IF;
  RETURN NEXT;

  -- V4：簽名格式不對被拒（防塞入任意字串）
  j := himitsu.submit_greeting(v_guest, NULL, 'javascript:alert(1)');
  IF j->>'error' = 'invalid' THEN item := 'V4'; result := 'PASS：非圖片 data URL 簽名被拒';
  ELSE item := 'V4'; result := format('FAIL：%s', j::text); END IF;
  RETURN NEXT;

  -- V5：兩者皆空被拒
  j := himitsu.submit_greeting(v_guest, '  ', NULL);
  IF j->>'error' = 'empty' THEN item := 'V5'; result := 'PASS：空白祝福被拒';
  ELSE item := 'V5'; result := format('FAIL：%s', j::text); END IF;
  RETURN NEXT;

  -- V6：staff 不能撤下；secretary 可以；撤下後重送不自動恢復
  j := himitsu.set_greeting_hidden(v_guest, true);
  IF j->>'error' = 'forbidden' THEN
    PERFORM pg_temp.himitsu_vip_as(U_SEC, 'viptest-sec@test.local');
    j := himitsu.set_greeting_hidden(v_guest, true);
    PERFORM pg_temp.himitsu_vip_as(U_STF, 'viptest-stf@test.local');
    PERFORM himitsu.submit_greeting(v_guest, '身體健康，闔家平安', NULL);
    SELECT count(*) INTO n FROM himitsu.attendee_greetings WHERE attendee_id = v_guest AND hidden_at IS NOT NULL;
    IF (j->>'ok')::boolean AND n = 1 THEN item := 'V6'; result := 'PASS：staff 撤下被拒、secretary 撤下成功、重送仍保持撤下';
    ELSE item := 'V6'; result := format('FAIL：%s／hidden %s', j::text, n); END IF;
  ELSE item := 'V6'; result := format('FAIL：staff 竟可撤下 %s', j::text); END IF;
  RETURN NEXT;

  -- V7：不能繞過 RPC 直接寫表
  BEGIN
    INSERT INTO himitsu.attendee_greetings(attendee_id, org_id, event_id, greeting)
    VALUES (v_guest, ORG, v_event, '直接寫');
    item := 'V7'; result := 'FAIL：authenticated 竟可直接寫入祝福表！';
  EXCEPTION WHEN insufficient_privilege THEN
    item := 'V7'; result := 'PASS：祝福表不開放直接寫入';
  END;
  RETURN NEXT;

  -- V8：他協會的人讀不到、也送不了
  PERFORM pg_temp.himitsu_vip_as(U_OUT, 'viptest-out@test.local');
  SELECT count(*) INTO n FROM himitsu.attendee_greetings WHERE event_id = v_event;
  j := himitsu.submit_greeting(v_guest, '身體健康，闔家平安', NULL);
  IF n = 0 AND j->>'error' = 'forbidden' THEN item := 'V8'; result := 'PASS：跨協會讀取為 0、送出被拒';
  ELSE item := 'V8'; result := format('FAIL：讀到 %s 筆／%s', n, j::text); END IF;
  RETURN NEXT;

  PERFORM pg_temp.himitsu_vip_cleanup();
  item := '收尾'; result := 'PASS：測試資料已全部清除'; RETURN NEXT;
END $$;

SELECT * FROM pg_temp.himitsu_vip_test();
