-- ============================================================================
-- HiMitsu 角色矩陣＋邀請流程測試（AC-3 / AC-4）
-- 用法：Supabase SQL Editor 整段貼上執行，看 Messages 面板的 PASS/FAIL。
-- 前置：需已執行 L2 core_tables 與 L3 auth_roles 兩支 migration。
-- 全程在交易內、最後 ROLLBACK——不會在資料庫留下任何東西。
-- ============================================================================
BEGIN;

-- 測試使用者：owner／secretary／finance／staff／受邀新人／局外人
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        confirmation_token, recovery_token, email_change, email_change_token_new)
VALUES
 ('00000000-0000-0000-0000-000000000000','cccccccc-0000-4000-8000-000000000001',
  'authenticated','authenticated','own-c@test.local','x',NOW(),NOW(),NOW(),'','','',''),
 ('00000000-0000-0000-0000-000000000000','cccccccc-0000-4000-8000-000000000002',
  'authenticated','authenticated','sec-c@test.local','x',NOW(),NOW(),NOW(),'','','',''),
 ('00000000-0000-0000-0000-000000000000','cccccccc-0000-4000-8000-000000000003',
  'authenticated','authenticated','fin-c@test.local','x',NOW(),NOW(),NOW(),'','','',''),
 ('00000000-0000-0000-0000-000000000000','cccccccc-0000-4000-8000-000000000004',
  'authenticated','authenticated','stf-c@test.local','x',NOW(),NOW(),NOW(),'','','',''),
 ('00000000-0000-0000-0000-000000000000','cccccccc-0000-4000-8000-000000000005',
  'authenticated','authenticated','new-c@test.local','x',NOW(),NOW(),NOW(),'','','',''),
 ('00000000-0000-0000-0000-000000000000','cccccccc-0000-4000-8000-000000000006',
  'authenticated','authenticated','eve-c@test.local','x',NOW(),NOW(),NOW(),'','','','');

-- 測試協會 C＋各角色成員＋一名會員（含會籍）
INSERT INTO himitsu.organizations(id, slug, name) VALUES
 ('33333333-0000-4000-8000-000000000003','org-c','測試協會C');
INSERT INTO himitsu.org_users(org_id, user_id, role, email) VALUES
 ('33333333-0000-4000-8000-000000000003','cccccccc-0000-4000-8000-000000000001','owner','own-c@test.local'),
 ('33333333-0000-4000-8000-000000000003','cccccccc-0000-4000-8000-000000000002','secretary','sec-c@test.local'),
 ('33333333-0000-4000-8000-000000000003','cccccccc-0000-4000-8000-000000000003','finance','fin-c@test.local'),
 ('33333333-0000-4000-8000-000000000003','cccccccc-0000-4000-8000-000000000004','staff','stf-c@test.local');

INSERT INTO himitsu.persons(id, org_id, name, mobile) VALUES
 ('44444444-0000-4000-8000-000000000001','33333333-0000-4000-8000-000000000003','測試會員甲','0911111111');
INSERT INTO himitsu.identities(id, org_id, person_id, kind) VALUES
 ('55555555-0000-4000-8000-000000000001','33333333-0000-4000-8000-000000000003',
  '44444444-0000-4000-8000-000000000001','individual_member');
INSERT INTO himitsu.memberships(id, org_id, identity_id, member_no, member_type, status) VALUES
 ('66666666-0000-4000-8000-000000000001','33333333-0000-4000-8000-000000000003',
  '55555555-0000-4000-8000-000000000001','C001','individual','active');

-- ── 矩陣完整性：每個角色的權限集合逐一比對（AC-3 的測試對應）────────
DO $$
DECLARE r RECORD; v_actual TEXT;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('owner',             'checkin.write,fees.write,identities.write,legal_entities.write,memberships.write,org_settings.write,org_users.manage,orgs.update,persons.write,roster_entries.write,rosters.write'),
    ('secretary_general', 'checkin.write,fees.write,identities.write,legal_entities.write,memberships.write,org_settings.write,org_users.manage,orgs.update,persons.write,roster_entries.write,rosters.write'),
    ('secretary',         'checkin.write,identities.write,legal_entities.write,memberships.write,persons.write,roster_entries.write,rosters.write'),
    ('finance',           'fees.write'),
    ('election_officer',  'roster_entries.write,rosters.write'),
    ('staff',             'checkin.write'),
    ('viewer',            '')
  ) AS m(role, expected)
  LOOP
    SELECT COALESCE(string_agg(perm, ',' ORDER BY perm), '') INTO v_actual
      FROM himitsu.role_permissions WHERE role = r.role;
    IF v_actual = r.expected THEN
      RAISE NOTICE 'PASS 矩陣[%]：權限集合正確', r.role;
    ELSE
      RAISE NOTICE 'FAIL 矩陣[%]：實際=%（預期=%）', r.role, v_actual, r.expected;
    END IF;
  END LOOP;
END $$;

-- ── AC-3a/b：staff 不可改、不可增會員資料 ────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"cccccccc-0000-4000-8000-000000000004","role":"authenticated","email":"stf-c@test.local"}';
DO $$
DECLARE n INT;
BEGIN
  UPDATE himitsu.persons SET mobile = '0900000000'
   WHERE id = '44444444-0000-4000-8000-000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE NOTICE 'PASS AC-3a：staff 改會員資料被拒（0 列生效）';
  ELSE RAISE NOTICE 'FAIL AC-3a：staff 竟改到 % 列會員資料！', n; END IF;

  BEGIN
    INSERT INTO himitsu.persons(org_id, name)
    VALUES ('33333333-0000-4000-8000-000000000003','staff偷加的人');
    RAISE NOTICE 'FAIL AC-3b：staff 竟能新增會員！';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PASS AC-3b：staff 新增會員被拒（%）', SQLERRM;
  END;

  -- staff 仍可讀（報到需要看名單）
  SELECT count(*) INTO n FROM himitsu.persons;
  IF n = 1 THEN RAISE NOTICE 'PASS AC-3c：staff 保有讀取權';
  ELSE RAISE NOTICE 'FAIL AC-3c：staff 讀到 % 筆（應為 1）', n; END IF;
END $$;

-- ── AC-3d：finance 不可改會籍 ────────────────────────────────────────
SET LOCAL request.jwt.claims = '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated","email":"fin-c@test.local"}';
DO $$
DECLARE n INT;
BEGIN
  UPDATE himitsu.memberships SET status = 'renewal_due'
   WHERE id = '66666666-0000-4000-8000-000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE NOTICE 'PASS AC-3d：finance 改會籍被拒（0 列生效）';
  ELSE RAISE NOTICE 'FAIL AC-3d：finance 竟改到 % 列會籍！', n; END IF;
END $$;

-- ── AC-3e＋AC-4：secretary 可改，且審計記到 actor/before/after ────────
SET LOCAL request.jwt.claims = '{"sub":"cccccccc-0000-4000-8000-000000000002","role":"authenticated","email":"sec-c@test.local"}';
DO $$
DECLARE n INT;
BEGIN
  UPDATE himitsu.persons SET mobile = '0922222222'
   WHERE id = '44444444-0000-4000-8000-000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 1 THEN RAISE NOTICE 'PASS AC-3e：secretary 可改會員資料';
  ELSE RAISE NOTICE 'FAIL AC-3e：secretary 更新生效 % 列（應為 1）', n; END IF;
END $$;

RESET ROLE;
SET LOCAL request.jwt.claims = '';
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM himitsu.audit_log
   WHERE tbl = 'persons' AND row_id = '44444444-0000-4000-8000-000000000001'
     AND action = 'UPDATE'
     AND actor = 'cccccccc-0000-4000-8000-000000000002'
     AND before->>'mobile' = '0911111111' AND after->>'mobile' = '0922222222';
  IF n = 1 THEN RAISE NOTICE 'PASS AC-4：審計記錄含 actor＋before/after 手機號';
  ELSE RAISE NOTICE 'FAIL AC-4：找不到 secretary 改手機號的完整審計（% 筆）', n; END IF;
END $$;

-- ── org_users 守衛：secretary 不可管帳號；owner 不可自斷最後一位 ─────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"cccccccc-0000-4000-8000-000000000002","role":"authenticated","email":"sec-c@test.local"}';
DO $$
DECLARE n INT;
BEGIN
  UPDATE himitsu.org_users SET role = 'secretary_general'
   WHERE org_id = '33333333-0000-4000-8000-000000000003'
     AND user_id = 'cccccccc-0000-4000-8000-000000000002';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE NOTICE 'PASS 守衛a：secretary 自改角色被拒';
  ELSE RAISE NOTICE 'FAIL 守衛a：secretary 竟自改角色成功！'; END IF;
END $$;

SET LOCAL request.jwt.claims = '{"sub":"cccccccc-0000-4000-8000-000000000001","role":"authenticated","email":"own-c@test.local"}';
DO $$
BEGIN
  BEGIN
    UPDATE himitsu.org_users SET role = 'viewer'
     WHERE org_id = '33333333-0000-4000-8000-000000000003'
       AND user_id = 'cccccccc-0000-4000-8000-000000000001';
    RAISE NOTICE 'FAIL 守衛b：最後一位 owner 竟可自降級！';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PASS 守衛b：最後一位 owner 受保護（%）', SQLERRM;
  END;
END $$;

-- ── 邀請流程：owner 邀 staff → 對的人接受成功、錯的人被拒 ────────────
DO $$
DECLARE j JSON; v_token UUID;
BEGIN
  j := himitsu.invite_user('33333333-0000-4000-8000-000000000003','new-c@test.local','staff');
  IF (j->>'ok')::boolean THEN
    RAISE NOTICE 'PASS 邀請a：owner 發出邀請成功';
  ELSE
    RAISE NOTICE 'FAIL 邀請a：發邀請失敗（%）', j->>'error';
  END IF;
  v_token := (j->>'token')::uuid;

  -- 錯的人（email 不符）嘗試接受
  PERFORM set_config('request.jwt.claims',
    '{"sub":"cccccccc-0000-4000-8000-000000000006","role":"authenticated","email":"eve-c@test.local"}', true);
  j := himitsu.accept_invitation(v_token);
  IF (j->>'ok')::boolean = false AND j->>'error' = 'email_mismatch' THEN
    RAISE NOTICE 'PASS 邀請b：email 不符者被拒';
  ELSE
    RAISE NOTICE 'FAIL 邀請b：局外人接受邀請的結果＝%', j::text;
  END IF;

  -- 對的人接受
  PERFORM set_config('request.jwt.claims',
    '{"sub":"cccccccc-0000-4000-8000-000000000005","role":"authenticated","email":"new-c@test.local"}', true);
  j := himitsu.accept_invitation(v_token);
  IF (j->>'ok')::boolean AND j->>'role' = 'staff' THEN
    RAISE NOTICE 'PASS 邀請c：受邀者入職成功（role=staff, org=%）', j->>'org_slug';
  ELSE
    RAISE NOTICE 'FAIL 邀請c：接受邀請失敗（%）', j::text;
  END IF;

  -- token 不可重複使用
  j := himitsu.accept_invitation(v_token);
  IF (j->>'ok')::boolean = false THEN
    RAISE NOTICE 'PASS 邀請d：token 不可重複使用（%）', j->>'error';
  ELSE
    RAISE NOTICE 'FAIL 邀請d：token 竟可重複使用！';
  END IF;
END $$;

RESET ROLE;
SET LOCAL request.jwt.claims = '';
DO $$
DECLARE v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM himitsu.org_users
   WHERE org_id = '33333333-0000-4000-8000-000000000003'
     AND user_id = 'cccccccc-0000-4000-8000-000000000005';
  IF v_role = 'staff' THEN RAISE NOTICE 'PASS 邀請e：org_users 已建立受邀者（staff）';
  ELSE RAISE NOTICE 'FAIL 邀請e：受邀者的 org_users 角色＝%', COALESCE(v_role,'(不存在)'); END IF;
END $$;

ROLLBACK;  -- 一切測試資料蒸發
