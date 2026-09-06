-- ============================================================================
-- HiMitsu L8（EPIC-1）：報到與領取——checkin_log / pickup_items / attendee_pickups
-- 執行位置：Supabase SQL Editor 貼上執行一次（需先跑過 L7 events）。
-- 設計依據：EPIC-1 規格 §1-2/§1-3（AC-9/AC-12）；支柱③ append-only 可回放
-- ============================================================================

-- ── 領取項目定義（名牌/禮品/選票…由活動企劃者自訂）──────────────────
CREATE TABLE himitsu.pickup_items (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id   UUID NOT NULL REFERENCES himitsu.organizations(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES himitsu.events(id) ON DELETE CASCADE,
  key      TEXT NOT NULL CHECK (key ~ '^[a-z0-9_]{1,30}$'),
  label    TEXT NOT NULL,
  sort     INT NOT NULL DEFAULT 0,
  UNIQUE (event_id, key)
);

-- ── 領取紀錄（append-only：撤銷用 undone_at，不刪列）─────────────────
CREATE TABLE himitsu.attendee_pickups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES himitsu.organizations(id) ON DELETE CASCADE,
  event_id    UUID NOT NULL,
  attendee_id UUID NOT NULL REFERENCES himitsu.event_attendees(id) ON DELETE CASCADE,
  item_key    TEXT NOT NULL,
  at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  by          UUID DEFAULT auth.uid(),
  undone_at   TIMESTAMPTZ,
  FOREIGN KEY (event_id, item_key) REFERENCES himitsu.pickup_items(event_id, key) ON DELETE CASCADE
);
-- 防重複發放：同 attendee 同項目只允許一筆有效紀錄
CREATE UNIQUE INDEX ux_pickup_active ON himitsu.attendee_pickups(attendee_id, item_key)
  WHERE undone_at IS NULL;
CREATE INDEX idx_pickups_event ON himitsu.attendee_pickups(event_id);

-- ── 報到紀錄（多通道；撤銷不刪列）────────────────────────────────────
CREATE TABLE himitsu.checkin_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES himitsu.organizations(id) ON DELETE CASCADE,
  event_id    UUID NOT NULL REFERENCES himitsu.events(id) ON DELETE CASCADE,
  attendee_id UUID NOT NULL REFERENCES himitsu.event_attendees(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL CHECK (channel IN ('kiosk','assist','vip','import')),
  at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  by          UUID DEFAULT auth.uid(),
  undone_at   TIMESTAMPTZ
);
CREATE INDEX idx_checkin_event ON himitsu.checkin_log(event_id, at DESC);

-- ── RLS＋審計 ─────────────────────────────────────────────────────────
-- pickup_items：定義屬企劃（events.write）；紀錄類寫入屬現場（checkin.write）
ALTER TABLE himitsu.pickup_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY pickupitems_read ON himitsu.pickup_items FOR SELECT TO authenticated
  USING (himitsu.is_org_member(org_id));
CREATE POLICY pickupitems_write ON himitsu.pickup_items FOR ALL TO authenticated
  USING (himitsu.has_perm(org_id, 'events.write'))
  WITH CHECK (himitsu.has_perm(org_id, 'events.write'));

DO $$ DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['attendee_pickups','checkin_log'] LOOP
    EXECUTE format('ALTER TABLE himitsu.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_read ON himitsu.%I FOR SELECT TO authenticated
                    USING (himitsu.is_org_member(org_id))', t, t);
    EXECUTE format('CREATE POLICY %I_insert ON himitsu.%I FOR INSERT TO authenticated
                    WITH CHECK (himitsu.has_perm(org_id, %L))', t, t, 'checkin.write');
    EXECUTE format('CREATE POLICY %I_update ON himitsu.%I FOR UPDATE TO authenticated
                    USING (himitsu.has_perm(org_id, %L))
                    WITH CHECK (himitsu.has_perm(org_id, %L))', t, t, 'checkin.write', 'checkin.write');
  END LOOP;
END $$;

DO $$ DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['pickup_items','attendee_pickups','checkin_log'] LOOP
    EXECUTE format('CREATE TRIGGER trg_audit_%s AFTER INSERT OR UPDATE OR DELETE ON himitsu.%I
                    FOR EACH ROW EXECUTE FUNCTION himitsu.audit()', t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON himitsu.%I TO authenticated', t, t);
  END LOOP;
END $$;

-- 領取只能發生在報到開放中的活動、且不可發給已除名者
CREATE OR REPLACE FUNCTION himitsu.guard_pickup()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_removed TIMESTAMPTZ; v_status TEXT;
BEGIN
  SELECT a.removed_at, e.status INTO v_removed, v_status
    FROM himitsu.event_attendees a JOIN himitsu.events e ON e.id = a.event_id
   WHERE a.id = NEW.attendee_id;
  IF v_status <> 'open' THEN RAISE EXCEPTION '活動未開放報到，不可發放領取項目'; END IF;
  IF v_removed IS NOT NULL THEN RAISE EXCEPTION '此人已除名，不可發放'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_pickup_guard BEFORE INSERT ON himitsu.attendee_pickups
  FOR EACH ROW EXECUTE FUNCTION himitsu.guard_pickup();

-- ── 報到 RPC（冪等：已報到者回 already，不產生第二筆有效紀錄）────────
CREATE OR REPLACE FUNCTION himitsu.check_in(p_attendee UUID, p_channel TEXT DEFAULT 'assist')
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_att himitsu.event_attendees%ROWTYPE; v_status TEXT;
BEGIN
  SELECT * INTO v_att FROM himitsu.event_attendees WHERE id = p_attendee;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'not_found'); END IF;
  IF NOT himitsu.has_perm(v_att.org_id, 'checkin.write') THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;
  SELECT status INTO v_status FROM himitsu.events WHERE id = v_att.event_id;
  IF v_status <> 'open' THEN RETURN json_build_object('ok', false, 'error', 'event_not_open'); END IF;
  IF v_att.removed_at IS NOT NULL THEN RETURN json_build_object('ok', false, 'error', 'removed'); END IF;
  IF v_att.checked_in_at IS NOT NULL THEN
    RETURN json_build_object('ok', true, 'already', true, 'checked_in_at', v_att.checked_in_at);
  END IF;
  IF p_channel NOT IN ('kiosk','assist','vip','import') THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_channel');
  END IF;

  INSERT INTO himitsu.checkin_log(org_id, event_id, attendee_id, channel)
  VALUES (v_att.org_id, v_att.event_id, p_attendee, p_channel);
  UPDATE himitsu.event_attendees SET checked_in_at = NOW() WHERE id = p_attendee;
  RETURN json_build_object('ok', true, 'already', false);
END $$;
GRANT EXECUTE ON FUNCTION himitsu.check_in(UUID, TEXT) TO authenticated;

-- 撤銷報到（undone_at 標記；快取欄清空）
CREATE OR REPLACE FUNCTION himitsu.undo_checkin(p_attendee UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_att himitsu.event_attendees%ROWTYPE;
BEGIN
  SELECT * INTO v_att FROM himitsu.event_attendees WHERE id = p_attendee;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'not_found'); END IF;
  IF NOT himitsu.has_perm(v_att.org_id, 'checkin.write') THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;
  UPDATE himitsu.checkin_log SET undone_at = NOW()
   WHERE attendee_id = p_attendee AND undone_at IS NULL;
  UPDATE himitsu.event_attendees SET checked_in_at = NULL WHERE id = p_attendee;
  RETURN json_build_object('ok', true);
END $$;
GRANT EXECUTE ON FUNCTION himitsu.undo_checkin(UUID) TO authenticated;

-- 現場臨時報名（walk-in）：staff 可用，受 checkin.walkin_enabled 設定管制
CREATE OR REPLACE FUNCTION himitsu.add_walkin(p_event UUID, p_name TEXT, p_org_name TEXT DEFAULT NULL)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_event himitsu.events%ROWTYPE; v_id UUID;
BEGIN
  SELECT * INTO v_event FROM himitsu.events WHERE id = p_event;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'not_found'); END IF;
  IF NOT himitsu.has_perm(v_event.org_id, 'checkin.write') THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF v_event.status <> 'open' THEN RETURN json_build_object('ok', false, 'error', 'event_not_open'); END IF;
  IF COALESCE(himitsu.get_setting(v_event.org_id, 'checkin.walkin_enabled'), 'true'::jsonb) <> 'true'::jsonb THEN
    RETURN json_build_object('ok', false, 'error', 'walkin_disabled');
  END IF;
  IF btrim(COALESCE(p_name, '')) = '' THEN
    RETURN json_build_object('ok', false, 'error', 'name_required');
  END IF;

  INSERT INTO himitsu.event_attendees(org_id, event_id, category, source, guest_name, guest_org)
  VALUES (v_event.org_id, p_event, 'walkin', 'walkin', btrim(p_name), NULLIF(btrim(p_org_name), ''))
  RETURNING id INTO v_id;
  RETURN json_build_object('ok', true, 'attendee_id', v_id);
END $$;
GRANT EXECUTE ON FUNCTION himitsu.add_walkin(UUID, TEXT, TEXT) TO authenticated;
