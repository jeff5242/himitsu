// 座位與唱名的純函式：每位來賓佔「1＋攜伴」個座位（與 DB 守衛 table_seats_used 同規則）
import type { Attendee } from './types';

const VEGETARIAN_PATTERN = /素/;

export function seatsOf(attendee: Attendee): number {
  return 1 + (attendee.companions ?? 0);
}

export function seatsUsed(attendees: Attendee[]): number {
  return attendees.filter((a) => !a.removed_at).reduce((sum, a) => sum + seatsOf(a), 0);
}

export function isVegetarian(diet: string | null | undefined): boolean {
  return !!diet && VEGETARIAN_PATTERN.test(diet);
}

/** 給餐廳的素食份數：素食來賓本人＋他的攜伴 */
export function vegetarianSeats(attendees: Attendee[]): number {
  return attendees.filter((a) => !a.removed_at && isVegetarian(a.diet)).reduce((sum, a) => sum + seatsOf(a), 0);
}

/** 唱名名單：有唱名資格者，已報到的依名單順序（序號）排；未報到的另列 */
export function rollCallList(attendees: Attendee[]): { ready: Attendee[]; waiting: Attendee[] } {
  const eligible = attendees
    .filter((a) => !a.removed_at && a.roll_call)
    .sort((x, y) => x.seq_no - y.seq_no);
  return {
    ready: eligible.filter((a) => a.checked_in_at !== null),
    waiting: eligible.filter((a) => a.checked_in_at === null),
  };
}
