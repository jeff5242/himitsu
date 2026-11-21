import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useOrg } from '../hooks/useOrg';
import { attendeeAffiliation, attendeeName } from '../lib/attendee';
import type { Attendee, OrgEvent } from '../lib/types';

const REFRESH_MS = 15_000;
const GREETING_SELECT = 'attendee_id, greeting, signature, hidden_at, updated_at, '
  + 'event_attendees(guest_name, guest_org, guest_tag, category, identities(title, kind, persons(name), legal_entities(name)))';

interface GreetingRow {
  attendee_id: string;
  greeting: string | null;
  signature: string | null;
  hidden_at: string | null;
  updated_at: string;
  event_attendees: Pick<Attendee, 'guest_name' | 'guest_org' | 'guest_tag' | 'category'> & {
    identities: Attendee['identities'];
  };
}

/** 以 attendee_id 合併增量資料；被撤下的移除；新到的排前面 */
function mergeGreetings(current: GreetingRow[], incoming: GreetingRow[]): GreetingRow[] {
  const byId = new Map(current.map((g) => [g.attendee_id, g]));
  for (const row of incoming) {
    if (row.hidden_at) byId.delete(row.attendee_id);
    else byId.set(row.attendee_id, row);
  }
  return [...byId.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

/** 祝福牆投影頁：瀑布流卡片、每 15 秒只抓新增／異動（簽名圖不重複下載） */
export default function BlessingWallPage() {
  const { slug, eventId } = useParams();
  const { org, can, isLoading } = useOrg(slug);
  const [event, setEvent] = useState<OrgEvent | null>(null);
  const [greetings, setGreetings] = useState<GreetingRow[]>([]);
  const [isManaging, setIsManaging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const lastSeenRef = useRef<string | null>(null);

  const poll = useCallback(async () => {
    if (!org || !eventId) return;
    let query = supabase.from('attendee_greetings').select(GREETING_SELECT).eq('event_id', eventId)
      .order('updated_at', { ascending: true });
    query = lastSeenRef.current ? query.gt('updated_at', lastSeenRef.current) : query.is('hidden_at', null);
    const { data, error } = await query;
    if (error || !data) return;  // 網路抖動：下一輪再試
    const rows = data as unknown as GreetingRow[];
    if (rows.length > 0) lastSeenRef.current = rows[rows.length - 1].updated_at;
    setGreetings((current) => mergeGreetings(current, rows));
  }, [org, eventId]);

  useEffect(() => {
    if (!eventId || !org) return;
    void supabase.from('events').select('*').eq('id', eventId).maybeSingle()
      .then(({ data }) => setEvent((data as OrgEvent) ?? null));
  }, [org, eventId]);

  useEffect(() => {
    void poll();
    const timer = setInterval(() => void poll(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [poll]);

  const hide = async (attendeeId: string) => {
    const { data, error } = await supabase.rpc('set_greeting_hidden', { p_attendee: attendeeId, p_hidden: true });
    if (error || !(data as { ok: boolean } | null)?.ok) { setNotice('撤下失敗（需要名單編輯權限）'); return; }
    setNotice(null);
    setGreetings((current) => current.filter((g) => g.attendee_id !== attendeeId));
  };

  const cards = useMemo(() => greetings.map((g) => {
    const attendee = g.event_attendees as unknown as Attendee;
    return { ...g, name: attendeeName(attendee), org: attendeeAffiliation(attendee) };
  }), [greetings]);

  if (isLoading || !org) return <main className="min-h-screen bg-stone-950" />;

  return (
    <main className="min-h-screen bg-stone-950 text-stone-50 px-6 py-8">
      <header className="mb-8 flex flex-wrap items-end gap-4">
        <div>
          <p className="text-stone-400">{event?.name ?? ''}</p>
          <h1 className="text-4xl font-black tracking-widest text-amber-300">🙏 祝福牆</h1>
        </div>
        <p className="text-2xl text-stone-300">已收到 <b className="text-amber-300 tabular-nums">{cards.length}</b> 份祝福</p>
        {can('events.write') && (
          <label className="ml-auto inline-flex items-center gap-2 text-sm text-stone-500">
            <input type="checkbox" checked={isManaging} onChange={(e) => setIsManaging(e.target.checked)} />
            管理模式（可撤下）
          </label>
        )}
      </header>
      {notice && <p className="mb-4 text-red-300">{notice}</p>}
      {cards.length === 0 && <p className="py-24 text-center text-2xl text-stone-500">貴賓報到後留下的祝福，會出現在這裡。</p>}

      <div className="columns-1 sm:columns-2 lg:columns-3 2xl:columns-4 gap-5">
        {cards.map((card) => (
          <article key={card.attendee_id}
            className="blessing-card mb-5 break-inside-avoid rounded-2xl border border-amber-300/30 bg-stone-900 p-5">
            {card.greeting && <p className="text-2xl font-bold leading-relaxed text-amber-100">「{card.greeting}」</p>}
            {card.signature && (
              <img src={card.signature} alt={`${card.name} 的簽名`} loading="lazy"
                className="mt-3 w-full rounded-xl bg-white" />
            )}
            <p className="mt-3 text-lg font-bold">{card.name}</p>
            {card.org && <p className="text-stone-400">{card.org}</p>}
            {isManaging && (
              <button type="button" onClick={() => void hide(card.attendee_id)}
                className="mt-2 text-sm text-red-300 underline">從祝福牆撤下</button>
            )}
          </article>
        ))}
      </div>
    </main>
  );
}
