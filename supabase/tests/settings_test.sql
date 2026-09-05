-- ============================================================================
-- HiMitsu 設定中心測試（AC-7）
-- 用法：Supabase SQL Editor 整段貼上執行，看 Messages 面板的 PASS/FAIL。
-- 前置：需已執行 L2、L3、L4 三支 migration。
-- 全程在交易內、最後 ROLLBACK——不會在資料庫留下任何東西。
-- ============================================================================
BEGIN;

-- 測試使用者：D 協會 owner＋secretary＋staff、E 協會 owner
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        confirmation_token, recovery_token, email_change, email_change_token_new)
VALUES
 ('00000000-0000-0000-0000-000000000000','dddddddd-0000-4000-8000-000000000001',
  'authenticated','authenticated','own-d@test.local','x',NOW(),NOW(),NOW(),'','','',''),
 ('00000000-0000-0000-0000-000000000000','dddddddd-0000-4000-8000-000000000002',
  'authenticated','authenticated','sec-d@test.local','x',NOW(),NOW(),NOW(),'','','',''),
 ('00000000-0000-0000-0000-000000000000','dddddddd-0000-4000-8000-000000000003',
  'authenticated','authenticated','stf-d@test.local','x',NOW(),NOW(),NOW(),'','','',''),
 ('00000000-0000-0000-0000-000000000000','eeeeeeee-0000-4000-8000-000000000001',
  'authenticated','authenticated','own-e@test.local','x',NOW(),NOW(),NOW(),'','','','');

INSERT INTO himitsu.organizations(id, slug, name) VALUES
 ('77777777-0000-4000-8000-000000000004','org-d','測試協會D'),
 ('88888888-0000-4000-8000-000000000005','org-e','測試協會E');
INSERT INTO himitsu.org_users(org_id, user_id, role, email) VALUES
 ('77777777-0000-4000-8000-000000000004','dddddddd-0000-4000-8000-000000000001','owner','own-d@test.local'),
 ('77777777-0000-4000-8000-000000000004','dddddddd-0000-4000-8000-000000000002','secretary','sec-d@test.local'),
 ('77777777-0000-4000-8000-000000000004','dddddddd-0000-4000-8000-000000000003','staff','stf-d@test.local'),
 ('88888888-0000-4000-8000-000000000005','eeeeeeee-0000-4000-8000-000000000001','owner','own-e@test.local');

-- ── 精靈：新版 create_organization 帶 LOGO＋主題色 ───────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"dddddddd-0000-4000-8000-000000000001","role":"authenticated","email":"own-d@test.local"}';
DO $$
DECLARE j JSON; v_theme JSONB; v_logo TEXT;
BEGIN
  j := himitsu.create_organization('精靈測試協會','wizard-test',
        'https://example.com/logo.png','{"primary_color":"#1e4d2b"}'::jsonb);
  IF (j->>'ok')::boolean THEN
    SELECT theme, logo_url INTO v_theme, v_logo
      FROM himitsu.organizations WHERE id = (j->>'org_id')::uuid;
    IF v_theme->>'primary_color' = '#1e4d2b' AND v_logo = 'https://example.com/logo.png' THEN
      RAISE NOTICE 'PASS 精靈a：開協會一次帶入 LOGO＋主題色';
    ELSE
      RAISE NOTICE 'FAIL 精靈a：theme=%、logo=%', v_theme, v_logo;
    END IF;
  ELSE
    RAISE NOTICE 'FAIL 精靈a：建立失敗（%）', j->>'error';
  END IF;
END $$;

-- ── 設定讀取：無覆寫時回目錄預設值 ───────────────────────────────────
DO $$
DECLARE v JSONB;
BEGIN
  v := himitsu.get_setting('77777777-0000-4000-8000-000000000004','fees.individual_annual');
  IF v = to_jsonb(3000) THEN RAISE NOTICE 'PASS 設定a：無覆寫時回目錄預設（個人年費 3000）';
  ELSE RAISE NOTICE 'FAIL 設定a：讀到 %（應為 3000）', v; END IF;
END $$;

-- ── AC-7 主軸：D 協會自訂編號規則，E 協會用預設，互不影響 ────────────
DO $$
DECLARE j JSON;
BEGIN
  -- D 的 owner 改編號規則：TC-{seq}、補 3 位
  INSERT INTO himitsu.org_settings(org_id, key, value)
  VALUES ('77777777-0000-4000-8000-000000000004','member_no.rule',
          '{"template":"TC-{seq}","pad":3}'::jsonb);

  j := himitsu.next_member_no('77777777-0000-4000-8000-000000000004');
  IF j->>'member_no' = 'TC-001' THEN
    RAISE NOTICE 'PASS AC-7a：D 協會新編號套用自訂規則（TC-001）';
  ELSE
    RAISE NOTICE 'FAIL AC-7a：D 編號＝%（應為 TC-001）', j::text;
  END IF;

  j := himitsu.next_member_no('77777777-0000-4000-8000-000000000004');
  IF j->>'member_no' = 'TC-002' THEN
    RAISE NOTICE 'PASS AC-7b：流水號正確遞增（TC-002）';
  ELSE
    RAISE NOTICE 'FAIL AC-7b：D 第二筆編號＝%', j::text;
  END IF;

  -- 改規則後：新建會員套新規則，流水號延續
  UPDATE himitsu.org_settings
     SET value = '{"template":"新-{seq}","pad":2}'::jsonb
   WHERE org_id = '77777777-0000-4000-8000-000000000004' AND key = 'member_no.rule';
  j := himitsu.next_member_no('77777777-0000-4000-8000-000000000004');
  IF j->>'member_no' = '新-03' THEN
    RAISE NOTICE 'PASS AC-7c：改規則後新建會員套用新規則（新-03，流水號延續）';
  ELSE
    RAISE NOTICE 'FAIL AC-7c：改規則後編號＝%（應為 新-03）', j::text;
  END IF;
END $$;

-- E 協會的 owner 產號：不受 D 的自訂規則影響
SET LOCAL request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000001","role":"authenticated","email":"own-e@test.local"}';
DO $$
DECLARE j JSON;
BEGIN
  j := himitsu.next_member_no('88888888-0000-4000-8000-000000000005');
  IF j->>'member_no' = 'M0001' THEN
    RAISE NOTICE 'PASS AC-7d：E 協會用預設規則（M0001），與 D 完全隔離';
  ELSE
    RAISE NOTICE 'FAIL AC-7d：E 編號＝%（應為 M0001）', j::text;
  END IF;

  -- E 讀不到 D 的設定
  IF himitsu.get_setting('77777777-0000-4000-8000-000000000004','member_no.rule') IS NULL THEN
    RAISE NOTICE 'PASS AC-7e：E 的帳號讀不到 D 的設定';
  ELSE
    RAISE NOTICE 'FAIL AC-7e：跨協會讀到設定！';
  END IF;
END $$;

-- ── 權限：secretary 不可改設定（無 org_settings.write）、staff 不可產號 ─
SET LOCAL request.jwt.claims = '{"sub":"dddddddd-0000-4000-8000-000000000002","role":"authenticated","email":"sec-d@test.local"}';
DO $$
DECLARE n INT;
BEGIN
  UPDATE himitsu.org_settings SET value = '9999'::jsonb
   WHERE org_id = '77777777-0000-4000-8000-000000000004' AND key = 'member_no.rule';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE NOTICE 'PASS 權限a：secretary 改設定被拒（0 列生效）';
  ELSE RAISE NOTICE 'FAIL 權限a：secretary 竟改到 % 列設定！', n; END IF;
END $$;

SET LOCAL request.jwt.claims = '{"sub":"dddddddd-0000-4000-8000-000000000003","role":"authenticated","email":"stf-d@test.local"}';
DO $$
DECLARE j JSON;
BEGIN
  j := himitsu.next_member_no('77777777-0000-4000-8000-000000000004');
  IF (j->>'ok')::boolean = false AND j->>'error' = 'forbidden' THEN
    RAISE NOTICE 'PASS 權限b：staff 不可產生會員編號';
  ELSE
    RAISE NOTICE 'FAIL 權限b：staff 產號結果＝%', j::text;
  END IF;
END $$;

ROLLBACK;  -- 一切測試資料蒸發
