// 會員 CSV 匯入的純函式：解析 → 驗證 → 匯入規劃（新會員／合併既有會員／要新建的分類）
// 欄位：姓名（必填）、單位、手機、分類（可多個，用「、」「／」「,」分隔）
import { parseCsv } from './guestCsv';
import { MAX_CATEGORY_NAME_LENGTH } from './personCategories';
import type { PersonCategory } from './personCategories';

export interface MemberRow {
  /** CSV 原始列號（含標題列，從 1 起算） */
  line: number;
  name: string;
  affiliation: string | null;
  mobile: string | null;
  categories: string[];
}

export interface MemberRowError {
  line: number;
  message: string;
}

export interface MemberParseResult {
  rows: MemberRow[];
  errors: MemberRowError[];
}

export interface ExistingPerson {
  id: string;
  name: string;
  affiliation: string | null;
}

export interface MemberImportPlan {
  toCreate: MemberRow[];
  /** 會員庫已有同姓名＋同單位：不新增，只補手機與勾分類 */
  toMerge: MemberRow[];
  newCategories: string[];
  categoryTicks: number;
}

export const MAX_MEMBER_ROWS = 2000;
const MAX_NAME_LENGTH = 50;
const MAX_AFFILIATION_LENGTH = 100;

type Field = 'name' | 'affiliation' | 'mobile' | 'categories';

const HEADER_ALIASES: Record<Field, string[]> = {
  name: ['姓名', 'name'],
  affiliation: ['單位', '公司', '鄉鎮', '服務單位', 'org', 'company'],
  mobile: ['手機', '電話', '行動電話', 'mobile', 'phone'],
  categories: ['分類', '類別', '身分', '身份', 'category'],
};

const MOBILE_CHARS = /^[0-9+\-()\s]{6,20}$/;
const EXCEL_DROPPED_ZERO = /^9\d{8}$/;
const CATEGORY_SEPARATORS = /[、,，/／;；\s]+/;

const memberKey = (name: string, affiliation: string | null): string => `${name}\u0000${affiliation ?? ''}`;

/** Excel 把 0912345678 存成數字時會掉前導 0（變 912345678），這裡補回 */
export function normalizeMobile(raw: string): string | null | 'invalid' {
  const value = raw.trim();
  if (value === '') return null;
  if (EXCEL_DROPPED_ZERO.test(value)) return `0${value}`;
  return MOBILE_CHARS.test(value) ? value : 'invalid';
}

export function splitCategories(raw: string): string[] {
  return [...new Set(raw.split(CATEGORY_SEPARATORS).map((s) => s.trim()).filter((s) => s !== ''))];
}

function mapHeader(header: string[]): Partial<Record<Field, number>> {
  const normalized = header.map((h) => h.trim().toLowerCase());
  const mapping: Partial<Record<Field, number>> = {};
  for (const field of Object.keys(HEADER_ALIASES) as Field[]) {
    const index = normalized.findIndex((h) => HEADER_ALIASES[field].includes(h));
    if (index >= 0) mapping[field] = index;
  }
  return mapping;
}

function validateRow(cells: string[], mapping: Partial<Record<Field, number>>, line: number): MemberRow | MemberRowError {
  const cell = (field: Field): string =>
    mapping[field] === undefined ? '' : (cells[mapping[field] as number] ?? '').trim();
  const name = cell('name');
  const affiliation = cell('affiliation');
  const rawMobile = cell('mobile');

  if (name === '') return { line, message: '姓名空白' };
  if (name.length > MAX_NAME_LENGTH) return { line, message: `姓名超過 ${MAX_NAME_LENGTH} 字` };
  if (affiliation.length > MAX_AFFILIATION_LENGTH) return { line, message: `單位超過 ${MAX_AFFILIATION_LENGTH} 字` };
  const mobile = normalizeMobile(rawMobile);
  if (mobile === 'invalid') return { line, message: `手機「${rawMobile}」格式不正確` };
  const categories = splitCategories(cell('categories'));
  if (categories.some((c) => c.length > MAX_CATEGORY_NAME_LENGTH)) {
    return { line, message: `分類名稱最多 ${MAX_CATEGORY_NAME_LENGTH} 字` };
  }
  return { line, name, affiliation: affiliation || null, mobile, categories };
}

export function parseMemberCsv(text: string): MemberParseResult {
  const [header = [], ...body] = parseCsv(text);
  const mapping = mapHeader(header);
  if (mapping.name === undefined) {
    return { rows: [], errors: [{ line: 1, message: '找不到「姓名」欄，第一列必須是欄位名稱' }] };
  }

  const rows: MemberRow[] = [];
  const errors: MemberRowError[] = [];
  const seen = new Map<string, number>();
  body.forEach((cells, index) => {
    const line = index + 2;
    if (cells.every((c) => c.trim() === '')) return;
    if (rows.length + errors.length >= MAX_MEMBER_ROWS) {
      if (!errors.at(-1)?.message.startsWith('超過')) {
        errors.push({ line, message: `超過 ${MAX_MEMBER_ROWS} 筆上限，請分批匯入` });
      }
      return;
    }
    const result = validateRow(cells, mapping, line);
    if ('message' in result) { errors.push(result); return; }
    const key = memberKey(result.name, result.affiliation);
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

export function planMemberImport(
  rows: MemberRow[], existingPersons: ExistingPerson[], existingCategories: PersonCategory[],
): MemberImportPlan {
  const existingKeys = new Set(existingPersons.map((p) => memberKey(p.name, p.affiliation)));
  const knownCategories = new Set(existingCategories.map((c) => c.name));
  const newCategories: string[] = [];
  for (const r of rows) {
    for (const c of r.categories) {
      if (!knownCategories.has(c) && !newCategories.includes(c)) newCategories.push(c);
    }
  }
  return {
    toCreate: rows.filter((r) => !existingKeys.has(memberKey(r.name, r.affiliation))),
    toMerge: rows.filter((r) => existingKeys.has(memberKey(r.name, r.affiliation))),
    newCategories,
    categoryTicks: rows.reduce((sum, r) => sum + r.categories.length, 0),
  };
}
