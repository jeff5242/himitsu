import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useOrg } from '../hooks/useOrg';
import { attendeeName } from '../lib/attendee';
import type { Attendee, OrgEvent } from '../lib/types';

interface ScreenTable {
  table_no: number;
  capacity: number;
  label: string | null;
}

const REFRESH_MS = 30_000;

/** 現場桌次投影頁：唯讀、大字級、自動更新（AC-10） */
export default function TableScreenPage() {
  const { slug, eventId } = useParams();
  const { org, isLoading } = useOrg(slug);
  const [event, setEvent] = useState<OrgEvent | null>(null);
  const [tables, setTables] = useState<ScreenTable[]>([]);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [query, setQuery] = useState('');

  const reload = useCallback(async () => {
    if (!org || !eventId) return;
    const [{ data: eventRow }, { data: tableRows }, { data: attendeeRows }] = await Promise.all([
      supabase.from('events').select('*').eq('id', eventId).maybeSingle(),
      supabase.from('event_tables').select('table_no, capacity, label').eq('event_id', eventId).order('table_no'),
      supabase.from('event_attendees')
        .select('*, identities(id, kind, title, persons(id, name, mobile), legal_entities(name), memberships(id, member_no, status))')
        .eq('event_id', eventId).not('table_no', 'is', null).is('removed_at', null),
    ]);
    setEvent((eventRow as OrgEvent) ?? null);
    setTables((tableRows as ScreenTable[]) ?? []);
    setAttendees((attendeeRows as Attendee[]) ?? []);
  }, [org, eventId]);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  const byTable = useMemo(() => {
    const map = new Map<number, Attendee[]>();
    for (const attendee of attendees) {
      if (attendee.table_no === null) continue;
      map.set(attendee.table_no, [...(map.get(attendee.table_no) ?? []), attendee]);
    }
    return map;
  }, [attendees]);

  const highlight = query.trim();

  if (isLoading) return <main className="min-h-screen bg-stone-900" />;

  return (
    <main className="min-h-screen bg-stone-900 text-stone-100 p-6">
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <h1 className="text-3xl font-black">{event?.name ?? ''}｜桌次表</h1>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="輸入姓名找桌…"
          className="ml-auto rounded-lg bg-stone-800 border border-stone-600 px-4 py-2 text-lg placeholder-stone-500"
        />
      </div>
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
        {tables.map((table) => {
          const seated = byTable.get(table.table_no) ?? [];
          return (
            <section key={table.table_no} className="rounded-2xl bg-stone-800 p-4">
              <p className="text-2xl font-black text-amber-400">
                桌 {table.table_no}
                {table.label && <span className="ml-2 text-base text-stone-300">{table.label}</span>}
              </p>
              <ul className="mt-2 space-y-1 text-xl leading-relaxed">
                {seated.map((attendee) => {
                  const name = attendeeName(attendee);
                  const isHit = highlight !== '' && name.includes(highlight);
                  return (
                    <li key={attendee.id}
                      className={isHit ? 'bg-amber-400 text-stone-900 font-black rounded px-2' : ''}>
                      {name}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      {tables.length === 0 && <p className="text-stone-500 text-xl">尚未建立桌次。</p>}
    </main>
  );
}
