-- ============================================================================
-- HiMitsu L29：唱名進度多台裝置同步
-- 執行位置：Supabase SQL Editor 貼上執行一次（需先跑過 L24 guest_details）。
-- 鐵律：本檔只建 himitsu schema 內物件，不觸碰 public。
-- 之前「已唱名」只存在瀏覽器（localStorage），電腦按了平板看不到。
-- 改存在名單列 called_at；寫入只走 set_called（報到權即可，主持人身旁的工作人員會按）。
-- ============================================================================

ALTER TABLE himitsu.event_attendees ADD COLUMN IF NOT EXISTS called_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION himitsu.set_called(p_attendee UUID, p_called BOOLEAN)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, himitsu AS $$
DECLARE
  v_att himitsu.event_attendees%ROWTYPE;
BEGIN
  SELECT * INTO v_att FROM himitsu.event_attendees WHERE id = p_attendee;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'not_found'); END IF;
  IF NOT himitsu.has_perm(v_att.org_id, 'checkin.write') THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF v_att.removed_at IS NOT NULL THEN RETURN json_build_object('ok', false, 'error', 'removed'); END IF;
  UPDATE himitsu.event_attendees
     SET called_at = CASE WHEN p_called THEN COALESCE(called_at, NOW()) END
   WHERE id = p_attendee;
  RETURN json_build_object('ok', true);
END $$;

REVOKE EXECUTE ON FUNCTION himitsu.set_called(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION himitsu.set_called(UUID, BOOLEAN) TO authenticated;
