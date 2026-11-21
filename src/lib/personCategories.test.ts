import { describe, expect, test } from 'vitest';
import {
  UNCATEGORIZED, categoryCounts, categoriesOf, filterPersonsByCategory, nextCategorySort, validateCategoryName,
} from './personCategories';
import type { CategoryLink, PersonCategory } from './personCategories';

const categories: PersonCategory[] = [
  { id: 'c-farmer', name: '農民', sort: 1 },
  { id: 'c-vip', name: '貴賓', sort: 0 },
  { id: 'c-rep', name: '農會代表', sort: 2 },
];
const persons = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }];
const links: CategoryLink[] = [
  { person_id: 'p1', category_id: 'c-farmer' },
  { person_id: 'p2', category_id: 'c-farmer' },
  { person_id: 'p2', category_id: 'c-vip' },
  { person_id: 'p3', category_id: 'c-vip' },
];

describe('categoryCounts', () => {
  test('counts persons per category in sort order, plus 未分類', () => {
    expect(categoryCounts(persons, links, categories)).toEqual([
      { id: 'c-vip', name: '貴賓', count: 2 },
      { id: 'c-farmer', name: '農民', count: 2 },
      { id: 'c-rep', name: '農會代表', count: 0 },
      { id: UNCATEGORIZED, name: '未分類', count: 1 },
    ]);
  });
});

describe('filterPersonsByCategory', () => {
  test('returns everyone when nothing is selected', () => {
    expect(filterPersonsByCategory(persons, links, undefined)).toHaveLength(4);
  });

  test('keeps persons linked to the selected category', () => {
    expect(filterPersonsByCategory(persons, links, 'c-vip').map((p) => p.id)).toEqual(['p2', 'p3']);
  });

  test('keeps persons without any category for 未分類', () => {
    expect(filterPersonsByCategory(persons, links, UNCATEGORIZED).map((p) => p.id)).toEqual(['p4']);
  });
});

describe('categoriesOf', () => {
  test('lists a person\'s categories in sort order', () => {
    expect(categoriesOf('p2', links, categories).map((c) => c.name)).toEqual(['貴賓', '農民']);
  });
});

describe('nextCategorySort', () => {
  test('puts a new category after the last one', () => {
    expect(nextCategorySort(categories)).toBe(3);
    expect(nextCategorySort([])).toBe(0);
  });
});

describe('validateCategoryName', () => {
  test('accepts a new trimmed name', () => {
    expect(validateCategoryName(' 理監事 ', categories)).toEqual({ ok: true, name: '理監事' });
  });

  test('rejects blank, over 20 characters, and duplicate names', () => {
    expect(validateCategoryName('  ', categories)).toEqual({ ok: false, message: '請輸入分類名稱' });
    expect(validateCategoryName('一二三四五六七八九十一二三四五六七八九十一', categories))
      .toEqual({ ok: false, message: '分類名稱最多 20 字' });
    expect(validateCategoryName('農民', categories)).toEqual({ ok: false, message: '已有「農民」這個分類' });
  });
});
