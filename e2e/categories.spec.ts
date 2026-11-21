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
  await expect(page.getByRole('button', { name: '刪除 農民' })).toBeVisible();
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

test('會員 CSV 匯入：預覽新增／更新／自動建分類，確認後整批送出', async ({ page }) => {
  const state: MockState = {
    writes: [], attendees: [], greetings: [], submitted: [], rpcBodies: {},
    persons: [person('p1', '陳大華', '二林鎮')],
    categories: [{ id: 'cat-1', name: '農民', sort: 0 }], links: [],
  };
  await mockSupabase(page, state);
  await loginAs(page);
  await page.goto('/o/miwu/members');

  const csv = '\uFEFF姓名,單位,手機,分類\n陳大華,二林鎮,912345678,農民\n王貴賓,彰化縣農會,,貴賓、農會代表\n林阿土,芳苑鄉,,農民\n';
  await page.getByLabel('選擇會員 CSV 檔').setInputFiles({ name: '會員.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf-8') });
  await expect(page.getByText('新增 2 位')).toBeVisible();
  await expect(page.getByText('已是會員、更新 1 位')).toBeVisible();
  await expect(page.getByText('自動建立分類：貴賓、農會代表')).toBeVisible();
  await expect(page.getByText('勾選分類 4 筆')).toBeVisible();
  await expect(page.getByRole('cell', { name: '0912345678' })).toBeVisible();
  await page.screenshot({ path: 'test-results/member-import.png', fullPage: true });

  await page.getByRole('button', { name: '確認匯入 3 位' }).click();
  await expect(page.getByText('新增 2 位會員、更新既有 1 位、新建 2 個分類、勾選分類 4 筆')).toBeVisible();
  expect(state.rpcBodies?.['/rest/v1/rpc/import_members']).toEqual([{
    p_org: 'org-1',
    p_rows: [
      { line: 2, name: '陳大華', affiliation: '二林鎮', mobile: '0912345678', categories: ['農民'] },
      { line: 3, name: '王貴賓', affiliation: '彰化縣農會', mobile: null, categories: ['貴賓', '農會代表'] },
      { line: 4, name: '林阿土', affiliation: '芳苑鄉', mobile: null, categories: ['農民'] },
    ],
  }]);
});
