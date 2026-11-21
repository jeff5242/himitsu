import { describe, expect, test } from 'vitest';
import {
  PRACTICE_PICKUP_ITEMS, PRACTICE_TABLE_LABELS, addPracticeWalkin, practicePickupItems, practiceRoster,
  togglePracticePickup, withPracticeCheckins,
} from './practice';
import type { Attendee } from './types';

const realGuest = (id: string, checkedIn: string | null = null): Attendee => ({
  id, event_id: 'ev-1', seq_no: 1, identity_id: null, guest_name: '真實來賓', guest_org: null, guest_tag: '農民',
  category: 'guest', table_no: 3, source: 'import', checked_in_at: checkedIn, removed_at: null, identities: null,
});

describe('practiceRoster', () => {
  test('uses the real roster (read-only) when the event already has attendees', () => {
    const real = [realGuest('a1')];
    const result = practiceRoster(real, 'ev-1');
    expect(result.isSample).toBe(false);
    expect(result.attendees.map((a) => a.id)).toEqual(['a1']);
  });

  test('ignores removed attendees when deciding whether the roster is empty', () => {
    const result = practiceRoster([{ ...realGuest('a1'), removed_at: '2026-11-01T00:00:00Z' }], 'ev-1');
    expect(result.isSample).toBe(true);
  });

  test('falls back to a sample roster with 貴賓 and 農民, some seated and one unseated', () => {
    const { attendees, isSample } = practiceRoster([], 'ev-1');
    expect(isSample).toBe(true);
    expect(attendees.length).toBeGreaterThanOrEqual(8);
    expect(new Set(attendees.map((a) => a.guest_tag))).toEqual(new Set(['貴賓', '農民']));
    expect(attendees.some((a) => a.table_no === null)).toBe(true);
    expect(attendees.every((a) => a.event_id === 'ev-1' && a.checked_in_at === null)).toBe(true);
    expect(new Set(attendees.map((a) => a.id)).size).toBe(attendees.length);
  });

  test('labels table 1 as 主桌 for the sample roster', () => {
    expect(PRACTICE_TABLE_LABELS.get(1)).toBe('主桌');
  });
});

describe('withPracticeCheckins', () => {
  test('replaces real check-in state with the local practice state', () => {
    const roster = [realGuest('a1', '2026-12-01T10:00:00Z'), realGuest('a2')];
    const result = withPracticeCheckins(roster, new Map([['a2', '2026-11-21T10:00:00Z']]));
    expect(result.map((a) => a.checked_in_at)).toEqual([null, '2026-11-21T10:00:00Z']);
  });

  test('does not mutate the input roster', () => {
    const roster = [realGuest('a1')];
    withPracticeCheckins(roster, new Map([['a1', '2026-11-21T10:00:00Z']]));
    expect(roster[0].checked_in_at).toBeNull();
  });
});

describe('practicePickupItems', () => {
  test('uses the event\'s real pickup items when defined', () => {
    const real = [{ key: 'p1', label: '名牌' }];
    expect(practicePickupItems(real)).toEqual(real);
  });

  test('falls back to 伴手禮 and 摸彩券 when the event has none', () => {
    expect(practicePickupItems([]).map((i) => i.label)).toEqual(['伴手禮', '摸彩券']);
    expect(PRACTICE_PICKUP_ITEMS.length).toBe(2);
  });
});

describe('togglePracticePickup', () => {
  test('adds then removes the same attendee + item, returning new sets', () => {
    const empty: ReadonlySet<string> = new Set();
    const issued = togglePracticePickup(empty, 'a1', 'gift');
    expect([...issued]).toEqual(['a1:gift']);
    expect(empty.size).toBe(0);
    expect([...togglePracticePickup(issued, 'a1', 'gift')]).toEqual([]);
  });
});

describe('addPracticeWalkin', () => {
  test('appends a 現場報名 row with the next sequence number and no table', () => {
    const roster = practiceRoster([], 'ev-1').attendees;
    const next = addPracticeWalkin(roster, '  路過的阿伯 ', ' 二林鎮 ', 'ev-1');
    const added = next[next.length - 1];
    expect(next.length).toBe(roster.length + 1);
    expect(added).toMatchObject({
      guest_name: '路過的阿伯', guest_org: '二林鎮', category: 'walkin', table_no: null,
      seq_no: roster.length + 1, event_id: 'ev-1', checked_in_at: null,
    });
    expect(roster.length).toBe(10);
  });

  test('stores an empty 單位 as null and gives each walk-in a unique id', () => {
    const once = addPracticeWalkin([], '甲', '', 'ev-1');
    const twice = addPracticeWalkin(once, '乙', '', 'ev-1');
    expect(twice[0].guest_org).toBeNull();
    expect(new Set(twice.map((a) => a.id)).size).toBe(2);
  });
});
