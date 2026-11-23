import { describe, expect, test } from 'vitest';
import { parseTablesPerRow, tableGridStyle } from './tableLayout';

describe('parseTablesPerRow', () => {
  test('accepts whole numbers 1～12', () => {
    expect(parseTablesPerRow(6)).toBe(6);
    expect(parseTablesPerRow('6')).toBe(6);
    expect(parseTablesPerRow(12)).toBe(12);
  });

  test('treats 0, blanks, out-of-range and non-numbers as automatic (0)', () => {
    expect([0, null, undefined, '', 13, -1, 2.5, 'abc'].map(parseTablesPerRow)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('tableGridStyle', () => {
  test('fixes the column count when tables-per-row is set', () => {
    expect(tableGridStyle(6, 150)).toEqual({ gridTemplateColumns: 'repeat(6, minmax(150px, 1fr))' });
  });

  test('falls back to automatic columns by screen width', () => {
    expect(tableGridStyle(0, 170)).toEqual({ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' });
  });
});
