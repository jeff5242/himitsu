import { describe, expect, test } from 'vitest';
import { attendanceStats, categoryLabel, groupByPerson } from './attendee';
import type { Attendee } from './types';

function makeAttendee(overrides: Partial<Attendee>): Attendee {
  return {
    id: crypto.randomUUID(),
    event_id: 'e1',
    seq_no: 1,
    identity_id: null,
    guest_name: null,
    guest_org: null,
    guest_tag: null,
    category: 'member',
    table_no: null,
    source: 'import',
    checked_in_at: null,
    removed_at: null,
    identities: null,
    ...overrides,
  };
}

function memberIdentity(personId: string, name: string): Attendee['identities'] {
  return {
    id: crypto.randomUUID(),
    kind: 'individual_member',
    title: null,
    persons: { id: personId, name, mobile: '0911' },
    legal_entities: null,
    memberships: [],
  };
}

describe('groupByPerson（AC-9 雙身分聚合）', () => {
  test('merges two attendee rows of the same person into one card', () => {
    // Arrange：洪柏聲型——同一 person 兩個身分
    const rows = [
      makeAttendee({ seq_no: 1, identity_id: 'i1', identities: memberIdentity('p1', '洪柏聲') }),
      makeAttendee({ seq_no: 2, identity_id: 'i2', identities: memberIdentity('p1', '洪柏聲') }),
      makeAttendee({ seq_no: 3, category: 'guest', guest_name: '王來賓' }),
    ];

    // Act
    const groups = groupByPerson(rows);

    // Assert
    expect(groups).toHaveLength(2);
    const hong = groups.find((g) => g.name === '洪柏聲');
    expect(hong?.attendees).toHaveLength(2);
  });

  test('excludes removed attendees from cards', () => {
    const rows = [
      makeAttendee({ seq_no: 1, category: 'guest', guest_name: 'A', removed_at: '2026-09-06' }),
      makeAttendee({ seq_no: 2, category: 'guest', guest_name: 'B' }),
    ];
    expect(groupByPerson(rows)).toHaveLength(1);
  });
});

describe('attendanceStats（AC-12 三來源一個總數）', () => {
  test('total always equals the sum of the three category subtotals', () => {
    const rows = [
      makeAttendee({ identity_id: 'i1', identities: memberIdentity('p1', '甲'), checked_in_at: 't' }),
      makeAttendee({ identity_id: 'i2', identities: memberIdentity('p2', '乙') }),
      makeAttendee({ category: 'guest', guest_name: '丙', checked_in_at: 't' }),
      makeAttendee({ category: 'walkin', guest_name: '丁', checked_in_at: 't' }),
      makeAttendee({ category: 'member', identity_id: 'i3', identities: memberIdentity('p3', '戊'), removed_at: 't' }),
    ];

    const stats = attendanceStats(rows);

    expect(stats.total).toBe(4); // 除名者不計
    expect(stats.checkedIn).toBe(3);
    expect(stats.byCategory.member.checkedIn + stats.byCategory.guest.checkedIn + stats.byCategory.walkin.checkedIn)
      .toBe(stats.checkedIn);
    expect(stats.byCategory.member.total + stats.byCategory.guest.total + stats.byCategory.walkin.total)
      .toBe(stats.total);
  });
});

describe('categoryLabel', () => {
  test('shows the guest tag after 來賓 when present', () => {
    expect(categoryLabel(makeAttendee({ category: 'guest', guest_name: '王小明', guest_tag: '貴賓' }))).toBe('來賓·貴賓');
  });

  test('falls back to 來賓 / 現場報名 without a tag', () => {
    expect(categoryLabel(makeAttendee({ category: 'guest', guest_name: '甲' }))).toBe('來賓');
    expect(categoryLabel(makeAttendee({ category: 'walkin', guest_name: '乙' }))).toBe('現場報名');
  });

  test('returns null for members (they show their identity kind instead)', () => {
    expect(categoryLabel(makeAttendee({ category: 'member', identity_id: 'i1' }))).toBeNull();
  });
});
