-- ============================================================================
-- HiMitsu L17：來賓 CSV 匯入——guest_tag 身分標籤＋import_guests 整批原子匯入
-- 執行位置：Supabase SQL Editor 貼上執行一次（需先跑過 L7~L9 events/checkin/tables）。
-- 鐵律：本檔只建 himitsu schema 內物件，不觸碰 public。
-- 需求來源：米屋智農 2026 忘年會（約 150 位來賓，身分分貴賓／農民，預先排桌）。
-- ============================================================================

-- ── 來賓身分標籤（自由文字，例：貴賓／農民；會員列不使用）──────────────
ALTER TABLE himitsu.event_attendees
  ADD COLUMN IF NOT EXISTS guest_tag TEXT
  CHECK (guest_tag IS NULL OR char_length(guest_tag) BETWEEN 1 AND 20);

-- ── 核心：整批匯入（一筆失敗＝全部回滾）────────────────────────────────
-- p_rows：[{ "line": 2, "name": "王小明", "org": "米屋智農", "tag": "貴賓", "table_no": 3 }, …]
-- 規則：同活動已有「同姓名＋同單位」的有效列 → 略過（不重複加）；
--       桌號不存在 → 自動建桌（容量套設定中心「每桌人數」，桌數上限照守衛）；
--       爆桌、超過桌數上限 → 由既有 trigger 擋下，整批回滾。
-- 只給內部呼叫：前端走下方 import_guests（有權限檢查）；SQL Editor 一次性匯入可直呼。
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
      SELECT x.line, x.name, x.org, x.tag, x.table_no, x.ord
        FROM ROWS FROM (jsonb_to_recordset(p_rows)
               AS (line INT, name TEXT, org TEXT, tag TEXT, table_no INT))
             WITH ORDINALITY AS x(line, name, org, tag, table_no, ord)
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

      -- 已在名單（同姓名＋同單位、未除名）→ 略過
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
                                            guest_name, guest_org, guest_tag, table_no)
        VALUES (v_org, p_event, 'guest', 'import', v_name, v_org_name, v_tag, v_row.table_no);
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION '%（%）：%', v_label, v_name, SQLERRM USING ERRCODE = SQLSTATE;
      END;
      v_inserted := v_inserted + 1;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- 區塊內的寫入（建桌＋名單）全部回滾
    RETURN json_build_object('ok', false, 'error', 'rejected', 'detail', SQLERRM);
  END;

  RETURN json_build_object('ok', true, 'inserted', v_inserted,
                           'skipped', v_skipped, 'tables_created', v_tables);
END $$;
REVOKE ALL ON FUNCTION himitsu.import_guests_core(UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- ── 前端入口：需 events.write（負責人／秘書長／秘書）────────────────────
CREATE OR REPLACE FUNCTION himitsu.import_guests(p_event UUID, p_rows JSONB)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_org UUID;
BEGIN
  SELECT org_id INTO v_org FROM himitsu.events WHERE id = p_event;
  IF v_org IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'event_not_found');
  END IF;
  IF NOT himitsu.has_perm(v_org, 'events.write') THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;
  RETURN himitsu.import_guests_core(p_event, p_rows);
END $$;
REVOKE ALL ON FUNCTION himitsu.import_guests(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION himitsu.import_guests(UUID, JSONB) TO authenticated;
