import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useOrg } from '../hooks/useOrg';
import OrgLayout from '../components/OrgLayout';
import { EVENT_KIND_LABELS, EVENT_STATUS_BADGE_CLASS, EVENT_STATUS_LABELS } from '../lib/labels';
import type { EventKind, OrgEvent } from '../lib/types';

/** 活動列表＋建立（EPIC-1 L7；一場大會＝一個活動） */
export default function EventsPage() {
  const { slug } = useParams();
  const { org, myRole, can, isLoading, error } = useOrg(slug);
  const [events, setEvents] = useState<OrgEvent[]>([]);

  const reload = useCallback(async () => {
    if (!org) return;
    const { data } = await supabase
      .from('events')
      .select('*')
      .eq('org_id', org.id)
      .order('created_at', { ascending: false });
    setEvents((data as OrgEvent[]) ?? []);
  }, [org]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (isLoading) return <p className="p-8 text-stone-400">載入中…</p>;
  if (error || !org) return <p className="p-8 text-red-600">{error ?? '找不到協會'}</p>;

  return (
    <OrgLayout org={org} myRole={myRole}>
      <h2 className="text-lg font-bold">活動（{events.length}）</h2>

      {can('events.write') && <CreateEventForm orgId={org.id} onCreated={reload} />}

      <section className="bg-white rounded-xl shadow divide-y divide-stone-100">
        {events.length === 0 && (
          <p className="p-4 text-stone-400 text-sm">還沒有活動——建立第一場吧。</p>
        )}
        {events.map((event) => (
          <Link
            key={event.id}
            to={`/o/${org.slug}/events/${event.id}`}
            className="flex flex-wrap items-center gap-3 p-4 hover:bg-stone-50"
          >
            <span className="font-bold">{event.name}</span>
            <span className="text-xs rounded-full bg-stone-100 px-2 py-0.5 text-stone-500">
              {EVENT_KIND_LABELS[event.kind]}
            </span>
            <span className={`text-xs rounded-full border px-2 py-0.5 ${EVENT_STATUS_BADGE_CLASS[event.status]}`}>
              {EVENT_STATUS_LABELS[event.status]}
            </span>
            <span className="ml-auto text-sm text-stone-500">
              {event.starts_at ? new Date(event.starts_at).toLocaleString('zh-TW') : '（未定日期）'}
              {event.venue ? `｜${event.venue}` : ''}
            </span>
          </Link>
        ))}
      </section>
    </OrgLayout>
  );
}

function CreateEventForm({ orgId, onCreated }: { orgId: string; onCreated: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<EventKind>('assembly');
  const [startsAt, setStartsAt] = useState('');
  const [venue, setVenue] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);
    const { error } = await supabase.from('events').insert({
      org_id: orgId,
      name: name.trim(),
      kind,
      starts_at: startsAt ? new Date(startsAt).toISOString() : null,
      venue: venue.trim() || null,
    });
    if (error) {
      setErrorMessage(`建立失敗：${error.message}`);
      return;
    }
    setName('');
    setStartsAt('');
    setVenue('');
    await onCreated();
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow p-4 flex flex-wrap gap-2 text-sm items-end">
      <label className="block flex-1 min-w-44">
        <span className="text-stone-600">活動名稱</span>
        <input required value={name} onChange={(e) => setName(e.target.value)}
          placeholder="例：第七屆會員大會" className="mt-1 w-full rounded border border-stone-300 px-3 py-2" />
      </label>
      <label className="block">
        <span className="text-stone-600">類型</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as EventKind)}
          className="mt-1 rounded border border-stone-300 px-3 py-2">
          {Object.entries(EVENT_KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-stone-600">日期時間</span>
        <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)}
          className="mt-1 rounded border border-stone-300 px-3 py-2" />
      </label>
      <label className="block flex-1 min-w-36">
        <span className="text-stone-600">地點</span>
        <input value={venue} onChange={(e) => setVenue(e.target.value)}
          placeholder="（選填）" className="mt-1 w-full rounded border border-stone-300 px-3 py-2" />
      </label>
      <button type="submit" className="rounded bg-amber-600 px-4 py-2 font-bold text-white hover:bg-amber-700">
        建立活動
      </button>
      {errorMessage && <p className="w-full text-red-600">{errorMessage}</p>}
    </form>
  );
}
