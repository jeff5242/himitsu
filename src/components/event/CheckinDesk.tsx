import { useMemo, useState } from 'react';
import { ATTENDEE_SEARCH_PLACEHOLDER, matchesAttendeeQuery } from '../../lib/attendeeSearch';
import type { FormEvent, ReactNode } from 'react';
import { attendeeAffiliation, categoryLabel, groupByPerson } from '../../lib/attendee';
import type { PersonGroup } from '../../lib/attendee';
import { KIND_LABELS } from '../../lib/labels';
import type { Attendee } from '../../lib/types';

export type Channel = 'assist' | 'kiosk' | 'vip';

export interface DeskPickupItem {
  key: string;
  label: string;
}

const CHANNEL_LABELS: Record<Channel, string> = { assist: '服務台', kiosk: '自助機', vip: '貴賓' };
const MAX_VISIBLE_GROUPS = 30;

interface CheckinDeskProps {
  attendees: Attendee[];
  items: DeskPickupItem[];
  /** 已發放：`${attendeeId}:${itemKey}` */
  issuedPickups: ReadonlySet<string>;
  unpaidMemberships: ReadonlySet<string>;
  requiresPaid: boolean;
  queuedIds: ReadonlySet<string>;
  isOnline: boolean;
  pendingCount: number;
  canCheckin: boolean;
  banner?: ReactNode;
  onFlush: () => void;
  /** 以下動作回傳錯誤訊息；成功回 null */
  onCheckInGroup: (group: PersonGroup, channel: Channel) => Promise<string | null>;
  onUndo: (attendee: Attendee) => Promise<string | null>;
  onTogglePickup: (attendee: Attendee, itemKey: string) => Promise<string | null>;
  onAddWalkin: (name: string, company: string) => Promise<string | null>;
}

/** 報到台畫面（正式與練習共用）：person 聚合卡、一鍵全報到、領取項目逐項發放、walk-in */
export default function CheckinDesk(props: CheckinDeskProps) {
  const { attendees, items, issuedPickups, unpaidMemberships, requiresPaid, queuedIds, canCheckin } = props;
  const [query, setQuery] = useState('');
  const [channel, setChannel] = useState<Channel>('assist');
  const [notice, setNotice] = useState<string | null>(null);

  const groups = useMemo(() => groupByPerson(attendees), [attendees]);
  const visibleGroups = useMemo(
    () => groups.filter((g) => g.attendees.some((a) => matchesAttendeeQuery(a, query))),
    [groups, query],
  );

  const run = async (action: () => Promise<string | null>) => {
    setNotice(null);
    const error = await action();
    if (error) setNotice(error);
  };

  return (
    <div className="space-y-4">
      {props.banner}
      <div className="flex flex-wrap items-center gap-3">
        <input value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
          placeholder={ATTENDEE_SEARCH_PLACEHOLDER} aria-label="搜尋名單"
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

      {!props.isOnline && (
        <p className="rounded bg-amber-50 border border-amber-300 text-amber-800 text-sm px-3 py-2 font-bold">
          📴 離線模式——可照常搜尋與報到，動作已排入本機佇列（{props.pendingCount} 筆），回網自動同步。
          離線期間請勿重新整理頁面。
        </p>
      )}
      {props.isOnline && props.pendingCount > 0 && (
        <p className="rounded bg-blue-50 border border-blue-200 text-blue-700 text-sm px-3 py-2 flex items-center gap-3">
          <span>待同步 {props.pendingCount} 筆離線報到</span>
          <button onClick={props.onFlush} className="rounded border border-blue-300 px-2 py-1 hover:bg-blue-100">
            立即同步
          </button>
        </p>
      )}

      {canCheckin && <WalkinForm onAdd={props.onAddWalkin} />}

      {notice && (
        <p className="rounded bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{notice}</p>
      )}

      <div className="space-y-3">
        {visibleGroups.length === 0 && <p className="text-sm text-stone-400">沒有符合的名單。</p>}
        {visibleGroups.slice(0, MAX_VISIBLE_GROUPS).map((group) => {
          const allCheckedIn = group.attendees.every((a) => a.checked_in_at || queuedIds.has(a.id));
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
                  <button onClick={() => void run(() => props.onCheckInGroup(group, channel))}
                    className="ml-auto rounded bg-green-700 px-4 py-2 text-white font-bold hover:bg-green-800">
                    {group.attendees.length > 1 ? '全部報到' : '報到'}
                  </button>
                )}
                {allCheckedIn && <span className="ml-auto text-green-700 font-bold text-sm">✓ 已報到</span>}
              </div>

              {group.attendees.map((attendee) => (
                <div key={attendee.id} className="flex flex-wrap items-center gap-2 text-sm border-t border-stone-100 pt-2">
                  <span className="font-mono text-stone-400">#{attendee.seq_no}</span>
                  <span className="text-xs rounded-full bg-stone-100 px-2 py-0.5 text-stone-600">
                    {attendee.identities ? KIND_LABELS[attendee.identities.kind] : categoryLabel(attendee)}
                  </span>
                  {attendeeAffiliation(attendee) && (
                    <span className="text-stone-500">{attendeeAffiliation(attendee)}</span>
                  )}
                  {attendee.guest_title && <span className="text-stone-500">{attendee.guest_title}</span>}
                  {attendee.roll_call && (
                    <span className="text-xs rounded-full bg-amber-50 border border-amber-300 px-2 py-0.5 font-bold text-amber-800">★ 唱名</span>
                  )}
                  {attendee.diet && <span className="text-xs text-stone-500">{attendee.diet}</span>}
                  {(attendee.companions ?? 0) > 0 && (
                    <span className="text-xs rounded-full bg-sky-50 border border-sky-200 px-2 py-0.5 text-sky-700">
                      攜伴 {attendee.companions}・共 {1 + (attendee.companions ?? 0)} 位
                    </span>
                  )}
                  {attendee.table_no !== null && (
                    <span className="text-xs rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-amber-700">
                      桌 {attendee.table_no}
                    </span>
                  )}
                  {(attendee.identities?.memberships.some((m) => unpaidMemberships.has(m.id)) ?? false) && (
                    <span className="text-xs rounded-full bg-red-50 border border-red-300 px-2 py-0.5 text-red-600 font-bold">
                      未繳會費{requiresPaid ? '·領取鎖定' : ''}
                    </span>
                  )}
                  {attendee.checked_in_at ? (
                    <span className="text-green-700">✓ {new Date(attendee.checked_in_at).toLocaleTimeString('zh-TW')}</span>
                  ) : queuedIds.has(attendee.id) ? (
                    <span className="text-amber-700">⏳ 已報到（待同步）</span>
                  ) : (
                    <span className="text-stone-400">未報到</span>
                  )}
                  {canCheckin && (
                    <span className="ml-auto flex flex-wrap items-center gap-2">
                      {items.map((item) => {
                        const issued = issuedPickups.has(`${attendee.id}:${item.key}`);
                        return (
                          <button key={item.key} onClick={() => void run(() => props.onTogglePickup(attendee, item.key))}
                            className={`rounded-full border px-2.5 py-1 text-xs ${
                              issued ? 'bg-green-50 border-green-300 text-green-700 font-bold'
                                     : 'border-stone-300 text-stone-500 hover:bg-stone-50'}`}>
                            {issued ? '✓ ' : ''}{item.label}
                          </button>
                        );
                      })}
                      {attendee.checked_in_at && (
                        <button onClick={() => void run(() => props.onUndo(attendee))}
                          className="text-xs text-stone-400 hover:text-red-600">撤銷報到</button>
                      )}
                    </span>
                  )}
                </div>
              ))}
            </section>
          );
        })}
        {visibleGroups.length > MAX_VISIBLE_GROUPS && (
          <p className="text-xs text-stone-400">
            還有 {visibleGroups.length - MAX_VISIBLE_GROUPS} 張卡——輸入關鍵字縮小範圍。
          </p>
        )}
      </div>
    </div>
  );
}

function WalkinForm({ onAdd }: { onAdd: (name: string, company: string) => Promise<string | null> }) {
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (formEvent: FormEvent) => {
    formEvent.preventDefault();
    const error = await onAdd(name, company);
    if (error) { setMessage(error); return; }
    setMessage(null);
    setName('');
    setCompany('');
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
