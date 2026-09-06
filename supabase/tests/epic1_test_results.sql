-- ============================================================================
-- HiMitsu EPIC-1 驗收測試（AC-8 ~ AC-12）——結果表格版
-- 用法：Supabase SQL Editor 整段貼上執行，PASS/FAIL 直接顯示在 Results 表格。
-- 前置：需已執行 L2~L4 與 EPIC-1 的四支 migration（events/checkin/tables/fees）。
-- 安全性：測試資料用 epic1test 前綴、函式內自我清除；中途出錯整句自動回滾。
-- AC-13（離線報到）為瀏覽器行為，走人工驗收。
-- ============================================================================

CREATE OR REPLACE FUNCTION pg_temp.himitsu_epic1_cleanup()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ids UUID[];
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT array_agg(id) INTO v_ids FROM himitsu.organizations WHERE slug = 'epic1test';
  IF v_ids IS NOT NULL THEN
    DELETE FROM himitsu.organizations WHERE id = ANY(v_ids);
    DELETE FROM himitsu.audit_log WHERE org_id = ANY(v_ids);
  END IF;
  DELETE FROM auth.users WHERE email LIKE 'epic1-%@test.local';
END $$;

CREATE OR REPLACE FUNCTION pg_temp.himitsu_epic1_test()
RETURNS TABLE(item TEXT, result TEXT) LANGUAGE plpgsql AS $$
DECLARE
  ORG CONSTANT UUID := '99999999-0000-4000-8000-000000000006';
  U_OWN CONSTANT UUID := 'ffffffff-0000-4000-8000-000000000001';
  U_SEC CONSTANT UUID := 'ffffffff-0000-4000-8000-000000000002';
  U_STF CONSTANT UUID := 'ffffffff-0000-4000-8000-000000000003';
  U_FIN CONSTANT UUID := 'ffffffff-0000-4000-8000-000000000004';
  v_person UUID; v_entity UUID;
  v_i1a UUID; v_i1b UUID; v_i2 UUID; v_i3 UUID;      -- identities
  v_event UUID; v_att1a UUID; v_att1b UUID; v_att2 UUID; v_guest UUID; v_walkin UUID;
  v_seqs TEXT; j JSON; n INT; v_amt NUMERIC; v_inv UUID;
BEGIN
  PERFORM pg_temp.himitsu_epic1_cleanup();

  -- ── 佈景：協會 F＋四角色＋雙身分/一般/榮譽 會員＋費率與桌次覆寫 ──
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          confirmation_token, recovery_token, email_change, email_change_token_new)
  VALUES
   ('00000000-0000-0000-0000-000000000000', U_OWN,'authenticated','authenticated','epic1-own@test.local','x',NOW(),NOW(),NOW(),'','','',''),
   ('00000000-0000-0000-0000-000000000000', U_SEC,'authenticated','authenticated','epic1-sec@test.local','x',NOW(),NOW(),NOW(),'','','',''),
   ('00000000-0000-0000-0000-000000000000', U_STF,'authenticated','authenticated','epic1-stf@test.local','x',NOW(),NOW(),NOW(),'','','',''),
   ('00000000-0000-0000-0000-000000000000', U_FIN,'authenticated','authenticated','epic1-fin@test.local','x',NOW(),NOW(),NOW(),'','','','');
  INSERT INTO himitsu.organizations(id, slug, name) VALUES (ORG, 'epic1test', 'EPIC1 測試協會');
  INSERT INTO himitsu.org_users(org_id, user_id, role, email) VALUES
   (ORG, U_OWN, 'owner','epic1-own@test.local'), (ORG, U_SEC, 'secretary','epic1-sec@test.local'),
   (ORG, U_STF, 'staff','epic1-stf@test.local'), (ORG, U_FIN, 'finance','epic1-fin@test.local');

  -- P1 雙身分（個人會員＋團體代表）
  INSERT INTO himitsu.persons(org_id, name, mobile) VALUES (ORG,'雙身分甲','0910000001') RETURNING id INTO v_person;
  INSERT INTO himitsu.legal_entities(org_id, name) VALUES (ORG,'甲公司') RETURNING id INTO v_entity;
  INSERT INTO himitsu.identities(org_id, person_id, kind) VALUES (ORG, v_person,'individual_member') RETURNING id INTO v_i1a;
  INSERT INTO himitsu.identities(org_id, person_id, entity_id, kind) VALUES (ORG, v_person, v_entity,'group_rep') RETURNING id INTO v_i1b;
  INSERT INTO himitsu.memberships(org_id, identity_id, member_no, member_type, status) VALUES
   (ORG, v_i1a, 'F001','individual','active'), (ORG, v_i1b, 'F002','group','active');
  -- P2 一般個人、P3 榮譽
  INSERT INTO himitsu.persons(org_id, name) VALUES (ORG,'一般乙') RETURNING id INTO v_person;
  INSERT INTO himitsu.identities(org_id, person_id, kind) VALUES (ORG, v_person,'individual_member') RETURNING id INTO v_i2;
  INSERT INTO himitsu.memberships(org_id, identity_id, member_no, member_type, status) VALUES (ORG, v_i2,'F003','individual','active');
  INSERT INTO himitsu.persons(org_id, name) VALUES (ORG,'榮譽丙') RETURNING id INTO v_person;
  INSERT INTO himitsu.identities(org_id, person_id, kind) VALUES (ORG, v_person,'honorary') RETURNING id INTO v_i3;
  INSERT INTO himitsu.memberships(org_id, identity_id, member_no, member_type, status) VALUES (ORG, v_i3,'F004','individual','honorary');
  -- 設定覆寫：費率快照驗證＋小桌容量好測爆桌
  INSERT INTO himitsu.org_settings(org_id, key, value) VALUES
   (ORG,'fees.individual_annual','1500'), (ORG,'fees.group_annual','5000'),
   (ORG,'assembly.table_capacity','2'), (ORG,'assembly.max_tables','2');

  -- ── AC-8：活動與序號終身制（secretary 操作）──────────────────────
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', U_SEC, 'role','authenticated','email','epic1-sec@test.local')::text, true);

  INSERT INTO himitsu.events(org_id, name, kind) VALUES (ORG,'EPIC1 測試大會','assembly') RETURNING id INTO v_event;
  INSERT INTO himitsu.event_attendees(org_id, event_id, identity_id, category, source)
   VALUES (ORG, v_event, v_i1a,'member','import') RETURNING id INTO v_att1a;
  INSERT INTO himitsu.event_attendees(org_id, event_id, identity_id, category, source)
   VALUES (ORG, v_event, v_i1b,'member','import') RETURNING id INTO v_att1b;
  INSERT INTO himitsu.event_attendees(org_id, event_id, identity_id, category, source)
   VALUES (ORG, v_event, v_i2,'member','import') RETURNING id INTO v_att2;
  SELECT string_agg(seq_no::text, ',' ORDER BY seq_no) INTO v_seqs
    FROM himitsu.event_attendees WHERE event_id = v_event;
  IF v_seqs = '1,2,3' THEN item := 'AC-8a'; result := 'PASS：序號自動發放 1,2,3';
  ELSE item := 'AC-8a'; result := format('FAIL：序號＝%s', v_seqs); END IF;
  RETURN NEXT;

  UPDATE himitsu.event_attendees SET removed_at = NOW() WHERE id = v_att2;  -- 除名 #3
  INSERT INTO himitsu.event_attendees(org_id, event_id, category, source, guest_name, guest_org)
   VALUES (ORG, v_event,'guest','manual','王來賓','來賓公司') RETURNING id INTO v_guest;
  SELECT seq_no INTO n FROM himitsu.event_attendees WHERE id = v_guest;
  IF n = 4 THEN item := 'AC-8b'; result := 'PASS：除名後新增接尾（#4），#3 永久缺號';
  ELSE item := 'AC-8b'; result := format('FAIL：新序號＝%s（應為 4）', n); END IF;
  RETURN NEXT;

  BEGIN
    UPDATE himitsu.event_attendees SET seq_no = 99 WHERE id = v_att1a;
    item := 'AC-8c'; result := 'FAIL：序號竟可改！';
  EXCEPTION WHEN OTHERS THEN
    item := 'AC-8c'; result := 'PASS：序號不可變更（' || SQLERRM || '）';
  END;
  RETURN NEXT;
  BEGIN
    DELETE FROM himitsu.event_attendees WHERE id = v_guest;
    item := 'AC-8d'; result := 'FAIL：名單列竟可實體刪除！';
  EXCEPTION WHEN OTHERS THEN
    item := 'AC-8d'; result := 'PASS：不可刪列、只能除名';
  END;
  RETURN NEXT;

  UPDATE himitsu.events SET status = 'open' WHERE id = v_event;

  -- ── AC-9：staff 權限邊界＋冪等報到＋雙身分 ────────────────────────
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', U_STF, 'role','authenticated','email','epic1-stf@test.local')::text, true);
  BEGIN
    INSERT INTO himitsu.event_attendees(org_id, event_id, category, guest_name)
    VALUES (ORG, v_event, 'guest', 'staff偷加的人');
    item := 'AC-9a'; result := 'FAIL：staff 竟能改名單！';
  EXCEPTION WHEN OTHERS THEN
    item := 'AC-9a'; result := 'PASS：staff 改名單被拒（報到歸報到、名單歸名單）';
  END;
  RETURN NEXT;

  j := himitsu.check_in(v_att1a, 'assist');
  IF (j->>'ok')::boolean AND (j->>'already') = 'false' THEN
    item := 'AC-9b'; result := 'PASS：staff 可執行報到';
  ELSE item := 'AC-9b'; result := format('FAIL：報到結果＝%s', j::text); END IF;
  RETURN NEXT;

  j := himitsu.check_in(v_att1a, 'assist');
  SELECT count(*) INTO n FROM himitsu.checkin_log WHERE attendee_id = v_att1a AND undone_at IS NULL;
  IF (j->>'already')::boolean AND n = 1 THEN
    item := 'AC-9c'; result := 'PASS：重複報到冪等（僅 1 筆有效紀錄）';
  ELSE item := 'AC-9c'; result := format('FAIL：already=%s、有效紀錄 %s 筆', j->>'already', n); END IF;
  RETURN NEXT;

  j := himitsu.check_in(v_att1b, 'kiosk');
  SELECT count(*) INTO n FROM himitsu.event_attendees a
   JOIN himitsu.identities i ON i.id = a.identity_id
   WHERE a.event_id = v_event AND a.checked_in_at IS NOT NULL
     AND i.person_id = (SELECT person_id FROM himitsu.identities WHERE id = v_i1a);
  IF n = 2 THEN item := 'AC-9d'; result := 'PASS：雙身分兩列都完成報到（一人兩身分各自留紀錄）';
  ELSE item := 'AC-9d'; result := format('FAIL：雙身分報到列數＝%s', n); END IF;
  RETURN NEXT;

  -- 領取：secretary 定義項目、staff 發放、防重複
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', U_SEC, 'role','authenticated','email','epic1-sec@test.local')::text, true);
  INSERT INTO himitsu.pickup_items(org_id, event_id, key, label) VALUES (ORG, v_event, 'ballot', '選票');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', U_STF, 'role','authenticated','email','epic1-stf@test.local')::text, true);
  INSERT INTO himitsu.attendee_pickups(org_id, event_id, attendee_id, item_key) VALUES (ORG, v_event, v_att1a, 'ballot');
  BEGIN
    INSERT INTO himitsu.attendee_pickups(org_id, event_id, attendee_id, item_key) VALUES (ORG, v_event, v_att1a, 'ballot');
    item := 'AC-9e'; result := 'FAIL：同項目竟可重複發放！';
  EXCEPTION WHEN OTHERS THEN
    item := 'AC-9e'; result := 'PASS：重複發放被擋（unique 防線）';
  END;
  RETURN NEXT;

  -- walk-in＋AC-12 三來源一個總數
  j := himitsu.add_walkin(v_event, '臨時丁', NULL);
  v_walkin := (j->>'attendee_id')::uuid;
  j := himitsu.check_in(v_walkin, 'assist');
  SELECT count(*) INTO n FROM himitsu.event_attendees WHERE event_id = v_event AND removed_at IS NULL;
  DECLARE v_member INT; v_guestn INT; v_walkinn INT; v_checked INT;
  BEGIN
    SELECT count(*) FILTER (WHERE category='member'),
           count(*) FILTER (WHERE category='guest'),
           count(*) FILTER (WHERE category='walkin'),
           count(*) FILTER (WHERE checked_in_at IS NOT NULL)
      INTO v_member, v_guestn, v_walkinn, v_checked
      FROM himitsu.event_attendees WHERE event_id = v_event AND removed_at IS NULL;
    IF n = v_member + v_guestn + v_walkinn AND n = 4 AND v_checked = 3 THEN
      item := 'AC-12'; result := format('PASS：總數 %s＝會員 %s＋來賓 %s＋現場 %s；已報到 %s', n, v_member, v_guestn, v_walkinn, v_checked);
    ELSE
      item := 'AC-12'; result := format('FAIL：總 %s、member %s、guest %s、walkin %s、checked %s', n, v_member, v_guestn, v_walkinn, v_checked);
    END IF;
    RETURN NEXT;
  END;

  -- ── AC-10：桌次容量／桌數上限／設定連動（secretary）──────────────
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', U_SEC, 'role','authenticated','email','epic1-sec@test.local')::text, true);
  INSERT INTO himitsu.event_tables(org_id, event_id, table_no) VALUES (ORG, v_event, 1);
  SELECT capacity INTO n FROM himitsu.event_tables WHERE event_id = v_event AND table_no = 1;
  IF n = 2 THEN item := 'AC-10a'; result := 'PASS：建桌容量套設定中心的每桌人數（2）';
  ELSE item := 'AC-10a'; result := format('FAIL：容量＝%s（應為 2）', n); END IF;
  RETURN NEXT;

  UPDATE himitsu.event_attendees SET table_no = 1 WHERE id = v_att1a;
  UPDATE himitsu.event_attendees SET table_no = 1 WHERE id = v_att1b;
  BEGIN
    UPDATE himitsu.event_attendees SET table_no = 1 WHERE id = v_guest;
    item := 'AC-10b'; result := 'FAIL：爆桌竟然入座成功！';
  EXCEPTION WHEN OTHERS THEN
    item := 'AC-10b'; result := 'PASS：爆桌被 DB 擋（' || SQLERRM || '）';
  END;
  RETURN NEXT;
  BEGIN
    UPDATE himitsu.event_attendees SET table_no = 9 WHERE id = v_guest;
    item := 'AC-10c'; result := 'FAIL：不存在的桌竟可指派！';
  EXCEPTION WHEN OTHERS THEN
    item := 'AC-10c'; result := 'PASS：不存在的桌被擋';
  END;
  RETURN NEXT;

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE himitsu.org_settings SET value = '5' WHERE org_id = ORG AND key = 'assembly.table_capacity';
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', U_SEC, 'role','authenticated','email','epic1-sec@test.local')::text, true);
  INSERT INTO himitsu.event_tables(org_id, event_id, table_no) VALUES (ORG, v_event, 2);
  SELECT capacity INTO n FROM himitsu.event_tables WHERE event_id = v_event AND table_no = 2;
  IF n = 5 THEN item := 'AC-10d'; result := 'PASS：改設定後新桌套新容量（5）';
  ELSE item := 'AC-10d'; result := format('FAIL：新桌容量＝%s（應為 5）', n); END IF;
  RETURN NEXT;
  BEGIN
    INSERT INTO himitsu.event_tables(org_id, event_id, table_no) VALUES (ORG, v_event, 3);
    item := 'AC-10e'; result := 'FAIL：超過桌數上限竟可建桌！';
  EXCEPTION WHEN OTHERS THEN
    item := 'AC-10e'; result := 'PASS：桌數上限被擋（max_tables=2）';
  END;
  RETURN NEXT;

  -- ── AC-11：開繳套費率快照＋回報/確認權限 ─────────────────────────
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', U_FIN, 'role','authenticated','email','epic1-fin@test.local')::text, true);
  j := himitsu.open_fee_period(ORG, '2027 年度會費');
  IF (j->>'ok')::boolean AND (j->>'billed')::int = 3 AND (j->>'waived')::int = 1 THEN
    item := 'AC-11a'; result := 'PASS：開繳應繳 3 筆、榮譽自動免繳 1 筆';
  ELSE item := 'AC-11a'; result := format('FAIL：開繳結果＝%s', j::text); END IF;
  RETURN NEXT;

  SELECT i.amount INTO v_amt FROM himitsu.fee_invoices i
   JOIN himitsu.memberships m ON m.id = i.membership_id
   WHERE i.org_id = ORG AND m.member_type = 'group';
  IF v_amt = 5000 THEN item := 'AC-11b'; result := 'PASS：團體會費套費率快照（5000；個人 1500）';
  ELSE item := 'AC-11b'; result := format('FAIL：團體金額＝%s', v_amt); END IF;
  RETURN NEXT;

  SELECT i.id INTO v_inv FROM himitsu.fee_invoices i
   JOIN himitsu.memberships m ON m.id = i.membership_id
   WHERE i.org_id = ORG AND m.identity_id = v_i1b;   -- 雙身分甲的團體會籍

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', U_STF, 'role','authenticated','email','epic1-stf@test.local')::text, true);
  j := himitsu.report_fee_payment(v_inv, 'transfer', '12345');
  IF (j->>'ok')::boolean THEN item := 'AC-11c'; result := 'PASS：服務台（staff）可代登繳費回報';
  ELSE item := 'AC-11c'; result := format('FAIL：回報＝%s', j::text); END IF;
  RETURN NEXT;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', U_SEC, 'role','authenticated','email','epic1-sec@test.local')::text, true);
  j := himitsu.confirm_fee_payment(v_inv);
  IF (j->>'ok')::boolean = false AND j->>'error' = 'forbidden' THEN
    item := 'AC-11d'; result := 'PASS：secretary 不可確認入帳（需 fees.confirm）';
  ELSE item := 'AC-11d'; result := format('FAIL：secretary 確認結果＝%s', j::text); END IF;
  RETURN NEXT;

  -- ── 報到連動：require_paid 開啟 → 未繳鎖領取 → 入帳解鎖 ──────────
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO himitsu.org_settings(org_id, key, value) VALUES (ORG, 'checkin.require_paid', 'true');
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', U_STF, 'role','authenticated','email','epic1-stf@test.local')::text, true);
  BEGIN
    INSERT INTO himitsu.attendee_pickups(org_id, event_id, attendee_id, item_key) VALUES (ORG, v_event, v_att1b, 'ballot');
    item := 'AC-11e'; result := 'FAIL：未繳（已回報未確認）竟可領取！';
  EXCEPTION WHEN OTHERS THEN
    item := 'AC-11e'; result := 'PASS：未繳者領取被鎖（回報未確認也算未繳）';
  END;
  RETURN NEXT;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', U_FIN, 'role','authenticated','email','epic1-fin@test.local')::text, true);
  j := himitsu.confirm_fee_payment(v_inv);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', U_STF, 'role','authenticated','email','epic1-stf@test.local')::text, true);
  INSERT INTO himitsu.attendee_pickups(org_id, event_id, attendee_id, item_key) VALUES (ORG, v_event, v_att1b, 'ballot');
  item := 'AC-11f'; result := 'PASS：財務確認入帳後領取即解鎖（finance 確認也驗過）';
  RETURN NEXT;

  -- ── 收尾 ──────────────────────────────────────────────────────────
  PERFORM pg_temp.himitsu_epic1_cleanup();
  item := '收尾'; result := 'PASS：測試資料已全部清除'; RETURN NEXT;
END $$;

SELECT * FROM pg_temp.himitsu_epic1_test();
