-- ============================================================================
-- HiMitsu L22：會員 CSV 匯入——姓名、單位、手機、分類（缺的分類自動建立並勾選）
-- 執行位置：Supabase SQL Editor 貼上執行一次（需先跑過 L21 person_categories）。
-- 鐵律：本檔只建 himitsu schema 內物件，不觸碰 public。
-- 規則：
--   同姓名＋同單位的會員已存在 → 不新增，只補空白手機、勾分類（不覆蓋既有手機）
--   需要新建分類時，匯入者必須有設定權（org_settings.write＝負責人／秘書長），否則整批拒絕
--   一列錯＝整批回滾（含新建的分類）
-- ============================================================================

-- p_rows：[{ "line": 2, "name": "陳大華", "affiliation": "二林鎮", "mobile": "0912345678",
--            "categories": ["農民"] }, …]
CREATE OR REPLACE FUNCTION himitsu.import_members(p_org UUID, p_rows JSONB)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_row RECORD;
  v_label TEXT;
  v_name TEXT; v_affiliation TEXT; v_mobile TEXT;
  v_person UUID;
  v_category TEXT;
  v_category_id UUID;
  v_new_categories TEXT[];
  v_sort INT;
  v_added INT;
  v_created INT := 0; v_merged INT := 0; v_categories_created INT := 0; v_links_added INT := 0;
BEGIN
  IF NOT himitsu.has_perm(p_org, 'persons.write') THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'empty');
  END IF;
  IF jsonb_array_length(p_rows) > 2000 THEN
    RETURN json_build_object('ok', false, 'error', 'too_many', 'detail', '一次最多 2000 筆');
  END IF;

  -- 需要新建的分類（權限先檢查，避免做到一半才失敗）
  SELECT array_agg(DISTINCT btrim(c)) INTO v_new_categories
    FROM jsonb_array_elements(p_rows) r, jsonb_array_elements_text(COALESCE(r->'categories', '[]'::jsonb)) c
   WHERE btrim(c) <> ''
     AND NOT EXISTS (SELECT 1 FROM himitsu.person_categories pc WHERE pc.org_id = p_org AND pc.name = btrim(c));
  IF v_new_categories IS NOT NULL AND NOT himitsu.has_perm(p_org, 'org_settings.write') THEN
    RETURN json_build_object('ok', false, 'error', 'category_forbidden',
      'detail', '需要新增分類：' || array_to_string(v_new_categories, '、') || '（只有負責人／秘書長能新增分類）');
  END IF;

  BEGIN
    SELECT COALESCE(max(sort), -1) INTO v_sort FROM himitsu.person_categories WHERE org_id = p_org;

    FOR v_row IN
      SELECT x.line, x.name, x.affiliation, x.mobile, x.categories, x.ord
        FROM ROWS FROM (jsonb_to_recordset(p_rows)
               AS (line INT, name TEXT, affiliation TEXT, mobile TEXT, categories JSONB))
             WITH ORDINALITY AS x(line, name, affiliation, mobile, categories, ord)
       ORDER BY x.ord
    LOOP
      v_label := format('第 %s 列', COALESCE(v_row.line, v_row.ord + 1));
      v_name := btrim(COALESCE(v_row.name, ''));
      v_affiliation := NULLIF(btrim(COALESCE(v_row.affiliation, '')), '');
      v_mobile := NULLIF(btrim(COALESCE(v_row.mobile, '')), '');
      IF v_name = '' THEN RAISE EXCEPTION '%：姓名空白', v_label USING ERRCODE = '22023'; END IF;
      IF char_length(v_name) > 50 OR char_length(COALESCE(v_mobile, '')) > 20 THEN
        RAISE EXCEPTION '%：姓名或手機超過長度上限', v_label USING ERRCODE = '22023';
      END IF;

      SELECT id INTO v_person FROM himitsu.persons
       WHERE org_id = p_org AND name = v_name AND affiliation IS NOT DISTINCT FROM v_affiliation
       ORDER BY created_at LIMIT 1;
      IF v_person IS NULL THEN
        INSERT INTO himitsu.persons(org_id, name, affiliation, mobile)
        VALUES (p_org, v_name, v_affiliation, v_mobile) RETURNING id INTO v_person;
        v_created := v_created + 1;
      ELSE
        UPDATE himitsu.persons SET mobile = COALESCE(mobile, v_mobile)
         WHERE id = v_person AND mobile IS NULL AND v_mobile IS NOT NULL;
        v_merged := v_merged + 1;
      END IF;

      FOR v_category IN
        SELECT DISTINCT btrim(c) FROM jsonb_array_elements_text(COALESCE(v_row.categories, '[]'::jsonb)) c
         WHERE btrim(c) <> ''
      LOOP
        SELECT id INTO v_category_id FROM himitsu.person_categories WHERE org_id = p_org AND name = v_category;
        IF v_category_id IS NULL THEN
          v_sort := v_sort + 1;
          INSERT INTO himitsu.person_categories(org_id, name, sort) VALUES (p_org, v_category, v_sort)
            RETURNING id INTO v_category_id;
          v_categories_created := v_categories_created + 1;
        END IF;
        INSERT INTO himitsu.person_category_links(org_id, person_id, category_id)
        VALUES (p_org, v_person, v_category_id) ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS v_added = ROW_COUNT;
        v_links_added := v_links_added + v_added;
      END LOOP;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('ok', false, 'error', 'rejected', 'detail', SQLERRM);
  END;

  RETURN json_build_object('ok', true, 'created', v_created, 'merged', v_merged,
                           'categories_created', v_categories_created, 'links_added', v_links_added);
END $$;
REVOKE ALL ON FUNCTION himitsu.import_members(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION himitsu.import_members(UUID, JSONB) TO authenticated;
