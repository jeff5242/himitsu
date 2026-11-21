// 來賓 CSV 匯入的純函式：解碼 → 解析 → 驗證 → 匯入規劃（先預覽再匯入）
// 欄位：姓名（必填）、單位、身分（例：貴賓／農民）、桌號

export interface GuestRow {
  /** CSV 原始列號（含標題列，從 1 起算），給使用者對照 Excel */
  line: number;
  name: string;
  org: string | null;
  tag: string | null;
  tableNo: number | null;
}

export interface GuestRowError {
  line: number;
  message: string;
}

export interface GuestParseResult {
  rows: GuestRow[];
  errors: GuestRowError[];
}

export interface ExistingGuest {
  name: string;
  org: string | null;
}

export interface TableOccupancy {
  tableNo: number;
  capacity: number;
  seated: number;
}

export interface TableOverflow {
  tableNo: number;
  capacity: number;
  total: number;
}

export interface GuestImportPlan {
  toInsert: GuestRow[];
  skipped: GuestRow[];
  newTables: number[];
  overflows: TableOverflow[];
}

export const MAX_NAME_LENGTH = 50;
export const MAX_ORG_LENGTH = 100;
export const MAX_TAG_LENGTH = 20;
export const MAX_IMPORT_ROWS = 1000;

type Field = 'name' | 'org' | 'tag' | 'tableNo';

const HEADER_ALIASES: Record<Field, string[]> = {
  name: ['姓名', 'name'],
  org: ['單位', '公司', '單位名稱', 'org', 'company'],
  tag: ['身分', '身份', '類別', 'tag'],
  tableNo: ['桌號', '桌次', '桌', 'table'],
};

const TABLE_NO_PATTERN = /^第?\s*(\d{1,3})\s*桌?$/;

/** Excel 的 CSV 可能是 UTF-8（含 BOM）或 Big5（繁中 Windows 預設「CSV（逗號分隔）」） */
export function decodeCsvBytes(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('big5').decode(bytes);
  }
  return text.startsWith('﻿') ? text.slice(1) : text;
}

/** RFC 4180：引號內可含逗號、換行，"" 代表一個引號 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') { inQuotes = false; }
      else { field += ch; }
      continue;
    }
    if (ch === '"') { inQuotes = true; }
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      rows.push([...row, field]);
      row = []; field = '';
    } else { field += ch; }
  }
  if (field !== '' || row.length > 0) rows.push([...row, field]);
  return rows;
}

const guestKey = (name: string, org: string | null): string => `${name}\u0000${org ?? ''}`;

function mapHeader(header: string[]): Partial<Record<Field, number>> {
  const normalized = header.map((h) => h.trim().toLowerCase());
  const mapping: Partial<Record<Field, number>> = {};
  for (const field of Object.keys(HEADER_ALIASES) as Field[]) {
    const index = normalized.findIndex((h) => HEADER_ALIASES[field].includes(h));
    if (index >= 0) mapping[field] = index;
  }
  return mapping;
}

function parseTableNo(raw: string): number | null | 'invalid' {
  if (raw === '') return null;
  const match = TABLE_NO_PATTERN.exec(raw);
  if (!match) return 'invalid';
  const value = Number(match[1]);
  return value > 0 ? value : 'invalid';
}

function validateRow(cells: string[], mapping: Partial<Record<Field, number>>, line: number):
  GuestRow | GuestRowError {
  const cell = (field: Field): string =>
    mapping[field] === undefined ? '' : (cells[mapping[field] as number] ?? '').trim();
  const name = cell('name');
  const org = cell('org');
  const tag = cell('tag');
  const rawTable = cell('tableNo');

  if (name === '') return { line, message: '姓名空白' };
  if (name.length > MAX_NAME_LENGTH) return { line, message: `姓名超過 ${MAX_NAME_LENGTH} 字` };
  if (org.length > MAX_ORG_LENGTH) return { line, message: `單位超過 ${MAX_ORG_LENGTH} 字` };
  if (tag.length > MAX_TAG_LENGTH) return { line, message: `身分超過 ${MAX_TAG_LENGTH} 字` };
  const tableNo = parseTableNo(rawTable);
  if (tableNo === 'invalid') return { line, message: `桌號「${rawTable}」不是正整數` };

  return { line, name, org: org || null, tag: tag || null, tableNo };
}

export function parseGuestCsv(text: string): GuestParseResult {
  const [header = [], ...body] = parseCsv(text);
  const mapping = mapHeader(header);
  if (mapping.name === undefined) {
    return { rows: [], errors: [{ line: 1, message: '找不到「姓名」欄，第一列必須是欄位名稱' }] };
  }

  const rows: GuestRow[] = [];
  const errors: GuestRowError[] = [];
  const seen = new Map<string, number>();

  body.forEach((cells, index) => {
    const line = index + 2;
    if (cells.every((c) => c.trim() === '')) return;
    if (rows.length + errors.length >= MAX_IMPORT_ROWS) {
      if (errors.at(-1)?.message.startsWith('超過')) return;
      errors.push({ line, message: `超過 ${MAX_IMPORT_ROWS} 筆上限，請分批匯入` });
      return;
    }
    const result = validateRow(cells, mapping, line);
    if ('message' in result) { errors.push(result); return; }
    const key = guestKey(result.name, result.org);
    const firstLine = seen.get(key);
    if (firstLine !== undefined) {
      errors.push({ line, message: `與第 ${firstLine} 列重複（同姓名＋單位）` });
      return;
    }
    seen.set(key, line);
    rows.push(result);
  });

  return { rows, errors };
}

/** 比對現有名單與桌次，算出實際要寫入的列、要新建的桌、會爆桌的桌（DB 守衛是最後防線） */
export function planGuestImport(
  rows: GuestRow[],
  existing: ExistingGuest[],
  tables: TableOccupancy[],
  defaultCapacity: number,
): GuestImportPlan {
  const existingKeys = new Set(existing.map((g) => guestKey(g.name, g.org)));
  const toInsert = rows.filter((r) => !existingKeys.has(guestKey(r.name, r.org)));
  const skipped = rows.filter((r) => existingKeys.has(guestKey(r.name, r.org)));

  const tableByNo = new Map(tables.map((t) => [t.tableNo, t]));
  const incoming = new Map<number, number>();
  for (const r of toInsert) {
    if (r.tableNo !== null) incoming.set(r.tableNo, (incoming.get(r.tableNo) ?? 0) + 1);
  }

  const tableNos = [...incoming.keys()].sort((a, b) => a - b);
  const newTables = tableNos.filter((no) => !tableByNo.has(no));
  const overflows = tableNos.flatMap((no) => {
    const table = tableByNo.get(no);
    const capacity = table?.capacity ?? defaultCapacity;
    const total = (table?.seated ?? 0) + (incoming.get(no) ?? 0);
    return total > capacity ? [{ tableNo: no, capacity, total }] : [];
  });

  return { toInsert, skipped, newTables, overflows };
}
