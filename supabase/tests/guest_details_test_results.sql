-- ============================================================================
-- HiMitsu L24 來賓詳細欄位＋攜伴佔座位測試——結果表格版
-- 用法：Supabase SQL Editor 整段貼上執行，PASS/FAIL 直接顯示在 Results 表格。
-- 前置：需已執行 migration 20261123000016_guest_details.sql。
-- 安全性：測試資料用 dettest 前綴、函式內自我清除。
-- ============================================================================

CREATE OR REPLACE FUNCTION pg_temp.himitsu_det_cleanup()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ids UUID[];
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT array_agg(id) INTO v_ids FROM himitsu.organizations WHERE slug = 'dettest';
  IF v_ids IS NOT NULL THEN
    DELETE FROM himitsu.organizations WHERE id = ANY(v_ids);
    DELETE FROM himitsu.audit_log WHERE org_id = ANY(v_ids);
  END IF;
  DELETE FROM auth.users WHERE email LIKE 'dettest-%@test.local';
END $$;

CREATE OR REPLACE FUNCTION pg_temp.himitsu_det_test()
RETURNS TABLE(item TEXT, result TEXT) LANGUAGE plpgsql AS $$
DECLARE
  ORG CONSTANT UUID := '99999999-0000-4000-8000-000000000024';
  U_SEC CONSTANT UUID := 'ffffffff-0000-4000-8000-000000000241';
  v_event UUID; v_a UUID; v_b UUID; v_c UUID; j JSON; v_text TEXT; n INT;
BEGIN
  PERFORM pg_temp.himitsu_det_cleanup();

  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          confirmation_token, recovery_token, email_change, email_change_token_new)
  VALUES ('00000000-0000-0000-0000-000000000000', U_SEC,'authenticated','authenticated','dettest-sec@test.local','x',NOW(),NOW(),NOW(),'','','','');
  INSERT INTO himitsu.organizations(id, slug, name) VALUES (ORG, 'dettest', '來賓欄位測試');
  INSERT INTO himitsu.org_users(org_id, user_id, role, email) VALUES (ORG, U_SEC, 'secretary', 'dettest-sec@test.local');
  INSERT INTO himitsu.events(org_id, name, kind) VALUES (ORG, '測試旺年會', 'banquet') RETURNING id INTO v_event;
  INSERT INTO himitsu.event_tables(org_id, event_id, table_no, capacity) VALUES (ORG, v_event, 1, 4), (ORG, v_event, 2, 2);

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', U_SEC, 'role','authenticated','email','dettest-sec@test.local')::text, true);

  -- D1：CSV 匯入帶入職稱、手機、葷素、攜伴、唱名
  j := himitsu.import_guests(v_event, '[
    {"line":2,"name":"王董","org":"米屋智農","tag":"貴賓","title":"董事長","mobile":"0912345678",
     "diet":"素","companions":2,"roll_call":true,"table_no":1}]'::jsonb);
  SELECT id, guest_title || '/' || guest_mobile || '/' || diet || '/' || companions || '/' || roll_call
    INTO v_a, v_text FROM himitsu.event_attendees WHERE event_id = v_event AND guest_name = '王董';
  IF (j->>'ok')::boolean AND v_text = '董事長/0912345678/素/2/true' THEN
    item := 'D1'; result := 'PASS：匯入帶入職稱/手機/葷素/攜伴/唱名';
  ELSE item := 'D1'; result := format('FAIL：%s／%s', j::text, v_text); END IF;
  RETURN NEXT;

  -- D2：攜伴佔座位——桌 1 容量 4、王董已用 3 位；攜伴 1 人（2 位）被擋
  BEGIN
    INSERT INTO himitsu.event_attendees(org_id, event_id, category, source, guest_name, companions, table_no)
    VALUES (ORG, v_event, 'guest', 'manual', '李總', 1, 1);
    item := 'D2'; result := 'FAIL：座位不足竟可入座！';
  EXCEPTION WHEN OTHERS THEN
    item := 'D2'; result := 'PASS：本人＋攜伴超過容量被擋（' || SQLERRM || '）';
  END;
  RETURN NEXT;

  -- D3：一個人（1 位）剛好坐滿
  INSERT INTO himitsu.event_attendees(org_id, event_id, category, source, guest_name, table_no)
  VALUES (ORG, v_event, 'guest', 'manual', '陳經理', 1) RETURNING id INTO v_b;
  item := 'D3'; result := 'PASS：剩 1 位時單人可入座（桌 1 滿 4/4）'; RETURN NEXT;

  -- D4：滿桌時增加攜伴被擋；減少攜伴可以
  BEGIN
    UPDATE himitsu.event_attendees SET companions = 3 WHERE id = v_a;
    item := 'D4'; result := 'FAIL：滿桌竟可增加攜伴！';
  EXCEPTION WHEN OTHERS THEN
    UPDATE himitsu.event_attendees SET companions = 1 WHERE id = v_a;
    SELECT companions INTO n FROM himitsu.event_attendees WHERE id = v_a;
    IF n = 1 THEN item := 'D4'; result := 'PASS：滿桌增加攜伴被擋、減少攜伴可以';
    ELSE item := 'D4'; result := format('FAIL：減少後 companions=%s', n); END IF;
  END;
  RETURN NEXT;

  -- D5：縮桌不可小於已用座位（王董 2＋陳經理 1＝3 位）
  BEGIN
    UPDATE himitsu.event_tables SET capacity = 2 WHERE event_id = v_event AND table_no = 1;
    item := 'D5'; result := 'FAIL：縮桌竟小於已用座位！';
  EXCEPTION WHEN OTHERS THEN
    item := 'D5'; result := 'PASS：縮桌以座位數檢查（' || SQLERRM || '）';
  END;
  RETURN NEXT;

  -- D6：兩桌互換以座位數驗容量（桌 1 用 3 位 ↔ 桌 2 容量 2）
  INSERT INTO himitsu.event_attendees(org_id, event_id, category, source, guest_name, table_no)
  VALUES (ORG, v_event, 'guest', 'manual', '林主任', 2) RETURNING id INTO v_c;
  j := himitsu.swap_tables(v_event, 1, 2);
  IF j->>'error' = 'capacity' THEN item := 'D6'; result := 'PASS：互換以座位數擋下（' || (j->>'detail') || '）';
  ELSE item := 'D6'; result := format('FAIL：%s', j::text); END IF;
  RETURN NEXT;

  -- D7：除名後釋出座位（王董除名 → 桌 1 只剩 1 位，可再坐 3 位）
  UPDATE himitsu.event_attendees SET removed_at = NOW() WHERE id = v_a;
  INSERT INTO himitsu.event_attendees(org_id, event_id, category, source, guest_name, companions, table_no)
  VALUES (ORG, v_event, 'guest', 'manual', '黃協理', 2, 1);
  item := 'D7'; result := 'PASS：除名釋出座位，攜伴 2 人可入座'; RETURN NEXT;

  -- D8：攜伴人數範圍 0～20
  BEGIN
    INSERT INTO himitsu.event_attendees(org_id, event_id, category, source, guest_name, companions)
    VALUES (ORG, v_event, 'guest', 'manual', '錯誤', -1);
    item := 'D8'; result := 'FAIL：攜伴竟可為負數！';
  EXCEPTION WHEN check_violation THEN
    item := 'D8'; result := 'PASS：攜伴人數為負被擋';
  END;
  RETURN NEXT;

  PERFORM pg_temp.himitsu_det_cleanup();
  item := '收尾'; result := 'PASS：測試資料已全部清除'; RETURN NEXT;
END $$;

SELECT * FROM pg_temp.himitsu_det_test();
