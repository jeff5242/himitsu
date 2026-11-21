// 會員庫「人員分類」的純函式：計數、篩選、排序、名稱驗證

export interface PersonCategory {
  id: string;
  name: string;
  sort: number;
}

export interface CategoryLink {
  person_id: string;
  category_id: string;
}

export interface CategoryCount {
  id: string;
  name: string;
  count: number;
}

/** 篩選用的特殊鍵：沒有任何分類的成員 */
export const UNCATEGORIZED = '__uncategorized__';
export const MAX_CATEGORY_NAME_LENGTH = 20;

type CategoryNameResult = { ok: true; name: string } | { ok: false; message: string };

const bySort = (a: PersonCategory, b: PersonCategory): number => a.sort - b.sort || a.name.localeCompare(b.name);

export function sortCategories(categories: PersonCategory[]): PersonCategory[] {
  return [...categories].sort(bySort);
}

export function categoryCounts(
  persons: { id: string }[], links: CategoryLink[], categories: PersonCategory[],
): CategoryCount[] {
  const personIds = new Set(persons.map((p) => p.id));
  const counts = new Map<string, number>();
  const linked = new Set<string>();
  for (const link of links) {
    if (!personIds.has(link.person_id)) continue;
    counts.set(link.category_id, (counts.get(link.category_id) ?? 0) + 1);
    linked.add(link.person_id);
  }
  return [
    ...sortCategories(categories).map((c) => ({ id: c.id, name: c.name, count: counts.get(c.id) ?? 0 })),
    { id: UNCATEGORIZED, name: '未分類', count: persons.filter((p) => !linked.has(p.id)).length },
  ];
}

export function filterPersonsByCategory<T extends { id: string }>(
  persons: T[], links: CategoryLink[], selected: string | undefined,
): T[] {
  if (!selected) return persons;
  if (selected === UNCATEGORIZED) {
    const linked = new Set(links.map((l) => l.person_id));
    return persons.filter((p) => !linked.has(p.id));
  }
  const inCategory = new Set(links.filter((l) => l.category_id === selected).map((l) => l.person_id));
  return persons.filter((p) => inCategory.has(p.id));
}

export function categoriesOf(personId: string, links: CategoryLink[], categories: PersonCategory[]): PersonCategory[] {
  const ids = new Set(links.filter((l) => l.person_id === personId).map((l) => l.category_id));
  return sortCategories(categories.filter((c) => ids.has(c.id)));
}

export function nextCategorySort(categories: PersonCategory[]): number {
  return categories.length === 0 ? 0 : Math.max(...categories.map((c) => c.sort)) + 1;
}

export function validateCategoryName(raw: string, existing: PersonCategory[]): CategoryNameResult {
  const name = raw.trim();
  if (name === '') return { ok: false, message: '請輸入分類名稱' };
  if (name.length > MAX_CATEGORY_NAME_LENGTH) return { ok: false, message: `分類名稱最多 ${MAX_CATEGORY_NAME_LENGTH} 字` };
  if (existing.some((c) => c.name === name)) return { ok: false, message: `已有「${name}」這個分類` };
  return { ok: true, name };
}
