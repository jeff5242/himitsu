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
