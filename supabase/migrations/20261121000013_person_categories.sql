-- ============================================================================
-- HiMitsu L21：會員庫「人員分類」（農民／貴賓／農會代表…由管理者自訂）
-- 執行位置：Supabase SQL Editor 貼上執行一次（需先跑過 L2~L9、L17）。
-- 鐵律：本檔只建 himitsu schema 內物件，不觸碰 public。
-- 設計：
--   person_categories       分類定義（協會設定：org_settings.write＝負責人／秘書長）
--   person_category_links   成員↔分類（多對多；persons.write＝負責人／秘書長／秘書）
--   persons.affiliation     成員單位（農民的鄉鎮、貴賓的服務單位）
--   event_attendees.person_id  從會員庫依分類匯入的來賓連回成員（防重複匯入）
--   import_people_by_category  依分類把成員整批加進活動名單（整批原子）
-- ============================================================================

ALTER TABLE himitsu.persons
  ADD COLUMN IF NOT EXISTS affiliation TEXT
  CHECK (affiliation IS NULL OR char_length(affiliation) <= 100);

-- ── 分類定義 ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS himitsu.person_categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES himitsu.organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 20),
  sort       INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, name)
);

-- ── 成員↔分類 ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS himitsu.person_category_links (
  org_id      UUID NOT NULL REFERENCES himitsu.organizations(id) ON DELETE CASCADE,
  person_id   UUID NOT NULL REFERENCES himitsu.persons(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES himitsu.person_categories(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (person_id, category_id)
);
CREATE INDEX IF NOT EXISTS idx_category_links_category ON himitsu.person_category_links(category_id);

-- 租戶一致性：成員與分類都必須屬於同一協會（RLS 只檢查 org_id 欄，擋不住拼接他協會的 id）
CREATE OR REPLACE FUNCTION himitsu.guard_category_link()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM himitsu.persons WHERE id = NEW.person_id AND org_id = NEW.org_id)
     OR NOT EXISTS (SELECT 1 FROM himitsu.person_categories WHERE id = NEW.category_id AND org_id = NEW.org_id) THEN
    RAISE EXCEPTION '成員與分類必須屬於同一個協會' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_category_link ON himitsu.person_category_links;
CREATE TRIGGER trg_guard_category_link BEFORE INSERT OR UPDATE ON himitsu.person_category_links
  FOR EACH ROW EXECUTE FUNCTION himitsu.guard_category_link();

-- ── RLS＋審計 ─────────────────────────────────────────────────────────
ALTER TABLE himitsu.person_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE himitsu.person_category_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS person_categories_read ON himitsu.person_categories;
CREATE POLICY person_categories_read ON himitsu.person_categories FOR SELECT TO authenticated
  USING (himitsu.is_org_member(org_id));
DROP POLICY IF EXISTS person_categories_write ON himitsu.person_categories;
CREATE POLICY person_categories_write ON himitsu.person_categories FOR ALL TO authenticated
  USING (himitsu.has_perm(org_id, 'org_settings.write'))
  WITH CHECK (himitsu.has_perm(org_id, 'org_settings.write'));

DROP POLICY IF EXISTS category_links_read ON himitsu.person_category_links;
CREATE POLICY category_links_read ON himitsu.person_category_links FOR SELECT TO authenticated
  USING (himitsu.is_org_member(org_id));
DROP POLICY IF EXISTS category_links_write ON himitsu.person_category_links;
CREATE POLICY category_links_write ON himitsu.person_category_links FOR ALL TO authenticated
  USING (himitsu.has_perm(org_id, 'persons.write'))
  WITH CHECK (himitsu.has_perm(org_id, 'persons.write'));

GRANT SELECT, INSERT, UPDATE, DELETE ON himitsu.person_categories TO authenticated;
GRANT SELECT, INSERT, DELETE ON himitsu.person_category_links TO authenticated;

DROP TRIGGER IF EXISTS trg_audit_person_categories ON himitsu.person_categories;
CREATE TRIGGER trg_audit_person_categories AFTER INSERT OR UPDATE OR DELETE ON himitsu.person_categories
  FOR EACH ROW EXECUTE FUNCTION himitsu.audit();
DROP TRIGGER IF EXISTS trg_audit_person_category_links ON himitsu.person_category_links;
CREATE TRIGGER trg_audit_person_category_links AFTER INSERT OR DELETE ON himitsu.person_category_links
  FOR EACH ROW EXECUTE FUNCTION himitsu.audit();

-- ── 活動名單連回成員 ──────────────────────────────────────────────────
ALTER TABLE himitsu.event_attendees
  ADD COLUMN IF NOT EXISTS person_id UUID REFERENCES himitsu.persons(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_attendee_person ON himitsu.event_attendees(event_id, person_id)
  WHERE person_id IS NOT NULL AND removed_at IS NULL;

-- ── 依分類匯入活動名單（名單編輯權 events.write）──────────────────────
-- 一人多分類只加一次，身分取排序最前的分類；單位＝成員單位，沒有就用所屬法人名稱。
-- 略過：已用同一成員匯入過、已以會員身分在名單上、或同姓名＋同單位的來賓已在名單上。
CREATE OR REPLACE FUNCTION himitsu.import_people_by_category(p_event UUID, p_category_ids UUID[])
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_org UUID;
  v_valid UUID[];
  v_row RECORD;
  v_inserted INT := 0;
  v_skipped INT := 0;
BEGIN
  SELECT org_id INTO v_org FROM himitsu.events WHERE id = p_event;
  IF v_org IS NULL THEN RETURN json_build_object('ok', false, 'error', 'event_not_found'); END IF;
  IF NOT himitsu.has_perm(v_org, 'events.write') THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;
  SELECT array_agg(id) INTO v_valid FROM himitsu.person_categories
   WHERE org_id = v_org AND id = ANY(COALESCE(p_category_ids, '{}'));
  IF v_valid IS NULL THEN RETURN json_build_object('ok', false, 'error', 'no_category'); END IF;

  BEGIN
    FOR v_row IN
      SELECT picked.* FROM (
        SELECT DISTINCT ON (p.id)
               p.id AS person_id, p.name, c.name AS tag, c.sort, c.name AS cat_name,
               COALESCE(NULLIF(btrim(p.affiliation), ''), (
                 SELECT le.name FROM himitsu.identities i
                   JOIN himitsu.legal_entities le ON le.id = i.entity_id
                  WHERE i.person_id = p.id ORDER BY i.created_at LIMIT 1)) AS org_label
          FROM himitsu.person_category_links l
          JOIN himitsu.persons p ON p.id = l.person_id AND p.org_id = v_org
          JOIN himitsu.person_categories c ON c.id = l.category_id
         WHERE l.category_id = ANY(v_valid)
         ORDER BY p.id, c.sort, c.name
      ) picked
      ORDER BY picked.sort, picked.cat_name, picked.name
    LOOP
      IF EXISTS (
        SELECT 1 FROM himitsu.event_attendees a
         WHERE a.event_id = p_event AND a.removed_at IS NULL
           AND (a.person_id = v_row.person_id
                OR a.identity_id IN (SELECT id FROM himitsu.identities WHERE person_id = v_row.person_id)
                OR (a.identity_id IS NULL AND a.guest_name = v_row.name
                    AND a.guest_org IS NOT DISTINCT FROM v_row.org_label))
      ) THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      INSERT INTO himitsu.event_attendees(org_id, event_id, category, source,
                                          person_id, guest_name, guest_org, guest_tag)
      VALUES (v_org, p_event, 'guest', 'import', v_row.person_id, v_row.name, v_row.org_label, v_row.tag);
      v_inserted := v_inserted + 1;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('ok', false, 'error', 'rejected', 'detail', SQLERRM);
  END;

  RETURN json_build_object('ok', true, 'inserted', v_inserted, 'skipped', v_skipped);
END $$;
REVOKE ALL ON FUNCTION himitsu.import_people_by_category(UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION himitsu.import_people_by_category(UUID, UUID[]) TO authenticated;
