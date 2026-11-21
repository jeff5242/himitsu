import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useOrg } from '../hooks/useOrg';
import OrgLayout from '../components/OrgLayout';
import RosterTab from '../components/event/RosterTab';
import CheckinTab from '../components/event/CheckinTab';
import TablesTab from '../components/event/TablesTab';
import DashboardTab from '../components/event/DashboardTab';
import { EVENT_STATUS_BADGE_CLASS, EVENT_STATUS_LABELS } from '../lib/labels';
import type { Attendee, EventStatus, OrgEvent } from '../lib/types';

const ATTENDEE_SELECT =
  '*, identities(id, kind, title, persons(id, name, mobile), legal_entities(name), memberships(id, member_no, status))';

type TabKey = 'roster' | 'checkin' | 'tables' | 'dashboard';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'roster', label: '名單' },
  { key: 'checkin', label: '報到台' },
  { key: 'tables', label: '桌次' },
  { key: 'dashboard', label: '儀表板' },
];

/** 單一活動頁：名單／報到／桌次／儀表板（L7 先出名單，L8/L9 逐段掛上） */
export default function EventPage() {
  const { slug, eventId } = useParams();
  const { org, myRole, can, isLoading, error } = useOrg(slug);
  const [event, setEvent] = useState<OrgEvent | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [tab, setTab] = useState<TabKey>('roster');
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!org || !eventId) return;
    const [{ data: eventRow }, { data: attendeeRows }] = await Promise.all([
      supabase.from('events').select('*').eq('id', eventId).maybeSingle(),
      supabase.from('event_attendees').select(ATTENDEE_SELECT).eq('event_id', eventId).order('seq_no'),
    ]);
    // 離線時查詢會失敗——保留手上已有的名單（AC-13 報到台斷網不清空）
    if (eventRow) setEvent(eventRow as OrgEvent);
    if (attendeeRows) setAttendees(attendeeRows as Attendee[]);
  }, [org, eventId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (isLoading) return <p className="p-8 text-stone-400">載入中…</p>;
  if (error || !org) return <p className="p-8 text-red-600">{error ?? '找不到協會'}</p>;
  if (!event) return <p className="p-8 text-stone-400">活動載入中…</p>;

  const setStatus = async (status: EventStatus) => {
    const { data, error: updateError } = await supabase
      .from('events').update({ status }).eq('id', event.id).select();
    if (updateError || !data?.length) setNotice('狀態變更被拒（權限不足）');
    else { setNotice(null); await reload(); }
  };

  return (
    <OrgLayout org={org} myRole={myRole}>
      <div className="flex flex-wrap items-center gap-3">
        <Link to={`/o/${org.slug}/events`} className="text-sm text-stone-400 hover:text-stone-600">← 活動</Link>
        <h2 className="text-lg font-bold">{event.name}</h2>
        <span className={`text-xs rounded-full border px-2 py-0.5 ${EVENT_STATUS_BADGE_CLASS[event.status]}`}>
          {EVENT_STATUS_LABELS[event.status]}
        </span>
        {can('events.write') && (
          <span className="ml-auto flex gap-2 text-sm">
            {event.status === 'draft' && (
              <button onClick={() => void setStatus('open')}
                className="rounded bg-green-700 px-3 py-1.5 text-white hover:bg-green-800">開放報到</button>
            )}
            {event.status === 'open' && (
              <button onClick={() => void setStatus('closed')}
                className="rounded border border-stone-300 px-3 py-1.5 hover:bg-stone-100">結束活動</button>
            )}
            {event.status === 'closed' && (
              <button onClick={() => void setStatus('open')}
                className="rounded border border-stone-300 px-3 py-1.5 hover:bg-stone-100">重新開放</button>
            )}
          </span>
        )}
      </div>

      <nav className="flex flex-wrap items-center gap-1">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded text-sm ${tab === t.key ? 'bg-amber-600 text-white font-bold' : 'hover:bg-stone-100'}`}>
            {t.label}
          </button>
        ))}
        <span className="ml-auto flex gap-2 text-sm">
          <Link to={`/o/${org.slug}/events/${event.id}/practice`} target="_blank"
            className="rounded border border-sky-300 bg-sky-50 px-3 py-1.5 text-sky-800 hover:bg-sky-100">
            🧪 報到練習
          </Link>
          <Link to={`/o/${org.slug}/events/${event.id}/vip`} target="_blank"
            className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-800 hover:bg-amber-100">
            👑 貴賓報到畫面
          </Link>
          <Link to={`/o/${org.slug}/events/${event.id}/blessings`} target="_blank"
            className="rounded border border-stone-300 px-3 py-1.5 hover:bg-stone-100">
            🙏 祝福牆
          </Link>
        </span>
      </nav>

      {notice && (
        <p className="rounded bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{notice}</p>
      )}

      {tab === 'roster' && (
        <RosterTab org={org} event={event} attendees={attendees} canWrite={can('events.write')} onChanged={reload} />
      )}
      {tab === 'checkin' && (
        <CheckinTab org={org} event={event} attendees={attendees} canCheckin={can('checkin.write')} onChanged={reload} />
      )}
      {tab === 'tables' && (
        <TablesTab org={org} event={event} attendees={attendees} canWrite={can('events.write')} onChanged={reload} />
      )}
      {tab === 'dashboard' && <DashboardTab event={event} attendees={attendees} />}
    </OrgLayout>
  );
}
