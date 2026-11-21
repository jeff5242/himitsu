import { describe, expect, test } from 'vitest';
import { PRACTICE_TABLE_LABELS, practiceRoster, withPracticeCheckins } from './practice';
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
