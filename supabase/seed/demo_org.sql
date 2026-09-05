-- ============================================================================
-- HiMitsu 示範協會種子（AC-5）
-- 用法：1. 把最後一行的 your@email.tld 改成「你登入 HiMitsu 用的 email」
--       2. Supabase SQL Editor 整段貼上執行，Results 顯示建置統計
-- 可重複執行：每次先刪掉舊的示範協會（slug=demo）再重建。
-- 內容：80 筆會籍，含大會實戰的全部地雷型態——
--       雙身分（洪柏聲型）、榮譽/永久會員、團體 5 代表、同名兩人、
--       隱藏籍、待審核、待續會、退會、除籍。
-- ============================================================================

CREATE OR REPLACE FUNCTION pg_temp.himitsu_seed_demo(p_email TEXT)
RETURNS TABLE(item TEXT, result TEXT) LANGUAGE plpgsql AS $$
DECLARE
  v_user UUID; v_org UUID; v_ids UUID[];
  v_person UUID; v_entity UUID; v_identity UUID;
  v_no INT := 1;   -- 會員編號流水號
  i INT;
  v_surnames TEXT[] := ARRAY['陳','林','黃','張','李','王','吳','劉','蔡','楊',
                             '許','鄭','謝','郭','洪','曾','邱','廖','賴','周'];
  v_given    TEXT[] := ARRAY['志明','淑芬','建宏','美玲','俊傑','雅婷','家豪','怡君','宗翰','佩珊',
                             '冠宇','欣怡','柏翰','詩涵','承翰','宜蓁','冠廷','子涵','宥廷','品妍'];
  v_name TEXT;
BEGIN
  SELECT id INTO v_user FROM auth.users WHERE lower(email) = lower(btrim(p_email));
  IF v_user IS NULL THEN
    item := '錯誤'; result := format('找不到 %s 的帳號——請先用這個 email 登入過 HiMitsu 一次', p_email);
    RETURN NEXT; RETURN;
  END IF;

  -- 重建：刪掉舊示範協會與其審計軌跡
  SELECT array_agg(id) INTO v_ids FROM himitsu.organizations WHERE slug = 'demo';
  IF v_ids IS NOT NULL THEN
    DELETE FROM himitsu.organizations WHERE id = ANY(v_ids);
    DELETE FROM himitsu.audit_log WHERE org_id = ANY(v_ids);
  END IF;

  INSERT INTO himitsu.organizations(name, slug, theme)
  VALUES ('示範協會', 'demo', '{"primary_color":"#1e4d2b"}'::jsonb)
  RETURNING id INTO v_org;
  INSERT INTO himitsu.org_users(org_id, user_id, role, email)
  VALUES (v_org, v_user, 'owner', lower(btrim(p_email)));

  -- ── 地雷1：雙身分（洪柏聲型＝個人會員＋團體代表，一人兩會籍）──────
  INSERT INTO himitsu.persons(org_id, name, mobile, note)
  VALUES (v_org, '洪柏聲', '0912000001', '示範：一人雙身分') RETURNING id INTO v_person;
  INSERT INTO himitsu.legal_entities(org_id, name, tax_id)
  VALUES (v_org, '柏聲工業股份有限公司', '12345678') RETURNING id INTO v_entity;
  INSERT INTO himitsu.identities(org_id, person_id, kind)
  VALUES (v_org, v_person, 'individual_member') RETURNING id INTO v_identity;
  INSERT INTO himitsu.memberships(org_id, identity_id, member_no, member_type, status, joined_at)
  VALUES (v_org, v_identity, 'M' || lpad(v_no::text, 4, '0'), 'individual', 'active', '2020-03-15');
  v_no := v_no + 1;
  INSERT INTO himitsu.identities(org_id, person_id, entity_id, kind, title)
  VALUES (v_org, v_person, v_entity, 'group_rep', '總經理') RETURNING id INTO v_identity;
  INSERT INTO himitsu.memberships(org_id, identity_id, member_no, member_type, status, joined_at)
  VALUES (v_org, v_identity, 'M' || lpad(v_no::text, 4, '0'), 'group', 'active', '2021-06-01');
  v_no := v_no + 1;

  -- ── 地雷2：團體 5 代表（一家公司、一張會籍掛主代表，另 4 人只有身分）─
  INSERT INTO himitsu.legal_entities(org_id, name, tax_id)
  VALUES (v_org, '大灣製造股份有限公司', '87654321') RETURNING id INTO v_entity;
  FOR i IN 1..5 LOOP
    INSERT INTO himitsu.persons(org_id, name, mobile)
    VALUES (v_org, '代表' || i || '號·大灣', '09130000' || lpad(i::text, 2, '0'))
    RETURNING id INTO v_person;
    IF i = 1 THEN
      INSERT INTO himitsu.identities(org_id, person_id, entity_id, kind, title)
      VALUES (v_org, v_person, v_entity, 'group_rep', '董事長') RETURNING id INTO v_identity;
      INSERT INTO himitsu.memberships(org_id, identity_id, member_no, member_type, status, joined_at)
      VALUES (v_org, v_identity, 'M' || lpad(v_no::text, 4, '0'), 'group', 'active', '2019-01-10');
      v_no := v_no + 1;
    ELSE
      INSERT INTO himitsu.identities(org_id, person_id, entity_id, kind, title)
      VALUES (v_org, v_person, v_entity, 'group_rep', '代表人');
    END IF;
  END LOOP;

  -- ── 地雷3：榮譽×2、永久×1（榮譽無票——名冊凍結時 rights 另計）──────
  FOR i IN 1..3 LOOP
    INSERT INTO himitsu.persons(org_id, name, mobile)
    VALUES (v_org, CASE i WHEN 1 THEN '榮譽·前理事長甲' WHEN 2 THEN '榮譽·創會元老乙' ELSE '永久·資深會員丙' END,
            '09140000' || lpad(i::text, 2, '0'))
    RETURNING id INTO v_person;
    INSERT INTO himitsu.identities(org_id, person_id, kind)
    VALUES (v_org, v_person, CASE WHEN i <= 2 THEN 'honorary' ELSE 'permanent' END)
    RETURNING id INTO v_identity;
    INSERT INTO himitsu.memberships(org_id, identity_id, member_no, member_type, status, joined_at)
    VALUES (v_org, v_identity, 'M' || lpad(v_no::text, 4, '0'), 'individual',
            CASE WHEN i <= 2 THEN 'honorary' ELSE 'permanent' END, '2010-05-20');
    v_no := v_no + 1;
  END LOOP;

  -- ── 地雷4：同名兩人（手機不同）─────────────────────────────────────
  FOR i IN 1..2 LOOP
    INSERT INTO himitsu.persons(org_id, name, mobile, note)
    VALUES (v_org, '陳志明', '091500000' || i, '示範：同名同姓第' || i || '位')
    RETURNING id INTO v_person;
    INSERT INTO himitsu.identities(org_id, person_id, kind)
    VALUES (v_org, v_person, 'individual_member') RETURNING id INTO v_identity;
    INSERT INTO himitsu.memberships(org_id, identity_id, member_no, member_type, status, joined_at)
    VALUES (v_org, v_identity, 'M' || lpad(v_no::text, 4, '0'), 'individual', 'active', '2022-07-07');
    v_no := v_no + 1;
  END LOOP;

  -- ── 地雷5：隱藏籍×2、待審核×3、待續會×5、退會×2、除籍×1 ───────────
  FOR i IN 1..13 LOOP
    v_name := CASE
      WHEN i <= 2  THEN '隱藏籍·示範' || i
      WHEN i <= 5  THEN '待審核·新會員' || (i - 2)
      WHEN i <= 10 THEN '待續會·示範' || (i - 5)
      WHEN i <= 12 THEN '退會·示範' || (i - 10)
      ELSE '除籍·示範1' END;
    INSERT INTO himitsu.persons(org_id, name, mobile)
    VALUES (v_org, v_name, '09160000' || lpad(i::text, 2, '0')) RETURNING id INTO v_person;
    INSERT INTO himitsu.identities(org_id, person_id, kind)
    VALUES (v_org, v_person, 'individual_member') RETURNING id INTO v_identity;
    INSERT INTO himitsu.memberships(org_id, identity_id, member_no, member_type, status, joined_at)
    VALUES (v_org, v_identity, 'M' || lpad(v_no::text, 4, '0'), 'individual',
            CASE WHEN i <= 2 THEN 'hidden' WHEN i <= 5 THEN 'applying'
                 WHEN i <= 10 THEN 'renewal_due' WHEN i <= 12 THEN 'withdrawn'
                 ELSE 'expelled' END,
            CASE WHEN i BETWEEN 3 AND 5 THEN NULL ELSE '2023-02-14'::date END);
    v_no := v_no + 1;
  END LOOP;

  -- ── 一般團體會員×8（各一家公司、一位代表）─────────────────────────
  FOR i IN 1..8 LOOP
    INSERT INTO himitsu.legal_entities(org_id, name, tax_id)
    VALUES (v_org, '示範企業' || i || '有限公司', lpad((20000000 + i)::text, 8, '0'))
    RETURNING id INTO v_entity;
    INSERT INTO himitsu.persons(org_id, name, mobile)
    VALUES (v_org, v_surnames[1 + (i % 20)] || v_given[1 + ((i + 7) % 20)],
            '0917' || lpad(i::text, 6, '0')) RETURNING id INTO v_person;
    INSERT INTO himitsu.identities(org_id, person_id, entity_id, kind, title)
    VALUES (v_org, v_person, v_entity, 'group_rep', '負責人') RETURNING id INTO v_identity;
    INSERT INTO himitsu.memberships(org_id, identity_id, member_no, member_type, status, joined_at)
    VALUES (v_org, v_identity, 'M' || lpad(v_no::text, 4, '0'), 'group', 'active', '2021-11-11');
    v_no := v_no + 1;
  END LOOP;

  -- ── 一般個人會員：補到 80 筆會籍 ───────────────────────────────────
  i := 0;
  WHILE v_no <= 80 LOOP
    v_name := v_surnames[1 + (i % 20)] || v_given[1 + ((i / 20 + (i % 20) * 3) % 20)];
    INSERT INTO himitsu.persons(org_id, name, mobile)
    VALUES (v_org, v_name, '09' || lpad((20000000 + i)::text, 8, '0')) RETURNING id INTO v_person;
    INSERT INTO himitsu.identities(org_id, person_id, kind)
    VALUES (v_org, v_person, 'individual_member') RETURNING id INTO v_identity;
    INSERT INTO himitsu.memberships(org_id, identity_id, member_no, member_type, status, joined_at)
    VALUES (v_org, v_identity, 'M' || lpad(v_no::text, 4, '0'), 'individual', 'active',
            ('2018-01-01'::date + (i * 17 % 2500)));
    v_no := v_no + 1;
    i := i + 1;
  END LOOP;

  -- 讓設定中心的產號接續在種子之後
  INSERT INTO himitsu.org_settings(org_id, key, value)
  VALUES (v_org, 'member_no.next_seq', to_jsonb(v_no));

  -- ── 建置統計 ──────────────────────────────────────────────────────
  item := '協會'; result := '示範協會（/o/demo）已重建，你是 owner'; RETURN NEXT;
  SELECT count(*)::text INTO result FROM himitsu.memberships WHERE org_id = v_org;
  item := '會籍總數'; result := result || '（目標 80）'; RETURN NEXT;
  SELECT count(*)::text INTO result FROM himitsu.persons WHERE org_id = v_org;
  item := '自然人總數'; RETURN NEXT;
  SELECT count(*)::text INTO result FROM himitsu.legal_entities WHERE org_id = v_org;
  item := '法人總數'; RETURN NEXT;
  SELECT count(*)::text INTO result FROM (
    SELECT person_id FROM himitsu.identities WHERE org_id = v_org
    GROUP BY person_id HAVING count(*) >= 2) t;
  item := '雙身分人數'; result := result || '（洪柏聲）'; RETURN NEXT;
  FOR item, result IN
    SELECT '狀態·' || m.status, count(*)::text
    FROM himitsu.memberships m WHERE m.org_id = v_org GROUP BY m.status ORDER BY 1
  LOOP RETURN NEXT; END LOOP;
END $$;

-- ↓↓↓ 把 your@email.tld 改成你登入 HiMitsu 的 email 再執行 ↓↓↓
SELECT * FROM pg_temp.himitsu_seed_demo('your@email.tld');
