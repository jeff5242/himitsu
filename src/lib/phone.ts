// 台灣電話正規化：Excel 把 0912345678 存成數字時會掉前導 0（變 912345678），這裡補回

const MOBILE_CHARS = /^[0-9+\-()\s]{6,20}$/;
const EXCEL_DROPPED_ZERO = /^9\d{8}$/;

export function normalizeMobile(raw: string): string | null | 'invalid' {
  const value = raw.trim();
  if (value === '') return null;
  if (EXCEL_DROPPED_ZERO.test(value)) return `0${value}`;
  return MOBILE_CHARS.test(value) ? value : 'invalid';
}
