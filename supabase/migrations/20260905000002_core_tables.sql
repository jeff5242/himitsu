-- ============================================================================
-- HiMitsu L2：核心資料模型＋RLS 多租戶隔離
-- 執行位置：Supabase SQL Editor 貼上執行一次。
-- 鐵律：本檔只建 himitsu schema 內物件，不觸碰 public。
-- 設計依據：EPIC-0 規格 §2（person/identity 分離、roster 快照、audit 全表）
-- ============================================================================

-- ── 租戶 ──────────────────────────────────────────────────────────────
CREATE TABLE himitsu.organizations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name       TEXT NOT NULL,
  logo_url   TEXT,
  theme      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE himitsu.org_users (
  org_id     UUID NOT NULL REFERENCES himitsu.organizations(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN
             ('owner','secretary_general','secretary','finance','election_officer','staff','viewer')),
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','disabled')),
  invited_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, user_id)
);

-- ── 自然人／法人／身分（今天雙身分教訓的制度化）──────────────────────
CREATE TABLE himitsu.persons (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES himitsu.organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  mobile     TEXT,
  email      TEXT,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_persons_org_name ON himitsu.persons(org_id, name);

CREATE TABLE himitsu.legal_entities (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES himitsu.organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  tax_id     TEXT,
  address    TEXT,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_entities_org ON himitsu.legal_entities(org_id);

CREATE TABLE himitsu.identities (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES himitsu.organizations(id) ON DELETE CASCADE,
  person_id  UUID NOT NULL REFERENCES himitsu.persons(id) ON DELETE CASCADE,
  entity_id  UUID REFERENCES himitsu.legal_entities(id) ON DELETE SET NULL,  -- 團體代表掛所屬法人
  kind       TEXT NOT NULL CHECK (kind IN
             ('individual_member','group_rep','honorary','permanent','guest','staff')),
  title      TEXT,      -- 職稱（總經理／廠長…）
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_identities_org_person ON himitsu.identities(org_id, person_id);

-- ── 會籍（狀態機由轉移表驅動；榮譽/永久終態進 DB 層）────────────────
CREATE TABLE himitsu.memberships (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES himitsu.organizations(id) ON DELETE CASCADE,
  identity_id UUID NOT NULL REFERENCES himitsu.identities(id) ON DELETE CASCADE,
  member_no   TEXT NOT NULL,
  member_type TEXT NOT NULL CHECK (member_type IN ('individual','group')),
  status      TEXT NOT NULL DEFAULT 'applying' CHECK (status IN
              ('applying','active','renewal_due','honorary','permanent','withdrawn','expelled','hidden')),
  joined_at   DATE,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, member_no)
);
CREATE INDEX idx_memberships_org_status ON himitsu.memberships(org_id, status);

-- 合法轉移表（AC-6：非法轉移被 DB 層拒絕）
CREATE TABLE himitsu.membership_transitions (
  from_status TEXT NOT NULL,
  to_status   TEXT NOT NULL,
  PRIMARY KEY (from_status, to_status)
);
INSERT INTO himitsu.membership_transitions VALUES
  ('applying','active'), ('applying','withdrawn'),
  ('active','renewal_due'), ('active','honorary'), ('active','permanent'),
  ('active','withdrawn'), ('active','hidden'),
  ('renewal_due','active'), ('renewal_due','expelled'), ('renewal_due','withdrawn'),
  ('hidden','active'), ('withdrawn','active');
  -- honorary / permanent / expelled 是終態：不在 from_status ＝ 不可再轉出

CREATE OR REPLACE FUNCTION himitsu.check_membership_transition()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NOT EXISTS (SELECT 1 FROM himitsu.membership_transitions
                   WHERE from_status = OLD.status AND to_status = NEW.status) THEN
      RAISE EXCEPTION '會籍狀態不可由 % 轉為 %（終態或非法轉移）', OLD.status, NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_membership_transition BEFORE UPDATE ON himitsu.memberships
  FOR EACH ROW EXECUTE FUNCTION himitsu.check_membership_transition();

-- ── 屆次名冊快照（投票/領票資格看凍結名冊，不看即時會籍）────────────
CREATE TABLE himitsu.rosters (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES himitsu.organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,          -- 例：第5屆有效會員名冊
  term_no    INT,
  frozen_at  TIMESTAMPTZ,            -- 凍結後 entries 不可再改（trigger 擋）
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE himitsu.roster_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES himitsu.organizations(id) ON DELETE CASCADE,
  roster_id   UUID NOT NULL REFERENCES himitsu.rosters(id) ON DELETE CASCADE,
  identity_id UUID NOT NULL REFERENCES himitsu.identities(id),
  member_no   TEXT NOT NULL,         -- 快照當下的編號（不隨主檔變動）
  display_name TEXT NOT NULL,        -- 快照當下的姓名
  rights      JSONB NOT NULL DEFAULT '{"can_vote": true}'::jsonb,
  UNIQUE (roster_id, identity_id)
);

CREATE OR REPLACE FUNCTION himitsu.block_frozen_roster()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE r_frozen TIMESTAMPTZ;
BEGIN
  SELECT frozen_at INTO r_frozen FROM himitsu.rosters
   WHERE id = COALESCE(NEW.roster_id, OLD.roster_id);
  IF r_frozen IS NOT NULL THEN
    RAISE EXCEPTION '名冊已凍結（%），不可再異動', r_frozen;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER trg_roster_frozen BEFORE INSERT OR UPDATE OR DELETE ON himitsu.roster_entries
  FOR EACH ROW EXECUTE FUNCTION himitsu.block_frozen_roster();

-- ── 設定中心 ──────────────────────────────────────────────────────────
CREATE TABLE himitsu.org_settings (
  org_id     UUID NOT NULL REFERENCES himitsu.organizations(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      JSONB NOT NULL,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, key)
);

-- ── 審計（AC-4：全自動 before/after）─────────────────────────────────
CREATE TABLE himitsu.audit_log (
  id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id   UUID,
  actor    UUID DEFAULT auth.uid(),
  action   TEXT NOT NULL,            -- INSERT / UPDATE / DELETE
  tbl      TEXT NOT NULL,
  row_id   TEXT,
  before   JSONB,
  after    JSONB,
  at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_org_at ON himitsu.audit_log(org_id, at DESC);

CREATE OR REPLACE FUNCTION himitsu.audit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO himitsu.audit_log(org_id, action, tbl, row_id, before, after)
  VALUES (
    COALESCE( (to_jsonb(COALESCE(NEW, OLD))->>'org_id')::uuid, NULL ),
    TG_OP, TG_TABLE_NAME,
    to_jsonb(COALESCE(NEW, OLD))->>'id',
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END $$;

DO $$ DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['organizations','org_users','persons','legal_entities',
                           'identities','memberships','rosters','roster_entries','org_settings']
  LOOP
    EXECUTE format('CREATE TRIGGER trg_audit_%s AFTER INSERT OR UPDATE OR DELETE ON himitsu.%I
                    FOR EACH ROW EXECUTE FUNCTION himitsu.audit()', t, t);
  END LOOP;
END $$;

-- ── RLS：租戶隔離（AC-1 的執行點）────────────────────────────────────
CREATE OR REPLACE FUNCTION himitsu.is_org_member(p_org UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM himitsu.org_users
                 WHERE org_id = p_org AND user_id = auth.uid() AND status = 'active');
$$;

DO $$ DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['organizations','org_users','persons','legal_entities',
                           'identities','memberships','rosters','roster_entries','org_settings','audit_log',
                           'membership_transitions']
  LOOP
    EXECUTE format('ALTER TABLE himitsu.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- organizations：成員可讀自己的協會；建立走 RPC（見下）
CREATE POLICY org_read ON himitsu.organizations FOR SELECT TO authenticated
  USING (himitsu.is_org_member(id));
CREATE POLICY org_update ON himitsu.organizations FOR UPDATE TO authenticated
  USING (himitsu.is_org_member(id));

-- org_users：同協會成員可讀；寫入管理留待 L3 角色矩陣（先鎖住）
CREATE POLICY orgusers_read ON himitsu.org_users FOR SELECT TO authenticated
  USING (himitsu.is_org_member(org_id));

-- 一般業務表：成員可讀寫自己協會的列（L3 再依角色細分寫入權）
DO $$ DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['persons','legal_entities','identities','memberships',
                           'rosters','roster_entries','org_settings']
  LOOP
    EXECUTE format('CREATE POLICY %I_rw ON himitsu.%I FOR ALL TO authenticated
                    USING (himitsu.is_org_member(org_id))
                    WITH CHECK (himitsu.is_org_member(org_id))', t, t);
  END LOOP;
END $$;

-- 審計唯讀（成員可查自己協會的軌跡；寫入只走 trigger）
CREATE POLICY audit_read ON himitsu.audit_log FOR SELECT TO authenticated
  USING (org_id IS NOT NULL AND himitsu.is_org_member(org_id));

-- 轉移規則表全體唯讀
CREATE POLICY transitions_read ON himitsu.membership_transitions FOR SELECT
  TO authenticated USING (true);

-- ── 開新協會 RPC（建立者自動成 owner）────────────────────────────────
CREATE OR REPLACE FUNCTION himitsu.create_organization(p_name TEXT, p_slug TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_org UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  INSERT INTO himitsu.organizations(name, slug) VALUES (btrim(p_name), lower(btrim(p_slug)))
    RETURNING id INTO v_org;
  INSERT INTO himitsu.org_users(org_id, user_id, role) VALUES (v_org, auth.uid(), 'owner');
  RETURN json_build_object('ok', true, 'org_id', v_org);
EXCEPTION WHEN unique_violation THEN
  RETURN json_build_object('ok', false, 'error', 'slug_taken');
END $$;

-- ── 權限：himitsu 一律走 authenticated；anon 只留 health ─────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA himitsu TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON himitsu.audit_log FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON himitsu.membership_transitions FROM authenticated;
GRANT EXECUTE ON FUNCTION himitsu.create_organization(TEXT, TEXT) TO authenticated;
