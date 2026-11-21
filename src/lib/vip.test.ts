import { describe, expect, test } from 'vitest';
import {
  DEFAULT_GREETING_PHRASES, OTHER_ORG, buildVipIndex, filterVip, parseGreetingPhrases, surnameOf,
} from './vip';
import type { Attendee } from './types';

let seq = 0;
function guest(name: string, overrides: Partial<Attendee> = {}): Attendee {
  seq += 1;
  return {
    id: `a${seq}`, event_id: 'e1', seq_no: seq, identity_id: null,
    guest_name: name, guest_org: null, guest_tag: null, category: 'guest',
    table_no: null, source: 'import', checked_in_at: null, removed_at: null, identities: null,
    ...overrides,
  };
}

const checkedIn = (a: Attendee) => a.checked_in_at !== null;

describe('surnameOf', () => {
  test('takes the first character for single surnames', () => {
    expect(surnameOf('王小明')).toBe('王');
  });

  test('keeps Taiwanese compound surnames together', () => {
    expect(surnameOf('歐陽娜娜')).toBe('歐陽');
    expect(surnameOf('張簡美玲')).toBe('張簡');
    expect(surnameOf('范姜大同')).toBe('范姜');
  });

  test('uppercases the first letter of latin names and trims spaces', () => {
    expect(surnameOf('  jeff fang')).toBe('J');
  });
});

describe('buildVipIndex facets', () => {
  const attendees = [
    guest('王小明', { guest_tag: '貴賓', guest_org: '米屋智農', checked_in_at: '2026-12-20T10:00:00Z' }),
    guest('王大華', { guest_tag: '農民', guest_org: '後壁鄉' }),
    guest('陳阿土', { guest_tag: '農民', guest_org: '後壁鄉', checked_in_at: '2026-12-20T10:05:00Z' }),
    guest('林小美', { guest_tag: '農民', guest_org: '新營區' }),
    guest('李四', { category: 'walkin' }),
    guest('除名者', { guest_tag: '貴賓', removed_at: '2026-12-01T00:00:00Z' }),
  ];
  const { facets } = buildVipIndex(attendees, checkedIn);

  test('counts total and checked-in per 身分, excluding removed rows, largest first', () => {
    expect(facets.tags).toEqual([
      { key: '農民', total: 3, checkedIn: 1 },
      { key: '貴賓', total: 1, checkedIn: 1 },
      { key: '現場報名', total: 1, checkedIn: 0 },
    ]);
  });

  test('groups 單位 with a single guest under 其他', () => {
    expect(facets.orgs).toEqual([
      { key: '後壁鄉', total: 2, checkedIn: 1 },
      { key: OTHER_ORG, total: 3, checkedIn: 1 },
    ]);
  });

  test('builds 姓氏 facets', () => {
    expect(facets.surnames[0]).toEqual({ key: '王', total: 2, checkedIn: 1 });
  });

  test('reports overall totals', () => {
    expect(facets.total).toBe(5);
    expect(facets.checkedIn).toBe(2);
  });
});

describe('filterVip', () => {
  const attendees = [
    guest('王小明', { guest_tag: '貴賓', guest_org: '米屋智農', checked_in_at: '2026-12-20T10:00:00Z' }),
    guest('王大華', { guest_tag: '農民', guest_org: '後壁鄉' }),
    guest('陳阿土', { guest_tag: '農民', guest_org: '後壁鄉' }),
    guest('林小美', { guest_tag: '農民', guest_org: '新營區' }),
  ];
  const { entries } = buildVipIndex(attendees, checkedIn);
  const names = (filter: Parameters<typeof filterVip>[1]) =>
    filterVip(entries, filter, checkedIn).map((e) => e.name);

  test('combines 身分 and 姓氏 filters', () => {
    expect(names({ tag: '農民', surname: '王' })).toEqual(['王大華']);
  });

  test('filters the 其他 bucket by organisations that have one guest', () => {
    expect(names({ org: OTHER_ORG })).toEqual(['王小明', '林小美']);
  });

  test('searches name, 單位 and 身分 text', () => {
    expect(names({ query: '新營' })).toEqual(['林小美']);
    expect(names({ query: '貴賓' })).toEqual(['王小明']);
  });

  test('hides checked-in guests when asked', () => {
    expect(names({ hideCheckedIn: true })).toEqual(['王大華', '陳阿土', '林小美']);
  });
});

describe('parseGreetingPhrases', () => {
  test('uses the configured list, trimmed, dropping blanks', () => {
    expect(parseGreetingPhrases([' 生意興隆 ', '', '闔家平安'])).toEqual(['生意興隆', '闔家平安']);
  });

  test('falls back to defaults for anything that is not a non-empty string array', () => {
    expect(parseGreetingPhrases(null)).toEqual(DEFAULT_GREETING_PHRASES);
    expect(parseGreetingPhrases('生意興隆')).toEqual(DEFAULT_GREETING_PHRASES);
    expect(parseGreetingPhrases([1, 2])).toEqual(DEFAULT_GREETING_PHRASES);
  });

  test('keeps at most 6 phrases of at most 30 characters', () => {
    const long = 'x'.repeat(31);
    expect(parseGreetingPhrases(['a', 'b', 'c', 'd', 'e', 'f', 'g', long])).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });
});
