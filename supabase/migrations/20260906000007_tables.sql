-- ============================================================================
-- HiMitsu L9（EPIC-1）：宴會桌次——event_tables＋容量 DB 防線
-- 執行位置：Supabase SQL Editor 貼上執行一次（需先跑過 L7/L8）。
-- 設計依據：EPIC-1 規格 §1-4（AC-10）；桌數/每桌人數預設吃設定中心
-- ============================================================================

CREATE TABLE himitsu.event_tables (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id   UUID NOT NULL REFERENCES himitsu.organizations(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES himitsu.events(id) ON DELETE CASCADE,
  table_no INT  NOT NULL CHECK (table_no > 0),
  capacity INT  NOT NULL CHECK (capacity > 0),
  label    TEXT,                       -- 貴賓桌／主桌…
  note     TEXT,
  UNIQUE (event_id, table_no)
);

-- 建桌守衛：桌數上限吃設定；capacity 未給時套「每桌人數」設定（AC-10）
CREATE OR REPLACE FUNCTION himitsu.guard_table_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_max INT; v_count INT;
BEGIN
  v_max := COALESCE((himitsu.get_setting(NEW.org_id, 'assembly.max_tables') #>> '{}')::int, 30);
  SELECT count(*) INTO v_count FROM himitsu.event_tables WHERE event_id = NEW.event_id;
  IF v_count >= v_max THEN
    RAISE EXCEPTION '已達桌數上限 %（設定中心 assembly.max_tables 可調）', v_max;
  END IF;
  IF NEW.capacity IS NULL THEN
    NEW.capacity := COALESCE((himitsu.get_setting(NEW.org_id, 'assembly.table_capacity') #>> '{}')::int, 10);
  END IF;
  RETURN NEW;
END $$;
-- BEFORE trigger 先補 capacity，NOT NULL 約束才檢查——欄位改為允許 trigger 填值
ALTER TABLE himitsu.event_tables ALTER COLUMN capacity DROP NOT NULL;
CREATE TRIGGER trg_table_insert BEFORE INSERT ON himitsu.event_tables
  FOR EACH ROW EXECUTE FUNCTION himitsu.guard_table_insert();
-- 補值後仍不得為空
ALTER TABLE himitsu.event_tables ADD CONSTRAINT event_tables_capacity_filled
  CHECK (capacity IS NOT NULL AND capacity > 0);

-- 縮桌守衛：容量不可低於現有入座人數
CREATE OR REPLACE FUNCTION himitsu.guard_table_shrink()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_occupied INT;
BEGIN
  IF NEW.capacity < OLD.capacity THEN
    SELECT count(*) INTO v_occupied FROM himitsu.event_attendees
     WHERE event_id = NEW.event_id AND table_no = NEW.table_no AND removed_at IS NULL;
    IF v_occupied > NEW.capacity THEN
      RAISE EXCEPTION '桌 % 已入座 % 人，容量不可縮到 %', NEW.table_no, v_occupied, NEW.capacity;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_table_shrink BEFORE UPDATE ON himitsu.event_tables
  FOR EACH ROW EXECUTE FUNCTION himitsu.guard_table_shrink();

-- 入座守衛（AC-10 核心）：桌必須存在、爆桌被 DB 擋（advisory lock 防併發）
CREATE OR REPLACE FUNCTION himitsu.guard_table_assignment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_capacity INT; v_occupied INT;
BEGIN
  IF NEW.table_no IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.table_no IS NOT DISTINCT FROM OLD.table_no THEN RETURN NEW; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.event_id::text || ':' || NEW.table_no::text, 9));
  SELECT capacity INTO v_capacity FROM himitsu.event_tables
   WHERE event_id = NEW.event_id AND table_no = NEW.table_no;
  IF NOT FOUND THEN
    RAISE EXCEPTION '桌 % 不存在，請先在桌次分頁建桌', NEW.table_no;
  END IF;
  SELECT count(*) INTO v_occupied FROM himitsu.event_attendees
   WHERE event_id = NEW.event_id AND table_no = NEW.table_no
     AND removed_at IS NULL AND id <> NEW.id;
  IF v_occupied >= v_capacity THEN
    RAISE EXCEPTION '桌 % 已滿（容量 %），不可再指派', NEW.table_no, v_capacity;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_table_assignment BEFORE INSERT OR UPDATE ON himitsu.event_attendees
  FOR EACH ROW EXECUTE FUNCTION himitsu.guard_table_assignment();

-- ── RLS＋審計 ─────────────────────────────────────────────────────────
ALTER TABLE himitsu.event_tables ENABLE ROW LEVEL SECURITY;
CREATE POLICY tables_read ON himitsu.event_tables FOR SELECT TO authenticated
  USING (himitsu.is_org_member(org_id));
CREATE POLICY tables_write ON himitsu.event_tables FOR ALL TO authenticated
  USING (himitsu.has_perm(org_id, 'events.write'))
  WITH CHECK (himitsu.has_perm(org_id, 'events.write'));
CREATE TRIGGER trg_audit_event_tables AFTER INSERT OR UPDATE OR DELETE ON himitsu.event_tables
  FOR EACH ROW EXECUTE FUNCTION himitsu.audit();
GRANT SELECT, INSERT, UPDATE, DELETE ON himitsu.event_tables TO authenticated;
