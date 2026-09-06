-- ============================================================================
-- HiMitsu L7（EPIC-1）：活動引擎——events / event_attendees＋序號終身制
-- 執行位置：Supabase SQL Editor 貼上執行一次（需先跑過 L2~L4 migration）。
-- 鐵律：本檔只建 himitsu schema 內物件，不觸碰 public。
-- 設計依據：EPIC-1 規格 §1-1（AC-8）；支柱①attendee 掛 identity、②序號終身制
-- ============================================================================

-- ── 權限矩陣新增（EPIC-1 全部一次入冊）─────────────────────────────
INSERT INTO himitsu.role_permissions(role, perm) VALUES
  ('owner','events.write'), ('secretary_general','events.write'), ('secretary','events.write'),
  ('owner','fees.confirm'), ('secretary_general','fees.confirm'), ('finance','fees.confirm');

-- ── 設定目錄新增 ──────────────────────────────────────────────────────
INSERT INTO himitsu.settings_catalog (key, category, label, description, value_type, default_value, sort) VALUES
  ('checkin.require_paid',  '報到', '未繳會費鎖領取',   '開啟後未繳年費者的領取項目鎖定，現場繳費經財務確認後解鎖', 'boolean', 'false', 44),
  ('checkin.walkin_enabled','報到', '開放現場臨時報名', '關閉後報到台不可新增 walk-in',                              'boolean', 'true',  45);

-- ── 活動 ──────────────────────────────────────────────────────────────
CREATE TABLE himitsu.events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES himitsu.organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'assembly' CHECK (kind IN ('assembly','meeting','banquet','other')),
  starts_at  TIMESTAMPTZ,
  venue      TEXT,
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  roster_id  UUID REFERENCES himitsu.rosters(id),   -- 投票型活動的資格來源（EPIC-2 使用）
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_events_org ON himitsu.events(org_id, starts_at DESC);

-- ── 出席名單（attendee 掛 identity；來賓/walk-in 用 guest_name）────────
CREATE TABLE himitsu.event_attendees (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES himitsu.organizations(id) ON DELETE CASCADE,
  event_id    UUID NOT NULL REFERENCES himitsu.events(id) ON DELETE CASCADE,
  seq_no      INT  NOT NULL,                         -- 序號終身制：trigger 發號、永不回收
  identity_id UUID REFERENCES himitsu.identities(id),
  guest_name  TEXT,
  guest_org   TEXT,
  category    TEXT NOT NULL DEFAULT 'member' CHECK (category IN ('member','guest','walkin')),
  table_no    INT,                                   -- 桌次（L9 掛容量防線）
  source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('import','manual','walkin')),
  checked_in_at TIMESTAMPTZ,                         -- 快取欄；事實在 checkin_log（L8）
  removed_at  TIMESTAMPTZ,                           -- 除名留列，序號永久缺號
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, seq_no),
  CHECK ((category = 'member') = (identity_id IS NOT NULL)),
  CHECK (identity_id IS NOT NULL OR guest_name IS NOT NULL)
);
CREATE INDEX idx_attendees_event ON himitsu.event_attendees(event_id, removed_at);
-- 同活動同身分不重複掛列（除名後允許重加）
CREATE UNIQUE INDEX ux_attendee_identity ON himitsu.event_attendees(event_id, identity_id)
  WHERE identity_id IS NOT NULL AND removed_at IS NULL;

-- 序號終身制：發號（同活動序列化）＋不可改號＋不可刪列
CREATE OR REPLACE FUNCTION himitsu.assign_attendee_seq()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.event_id::text, 42));
  NEW.seq_no := COALESCE(
    (SELECT max(seq_no) FROM himitsu.event_attendees WHERE event_id = NEW.event_id), 0) + 1;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_attendee_seq BEFORE INSERT ON himitsu.event_attendees
  FOR EACH ROW EXECUTE FUNCTION himitsu.assign_attendee_seq();

CREATE OR REPLACE FUNCTION himitsu.guard_attendee()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.seq_no <> OLD.seq_no THEN
      RAISE EXCEPTION '序號終身制：序號不可變更';
    END IF;
    RETURN NEW;
  END IF;
  -- DELETE：除名一律走 removed_at；只有 service 情境（無 JWT）可實體刪除
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION '不可刪除出席名單列，請改用除名（removed_at）';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER trg_attendee_guard BEFORE UPDATE OR DELETE ON himitsu.event_attendees
  FOR EACH ROW EXECUTE FUNCTION himitsu.guard_attendee();

-- ── RLS＋審計（沿用 L2 機制）─────────────────────────────────────────
DO $$ DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['events','event_attendees'] LOOP
    EXECUTE format('ALTER TABLE himitsu.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_read ON himitsu.%I FOR SELECT TO authenticated
                    USING (himitsu.is_org_member(org_id))', t, t);
    EXECUTE format('CREATE POLICY %I_insert ON himitsu.%I FOR INSERT TO authenticated
                    WITH CHECK (himitsu.has_perm(org_id, %L))', t, t, 'events.write');
    EXECUTE format('CREATE POLICY %I_update ON himitsu.%I FOR UPDATE TO authenticated
                    USING (himitsu.has_perm(org_id, %L))
                    WITH CHECK (himitsu.has_perm(org_id, %L))', t, t, 'events.write', 'events.write');
    EXECUTE format('CREATE POLICY %I_delete ON himitsu.%I FOR DELETE TO authenticated
                    USING (himitsu.has_perm(org_id, %L))', t, t, 'events.write');
    EXECUTE format('CREATE TRIGGER trg_audit_%s AFTER INSERT OR UPDATE OR DELETE ON himitsu.%I
                    FOR EACH ROW EXECUTE FUNCTION himitsu.audit()', t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON himitsu.%I TO authenticated', t);
  END LOOP;
END $$;
