import { describe, expect, test } from 'vitest';
import { normalizeMobile, parseMemberCsv, planMemberImport, splitCategories } from './memberCsv';
import type { MemberRow } from './memberCsv';

const row = (name: string, overrides: Partial<MemberRow> = {}): MemberRow => ({
  line: 2, name, affiliation: null, mobile: null, categories: [], ...overrides,
});

describe('normalizeMobile', () => {
  test('restores the leading 0 that Excel drops from 09xx numbers', () => {
    expect(normalizeMobile('912345678')).toBe('0912345678');
  });

  test('keeps formatted numbers and removes surrounding spaces', () => {
    expect(normalizeMobile(' 0912-345-678 ')).toBe('0912-345-678');
    expect(normalizeMobile('04-8961234')).toBe('04-8961234');
  });

  test('returns null for blank and invalid for letters', () => {
    expect(normalizeMobile('')).toBeNull();
    expect(normalizeMobile('abc')).toBe('invalid');
  });
});

describe('splitCategories', () => {
  test('splits on 、 ／ / , ， ; and spaces, trims and de-duplicates', () => {
    expect(splitCategories('農民、貴賓 / 農會代表，農民')).toEqual(['農民', '貴賓', '農會代表']);
  });

  test('returns an empty list for blank', () => {
    expect(splitCategories('  ')).toEqual([]);
  });
});

describe('parseMemberCsv', () => {
  test('maps columns by header in any order, with aliases', () => {
    const result = parseMemberCsv('分類,電話,鄉鎮,姓名\n農民,912345678,二林鎮,陳大華\n"貴賓、農會代表",,彰化縣農會,王貴賓');
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { line: 2, name: '陳大華', affiliation: '二林鎮', mobile: '0912345678', categories: ['農民'] },
      { line: 3, name: '王貴賓', affiliation: '彰化縣農會', mobile: null, categories: ['貴賓', '農會代表'] },
    ]);
  });

  test('requires a 姓名 header', () => {
    expect(parseMemberCsv('名字\n陳大華').errors).toEqual([{ line: 1, message: '找不到「姓名」欄，第一列必須是欄位名稱' }]);
  });

  test('reports empty names, bad phones, over-long categories and in-file duplicates', () => {
    const result = parseMemberCsv([
      '姓名,單位,手機,分類',
      ',二林鎮,,農民',
      '陳大華,二林鎮,abc,農民',
      '林阿土,,,這是一個超過二十個字的分類名稱文字內容很長很長',
      '王小明,米屋,,貴賓',
      '王小明,米屋,,農民',
    ].join('\n'));
    expect(result.rows.map((r) => r.name)).toEqual(['王小明']);
    expect(result.errors).toEqual([
      { line: 2, message: '姓名空白' },
      { line: 3, message: '手機「abc」格式不正確' },
      { line: 4, message: '分類名稱最多 20 字' },
      { line: 6, message: '與第 5 列重複（同姓名＋單位）' },
    ]);
  });
});

describe('planMemberImport', () => {
  const existingPersons = [{ id: 'p1', name: '陳大華', affiliation: '二林鎮' }];
  const existingCategories = [{ id: 'c1', name: '農民', sort: 0 }];

  test('splits rows into new members and existing members to merge (same 姓名＋單位)', () => {
    const plan = planMemberImport(
      [row('陳大華', { affiliation: '二林鎮', categories: ['農民'] }), row('林阿土', { line: 3 })],
      existingPersons, existingCategories,
    );
    expect(plan.toCreate.map((r) => r.name)).toEqual(['林阿土']);
    expect(plan.toMerge.map((r) => r.name)).toEqual(['陳大華']);
  });

  test('lists categories that do not exist yet, in first-seen order', () => {
    const plan = planMemberImport(
      [row('甲', { categories: ['貴賓', '農民'] }), row('乙', { categories: ['農會代表', '貴賓'] })],
      existingPersons, existingCategories,
    );
    expect(plan.newCategories).toEqual(['貴賓', '農會代表']);
  });

  test('counts category ticks across all rows', () => {
    const plan = planMemberImport(
      [row('甲', { categories: ['貴賓', '農民'] }), row('乙', { categories: ['農民'] }), row('丙')],
      existingPersons, existingCategories,
    );
    expect(plan.categoryTicks).toBe(3);
  });
});
