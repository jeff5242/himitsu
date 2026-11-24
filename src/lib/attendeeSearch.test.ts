import { describe, expect, test } from 'vitest';
import { matchesAttendeeQuery } from './attendeeSearch';
import type { Attendee } from './types';

const guest = (overrides: Partial<Attendee> = {}): Attendee => ({
  id: 'a1', event_id: 'e1', seq_no: 12, identity_id: null, guest_name: '陳大明', guest_org: '米屋智農',
  guest_tag: '貴賓', category: 'guest', table_no: 3, source: 'import', checked_in_at: null, removed_at: null,
  identities: null, guest_title: '董事長', guest_mobile: '0912345678', diet: '素', companions: 2, roll_call: true,
  ...overrides,
});

const member = (): Attendee => guest({
  guest_name: null, guest_org: null, guest_tag: null, guest_title: null, guest_mobile: null, category: 'member',
  identity_id: 'i1',
  identities: {
    id: 'i1', kind: 'group_rep', title: '總經理',
    persons: { id: 'p1', name: '林小華', mobile: '0987-654-321' },
    legal_entities: { name: '大橋產銷班' },
    memberships: [{ id: 'm1', member_no: 'A-0042', status: 'active' }],
  },
});

describe('matchesAttendeeQuery', () => {
  test('empty query matches everyone', () => {
    expect(matchesAttendeeQuery(guest(), '   ')).toBe(true);
  });

  test('finds guests by mobile, with or without dashes, partial from 3 digits', () => {
    expect(['0912345678', '0912-345-678', '345678', '678'].map((q) => matchesAttendeeQuery(guest(), q)))
      .toEqual([true, true, true, true]);
    expect(matchesAttendeeQuery(guest(), '0911')).toBe(false);
  });

  test('finds members by their person mobile even when stored with dashes', () => {
    expect(matchesAttendeeQuery(member(), '0987654321')).toBe(true);
    expect(matchesAttendeeQuery(member(), '654-321')).toBe(true);
  });

  test('short numbers match the serial number exactly, not partial mobiles', () => {
    expect(matchesAttendeeQuery(guest(), '12')).toBe(true);
    expect(matchesAttendeeQuery(guest(), '1')).toBe(false);
    expect(matchesAttendeeQuery(guest(), '#12')).toBe(true);
  });

  test('every visible field is searchable', () => {
    const queries = ['陳大明', '米屋', '董事長', '貴賓', '來賓', '素', '素食', '攜伴2', '唱名', '第3桌', '桌3', '未報到', '未回覆'];
    expect(queries.filter((q) => !matchesAttendeeQuery(guest(), q))).toEqual([]);
  });

  test('member fields: name, legal entity, title, kind, member number, status', () => {
    const queries = ['林小華', '大橋產銷班', '總經理', '團體代表', '會員', 'a-0042'];
    expect(queries.filter((q) => !matchesAttendeeQuery(member(), q))).toEqual([]);
  });

  test('status labels follow the data', () => {
    const checkedIn = guest({ checked_in_at: '2027-01-08T03:00:00Z', rsvp_status: 'declined', table_no: null });
    expect(['已報到', '不克出席', '未排桌'].every((q) => matchesAttendeeQuery(checkedIn, q))).toBe(true);
    expect(matchesAttendeeQuery(checkedIn, '未報到')).toBe(false);
    expect(matchesAttendeeQuery(guest({ diet: '葷' }), '素')).toBe(false);
  });

  test('space-separated terms must all match', () => {
    expect(matchesAttendeeQuery(guest(), '素 第3桌')).toBe(true);
    expect(matchesAttendeeQuery(guest(), '素 第4桌')).toBe(false);
  });
});
