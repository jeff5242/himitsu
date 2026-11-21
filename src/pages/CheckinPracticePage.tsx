import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useOrg } from '../hooks/useOrg';
import OrgLayout from '../components/OrgLayout';
import CheckinDesk from '../components/event/CheckinDesk';
import type { DeskPickupItem } from '../components/event/CheckinDesk';
import {
  addPracticeWalkin, practicePickupItems, practiceRoster, togglePracticePickup, withPracticeCheckins,
} from '../lib/practice';
import type { PersonGroup } from '../lib/attendee';
import type { Attendee, OrgEvent } from '../lib/types';

const ATTENDEE_SELECT =
  '*, identities(id, kind, title, persons(id, name, mobile), legal_entities(name), memberships(id, member_no, status))';
const NO_ITEMS: ReadonlySet<string> = new Set();

/** 報到台練習：同一個報到台畫面，所有動作只存在本機記憶體；籌備中也能用 */
export default function CheckinPracticePage() {
  const { slug, eventId } = useParams();
  const { org, myRole, isLoading, error } = useOrg(slug);
  const [event, setEvent] = useState<OrgEvent | null>(null);
  const [realAttendees, setRealAttendees] = useState<Attendee[]>([]);
  const [realItems, setRealItems] = useState<DeskPickupItem[]>([]);
  const [checkins, setCheckins] = useState<ReadonlyMap<string, string>>(new Map());
  const [issued, setIssued] = useState<ReadonlySet<string>>(new Set());
  const [walkins, setWalkins] = useState<Attendee[]>([]);

  // 只讀：活動、名單、領取項目
  const load = useCallback(async () => {
    if (!org || !eventId) return;
    const [{ data: eventRow }, { data: attendeeRows }, { data: itemRows }] = await Promise.all([
      supabase.from('events').select('*').eq('id', eventId).maybeSingle(),
      supabase.from('event_attendees').select(ATTENDEE_SELECT).eq('event_id', eventId).order('seq_no'),
      supabase.from('pickup_items').select('key, label').eq('event_id', eventId).order('sort'),
    ]);
    if (eventRow) setEvent(eventRow as OrgEvent);
    if (attendeeRows) setRealAttendees(attendeeRows as Attendee[]);
    if (itemRows) setRealItems(itemRows as DeskPickupItem[]);
  }, [org, eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const base = useMemo(() => practiceRoster(realAttendees, eventId ?? ''), [realAttendees, eventId]);
  const roster = useMemo(
    () => withPracticeCheckins([...base.attendees, ...walkins], checkins), [base, walkins, checkins]);
  const items = useMemo(() => practicePickupItems(realItems), [realItems]);

  if (isLoading) return <p className="p-8 text-stone-400">載入中…</p>;
  if (error || !org) return <p className="p-8 text-red-600">{error ?? '找不到協會'}</p>;
  if (!event) return <p className="p-8 text-stone-400">活動載入中…</p>;

  const checkInGroup = async (group: PersonGroup): Promise<string | null> => {
    const now = new Date().toISOString();
    const next = new Map(checkins);
    for (const a of group.attendees) if (!next.has(a.id)) next.set(a.id, now);
    setCheckins(next);
    return null;
  };

  const undo = async (attendee: Attendee): Promise<string | null> => {
    const next = new Map(checkins);
    next.delete(attendee.id);
    setCheckins(next);
    return null;
  };

  const togglePickup = async (attendee: Attendee, itemKey: string): Promise<string | null> => {
    setIssued(togglePracticePickup(issued, attendee.id, itemKey));
    return null;
  };

  const addWalkin = async (name: string, company: string): Promise<string | null> => {
    if (name.trim() === '') return '請輸入姓名';
    const all = addPracticeWalkin([...base.attendees, ...walkins], name, company, event.id);
    setWalkins(all.slice(base.attendees.length));
    return null;
  };

  const reset = () => {
    setCheckins(new Map());
    setIssued(new Set());
    setWalkins([]);
  };

  const checkedCount = roster.filter((a) => a.checked_in_at !== null).length;

  return (
    <OrgLayout org={org} myRole={myRole}>
      <div className="flex flex-wrap items-center gap-3">
        <Link to={`/o/${org.slug}/events/${event.id}`} className="text-sm text-stone-400 hover:text-stone-600">← 返回活動</Link>
        <h2 className="text-lg font-bold">報到台練習</h2>
        <span className="text-sm text-stone-500">{event.name}</span>
        <span className="ml-auto rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-800 tabular-nums">
          已報到 {checkedCount}／{roster.length}
        </span>
      </div>
      <CheckinDesk attendees={roster} items={items} issuedPickups={issued}
        unpaidMemberships={NO_ITEMS} requiresPaid={false} queuedIds={NO_ITEMS}
        isOnline pendingCount={0} canCheckin onFlush={() => undefined}
        onCheckInGroup={checkInGroup} onUndo={undo} onTogglePickup={togglePickup} onAddWalkin={addWalkin}
        banner={(
          <div className="rounded-lg border-2 border-dashed border-sky-400 bg-sky-50 px-3 py-2 text-sky-900 flex flex-wrap items-center gap-3 text-sm">
            <p className="font-bold">🧪 練習模式：報到、發放、現場報名都只存在這台裝置，不會寫入名單。</p>
            {base.isSample && <p>目前名單是空的，先用 10 位範例來賓練習。</p>}
            {realItems.length === 0 && <p>領取項目先用「伴手禮」「摸彩券」示範。</p>}
            <button type="button" onClick={reset}
              className="ml-auto rounded-lg border border-sky-400 bg-white px-3 py-1.5 font-bold">↺ 重新練習</button>
          </div>
        )} />
    </OrgLayout>
  );
}
