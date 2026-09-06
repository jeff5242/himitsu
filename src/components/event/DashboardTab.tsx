import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { attendanceStats } from '../../lib/attendee';
import type { Attendee, OrgEvent } from '../../lib/types';

const CATEGORY_LABELS = { member: '會員', guest: '來賓', walkin: '現場報名' } as const;
const CHANNEL_LABELS: Record<string, string> = {
  assist: '服務台', kiosk: '自助機', vip: '貴賓通道', import: '匯入標記',
};

interface DashboardTabProps {
  event: OrgEvent;
  attendees: Attendee[];
}

/** 出席儀表板（AC-12）：三來源各自小計＋單一總數；通道與領取統計同版面 */
export default function DashboardTab({ event, attendees }: DashboardTabProps) {
  const stats = attendanceStats(attendees);
  const [channelCounts, setChannelCounts] = useState<Record<string, number>>({});
  const [pickupCounts, setPickupCounts] = useState<{ label: string; count: number }[]>([]);

  const reload = useCallback(async () => {
    const [{ data: logs }, { data: pickups }, { data: items }] = await Promise.all([
      supabase.from('checkin_log').select('channel').eq('event_id', event.id).is('undone_at', null),
      supabase.from('attendee_pickups').select('item_key').eq('event_id', event.id).is('undone_at', null),
      supabase.from('pickup_items').select('key, label, sort').eq('event_id', event.id).order('sort'),
    ]);
    const byChannel: Record<string, number> = {};
    for (const row of (logs ?? []) as { channel: string }[]) {
      byChannel[row.channel] = (byChannel[row.channel] ?? 0) + 1;
    }
    setChannelCounts(byChannel);
    const byItem: Record<string, number> = {};
    for (const row of (pickups ?? []) as { item_key: string }[]) {
      byItem[row.item_key] = (byItem[row.item_key] ?? 0) + 1;
    }
    setPickupCounts(
      ((items ?? []) as { key: string; label: string }[]).map((item) => ({
        label: item.label,
        count: byItem[item.key] ?? 0,
      })),
    );
  }, [event.id]);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), 15_000);
    return () => clearInterval(timer);
  }, [reload]);

  return (
    <div className="space-y-4">
      <section className="bg-white rounded-xl shadow p-5">
        <div className="flex items-end gap-6 flex-wrap">
          <div>
            <p className="text-xs text-stone-500 tracking-widest">總出席</p>
            <p className="text-5xl font-black tabular-nums">
              {stats.checkedIn}
              <span className="text-xl text-stone-400 font-normal">／{stats.total}</span>
            </p>
          </div>
          {(Object.keys(CATEGORY_LABELS) as (keyof typeof CATEGORY_LABELS)[]).map((category) => (
            <div key={category}>
              <p className="text-xs text-stone-500">{CATEGORY_LABELS[category]}</p>
              <p className="text-2xl font-bold tabular-nums">
                {stats.byCategory[category].checkedIn}
                <span className="text-sm text-stone-400 font-normal">／{stats.byCategory[category].total}</span>
              </p>
            </div>
          ))}
        </div>
        <p className="text-xs text-stone-400 mt-2">
          總數＝三來源之和（{stats.byCategory.member.checkedIn}＋{stats.byCategory.guest.checkedIn}＋{stats.byCategory.walkin.checkedIn}＝{stats.checkedIn}），每 15 秒更新
        </p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="bg-white rounded-xl shadow p-5 space-y-2">
          <h3 className="font-bold text-sm">報到通道</h3>
          {Object.keys(channelCounts).length === 0 && (
            <p className="text-sm text-stone-400">尚無報到紀錄。</p>
          )}
          {Object.entries(channelCounts).map(([channel, count]) => (
            <div key={channel} className="flex justify-between text-sm">
              <span>{CHANNEL_LABELS[channel] ?? channel}</span>
              <span className="font-bold tabular-nums">{count}</span>
            </div>
          ))}
        </section>
        <section className="bg-white rounded-xl shadow p-5 space-y-2">
          <h3 className="font-bold text-sm">領取項目發放</h3>
          {pickupCounts.length === 0 && (
            <p className="text-sm text-stone-400">本活動未定義領取項目（名單分頁可新增）。</p>
          )}
          {pickupCounts.map((item) => (
            <div key={item.label} className="flex justify-between text-sm">
              <span>{item.label}</span>
              <span className="font-bold tabular-nums">{item.count}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
