-- ============================================================================
-- HiMitsu RLS 隔離測試（AC-1 / AC-6）
-- 用法：Supabase SQL Editor 整段貼上執行，看 Messages 面板的 PASS/FAIL。
-- 全程在交易內、最後 ROLLBACK——不會在資料庫留下任何東西。
-- ============================================================================
BEGIN;

-- 建兩個測試使用者（僅存在於本交易）
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        confirmation_token, recovery_token, email_change, email_change_token_new)
VALUES
 ('00000000-0000-0000-0000-000000000000','aaaaaaaa-0000-4000-8000-000000000001',
  'authenticated','authenticated','rls-a@test.local','x',NOW(),NOW(),NOW(),'','','',''),
 ('00000000-0000-0000-0000-000000000000','bbbbbbbb-0000-4000-8000-000000000002',
  'authenticated','authenticated','rls-b@test.local','x',NOW(),NOW(),NOW(),'','','','');

-- 建兩個協會，A、B 各一人
INSERT INTO himitsu.organizations(id, slug, name) VALUES
 ('11111111-0000-4000-8000-000000000001','org-a','測試協會A'),
 ('22222222-0000-4000-8000-000000000002','org-b','測試協會B');
INSERT INTO himitsu.org_users(org_id, user_id, role) VALUES
 ('11111111-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','owner'),
 ('22222222-0000-4000-8000-000000000002','bbbbbbbb-0000-4000-8000-000000000002','owner');
INSERT INTO himitsu.persons(org_id, name) VALUES
 ('11111111-0000-4000-8000-000000000001','A協會的會員'),
 ('22222222-0000-4000-8000-000000000002','B協會的會員');

-- ── 以 A 使用者身分測試 ────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
DECLARE n INT; nm TEXT;
BEGIN
  SELECT count(*) INTO n FROM himitsu.organizations;
  IF n = 1 THEN RAISE NOTICE 'PASS AC-1a：A 只看得到 1 個協會';
  ELSE RAISE NOTICE 'FAIL AC-1a：A 看到 % 個協會（應為 1）', n; END IF;

  SELECT count(*) INTO n FROM himitsu.persons;
  SELECT max(name) INTO nm FROM himitsu.persons;
  IF n = 1 AND nm = 'A協會的會員' THEN RAISE NOTICE 'PASS AC-1b：A 只看得到自己協會的人員';
  ELSE RAISE NOTICE 'FAIL AC-1b：A 看到 % 筆人員（%）', n, nm; END IF;

  BEGIN
    INSERT INTO himitsu.persons(org_id, name)
    VALUES ('22222222-0000-4000-8000-000000000002','A嘗試寫入B協會');
    RAISE NOTICE 'FAIL AC-1c：A 竟能寫入 B 協會！';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PASS AC-1c：A 寫入 B 協會被拒（%）', SQLERRM;
  END;
END $$;

-- ── 以 B 使用者身分反向驗證 ────────────────────────────────────────
SET LOCAL request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
DO $$
DECLARE nm TEXT;
BEGIN
  SELECT max(name) INTO nm FROM himitsu.persons;
  IF nm = 'B協會的會員' THEN RAISE NOTICE 'PASS AC-1d：B 只看得到自己協會的人員';
  ELSE RAISE NOTICE 'FAIL AC-1d：B 看到了「%」', nm; END IF;
END $$;

-- ── AC-6：會籍終態保護 ─────────────────────────────────────────────
RESET ROLE;
DO $$
DECLARE v_identity UUID; v_membership UUID;
BEGIN
  INSERT INTO himitsu.identities(org_id, person_id, kind)
  SELECT org_id, id, 'individual_member' FROM himitsu.persons WHERE name='A協會的會員'
  RETURNING id INTO v_identity;
  INSERT INTO himitsu.memberships(org_id, identity_id, member_no, member_type, status)
  VALUES ('11111111-0000-4000-8000-000000000001', v_identity, 'T001', 'individual', 'applying')
  RETURNING id INTO v_membership;
  UPDATE himitsu.memberships SET status='active'    WHERE id=v_membership;
  UPDATE himitsu.memberships SET status='permanent' WHERE id=v_membership;
  BEGIN
    UPDATE himitsu.memberships SET status='expelled' WHERE id=v_membership;
    RAISE NOTICE 'FAIL AC-6：permanent 竟可轉 expelled！';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PASS AC-6：終態保護生效（%）', SQLERRM;
  END;
END $$;

-- ── 審計抽查（AC-4）────────────────────────────────────────────────
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM himitsu.audit_log WHERE tbl='persons';
  IF n >= 2 THEN RAISE NOTICE 'PASS AC-4：persons 寫入已留審計軌跡（% 筆）', n;
  ELSE RAISE NOTICE 'FAIL AC-4：審計筆數 %（應 ≥2）', n; END IF;
END $$;

ROLLBACK;  -- 一切測試資料蒸發
