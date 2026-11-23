-- ============================================================================
-- HiMitsu L24：來賓詳細欄位（職稱／聯絡手機／葷素／攜伴人數／唱名資格）＋攜伴佔座位
-- 執行位置：Supabase SQL Editor 貼上執行一次（需先跑過 L9 tables、L17 guest_import）。
-- 鐵律：本檔只建 himitsu schema 內物件，不觸碰 public。
-- 需求來源：米屋（煜軒）——貴賓姓名/任職單位/職稱/聯絡手機/葷素/攜伴人數一起匯入；
--          名單可勾「唱名資格」，當天已報到者進唱名名單。
-- 座位規則：每位來賓佔「1＋攜伴人數」個座位——滿桌守衛、縮桌守衛、兩桌互換全部改用座位數。
-- ============================================================================

ALTER TABLE himitsu.event_attendees
  ADD COLUMN IF NOT EXISTS guest_title  TEXT CHECK (guest_title IS NULL OR char_length(guest_title) <= 50),
  ADD COLUMN IF NOT EXISTS guest_mobile TEXT CHECK (guest_mobile IS NULL OR char_length(guest_mobile) <= 20),
  ADD COLUMN IF NOT EXISTS diet         TEXT CHECK (diet IS NULL OR char_length(diet) BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS companions   INT NOT NULL DEFAULT 0 CHECK (companions BETWEEN 0 AND 20),
  ADD COLUMN IF NOT EXISTS roll_call    BOOLEAN NOT NULL DEFAULT false;

-- 某桌已用座位（可排除某一列，供「改自己」時計算）
CREATE OR REPLACE FUNCTION himitsu.table_seats_used(p_event UUID, p_table INT, p_exclude UUID DEFAULT NULL)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(sum(1 + companions), 0)::int FROM himitsu.event_attendees
   WHERE event_id = p_event AND table_no = p_table AND removed_at IS NULL
     AND (p_exclude IS NULL OR id <> p_exclude);
$$;

-- 入座守衛：桌必須存在；已用座位＋本人＋攜伴 ≤ 容量（advisory lock 防併發）
CREATE OR REPLACE FUNCTION himitsu.guard_table_assignment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_capacity INT; v_used INT; v_need INT;
BEGIN
  IF current_setting('himitsu.skip_table_guard', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.table_no IS NULL OR NEW.removed_at IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.table_no IS NOT DISTINCT FROM OLD.table_no
     AND NEW.companions <= OLD.companions AND OLD.removed_at IS NULL THEN
    RETURN NEW;  -- 同桌、沒有增加座位
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.event_id::text || ':' || NEW.table_no::text, 9));
  SELECT capacity INTO v_capacity FROM himitsu.event_tables
   WHERE event_id = NEW.event_id AND table_no = NEW.table_no;
  IF NOT FOUND THEN
    RAISE EXCEPTION '桌 % 不存在，請先在桌次分頁建桌', NEW.table_no;
  END IF;
  v_used := himitsu.table_seats_used(NEW.event_id, NEW.table_no, NEW.id);
  v_need := 1 + NEW.companions;
  IF v_used + v_need > v_capacity THEN
    RAISE EXCEPTION '桌 % 已滿（容量 %，已坐 % 位，這筆需要 % 位）', NEW.table_no, v_capacity, v_used, v_need;
  END IF;
  RETURN NEW;
END $$;

-- 縮桌守衛：容量不可低於已用座位
CREATE OR REPLACE FUNCTION himitsu.guard_table_shrink()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_used INT;
BEGIN
  IF NEW.capacity < OLD.capacity THEN
    v_used := himitsu.table_seats_used(NEW.event_id, NEW.table_no);
    IF v_used > NEW.capacity THEN
      RAISE EXCEPTION '桌 % 已用 % 個座位（含攜伴），容量不可縮到 %', NEW.table_no, v_used, NEW.capacity;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- 兩桌互換：以座位數驗容量
CREATE OR REPLACE FUNCTION himitsu.swap_tables(p_event UUID, p_a INT, p_b INT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_org UUID;
  v_cap_a INT; v_cap_b INT; v_seats_a INT; v_seats_b INT; v_moved INT;
BEGIN
  SELECT org_id INTO v_org FROM himitsu.events WHERE id = p_event;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'not_found'); END IF;
  IF NOT himitsu.has_perm(v_org, 'events.write') THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF p_a = p_b THEN RETURN json_build_object('ok', false, 'error', 'same_table'); END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_event::text || ':swap', 9));
  SELECT capacity INTO v_cap_a FROM himitsu.event_tables WHERE event_id = p_event AND table_no = p_a;
  SELECT capacity INTO v_cap_b FROM himitsu.event_tables WHERE event_id = p_event AND table_no = p_b;
  IF v_cap_a IS NULL OR v_cap_b IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'table_missing');
  END IF;
  v_seats_a := himitsu.table_seats_used(p_event, p_a);
  v_seats_b := himitsu.table_seats_used(p_event, p_b);
  IF v_seats_a > v_cap_b OR v_seats_b > v_cap_a THEN
    RETURN json_build_object('ok', false, 'error', 'capacity',
      'detail', format('桌%s %s位↔桌%s %s位（容量 %s/%s，含攜伴）', p_a, v_seats_a, p_b, v_seats_b, v_cap_a, v_cap_b));
  END IF;

  PERFORM set_config('himitsu.skip_table_guard', 'on', true);  -- 僅本交易內有效
  UPDATE himitsu.event_attendees
     SET table_no = CASE WHEN table_no = p_a THEN p_b ELSE p_a END
   WHERE event_id = p_event AND table_no IN (p_a, p_b) AND removed_at IS NULL;
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  PERFORM set_config('himitsu.skip_table_guard', '', true);

  RETURN json_build_object('ok', true, 'moved', v_moved);
END $$;
GRANT EXECUTE ON FUNCTION himitsu.swap_tables(UUID, INT, INT) TO authenticated;

-- 來賓 CSV 匯入核心：加上職稱／手機／葷素／攜伴／唱名（其餘規則同 L17）
CREATE OR REPLACE FUNCTION himitsu.import_guests_core(p_event UUID, p_rows JSONB)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_org UUID;
  v_row RECORD;
  v_name TEXT; v_org_name TEXT; v_tag TEXT; v_label TEXT;
  v_inserted INT := 0; v_skipped INT := 0; v_tables INT := 0;
BEGIN
  SELECT org_id INTO v_org FROM himitsu.events WHERE id = p_event;
  IF v_org IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'event_not_found');
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'empty');
  END IF;
  IF jsonb_array_length(p_rows) > 1000 THEN
    RETURN json_build_object('ok', false, 'error', 'too_many', 'detail', '一次最多 1000 筆');
  END IF;

  BEGIN
    FOR v_row IN
      SELECT x.* FROM ROWS FROM (jsonb_to_recordset(p_rows)
               AS (line INT, name TEXT, org TEXT, tag TEXT, table_no INT,
                   title TEXT, mobile TEXT, diet TEXT, companions INT, roll_call BOOLEAN))
             WITH ORDINALITY AS x(line, name, org, tag, table_no, title, mobile, diet, companions, roll_call, ord)
       ORDER BY x.ord
    LOOP
      v_label := format('第 %s 列', COALESCE(v_row.line, v_row.ord + 1));
      v_name := btrim(COALESCE(v_row.name, ''));
      v_org_name := NULLIF(btrim(COALESCE(v_row.org, '')), '');
      v_tag := NULLIF(btrim(COALESCE(v_row.tag, '')), '');

      IF v_name = '' THEN
        RAISE EXCEPTION '%：姓名空白', v_label USING ERRCODE = '22023';
      END IF;
      IF char_length(v_name) > 50 OR char_length(COALESCE(v_org_name, '')) > 100
         OR char_length(COALESCE(v_tag, '')) > 20 THEN
        RAISE EXCEPTION '%：姓名／單位／身分超過長度上限（50／100／20 字）', v_label USING ERRCODE = '22023';
      END IF;
      IF v_row.table_no IS NOT NULL AND v_row.table_no <= 0 THEN
        RAISE EXCEPTION '%：桌號必須是正整數', v_label USING ERRCODE = '22023';
      END IF;
      IF COALESCE(v_row.companions, 0) NOT BETWEEN 0 AND 20 THEN
        RAISE EXCEPTION '%：攜伴人數必須是 0～20', v_label USING ERRCODE = '22023';
      END IF;

      IF EXISTS (
        SELECT 1 FROM himitsu.event_attendees a
         WHERE a.event_id = p_event AND a.removed_at IS NULL
           AND a.guest_name = v_name AND a.guest_org IS NOT DISTINCT FROM v_org_name
      ) THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      IF v_row.table_no IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM himitsu.event_tables t WHERE t.event_id = p_event AND t.table_no = v_row.table_no
      ) THEN
        INSERT INTO himitsu.event_tables(org_id, event_id, table_no) VALUES (v_org, p_event, v_row.table_no);
        v_tables := v_tables + 1;
      END IF;

      BEGIN
        INSERT INTO himitsu.event_attendees(org_id, event_id, category, source,
                                            guest_name, guest_org, guest_tag, table_no,
                                            guest_title, guest_mobile, diet, companions, roll_call)
        VALUES (v_org, p_event, 'guest', 'import', v_name, v_org_name, v_tag, v_row.table_no,
                NULLIF(btrim(COALESCE(v_row.title, '')), ''), NULLIF(btrim(COALESCE(v_row.mobile, '')), ''),
                NULLIF(btrim(COALESCE(v_row.diet, '')), ''), COALESCE(v_row.companions, 0),
                COALESCE(v_row.roll_call, false));
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION '%（%）：%', v_label, v_name, SQLERRM USING ERRCODE = SQLSTATE;
      END;
      v_inserted := v_inserted + 1;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('ok', false, 'error', 'rejected', 'detail', SQLERRM);
  END;

  RETURN json_build_object('ok', true, 'inserted', v_inserted,
                           'skipped', v_skipped, 'tables_created', v_tables);
END $$;
REVOKE ALL ON FUNCTION himitsu.import_guests_core(UUID, JSONB) FROM PUBLIC, anon, authenticated;
