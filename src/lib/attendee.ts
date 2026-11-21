// 出席名單的純函式：命名、person 聚合、三來源統計（AC-12 的計算核心）
import type { Attendee, AttendeeCategory } from './types';

export function attendeeName(attendee: Attendee): string {
  return attendee.identities?.persons.name ?? attendee.guest_name ?? '（未命名）';
}

export function attendeeAffiliation(attendee: Attendee): string | null {
  if (attendee.identities?.legal_entities) {
    const title = attendee.identities.title ? `·${attendee.identities.title}` : '';
    return `${attendee.identities.legal_entities.name}${title}`;
  }
  return attendee.guest_org;
}

/** 非會員列的類別標籤：來賓（含身分標籤）／現場報名；會員回 null（改顯示身分種類） */
export function categoryLabel(attendee: Attendee): string | null {
  if (attendee.category === 'member') return null;
  if (attendee.category === 'walkin') return '現場報名';
  return attendee.guest_tag ? `來賓·${attendee.guest_tag}` : '來賓';
}

export interface PersonGroup {
  /** person id 或（來賓）attendee id */
  key: string;
  name: string;
  mobile: string | null;
  attendees: Attendee[];
}

/** 報到卡聚合：同一自然人的多個身分列合成一張卡（雙身分一鍵全領的基礎） */
export function groupByPerson(attendees: Attendee[]): PersonGroup[] {
  const groups = new Map<string, PersonGroup>();
  for (const attendee of attendees) {
    if (attendee.removed_at) continue;
    const person = attendee.identities?.persons;
    const key = person ? `p:${person.id}` : `a:${attendee.id}`;
    const existing = groups.get(key);
    if (existing) {
      groups.set(key, { ...existing, attendees: [...existing.attendees, attendee] });
    } else {
      groups.set(key, {
        key,
        name: attendeeName(attendee),
        mobile: person?.mobile ?? null,
        attendees: [attendee],
      });
    }
  }
  return [...groups.values()];
}

export interface AttendanceStats {
  byCategory: Record<AttendeeCategory, { total: number; checkedIn: number }>;
  total: number;
  checkedIn: number;
}

/** 三來源各自小計＋單一總數（AC-12：總數必等於小計之和） */
export function attendanceStats(attendees: Attendee[]): AttendanceStats {
  const byCategory: AttendanceStats['byCategory'] = {
    member: { total: 0, checkedIn: 0 },
    guest: { total: 0, checkedIn: 0 },
    walkin: { total: 0, checkedIn: 0 },
  };
  for (const attendee of attendees) {
    if (attendee.removed_at) continue;
    const bucket = byCategory[attendee.category];
    bucket.total += 1;
    if (attendee.checked_in_at) bucket.checkedIn += 1;
  }
  const total = byCategory.member.total + byCategory.guest.total + byCategory.walkin.total;
  const checkedIn =
    byCategory.member.checkedIn + byCategory.guest.checkedIn + byCategory.walkin.checkedIn;
  return { byCategory, total, checkedIn };
}
