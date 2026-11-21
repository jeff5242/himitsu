import { expect, test } from '@playwright/test';
import { loginAs, mockSupabase, person } from './support/supabaseMock';
import type { MockState } from './support/supabaseMock';

// 人員分類：設定頁新增分類 → 成員頁勾選與篩選 → 活動名單依分類匯入（假後端，不碰真實資料）

test('人員分類：新增、勾選、篩選、依分類匯入', async ({ page }) => {
  const state: MockState = {
    writes: [], attendees: [], greetings: [], submitted: [], rpcBodies: {},
    persons: [person('p1', '陳大華', '二林鎮'), person('p2', '王貴賓', '彰化縣農會')],
    categories: [], links: [],
  };
  await mockSupabase(page, state);
  await loginAs(page);

  // 1. 設定頁新增兩個分類
  await page.goto('/o/miwu/settings');
  await page.getByLabel('新分類名稱').fill('農民');
  await page.getByRole('button', { name: '新增分類' }).click();
  await page.getByLabel('新分類名稱').fill('貴賓');
  await page.getByRole('button', { name: '新增分類' }).click();
  await expect(page.getByRole('button', { name: '刪除 貴賓' })).toBeVisible();
  await page.getByLabel('新分類名稱').fill('農民');
  await page.getByRole('button', { name: '新增分類' }).click();
  await expect(page.getByText('已有「農民」這個分類')).toBeVisible();
  expect(state.categories?.map((c) => c.name)).toEqual(['農民', '貴賓']);

  // 2. 成員頁：替陳大華勾「農民」，篩選
  await page.goto('/o/miwu/members');
  await expect(page.getByText('不會產生登入帳號')).toBeVisible();
  await page.getByRole('button', { name: '陳大華 農民' }).click();
  await expect(page.getByRole('button', { name: '陳大華 農民' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '農民 1' }).click();
  await expect(page.getByText('王貴賓')).toHaveCount(0);
  await expect(page.getByText('單位：二林鎮')).toBeVisible();
  await page.getByRole('button', { name: '未分類 1' }).click();
  await expect(page.getByText('陳大華')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/members-categories.png', fullPage: true });

  // 3. 活動名單：依「農民」匯入
  await page.goto('/o/miwu/events/ev-1');
  await page.getByRole('checkbox', { name: /農民/ }).check();
  await page.getByRole('button', { name: '依分類匯入' }).click();
  await expect(page.getByText('已匯入 1 人')).toBeVisible();
  expect(state.rpcBodies?.['/rest/v1/rpc/import_people_by_category']).toEqual([
    { p_event: 'ev-1', p_category_ids: ['cat-1'] },
  ]);
});
