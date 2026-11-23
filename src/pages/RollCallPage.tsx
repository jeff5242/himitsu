import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useOrg } from '../hooks/useOrg';
import { attendeeAffiliation, attendeeName } from '../lib/attendee';
import { rollCallList } from '../lib/seats';
import type { Attendee, OrgEvent } from '../lib/types';

const ATTENDEE_SELECT =
  '*, identities(id, kind, title, persons(id, name, mobile), legal_entities(name), memberships(id, member_no, status))';
const REFRESH_MS = 15_000;

const storageKey = (eventId: string) => `himitsu:rollcall:${eventId}`;

function loadCalled(eventId: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(eventId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveCalled(eventId: string, called: ReadonlySet<string>) {
  try { localStorage.setItem(storageKey(eventId), JSON.stringify([...called])); } catch { /* 私密視窗等環境忽略 */ }
}

/** 主持人唱名名單：有唱名資格且已報到者，依名單順序；「已唱名」記在這台裝置 */
export default function RollCallPage() {
  const { slug, eventId } = useParams();
  const { org, isLoading } = useOrg(slug);
  const [event, setEvent] = useState<OrgEvent | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [called, setCalled] = useState<ReadonlySet<string>>(() => loadCalled(eventId ?? ''));
  const [hideCalled, setHideCalled] = useState(false);
  const [showWaiting, setShowWaiting] = useState(false);
  // 練習預覽：全部當作已到場；「已唱名」另存記憶體，不碰正式的已唱名紀錄
  const [isPreview, setIsPreview] = useState(false);
  const [previewCalled, setPreviewCalled] = useState<ReadonlySet<string>>(new Set());

  const reload = useCallback(async () => {
    if (!org || !eventId) return;
    const [{ data: eventRow }, { data: rows }] = await Promise.all([
      supabase.from('events').select('*').eq('id', eventId).maybeSingle(),
      supabase.from('event_attendees').select(ATTENDEE_SELECT).eq('event_id', eventId).eq('roll_call', true).order('seq_no'),
    ]);
    if (eventRow) setEvent(eventRow as OrgEvent);
    if (rows) setAttendees(rows as Attendee[]);
  }, [org, eventId]);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  const { ready, waiting } = useMemo(() => rollCallList(attendees, { preview: isPreview }), [attendees, isPreview]);
  const calledSet = isPreview ? previewCalled : called;
  const visible = hideCalled ? ready.filter((a) => !calledSet.has(a.id)) : ready;

  const toggleCalled = (id: string) => {
    const next = new Set(calledSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    if (isPreview) { setPreviewCalled(next); return; }
    setCalled(next);
    saveCalled(eventId ?? '', next);
  };

  const togglePreview = (on: boolean) => {
    setIsPreview(on);
    setPreviewCalled(new Set());
  };

  if (isLoading || !org) return <main className="min-h-screen bg-stone-950" />;

  return (
    <main className="min-h-screen bg-stone-950 text-stone-50 px-6 py-6">
      <header className="mb-6 flex flex-wrap items-end gap-4">
        <div>
          <Link to={`/o/${org.slug}/events/${eventId}`} className="text-sm text-stone-500 hover:text-stone-300">← 返回活動</Link>
          <p className="text-stone-400">{event?.name ?? ''}</p>
          <h1 className="text-4xl font-black tracking-widest text-amber-300">📣 唱名名單</h1>
        </div>
        <p className="text-2xl text-stone-300 tabular-nums">
          {isPreview ? '預覽' : '已到'} <b className="text-amber-300">{ready.length}</b>／有唱名資格 {ready.length + waiting.length} 位
          {calledSet.size > 0 && <span className="ml-3 text-lg text-stone-500">已唱名 {ready.filter((a) => calledSet.has(a.id)).length}</span>}
        </p>
        <label className="ml-auto inline-flex items-center gap-2 text-sky-300">
          <input type="checkbox" checked={isPreview} onChange={(e) => togglePreview(e.target.checked)} className="h-5 w-5" />
          🧪 練習預覽
        </label>
        <label className="inline-flex items-center gap-2 text-stone-400">
          <input type="checkbox" checked={hideCalled} onChange={(e) => setHideCalled(e.target.checked)} className="h-5 w-5" />
          隱藏已唱名
        </label>
      </header>

      {isPreview && (
        <p className="mb-4 rounded-xl border-2 border-dashed border-sky-400 bg-sky-950 px-4 py-3 text-lg text-sky-200">
          🧪 練習預覽：所有勾了唱名的貴賓都當作已到場，讓主持人先練順序。這裡的「已唱名」不會留下紀錄；關掉預覽就回到正式名單。
        </p>
      )}
      {ready.length === 0 && (
        <p className="py-20 text-center text-2xl text-stone-500">有唱名資格的貴賓報到後，會依名單順序出現在這裡。</p>
      )}
      <ol className="space-y-3">
        {visible.map((a, index) => {
          const isCalled = calledSet.has(a.id);
          const subtitle = [a.guest_title ?? a.identities?.title, attendeeAffiliation(a)].filter(Boolean).join('・');
          return (
            <li key={a.id}
              className={`flex flex-wrap items-center gap-4 rounded-2xl border px-5 py-4 ${isCalled
                ? 'border-stone-800 bg-stone-900 text-stone-500' : 'border-amber-300/40 bg-stone-900'}`}>
              <span className="w-10 text-right text-2xl font-bold tabular-nums text-stone-500">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <p className={`text-4xl font-black ${isCalled ? 'line-through decoration-2' : ''}`}>{attendeeName(a)}</p>
                {subtitle && <p className="mt-1 text-xl text-stone-400">{subtitle}</p>}
              </div>
              {a.table_no !== null && <span className="text-xl text-stone-400">第 {a.table_no} 桌</span>}
              <button type="button" onClick={() => toggleCalled(a.id)} aria-pressed={isCalled}
                className={`rounded-xl px-5 py-3 text-lg font-bold ${isCalled
                  ? 'border border-stone-600 text-stone-400' : 'bg-amber-400 text-stone-900'}`}>
                {isCalled ? '↺ 取消' : '✓ 已唱名'}
              </button>
            </li>
          );
        })}
      </ol>

      {waiting.length > 0 && (
        <section className="mt-8">
          <button type="button" onClick={() => setShowWaiting(!showWaiting)} className="text-lg text-stone-400 underline">
            尚未報到 {waiting.length} 位{showWaiting ? '（收合）' : '（展開）'}
          </button>
          {showWaiting && (
            <ul className="mt-3 flex flex-wrap gap-2 text-lg text-stone-500">
              {waiting.map((a) => <li key={a.id} className="rounded-full border border-stone-700 px-3 py-1">{attendeeName(a)}</li>)}
            </ul>
          )}
        </section>
      )}
      <p className="mt-8 text-sm text-stone-600">名單每 15 秒自動更新；「已唱名」只記在這台裝置。</p>
    </main>
  );
}
