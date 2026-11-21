// 報到練習模式：不寫入任何資料，活動還在「籌備中」也能讓工作人員演練。
// 名單有資料就唯讀沿用；名單是空的就用範例名單。報到狀態只存在本機記憶體。
import type { Attendee } from './types';

interface SampleGuest {
  name: string;
  org: string | null;
  tag: '貴賓' | '農民';
  tableNo: number | null;
}

const SAMPLE_GUESTS: readonly SampleGuest[] = [
  { name: '王小明', org: '米屋智農', tag: '貴賓', tableNo: 1 },
  { name: '李美華', org: '米屋智農', tag: '貴賓', tableNo: 1 },
  { name: '吳建宏', org: '彰化縣農會', tag: '貴賓', tableNo: 1 },
  { name: '陳大華', org: '二林鎮', tag: '農民', tableNo: 2 },
  { name: '陳阿土', org: '二林鎮', tag: '農民', tableNo: 2 },
  { name: '蔡明哲', org: '二林鎮', tag: '農民', tableNo: 2 },
  { name: '林小美', org: '芳苑鄉', tag: '農民', tableNo: 3 },
  { name: '張志強', org: '芳苑鄉', tag: '農民', tableNo: 3 },
  { name: '劉淑芬', org: '竹塘鄉', tag: '農民', tableNo: 4 },
  { name: '黃秀英', org: '大城鄉', tag: '農民', tableNo: null },
];

/** 範例名單的桌名（歡迎卡顯示「第 1 桌・主桌」用） */
export const PRACTICE_TABLE_LABELS: ReadonlyMap<number, string> = new Map([[1, '主桌']]);

function buildSampleRoster(eventId: string): Attendee[] {
  return SAMPLE_GUESTS.map((g, index) => ({
    id: `practice-${index + 1}`,
    event_id: eventId,
    seq_no: index + 1,
    identity_id: null,
    guest_name: g.name,
    guest_org: g.org,
    guest_tag: g.tag,
    category: 'guest',
    table_no: g.tableNo,
    source: 'manual',
    checked_in_at: null,
    removed_at: null,
    identities: null,
  }));
}

export function practiceRoster(real: Attendee[], eventId: string): { attendees: Attendee[]; isSample: boolean } {
  const active = real.filter((a) => !a.removed_at);
  return active.length > 0
    ? { attendees: active, isSample: false }
    : { attendees: buildSampleRoster(eventId), isSample: true };
}

/** 練習的報到狀態取代真實狀態：練習時每個人都從「未報到」開始 */
export function withPracticeCheckins(roster: Attendee[], checkins: ReadonlyMap<string, string>): Attendee[] {
  return roster.map((a) => ({ ...a, checked_in_at: checkins.get(a.id) ?? null }));
}

export interface PracticePickupItem {
  key: string;
  label: string;
}

/** 範例領取項目：活動還沒設定領取項目時，練習發放用 */
export const PRACTICE_PICKUP_ITEMS: readonly PracticePickupItem[] = [
  { key: 'practice-gift', label: '伴手禮' },
  { key: 'practice-lottery', label: '摸彩券' },
];

export function practicePickupItems<T extends PracticePickupItem>(real: T[]): PracticePickupItem[] {
  return real.length > 0 ? real : [...PRACTICE_PICKUP_ITEMS];
}

/** 發放／取消發放（鍵＝attendeeId:itemKey），回傳新集合 */
export function togglePracticePickup(issued: ReadonlySet<string>, attendeeId: string, itemKey: string): Set<string> {
  const key = `${attendeeId}:${itemKey}`;
  const next = new Set(issued);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** 練習用現場報名：接在名單最後，序號＝最大序號＋1，未排桌 */
export function addPracticeWalkin(roster: Attendee[], name: string, org: string, eventId: string): Attendee[] {
  const seq = roster.reduce((max, a) => Math.max(max, a.seq_no), 0) + 1;
  const walkin: Attendee = {
    id: `practice-walkin-${seq}`,
    event_id: eventId,
    seq_no: seq,
    identity_id: null,
    guest_name: name.trim(),
    guest_org: org.trim() || null,
    guest_tag: null,
    category: 'walkin',
    table_no: null,
    source: 'walkin',
    checked_in_at: null,
    removed_at: null,
    identities: null,
  };
  return [...roster, walkin];
}
