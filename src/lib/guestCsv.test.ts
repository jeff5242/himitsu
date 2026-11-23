import { describe, expect, test } from 'vitest';
import { decodeCsvBytes, parseCsv, parseGuestCsv, planGuestImport } from './guestCsv';
import type { GuestRow } from './guestCsv';

const EXTRA = { title: null, mobile: null, diet: null, companions: 0, rollCall: false };
const row = (name: string, overrides: Partial<GuestRow> = {}): GuestRow => ({
  line: 2, name, org: null, tag: null, tableNo: null, ...EXTRA, ...overrides,
});

describe('decodeCsvBytes', () => {
  test('decodes UTF-8 and strips the BOM that Excel writes', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('姓名\n王小明')]);
    expect(decodeCsvBytes(bytes)).toBe('姓名\n王小明');
  });

  test('falls back to Big5 for CSV saved by Traditional Chinese Excel', () => {
    // 「姓名」的 Big5 編碼
    const big5 = new Uint8Array([0xa9, 0x6d, 0xa6, 0x57]);
    expect(decodeCsvBytes(big5)).toBe('姓名');
  });
});

describe('parseCsv', () => {
  test('splits CRLF lines and commas', () => {
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  test('keeps commas, quotes and newlines inside quoted fields', () => {
    expect(parseCsv('"台南,後壁","他說""好""","第一行\n第二行"')).toEqual([
      ['台南,後壁', '他說"好"', '第一行\n第二行'],
    ]);
  });
});

describe('parseGuestCsv', () => {
  test('maps the four columns by header name in any order', () => {
    const result = parseGuestCsv('桌號,身分,單位,姓名\n3,貴賓,米屋智農,王小明\n,農民,後壁,陳大華');

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { line: 2, name: '王小明', org: '米屋智農', tag: '貴賓', tableNo: 3, ...EXTRA },
      { line: 3, name: '陳大華', org: '後壁', tag: '農民', tableNo: null, ...EXTRA },
    ]);
  });

  test('accepts header aliases and table numbers written as 第3桌', () => {
    const result = parseGuestCsv('姓名,公司,身份,桌次\n王小明,米屋,貴賓,第 12 桌');
    expect(result.rows[0]).toMatchObject({ org: '米屋', tag: '貴賓', tableNo: 12 });
  });

  test('only 姓名 is required; other columns may be absent', () => {
    const result = parseGuestCsv('姓名\n王小明');
    expect(result.rows).toEqual([{ line: 2, name: '王小明', org: null, tag: null, tableNo: null, ...EXTRA }]);
  });

  test('reports a missing 姓名 header', () => {
    const result = parseGuestCsv('名字,單位\n王小明,米屋');
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([{ line: 1, message: '找不到「姓名」欄，第一列必須是欄位名稱' }]);
  });

  test('skips blank lines and trims whitespace', () => {
    const result = parseGuestCsv('姓名,單位\n  王小明  , 米屋 \n,\n\n');
    expect(result.rows).toEqual([{ line: 2, name: '王小明', org: '米屋', tag: null, tableNo: null, ...EXTRA }]);
  });

  test('reports rows with an empty name, a bad table number or an over-long tag', () => {
    const result = parseGuestCsv('姓名,單位,身分,桌號\n,米屋,貴賓,1\n王小明,,,A\n李四,,這是一個超過二十個字的身分標籤文字內容很長,');
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      { line: 2, message: '姓名空白' },
      { line: 3, message: '桌號「A」不是正整數' },
      { line: 4, message: '身分超過 20 字' },
    ]);
  });

  test('reports duplicate name + 單位 inside the same file', () => {
    const result = parseGuestCsv('姓名,單位\n王小明,米屋\n王小明,米屋\n王小明,後壁');
    expect(result.rows.map((r) => r.line)).toEqual([2, 4]);
    expect(result.errors).toEqual([{ line: 3, message: '與第 2 列重複（同姓名＋單位）' }]);
  });
});

describe('parseGuestCsv detail columns', () => {
  test('reads 職稱、手機、葷素、攜伴人數、唱名 with aliases', () => {
    const result = parseGuestCsv([
      '姓名,任職單位,職稱,聯絡手機,葷素,攜伴人數,唱名,桌號',
      '王董,米屋智農,董事長,912345678,素,2,是,1',
      '陳大華,二林鎮,,,葷,,,2',
    ].join('\n'));
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      org: '米屋智農', title: '董事長', mobile: '0912345678', diet: '素', companions: 2, rollCall: true, tableNo: 1,
    });
    expect(result.rows[1]).toMatchObject({ diet: '葷', companions: 0, rollCall: false });
  });

  test('accepts V／Y／✓／1 as 唱名 and blank／否 as no', () => {
    const result = parseGuestCsv('姓名,唱名\n甲,V\n乙,Y\n丙,✓\n丁,1\n戊,否\n己,');
    expect(result.rows.map((r) => r.rollCall)).toEqual([true, true, true, true, false, false]);
  });

  test('reports bad 攜伴人數, 唱名 and 手機 values', () => {
    const result = parseGuestCsv('姓名,攜伴人數,唱名,手機\n甲,兩位,,\n乙,21,,\n丙,,也許,\n丁,,,abc');
    expect(result.errors).toEqual([
      { line: 2, message: '攜伴人數「兩位」必須是 0～20 的整數' },
      { line: 3, message: '攜伴人數「21」必須是 0～20 的整數' },
      { line: 4, message: '唱名「也許」請填「是」或留白' },
      { line: 5, message: '手機「abc」格式不正確' },
    ]);
  });
});

describe('planGuestImport', () => {
  test('skips guests already on the roster (same name + 單位)', () => {
    const plan = planGuestImport(
      [row('王小明', { org: '米屋' }), row('陳大華', { line: 3 })],
      [{ name: '王小明', org: '米屋' }],
      [], 10,
    );
    expect(plan.toInsert.map((r) => r.name)).toEqual(['陳大華']);
    expect(plan.skipped.map((r) => r.name)).toEqual(['王小明']);
  });

  test('lists table numbers that must be created, sorted', () => {
    const plan = planGuestImport(
      [row('a', { tableNo: 5 }), row('b', { tableNo: 2 }), row('c', { tableNo: 5 }), row('d', { tableNo: 1 })],
      [], [{ tableNo: 1, capacity: 10, seated: 0 }], 10,
    );
    expect(plan.newTables).toEqual([2, 5]);
  });

  test('flags tables whose seated + imported count exceeds capacity', () => {
    const rows = [row('a', { tableNo: 1 }), row('b', { tableNo: 1 }), row('c', { tableNo: 2 }), row('d', { tableNo: 2 })];
    const plan = planGuestImport(rows, [], [{ tableNo: 1, capacity: 3, seated: 2 }], 1);
    expect(plan.overflows).toEqual([
      { tableNo: 1, capacity: 3, total: 4 },
      { tableNo: 2, capacity: 1, total: 2 },
    ]);
  });

  test('counts companions as seats', () => {
    const plan = planGuestImport(
      [row('王董', { tableNo: 1, companions: 2 }), row('李總', { tableNo: 1, companions: 1 })],
      [], [{ tableNo: 1, capacity: 5, seated: 1 }], 10,
    );
    expect(plan.overflows).toEqual([{ tableNo: 1, capacity: 5, total: 6 }]);
  });

  test('does not count skipped guests toward capacity', () => {
    const plan = planGuestImport(
      [row('王小明', { tableNo: 1 })],
      [{ name: '王小明', org: null }],
      [{ tableNo: 1, capacity: 1, seated: 1 }], 10,
    );
    expect(plan.overflows).toEqual([]);
    expect(plan.newTables).toEqual([]);
  });
});
