import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useOrg } from '../hooks/useOrg';
import { useCheckinQueue } from '../hooks/useCheckinQueue';
import { buildVipIndex, filterVip, parseGreetingPhrases } from '../lib/vip';
import { PRACTICE_TABLE_LABELS, practiceRoster, withPracticeCheckins } from '../lib/practice';
import type { VipEntry, VipFilter } from '../lib/vip';
import FacetRow from '../components/vip/FacetRow';
import WelcomeCard from '../components/vip/WelcomeCard';
import type { GreetingResult } from '../components/vip/WelcomeCard';
import type { Attendee, OrgEvent } from '../lib/types';

const ATTENDEE_SELECT =
  '*, identities(id, kind, title, persons(id, name, mobile), legal_entities(name), memberships(id, member_no, status))';
const REFRESH_MS = 20_000;

const CHECKIN_ERRORS: Record<string, string> = {
  forbidden: '這個帳號沒有報到權限',
  event_not_open: '活動尚未開放報到',
  removed: '此人已從名單除名',
  not_found: '找不到這筆名單',
};

async function submitGreetingLive(attendeeId: string, phrase: string | null, signature: string | null):
  Promise<GreetingResult> {
  const { data, error } = await supabase.rpc('submit_greeting', {
    p_attendee: attendeeId, p_greeting: phrase, p_signature: signature,
  });
  const result = data as GreetingResult | null;
  return error || !result ? { ok: false } : result;
}

const submitGreetingPractice = async (): Promise<GreetingResult> => ({ ok: true });

interface VipCheckinPageProps {
  /** practice＝報到練習：不寫入任何資料、不受活動狀態限制、名單空白時用範例名單 */
  mode?: 'live' | 'practice';
}

/** 貴賓報到畫面（iPad 用）：身分／單位／姓氏篩選、大卡片、報到後歡迎卡＋祝福簽名 */
export default function VipCheckinPage({ mode = 'live' }: VipCheckinPageProps) {
  const isPractice = mode === 'practice';
  const { slug, eventId } = useParams();
  const { org, can, isLoading } = useOrg(slug);
  const [event, setEvent] = useState<OrgEvent | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [tableLabels, setTableLabels] = useState<Map<number, string>>(new Map());
  const [phrases, setPhrases] = useState<string[]>(parseGreetingPhrases(null));
  const [filter, setFilter] = useState<VipFilter>({});
  const [welcomeId, setWelcomeId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [practiceCheckins, setPracticeCheckins] = useState<ReadonlyMap<string, string>>(new Map());

  const reload = useCallback(async () => {
    if (!org || !eventId) return;
    const [{ data: eventRow }, { data: attendeeRows }, { data: tableRows }, { data: phraseValue }] =
      await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).maybeSingle(),
        supabase.from('event_attendees').select(ATTENDEE_SELECT).eq('event_id', eventId).order('seq_no'),
        supabase.from('event_tables').select('table_no, label').eq('event_id', eventId),
        supabase.rpc('get_setting', { p_org: org.id, p_key: 'vip.greeting_phrases' }),
      ]);
    // 離線時查詢失敗——保留手上的名單，不清空
    if (eventRow) setEvent(eventRow as OrgEvent);
    if (attendeeRows) setAttendees(attendeeRows as Attendee[]);
    if (tableRows) {
      setTableLabels(new Map((tableRows as { table_no: number; label: string | null }[])
        .filter((t) => t.label).map((t) => [t.table_no, t.label as string])));
    }
    if (phraseValue !== null) setPhrases(parseGreetingPhrases(phraseValue));
  }, [org, eventId]);

  const { isOnline, queuedIds, pendingCount, checkIn } = useCheckinQueue(eventId ?? '', reload);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 歡迎卡開著時不刷新，避免畫面跳動（TADA 實戰作法）
  useEffect(() => {
    if (welcomeId) return undefined;
    const timer = setInterval(() => void reload(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload, welcomeId]);

  const practice = useMemo(() => practiceRoster(attendees, eventId ?? ''), [attendees, eventId]);
  const roster = useMemo(
    () => (isPractice ? withPracticeCheckins(practice.attendees, practiceCheckins) : attendees),
    [isPractice, practice, practiceCheckins, attendees]);
  const labels = isPractice && practice.isSample ? PRACTICE_TABLE_LABELS : tableLabels;
  const isCheckedIn = useCallback(
    (a: Attendee) => a.checked_in_at !== null || (!isPractice && queuedIds.has(a.id)), [queuedIds, isPractice]);
  const { entries, facets } = useMemo(() => buildVipIndex(roster, isCheckedIn), [roster, isCheckedIn]);
  const visible = useMemo(() => filterVip(entries, filter, isCheckedIn), [entries, filter, isCheckedIn]);
  const welcomeEntry = entries.find((e) => e.attendee.id === welcomeId) ?? null;

  if (isLoading || !org) return <main className="min-h-screen bg-stone-100" />;
  if (!event) return <p className="p-8 text-stone-400">活動載入中…</p>;

  const canCheckin = isPractice || can('checkin.write');
  const isOpen = isPractice || event.status === 'open';

  const handleCheckIn = async (entry: VipEntry) => {
    setNotice(null);
    if (isPractice) {
      setPracticeCheckins(new Map(practiceCheckins).set(entry.attendee.id, new Date().toISOString()));
      setWelcomeId(entry.attendee.id);
      return;
    }
    const result = await checkIn(entry.attendee.id, 'vip');
    if (!result.ok) { setNotice(CHECKIN_ERRORS[result.error ?? ''] ?? `報到失敗：${result.error}`); return; }
    setWelcomeId(entry.attendee.id);
    if (!result.queued) await reload();
  };

  const patch = (next: Partial<VipFilter>) => setFilter({ ...filter, ...next });

  return (
    <main className="min-h-screen bg-stone-100 pb-10">
      <header className="sticky top-0 z-10 bg-stone-900 text-stone-50 px-4 py-3 flex flex-wrap items-center gap-3">
        <Link to={`/o/${org.slug}/events/${event.id}`} className="text-sm text-stone-400 hover:text-white">← 返回</Link>
        <div>
          <p className="text-xs text-stone-400">{event.name}</p>
          <h1 className="text-2xl font-black tracking-[0.4em] text-amber-300">{isPractice ? '報到練習' : '貴賓報到'}</h1>
        </div>
        <span className="ml-auto rounded-full bg-amber-400 px-4 py-1.5 text-lg font-black text-stone-900 tabular-nums">
          已報到 {facets.checkedIn}／{facets.total}
        </span>
      </header>

      <div className="mx-auto max-w-6xl px-4 pt-4 space-y-3">
        {isPractice && (
          <div className="rounded-lg border-2 border-dashed border-sky-400 bg-sky-50 px-3 py-2 text-sky-900 flex flex-wrap items-center gap-3">
            <p className="font-bold">🧪 練習模式：報到、祝福、簽名都只存在這台裝置，不會寫入名單，也不會出現在祝福牆。</p>
            {practice.isSample && <p>目前名單是空的，先用 10 位範例來賓練習。</p>}
            <button type="button" onClick={() => { setPracticeCheckins(new Map()); setWelcomeId(null); }}
              className="ml-auto rounded-lg border border-sky-400 bg-white px-3 py-1.5 font-bold">↺ 重新練習</button>
          </div>
        )}
        {!isPractice && !isOnline && (
          <p className="rounded-lg bg-amber-50 border border-amber-300 px-3 py-2 font-bold text-amber-800">
            📴 離線模式——可照常報到（{pendingCount} 筆待同步），網路恢復後自動補送。離線期間請勿重新整理頁面。
          </p>
        )}
        {!isPractice && !isOpen && (
          <p className="rounded-lg bg-stone-200 px-3 py-2 text-stone-600">
            活動目前不是「報到開放」狀態，只能瀏覽名單。請主辦在活動頁按「開放報到」。
          </p>
        )}
        {!isPractice && !canCheckin && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">這個帳號沒有報到權限，只能瀏覽。</p>}
        {notice && <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-red-700">{notice}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <input value={filter.query ?? ''} onChange={(e) => patch({ query: e.target.value })}
            placeholder="🔍 搜尋姓名／單位／身分" aria-label="搜尋貴賓"
            className="flex-1 min-w-60 rounded-xl border border-stone-300 px-4 py-3 text-lg" />
          <label className="inline-flex items-center gap-2 text-base">
            <input type="checkbox" checked={filter.hideCheckedIn ?? false}
              onChange={(e) => patch({ hideCheckedIn: e.target.checked })} className="h-5 w-5" />
            隱藏已報到
          </label>
        </div>
        <FacetRow label="身分" facets={facets.tags} selected={filter.tag} onSelect={(tag) => patch({ tag })} />
        <FacetRow label="單位" facets={facets.orgs} selected={filter.org} onSelect={(o) => patch({ org: o })} />
        <FacetRow label="姓氏" facets={facets.surnames} selected={filter.surname}
          onSelect={(surname) => patch({ surname })} />

        {visible.length === 0 && <p className="py-10 text-center text-stone-400">沒有符合的貴賓。</p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((entry) => (
            <VipCard key={entry.attendee.id} entry={entry} isQueued={!isPractice && queuedIds.has(entry.attendee.id)}
              canCheckin={canCheckin && isOpen} onCheckIn={() => void handleCheckIn(entry)}
              onReopen={() => setWelcomeId(entry.attendee.id)} />
          ))}
        </div>
      </div>

      {welcomeEntry && (
        <WelcomeCard entry={welcomeEntry} phrases={phrases}
          tableLabel={welcomeEntry.attendee.table_no !== null ? labels.get(welcomeEntry.attendee.table_no) ?? null : null}
          isQueued={!isPractice && (queuedIds.has(welcomeEntry.attendee.id) || !isOnline)}
          onSubmitGreeting={isPractice ? submitGreetingPractice : submitGreetingLive}
          onClose={() => { setWelcomeId(null); if (!isPractice) void reload(); }} />
      )}
    </main>
  );
}

interface VipCardProps {
  entry: VipEntry;
  isQueued: boolean;
  canCheckin: boolean;
  onCheckIn: () => void;
  onReopen: () => void;
}

function VipCard({ entry, isQueued, canCheckin, onCheckIn, onReopen }: VipCardProps) {
  const { attendee } = entry;
  const done = attendee.checked_in_at !== null || isQueued;
  return (
    <article className={`rounded-2xl border-2 bg-white p-4 flex flex-col gap-2 ${done ? 'border-green-600' : 'border-stone-200'}`}>
      <div className="flex items-start gap-2">
        <p className="text-2xl font-black text-stone-900">{entry.name}</p>
        <span className="ml-auto shrink-0 rounded-full bg-amber-50 border border-amber-300 px-2.5 py-0.5 text-sm text-amber-800">
          {entry.tag}
        </span>
      </div>
      <p className="text-stone-500 min-h-6">{attendee.identities?.title ? `${attendee.identities.title}・` : ''}{entry.org}</p>
      <p className="text-lg">🍽️ {attendee.table_no !== null ? `第 ${attendee.table_no} 桌` : '未排桌'}</p>
      {done ? (
        <button type="button" onClick={onReopen}
          className="mt-auto rounded-xl bg-green-50 px-4 py-3 text-lg font-bold text-green-700">
          {isQueued ? '⏳ 已報到（待同步）' : `✓ 已報到 ${new Date(attendee.checked_in_at as string)
            .toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`}
        </button>
      ) : (
        <button type="button" onClick={onCheckIn} disabled={!canCheckin}
          className="mt-auto rounded-xl bg-green-700 px-4 py-3 text-xl font-bold text-white hover:bg-green-800 disabled:opacity-40">
          貴賓報到
        </button>
      )}
    </article>
  );
}
