// 貴賓報到畫面的純函式：身分／單位／姓氏篩選面板與計數、祝福詞設定解析
import { attendeeAffiliation, attendeeName } from './attendee';
import { KIND_LABELS } from './labels';
import type { Attendee } from './types';

export const OTHER_ORG = '其他';
export const NO_ORG = '（未填單位）';
export const MIN_GUESTS_FOR_ORG_FACET = 2;
export const MAX_GREETING_PHRASES = 6;
export const MAX_GREETING_LENGTH = 30;
/** 簽名 data URL 長度上限（DB 有同值 CHECK）；縮圖後的 PNG 通常 5～20KB */
export const MAX_SIGNATURE_LENGTH = 200_000;

export const DEFAULT_GREETING_PHRASES: readonly string[] = [
  '感謝一路相挺，來年更上層樓',
  '風調雨順，五穀豐收',
  '身體健康，闔家平安',
];

const COMPOUND_SURNAMES = [
  '歐陽', '司馬', '上官', '諸葛', '東方', '皇甫', '尉遲', '公孫', '慕容', '長孫',
  '夏侯', '軒轅', '令狐', '鍾離', '宇文', '司徒', '張簡', '范姜', '張廖', '簡廖',
];

export interface VipEntry {
  attendee: Attendee;
  name: string;
  org: string;
  tag: string;
  orgBucket: string;
  surname: string;
}

export interface Facet {
  key: string;
  total: number;
  checkedIn: number;
}

export interface VipFacets {
  tags: Facet[];
  orgs: Facet[];
  surnames: Facet[];
  total: number;
  checkedIn: number;
}

export interface VipFilter {
  tag?: string;
  org?: string;
  surname?: string;
  query?: string;
  hideCheckedIn?: boolean;
}

type CheckedInFn = (attendee: Attendee) => boolean;

export function surnameOf(name: string): string {
  const trimmed = name.trim();
  const compound = COMPOUND_SURNAMES.find((s) => trimmed.startsWith(s) && trimmed.length > s.length);
  if (compound) return compound;
  return trimmed.charAt(0).toUpperCase();
}

/** 卡片上的身分：會員看身分種類；來賓看身分標籤；現場報名固定 */
export function vipTagOf(attendee: Attendee): string {
  if (attendee.identities) return KIND_LABELS[attendee.identities.kind];
  if (attendee.category === 'walkin') return '現場報名';
  return attendee.guest_tag ?? '來賓';
}

function countFacets(entries: VipEntry[], keyOf: (e: VipEntry) => string, isCheckedIn: CheckedInFn): Facet[] {
  const map = new Map<string, Facet>();
  for (const entry of entries) {
    const key = keyOf(entry);
    const prev = map.get(key) ?? { key, total: 0, checkedIn: 0 };
    map.set(key, {
      key, total: prev.total + 1, checkedIn: prev.checkedIn + (isCheckedIn(entry.attendee) ? 1 : 0),
    });
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export function buildVipIndex(attendees: Attendee[], isCheckedIn: CheckedInFn):
  { entries: VipEntry[]; facets: VipFacets } {
  const active = attendees.filter((a) => !a.removed_at);
  const orgCounts = new Map<string, number>();
  for (const a of active) {
    const org = attendeeAffiliation(a) ?? NO_ORG;
    orgCounts.set(org, (orgCounts.get(org) ?? 0) + 1);
  }

  const entries = active.map((attendee): VipEntry => {
    const name = attendeeName(attendee);
    const org = attendeeAffiliation(attendee) ?? NO_ORG;
    const isMajorOrg = (orgCounts.get(org) ?? 0) >= MIN_GUESTS_FOR_ORG_FACET;
    return {
      attendee, name, org, tag: vipTagOf(attendee),
      orgBucket: isMajorOrg ? org : OTHER_ORG,
      surname: surnameOf(name),
    };
  });

  const orgs = countFacets(entries, (e) => e.orgBucket, isCheckedIn);
  const facets: VipFacets = {
    tags: countFacets(entries, (e) => e.tag, isCheckedIn),
    // 「其他」固定排最後
    orgs: [...orgs.filter((f) => f.key !== OTHER_ORG), ...orgs.filter((f) => f.key === OTHER_ORG)],
    surnames: countFacets(entries, (e) => e.surname, isCheckedIn),
    total: entries.length,
    checkedIn: entries.filter((e) => isCheckedIn(e.attendee)).length,
  };
  return { entries, facets };
}

export function filterVip(entries: VipEntry[], filter: VipFilter, isCheckedIn: CheckedInFn): VipEntry[] {
  const keyword = (filter.query ?? '').trim().toLowerCase();
  return entries.filter((e) =>
    (!filter.tag || e.tag === filter.tag) &&
    (!filter.org || e.orgBucket === filter.org) &&
    (!filter.surname || e.surname === filter.surname) &&
    (!filter.hideCheckedIn || !isCheckedIn(e.attendee)) &&
    (!keyword || [e.name, e.org, e.tag].some((text) => text.toLowerCase().includes(keyword))));
}

/** 設定中心 vip.greeting_phrases（json 字串陣列）→ 可用祝福詞；格式不對就用預設 */
export function parseGreetingPhrases(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    return [...DEFAULT_GREETING_PHRASES];
  }
  const phrases = (value as string[])
    .map((v) => v.trim())
    .filter((v) => v !== '' && v.length <= MAX_GREETING_LENGTH)
    .slice(0, MAX_GREETING_PHRASES);
  return phrases.length > 0 ? phrases : [...DEFAULT_GREETING_PHRASES];
}
