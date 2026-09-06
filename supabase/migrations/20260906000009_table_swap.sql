-- ============================================================================
-- HiMitsu L9.1（EPIC-1 補強）：兩桌互換 RPC——TADA 實戰高頻操作
-- 執行位置：Supabase SQL Editor 貼上執行一次（需先跑過 L9 tables）。
-- 語意：兩桌的「人」對調桌號（群組互換位置），桌的定義（標籤/容量）不動。
-- ============================================================================

-- 入座守衛加旁路：只有本檔的 swap RPC 會在交易內開旗標（REST 無法直呼 set_config）
CREATE OR REPLACE FUNCTION himitsu.guard_table_assignment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_capacity INT; v_occupied INT;
BEGIN
  IF current_setting('himitsu.skip_table_guard', true) = 'on' THEN RETURN NEW; END IF;
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

-- 兩桌互換：先驗「A 組人數 ≤ B 桌容量、B 組人數 ≤ A 桌容量」，再原子對調
CREATE OR REPLACE FUNCTION himitsu.swap_tables(p_event UUID, p_a INT, p_b INT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_org UUID;
  v_cap_a INT; v_cap_b INT; v_n_a INT; v_n_b INT;
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
  SELECT count(*) INTO v_n_a FROM himitsu.event_attendees
   WHERE event_id = p_event AND table_no = p_a AND removed_at IS NULL;
  SELECT count(*) INTO v_n_b FROM himitsu.event_attendees
   WHERE event_id = p_event AND table_no = p_b AND removed_at IS NULL;
  IF v_n_a > v_cap_b OR v_n_b > v_cap_a THEN
    RETURN json_build_object('ok', false, 'error', 'capacity',
      'detail', format('桌%s %s人↔桌%s %s人（容量 %s/%s）', p_a, v_n_a, p_b, v_n_b, v_cap_a, v_cap_b));
  END IF;

  PERFORM set_config('himitsu.skip_table_guard', 'on', true);  -- 僅本交易內有效
  UPDATE himitsu.event_attendees
     SET table_no = CASE WHEN table_no = p_a THEN p_b ELSE p_a END
   WHERE event_id = p_event AND table_no IN (p_a, p_b) AND removed_at IS NULL;
  PERFORM set_config('himitsu.skip_table_guard', '', true);

  RETURN json_build_object('ok', true, 'moved', v_n_a + v_n_b);
END $$;
GRANT EXECUTE ON FUNCTION himitsu.swap_tables(UUID, INT, INT) TO authenticated;
