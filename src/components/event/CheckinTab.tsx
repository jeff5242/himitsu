import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { attendeeAffiliation, groupByPerson } from '../../lib/attendee';
import type { PersonGroup } from '../../lib/attendee';
import { KIND_LABELS } from '../../lib/labels';
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

type Channel = 'assist' | 'kiosk' | 'vip';

const CHANNEL_LABELS: Record<Channel, string> = { assist: '服務台', kiosk: '自助機', vip: '貴賓' };

interface CheckinTabProps {
  org: Organization;
  event: OrgEvent;
  attendees: Attendee[];
  canCheckin: boolean;
  onChanged: () => Promise<void>;
}

/** 報到台（AC-9）：person 聚合卡、一鍵全報到、領取項目逐項/全領、walk-in */
export default function CheckinTab({ org, event, attendees, canCheckin, onChanged }: CheckinTabProps) {
  const [query, setQuery] = useState('');
  const [channel, setChannel] = useState<Channel>('assist');
  const [items, setItems] = useState<PickupItem[]>([]);
  const [pickups, setPickups] = useState<PickupRecord[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const reloadPickups = useCallback(async () => {
    const [{ data: itemRows }, { data: pickupRows }] = await Promise.all([
      supabase.from('pickup_items').select('id, key, label, sort').eq('event_id', event.id).order('sort'),
      supabase.from('attendee_pickups').select('id, attendee_id, item_key')
        .eq('event_id', event.id).is('undone_at', null),
    ]);
    setItems((itemRows as PickupItem[]) ?? []);
    setPickups((pickupRows as PickupRecord[]) ?? []);
  }, [event.id]);

  useEffect(() => {
    void reloadPickups();
  }, [reloadPickups]);

  const pickupSet = useMemo(
    () => new Set(pickups.map((p) => `${p.attendee_id}:${p.item_key}`)),
    [pickups],
  );

  const groups = useMemo(() => groupByPerson(attendees), [attendees]);
  const visibleGroups = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return groups;
    return groups.filter((g) =>
      g.name.toLowerCase().includes(keyword) ||
      g.mobile?.includes(keyword) ||
      g.attendees.some((a) =>
        String(a.seq_no) === keyword ||
        (attendeeAffiliation(a) ?? '').toLowerCase().includes(keyword) ||
        a.identities?.memberships.some((m) => m.member_no.toLowerCase().includes(keyword)),
      ),
    );
  }, [groups, query]);

  const refresh = async () => {
    await Promise.all([onChanged(), reloadPickups()]);
  };

  const checkInAll = async (group: PersonGroup) => {
    setNotice(null);
    for (const attendee of group.attendees) {
      if (attendee.checked_in_at) continue;
      const { data, error } = await supabase.rpc('check_in', {
        p_attendee: attendee.id, p_channel: channel,
      });
      const result = data as { ok: boolean; error?: string } | null;
      if (error || !result?.ok) {
        setNotice(`報到失敗：${error?.message ?? result?.error ?? '未知錯誤'}`);
        break;
      }
    }
    await refresh();
  };

  const undoCheckin = async (attendee: Attendee) => {
    const { data, error } = await supabase.rpc('undo_checkin', { p_attendee: attendee.id });
    const result = data as { ok: boolean; error?: string } | null;
    if (error || !result?.ok) setNotice(`撤銷失敗：${error?.message ?? result?.error ?? ''}`);
    else setNotice(null);
    await refresh();
  };

  const togglePickup = async (attendee: Attendee, item: PickupItem) => {
    setNotice(null);
    const issued = pickups.find((p) => p.attendee_id === attendee.id && p.item_key === item.key);
    if (issued) {
      const { error } = await supabase.from('attendee_pickups')
        .update({ undone_at: new Date().toISOString() }).eq('id', issued.id);
      if (error) setNotice(`撤銷發放失敗：${error.message}`);
    } else {
      const { error } = await supabase.from('attendee_pickups').insert({
        org_id: org.id, event_id: event.id, attendee_id: attendee.id, item_key: item.key,
      });
      if (error) setNotice(`發放被拒：${error.message}`);
    }
    await reloadPickups();
  };

  if (event.status !== 'open') {
    return (
      <p className="rounded bg-stone-100 border border-stone-200 text-stone-500 text-sm px-3 py-4">
        活動目前是「{event.status === 'draft' ? '籌備中' : '已結束'}」——開放報到後這裡才能操作。
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
          placeholder="搜尋姓名／手機／序號／編號／公司…"
          className="flex-1 min-w-64 rounded border border-stone-300 px-3 py-3 text-base" />
        <span className="flex rounded border border-stone-300 overflow-hidden text-sm">
          {(Object.keys(CHANNEL_LABELS) as Channel[]).map((c) => (
            <button key={c} onClick={() => setChannel(c)}
              className={`px-3 py-2 ${channel === c ? 'bg-amber-600 text-white font-bold' : 'bg-white hover:bg-stone-50'}`}>
              {CHANNEL_LABELS[c]}
            </button>
          ))}
        </span>
      </div>

      {canCheckin && <WalkinForm eventId={event.id} onAdded={refresh} />}

      {notice && (
        <p className="rounded bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{notice}</p>
      )}

      <div className="space-y-3">
        {visibleGroups.length === 0 && (
          <p className="text-sm text-stone-400">沒有符合的名單。</p>
        )}
        {visibleGroups.slice(0, 30).map((group) => {
          const allCheckedIn = group.attendees.every((a) => a.checked_in_at);
          return (
            <section key={group.key}
              className={`bg-white rounded-xl shadow p-4 space-y-2 border-l-4 ${allCheckedIn ? 'border-green-600' : 'border-stone-200'}`}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-lg font-black">{group.name}</span>
                {group.mobile && <span className="text-sm text-stone-500">{group.mobile}</span>}
                {group.attendees.length > 1 && (
                  <span className="text-xs rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 font-bold">
                    {group.attendees.length} 身分
                  </span>
                )}
                {canCheckin && !allCheckedIn && (
                  <button onClick={() => void checkInAll(group)}
                    className="ml-auto rounded bg-green-700 px-4 py-2 text-white font-bold hover:bg-green-800">
                    {group.attendees.length > 1 ? '全部報到' : '報到'}
                  </button>
                )}
                {allCheckedIn && (
                  <span className="ml-auto text-green-700 font-bold text-sm">✓ 已報到</span>
                )}
              </div>

              {group.attendees.map((attendee) => (
                <div key={attendee.id} className="flex flex-wrap items-center gap-2 text-sm border-t border-stone-100 pt-2">
                  <span className="font-mono text-stone-400">#{attendee.seq_no}</span>
                  <span className="text-xs rounded-full bg-stone-100 px-2 py-0.5 text-stone-600">
                    {attendee.identities ? KIND_LABELS[attendee.identities.kind]
                      : attendee.category === 'walkin' ? '現場報名' : '來賓'}
                  </span>
                  {attendeeAffiliation(attendee) && (
                    <span className="text-stone-500">{attendeeAffiliation(attendee)}</span>
                  )}
                  {attendee.table_no !== null && (
                    <span className="text-xs rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-amber-700">
                      桌 {attendee.table_no}
                    </span>
                  )}
                  {attendee.checked_in_at ? (
                    <span className="text-green-700">✓ {new Date(attendee.checked_in_at).toLocaleTimeString('zh-TW')}</span>
                  ) : (
                    <span className="text-stone-400">未報到</span>
                  )}
                  {canCheckin && (
                    <span className="ml-auto flex flex-wrap items-center gap-2">
                      {items.map((item) => {
                        const issued = pickupSet.has(`${attendee.id}:${item.key}`);
                        return (
                          <button key={item.key} onClick={() => void togglePickup(attendee, item)}
                            className={`rounded-full border px-2.5 py-1 text-xs ${
                              issued ? 'bg-green-50 border-green-300 text-green-700 font-bold'
                                     : 'border-stone-300 text-stone-500 hover:bg-stone-50'}`}>
                            {issued ? '✓ ' : ''}{item.label}
                          </button>
                        );
                      })}
                      {attendee.checked_in_at && (
                        <button onClick={() => void undoCheckin(attendee)}
                          className="text-xs text-stone-400 hover:text-red-600">撤銷報到</button>
                      )}
                    </span>
                  )}
                </div>
              ))}
            </section>
          );
        })}
        {visibleGroups.length > 30 && (
          <p className="text-xs text-stone-400">還有 {visibleGroups.length - 30} 張卡——輸入關鍵字縮小範圍。</p>
        )}
      </div>
    </div>
  );
}

function WalkinForm({ eventId, onAdded }: { eventId: string; onAdded: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (formEvent: FormEvent) => {
    formEvent.preventDefault();
    const { data, error } = await supabase.rpc('add_walkin', {
      p_event: eventId, p_name: name, p_org_name: company || null,
    });
    const result = data as { ok: boolean; error?: string } | null;
    if (error || !result?.ok) {
      setMessage(result?.error === 'walkin_disabled'
        ? '本活動已關閉現場報名（設定中心可開啟）'
        : `新增失敗：${error?.message ?? result?.error ?? ''}`);
      return;
    }
    setMessage(null);
    setName('');
    setCompany('');
    await onAdded();
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-stone-500">現場報名：</span>
      <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="姓名"
        className="w-36 rounded border border-stone-300 px-3 py-2" />
      <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="單位（選填）"
        className="w-44 rounded border border-stone-300 px-3 py-2" />
      <button type="submit" className="rounded border border-stone-300 px-3 py-2 hover:bg-stone-100">
        加入名單
      </button>
      {message && <span className="text-red-600">{message}</span>}
    </form>
  );
}
