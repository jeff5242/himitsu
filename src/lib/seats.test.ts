import { describe, expect, test } from 'vitest';
import { isVegetarian, rollCallList, seatsOf, seatsUsed, vegetarianSeats } from './seats';
import type { Attendee } from './types';

let seq = 0;
const a = (overrides: Partial<Attendee>): Attendee => {
  seq += 1;
  return {
    id: `a${seq}`, event_id: 'e1', seq_no: seq, identity_id: null, guest_name: `來賓${seq}`, guest_org: null,
    guest_tag: null, category: 'guest', table_no: 1, source: 'import', checked_in_at: null, removed_at: null,
    identities: null, ...overrides,
  };
};

describe('seats', () => {
  test('each guest takes 1 seat plus companions; missing companions counts as 0', () => {
    expect(seatsOf(a({ companions: 2 }))).toBe(3);
    expect(seatsOf(a({}))).toBe(1);
  });

  test('sums seats of non-removed attendees', () => {
    expect(seatsUsed([a({ companions: 2 }), a({}), a({ companions: 5, removed_at: '2026-12-01T00:00:00Z' })])).toBe(4);
  });
});

describe('vegetarian', () => {
  test('recognises 素、蛋奶素、全素、鍋邊素 but not 葷', () => {
    expect(['素', '蛋奶素', '全素', '鍋邊素', '葷', null].map((diet) => isVegetarian(diet))).toEqual(
      [true, true, true, true, false, false]);
  });

  test('counts vegetarian seats including companions of vegetarian guests', () => {
    expect(vegetarianSeats([a({ diet: '素', companions: 1 }), a({ diet: '葷' }), a({ diet: '蛋奶素' })])).toBe(3);
  });
});

describe('rollCallList', () => {
  test('lists checked-in guests with 唱名資格 in roster order, and counts the waiting ones', () => {
    const list = rollCallList([
      a({ seq_no: 3, roll_call: true, checked_in_at: '2026-12-20T11:05:00Z', guest_name: '三號' }),
      a({ seq_no: 1, roll_call: true, checked_in_at: '2026-12-20T11:20:00Z', guest_name: '一號' }),
      a({ seq_no: 2, roll_call: true, guest_name: '二號（未到）' }),
      a({ seq_no: 4, roll_call: false, checked_in_at: '2026-12-20T11:00:00Z', guest_name: '四號（不唱名）' }),
      a({ seq_no: 5, roll_call: true, checked_in_at: '2026-12-20T11:00:00Z', removed_at: '2026-12-01T00:00:00Z' }),
    ]);
    expect(list.ready.map((x) => x.guest_name)).toEqual(['一號', '三號']);
    expect(list.waiting.map((x) => x.guest_name)).toEqual(['二號（未到）']);
  });
});
