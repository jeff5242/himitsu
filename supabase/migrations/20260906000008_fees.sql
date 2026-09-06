-- ============================================================================
-- HiMitsu L10（EPIC-1）：會費金流——fee_periods / fee_invoices＋報到連動
-- 執行位置：Supabase SQL Editor 貼上執行一次（需先跑過 L7~L9）。
-- 設計依據：EPIC-1 規格 §1-5（AC-11）；支柱④繳費狀態即資格
-- ============================================================================

CREATE TABLE himitsu.fee_periods (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES himitsu.organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  due_date   DATE,
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, name)
);

CREATE TABLE himitsu.fee_invoices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES himitsu.organizations(id) ON DELETE CASCADE,
  period_id     UUID NOT NULL REFERENCES himitsu.fee_periods(id) ON DELETE CASCADE,
  membership_id UUID NOT NULL REFERENCES himitsu.memberships(id) ON DELETE CASCADE,
  amount        NUMERIC(10,0) NOT NULL CHECK (amount >= 0),  -- 開繳時的費率快照
  status        TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','reported','confirmed','waived')),
  method        TEXT,          -- transfer / cash / other
  last5         TEXT,          -- 轉帳末五碼
  evidence_url  TEXT,
  reported_at   TIMESTAMPTZ,
  paid_at       TIMESTAMPTZ,
  confirmed_by  UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (period_id, membership_id)
);
CREATE INDEX idx_invoices_org_status ON himitsu.fee_invoices(org_id, status);

-- ── RLS＋審計（手動修正走 fees.write；日常操作走下方 RPC）─────────────
DO $$ DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['fee_periods','fee_invoices'] LOOP
    EXECUTE format('ALTER TABLE himitsu.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_read ON himitsu.%I FOR SELECT TO authenticated
                    USING (himitsu.is_org_member(org_id))', t, t);
    EXECUTE format('CREATE POLICY %I_write ON himitsu.%I FOR ALL TO authenticated
                    USING (himitsu.has_perm(org_id, %L))
                    WITH CHECK (himitsu.has_perm(org_id, %L))', t, t, 'fees.write', 'fees.write');
    EXECUTE format('CREATE TRIGGER trg_audit_%s AFTER INSERT OR UPDATE OR DELETE ON himitsu.%I
                    FOR EACH ROW EXECUTE FUNCTION himitsu.audit()', t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON himitsu.%I TO authenticated', t, t);
  END LOOP;
END $$;

-- ── 開繳批次（AC-11：按會員類別套費率快照；榮譽/永久自動免繳）────────
CREATE OR REPLACE FUNCTION himitsu.open_fee_period(p_org UUID, p_name TEXT, p_due DATE DEFAULT NULL)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_period UUID;
  v_individual NUMERIC := COALESCE((himitsu.get_setting(p_org, 'fees.individual_annual') #>> '{}')::numeric, 0);
  v_group NUMERIC := COALESCE((himitsu.get_setting(p_org, 'fees.group_annual') #>> '{}')::numeric, 0);
  v_billed INT; v_waived INT;
BEGIN
  IF NOT himitsu.has_perm(p_org, 'fees.write') THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF btrim(COALESCE(p_name, '')) = '' THEN
    RETURN json_build_object('ok', false, 'error', 'name_required');
  END IF;

  INSERT INTO himitsu.fee_periods(org_id, name, due_date) VALUES (p_org, btrim(p_name), p_due)
    RETURNING id INTO v_period;

  -- 應繳：active / renewal_due 按類別套費率
  INSERT INTO himitsu.fee_invoices(org_id, period_id, membership_id, amount)
  SELECT p_org, v_period, m.id,
         CASE m.member_type WHEN 'individual' THEN v_individual ELSE v_group END
    FROM himitsu.memberships m
   WHERE m.org_id = p_org AND m.status IN ('active','renewal_due');
  GET DIAGNOSTICS v_billed = ROW_COUNT;

  -- 免繳：榮譽/永久（金額 0、直接 waived）
  INSERT INTO himitsu.fee_invoices(org_id, period_id, membership_id, amount, status)
  SELECT p_org, v_period, m.id, 0, 'waived'
    FROM himitsu.memberships m
   WHERE m.org_id = p_org AND m.status IN ('honorary','permanent');
  GET DIAGNOSTICS v_waived = ROW_COUNT;

  RETURN json_build_object('ok', true, 'period_id', v_period,
                           'billed', v_billed, 'waived', v_waived);
EXCEPTION WHEN unique_violation THEN
  RETURN json_build_object('ok', false, 'error', 'name_taken');
END $$;
GRANT EXECUTE ON FUNCTION himitsu.open_fee_period(UUID, TEXT, DATE) TO authenticated;

-- ── 回報繳費（服務台 checkin.write 或財務 fees.write 皆可代登）────────
CREATE OR REPLACE FUNCTION himitsu.report_fee_payment(
  p_invoice UUID, p_method TEXT, p_last5 TEXT DEFAULT NULL, p_evidence_url TEXT DEFAULT NULL)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_inv himitsu.fee_invoices%ROWTYPE;
BEGIN
  SELECT * INTO v_inv FROM himitsu.fee_invoices WHERE id = p_invoice;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'not_found'); END IF;
  IF NOT (himitsu.has_perm(v_inv.org_id, 'checkin.write') OR himitsu.has_perm(v_inv.org_id, 'fees.write')) THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF v_inv.status NOT IN ('unpaid','reported') THEN
    RETURN json_build_object('ok', false, 'error', v_inv.status);
  END IF;
  UPDATE himitsu.fee_invoices
     SET status = 'reported', method = p_method, last5 = NULLIF(btrim(p_last5), ''),
         evidence_url = NULLIF(btrim(p_evidence_url), ''), reported_at = NOW()
   WHERE id = p_invoice;
  RETURN json_build_object('ok', true);
END $$;
GRANT EXECUTE ON FUNCTION himitsu.report_fee_payment(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- ── 確認入帳（AC-11：只有 fees.confirm——owner/秘書長/財務）────────────
CREATE OR REPLACE FUNCTION himitsu.confirm_fee_payment(p_invoice UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_inv himitsu.fee_invoices%ROWTYPE;
BEGIN
  SELECT * INTO v_inv FROM himitsu.fee_invoices WHERE id = p_invoice;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'not_found'); END IF;
  IF NOT himitsu.has_perm(v_inv.org_id, 'fees.confirm') THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF v_inv.status NOT IN ('unpaid','reported') THEN
    RETURN json_build_object('ok', false, 'error', v_inv.status);
  END IF;
  UPDATE himitsu.fee_invoices
     SET status = 'confirmed', paid_at = NOW(), confirmed_by = auth.uid()
   WHERE id = p_invoice;
  RETURN json_build_object('ok', true);
END $$;
GRANT EXECUTE ON FUNCTION himitsu.confirm_fee_payment(UUID) TO authenticated;

-- ── 報到連動（支柱④）：require_paid 開啟時，未繳者的領取項目鎖定 ─────
CREATE OR REPLACE FUNCTION himitsu.guard_pickup_paid()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_identity UUID;
BEGIN
  IF COALESCE(himitsu.get_setting(NEW.org_id, 'checkin.require_paid'), 'false'::jsonb) <> 'true'::jsonb THEN
    RETURN NEW;
  END IF;
  SELECT identity_id INTO v_identity FROM himitsu.event_attendees WHERE id = NEW.attendee_id;
  IF v_identity IS NULL THEN RETURN NEW; END IF;  -- 來賓/walk-in 不受會費管制
  IF EXISTS (
    SELECT 1 FROM himitsu.fee_invoices i
    JOIN himitsu.fee_periods p ON p.id = i.period_id AND p.status = 'open'
    JOIN himitsu.memberships m ON m.id = i.membership_id
   WHERE m.identity_id = v_identity AND i.status IN ('unpaid','reported')
  ) THEN
    RAISE EXCEPTION '未繳會費（或款項尚未經財務確認），領取項目鎖定——現場繳費確認後解鎖';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_pickup_paid BEFORE INSERT ON himitsu.attendee_pickups
  FOR EACH ROW EXECUTE FUNCTION himitsu.guard_pickup_paid();
