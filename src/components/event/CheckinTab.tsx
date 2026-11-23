import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useCheckinQueue } from '../../hooks/useCheckinQueue';
import type { PersonGroup } from '../../lib/attendee';
import CheckinDesk from './CheckinDesk';
import { useOrgFeatures } from '../../hooks/useOrgFeatures';
import type { Channel } from './CheckinDesk';
import type { Attendee, Organization, OrgEvent } from '../../lib/types';

interface PickupItem {
  id: string;
  key: string;
  label: string;
  sort: number;
}

interface PickupRecord {
  id: string;
  attendee_id: string;
  item_key: string;
}

const NO_UNPAID: ReadonlySet<string> = new Set();

const ERROR_LABELS: Record<string, string> = {
  forbidden: '沒有報到權限',
  event_not_open: '活動未開放報到',
  removed: '此人已除名',
  not_found: '找不到這筆名單',
};

interface CheckinTabProps {
  org: Organization;
  event: OrgEvent;
  attendees: Attendee[];
  canCheckin: boolean;
  onChanged: () => Promise<void>;
}

/** 報到台（AC-9）正式版：資料讀寫走 Supabase＋離線佇列，畫面交給 CheckinDesk */
export default function CheckinTab({ org, event, attendees, canCheckin, onChanged }: CheckinTabProps) {
  const [items, setItems] = useState<PickupItem[]>([]);
  const [pickups, setPickups] = useState<PickupRecord[]>([]);
  const [unpaidMemberships, setUnpaidMemberships] = useState<ReadonlySet<string>>(new Set());
  const [requiresPaid, setRequiresPaid] = useState(false);
  const features = useOrgFeatures(org.id);

  const reloadPickups = useCallback(async () => {
    const [{ data: itemRows }, { data: pickupRows }, { data: unpaidRows }, { data: requirePaidValue }] =
      await Promise.all([
        supabase.from('pickup_items').select('id, key, label, sort').eq('event_id', event.id).order('sort'),
        supabase.from('attendee_pickups').select('id, attendee_id, item_key')
          .eq('event_id', event.id).is('undone_at', null),
        // 支柱④：開放中的開繳批次裡尚未入帳者 → 報到卡亮警示
        supabase.from('fee_invoices').select('membership_id, fee_periods!inner(status)')
          .eq('org_id', org.id).eq('fee_periods.status', 'open').in('status', ['unpaid', 'reported']),
        supabase.rpc('get_setting', { p_org: org.id, p_key: 'checkin.require_paid' }),
      ]);
    // 離線時查詢失敗——保留手上資料，不清空
    if (itemRows) setItems(itemRows as PickupItem[]);
    if (pickupRows) setPickups(pickupRows as PickupRecord[]);
    if (unpaidRows) {
      setUnpaidMemberships(new Set((unpaidRows as { membership_id: string }[]).map((r) => r.membership_id)));
    }
    if (requirePaidValue !== null) setRequiresPaid(requirePaidValue === true);
  }, [event.id, org.id]);

  useEffect(() => {
    void reloadPickups();
  }, [reloadPickups]);

  const issuedPickups = useMemo(() => new Set(pickups.map((p) => `${p.attendee_id}:${p.item_key}`)), [pickups]);

  const refresh = useCallback(async () => {
    await Promise.all([onChanged(), reloadPickups()]);
  }, [onChanged, reloadPickups]);

  const { isOnline, queuedIds, pendingCount, checkIn, flush } = useCheckinQueue(event.id, refresh);

  const checkInGroup = async (group: PersonGroup, channel: Channel): Promise<string | null> => {
    let error: string | null = null;
    for (const attendee of group.attendees) {
      if (attendee.checked_in_at || queuedIds.has(attendee.id)) continue;
      const result = await checkIn(attendee.id, channel);
      if (!result.ok) {
        error = `報到失敗：${ERROR_LABELS[result.error ?? ''] ?? result.error ?? '未知錯誤'}`;
        break;
      }
    }
    await refresh();
    return error;
  };

  const undo = async (attendee: Attendee): Promise<string | null> => {
    const { data, error } = await supabase.rpc('undo_checkin', { p_attendee: attendee.id });
    const result = data as { ok: boolean; error?: string } | null;
    await refresh();
    return error || !result?.ok ? `撤銷失敗：${error?.message ?? result?.error ?? ''}` : null;
  };

  const togglePickup = async (attendee: Attendee, itemKey: string): Promise<string | null> => {
    const issued = pickups.find((p) => p.attendee_id === attendee.id && p.item_key === itemKey);
    const { error } = issued
      ? await supabase.from('attendee_pickups').update({ undone_at: new Date().toISOString() }).eq('id', issued.id)
      : await supabase.from('attendee_pickups').insert({
        org_id: org.id, event_id: event.id, attendee_id: attendee.id, item_key: itemKey,
      });
    await reloadPickups();
    if (!error) return null;
    return issued ? `撤銷發放失敗：${error.message}` : `發放被拒：${error.message}`;
  };

  const addWalkin = async (name: string, company: string): Promise<string | null> => {
    const { data, error } = await supabase.rpc('add_walkin', {
      p_event: event.id, p_name: name, p_org_name: company || null,
    });
    const result = data as { ok: boolean; error?: string } | null;
    if (error || !result?.ok) {
      return result?.error === 'walkin_disabled'
        ? '本活動已關閉現場報名（設定中心可開啟）'
        : `新增失敗：${error?.message ?? result?.error ?? ''}`;
    }
    await refresh();
    return null;
  };

  if (event.status !== 'open') {
    return (
      <p className="rounded bg-stone-100 border border-stone-200 text-stone-500 text-sm px-3 py-4">
        活動目前是「{event.status === 'draft' ? '籌備中' : '已結束'}」——開放報到後這裡才能操作。
        想先熟悉操作，可以用活動頁上方的「🧪 報到台練習」。
      </p>
    );
  }

  return (
    <CheckinDesk attendees={attendees} items={items} issuedPickups={issuedPickups}
      unpaidMemberships={features.fees ? unpaidMemberships : NO_UNPAID} requiresPaid={features.fees && requiresPaid}
      queuedIds={queuedIds} isOnline={isOnline} pendingCount={pendingCount} canCheckin={canCheckin}
      onFlush={() => void flush()} onCheckInGroup={checkInGroup} onUndo={undo}
      onTogglePickup={togglePickup} onAddWalkin={addWalkin} />
  );
}
