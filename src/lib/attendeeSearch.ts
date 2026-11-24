// 名單搜尋：名單上看得到的每個欄位都能搜（姓名、單位、職稱、身分、會員編號、序號、
// 手機、葷素、攜伴、唱名、桌號、報到、回覆狀態）。空白分隔多個關鍵字＝全部都要符合。
import { attendeeAffiliation, attendeeName, categoryLabel } from './attendee';
import { KIND_LABELS, STATUS_LABELS } from './labels';
import { isVegetarian } from './seats';
import type { Attendee, RsvpStatus } from './types';

export const RSVP_LABELS: Record<RsvpStatus, string> = {
  attending: '出席',
  declined: '不克出席',
};
export const RSVP_PENDING_LABEL = '未回覆';

/** 手機至少輸入 3 碼才比對，避免單一數字（序號、桌號）誤中一堆手機 */
const MIN_MOBILE_DIGITS = 3;

const digitsOf = (text: string | null | undefined): string => (text ?? '').replace(/\D/g, '');
const normalize = (text: string): string => text.toLowerCase().replace(/\s+/g, '');

export function attendeeMobiles(attendee: Attendee): string[] {
  return [attendee.guest_mobile, attendee.identities?.persons.mobile]
    .map(digitsOf)
    .filter((digits) => digits.length > 0);
}

/** 可被文字比對的標籤（皆以去空白的小寫比對） */
function searchLabels(attendee: Attendee): string[] {
  const identity = attendee.identities;
  const membership = identity?.memberships[0];
  const companions = attendee.companions ?? 0;
  const labels = [
    attendeeName(attendee),
    attendeeAffiliation(attendee),
    attendee.guest_org,
    attendee.guest_tag,
    attendee.guest_title,
    identity?.title,
    identity ? KIND_LABELS[identity.kind] : null,
    identity ? '會員' : null,
    categoryLabel(attendee),
    membership?.member_no,
    membership ? STATUS_LABELS[membership.status] : null,
    `#${attendee.seq_no}`,
    attendee.diet,
    attendee.diet ? (isVegetarian(attendee.diet) ? '素食' : '葷食') : null,
    companions > 0 ? `攜伴${companions}` : null,
    attendee.roll_call ? '唱名' : null,
    attendee.table_no !== null ? `第${attendee.table_no}桌` : '未排桌',
    attendee.table_no !== null ? `桌${attendee.table_no}` : null,
    attendee.checked_in_at ? '已報到' : '未報到',
    attendee.rsvp_status ? RSVP_LABELS[attendee.rsvp_status] : RSVP_PENDING_LABEL,
    attendee.rsvp_note,
  ];
  return labels.filter((label): label is string => !!label).map(normalize);
}

function matchesTerm(attendee: Attendee, labels: string[], term: string): boolean {
  // 純數字：序號完全相同、手機（≥3 碼）或會員編號包含；不做一般文字比對，避免「1」中一堆人
  if (/^\d+$/.test(term)) {
    if (String(attendee.seq_no) === term) return true;
    const memberNo = attendee.identities?.memberships[0]?.member_no ?? '';
    if (memberNo.includes(term)) return true;
    return term.length >= MIN_MOBILE_DIGITS && attendeeMobiles(attendee).some((m) => m.includes(term));
  }
  // 「0912-345」這種帶連字號的手機也能找
  const termDigits = digitsOf(term);
  if (/^[\d+-]+$/.test(term) && termDigits.length >= MIN_MOBILE_DIGITS
      && attendeeMobiles(attendee).some((m) => m.includes(termDigits))) return true;
  return labels.some((label) => label.includes(term));
}

export function matchesAttendeeQuery(attendee: Attendee, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const labels = searchLabels(attendee);
  return terms.every((term) => matchesTerm(attendee, labels, term));
}

export const ATTENDEE_SEARCH_PLACEHOLDER = '搜尋姓名／單位／職稱／手機／身分／會員編號／序號／桌號（例：第3桌）／素／唱名／已報到…';
