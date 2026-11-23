// 桌次版面：設定中心 assembly.tables_per_row 決定每排幾桌（0＝依螢幕寬度自動）
import type { CSSProperties } from 'react';

export const MAX_TABLES_PER_ROW = 12;

export function parseTablesPerRow(value: unknown): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_TABLES_PER_ROW ? n : 0;
}

/** 每排固定 N 桌時用固定欄數（太窄時外層橫向捲動）；未設定時依寬度自動排 */
export function tableGridStyle(perRow: number, minWidthPx: number): CSSProperties {
  return perRow > 0
    ? { gridTemplateColumns: `repeat(${perRow}, minmax(${minWidthPx}px, 1fr))` }
    : { gridTemplateColumns: `repeat(auto-fill, minmax(${minWidthPx}px, 1fr))` };
}
