// 設定值 ↔ 輸入框字串的轉換（SettingRow 使用；獨立成模組以便單元測試）

import type { SettingsCatalogItem } from './types';

type ValueType = SettingsCatalogItem['value_type'];

export function toEditable(type: ValueType, value: unknown): string {
  if (type === 'text') return typeof value === 'string' ? value : '';
  if (type === 'number') return typeof value === 'number' ? String(value) : '';
  if (type === 'boolean') return value === true ? 'true' : 'false';
  return JSON.stringify(value ?? null, null, 0);
}

export function fromEditable(
  type: ValueType,
  draft: string,
): { value?: unknown; error?: string } {
  if (type === 'text') return { value: draft };
  if (type === 'number') {
    const parsed = Number(draft);
    if (draft.trim() === '' || Number.isNaN(parsed)) return { error: '請輸入數字' };
    return { value: parsed };
  }
  if (type === 'boolean') return { value: draft === 'true' };
  try {
    return { value: JSON.parse(draft) };
  } catch {
    return { error: 'JSON 格式不正確' };
  }
}
