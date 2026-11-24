import { expect, test } from '@playwright/test';
import { guest, loginAs, mockSupabase } from './support/supabaseMock';
import type { MockState } from './support/supabaseMock';

// 來賓詳細欄位（職稱／手機／葷素／攜伴／唱名）、唱名名單、攜伴佔座位（假後端，不碰真實資料）

const base = (): MockState => ({ writes: [], attendees: [], greetings: [], submitted: [], rpcBodies: {} });

test('CSV 匯入來賓帶入職稱、手機、葷素、攜伴、唱名', async ({ page }) => {
  const state = base();
  await mockSupabase(page, state);
  await loginAs(page);
  await page.goto('/o/miwu/events/ev-1');

  const csv = '﻿姓名,任職單位,職稱,聯絡手機,葷素,攜伴人數,唱名,桌號\n王董,米屋智農,董事長,912345678,素,2,是,1\n陳大華,二林鎮,,,葷,,,5\n';
  await page.getByLabel('選擇 CSV 檔').setInputFiles({ name: '來賓.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf-8') });
  await expect(page.getByRole('cell', { name: '董事長' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '+2' })).toBeVisible();
  await page.getByRole('button', { name: '確認匯入 2 人' }).click();
  await expect(page.getByText('已匯入 2 人')).toBeVisible();
  expect(state.rpcBodies?.['/rest/v1/rpc/import_guests']?.[0]).toMatchObject({
    p_rows: [
      { name: '王董', org: '米屋智農', title: '董事長', mobile: '0912345678', diet: '素', companions: 2, roll_call: true, table_no: 1 },
      { name: '陳大華', org: '二林鎮', title: null, mobile: null, diet: '葷', companions: 0, roll_call: false, table_no: 5 },
    ],
  });
});

test('名單勾唱名 → 唱名名單只列已報到者、依名單順序', async ({ page }) => {
  const state = base();
  state.attendees = [
    { ...guest('王董', '米屋智農', '貴賓', 1, true), seq_no: 1, roll_call: false, guest_title: '董事長' } as never,
    { ...guest('李總', '彰化縣農會', '貴賓', 1, true), seq_no: 2, roll_call: true } as never,
    { ...guest('陳主任', '二林鎮', '貴賓', 5, false), seq_no: 3, roll_call: true } as never,
  ];
  await mockSupabase(page, state);
  await loginAs(page);

  await page.goto('/o/miwu/events/ev-1');
  await page.getByRole('button', { name: '王董 唱名' }).click();
  await expect(page.getByRole('button', { name: '王董 唱名' })).toHaveAttribute('aria-pressed', 'true');

  await page.goto('/o/miwu/events/ev-1/roll-call');
  await expect(page.getByRole('heading', { name: '📣 唱名名單' })).toBeVisible();
  const names = page.locator('ol li p.text-4xl');
  await expect(names).toHaveText(['王董', '李總']);
  await expect(page.getByText('董事長・米屋智農')).toBeVisible();
  await expect(page.getByText('尚未報到 1 位（展開）')).toBeVisible();
  await page.locator('ol li').first().getByRole('button', { name: '✓ 已唱名' }).click();
  await expect(page.locator('ol li').first().getByRole('button', { name: '↺ 取消' })).toBeVisible();
  await page.screenshot({ path: 'test-results/roll-call.png', fullPage: true });
});

test('攜伴佔座位：桌次顯示含攜伴人數與素食份數', async ({ page }) => {
  const state = base();
  state.attendees = [
    { ...guest('王董', '米屋智農', '貴賓', 1), companions: 2, diet: '素' } as never,
    { ...guest('李總', '彰化縣農會', '貴賓', 1), companions: 0, diet: '葷' } as never,
  ];
  await mockSupabase(page, state);
  await loginAs(page);
  await page.goto('/o/miwu/events/ev-1');
  await page.getByRole('button', { name: '桌次' }).click();
  await page.getByRole('button', { name: '圓桌卡' }).click();
  const table1 = page.locator('section', { hasText: '桌 1' }).first();
  await expect(table1.getByText('4／10')).toBeVisible();
  await expect(table1.getByText('素 3')).toBeVisible();
  await expect(table1.getByText('王董＋2')).toBeVisible();
});

test('貴賓報到畫面（給貴賓看）不顯示唱名', async ({ page }) => {
  const state = base();
  state.attendees = [{ ...guest('王董', '米屋智農', '貴賓', 1), roll_call: true, guest_title: '董事長' } as never];
  await mockSupabase(page, state);
  await loginAs(page);
  await page.goto('/o/miwu/events/ev-1/vip');
  await expect(page.locator('article', { hasText: '王董' })).toContainText('董事長・米屋智農');
  await expect(page.getByText('★ 唱名')).toHaveCount(0);
});

test('桌次每排桌數依設定（6 桌一排）', async ({ page }) => {
  const state = { ...base(), settingValues: { 'assembly.tables_per_row': 6 } };
  await mockSupabase(page, state);
  await loginAs(page);
  await page.goto('/o/miwu/events/ev-1');
  await page.getByRole('button', { name: '桌次' }).click();
  await page.getByRole('button', { name: '圓桌卡' }).click();
  await expect(page.getByText('依設定每排 6 桌')).toBeVisible();
  const grid = page.locator('div.grid.gap-3').first();
  await expect(grid).toHaveAttribute('style', /repeat\(6, minmax\(150px, 1fr\)\)/);
  await page.getByRole('button', { name: '平面圖' }).click();
  await expect(page.locator('div.grid.gap-6').first()).toHaveAttribute('style', /repeat\(6, /);
});

test('唱名名單練習預覽：未報到的唱名貴賓也列出，已唱名不留紀錄、不寫入', async ({ page }) => {
  const state = base();
  state.attendees = [
    { ...guest('李總', '彰化縣農會', '貴賓', 1, false), seq_no: 2, roll_call: true } as never,
    { ...guest('王董', '米屋智農', '貴賓', 1, false), seq_no: 1, roll_call: true } as never,
  ];
  await mockSupabase(page, state);
  await loginAs(page);
  await page.goto('/o/miwu/events/ev-1/roll-call');
  await expect(page.getByText('有唱名資格的貴賓報到後')).toBeVisible();

  await page.getByLabel('🧪 練習預覽').check();
  const names = page.locator('ol li p.text-4xl');
  await expect(names).toHaveText(['王董', '李總']);
  await page.locator('ol li').first().getByRole('button', { name: '✓ 已唱名' }).click();
  await expect(page.locator('ol li').first().getByRole('button', { name: '↺ 取消' })).toBeVisible();

  await page.getByLabel('🧪 練習預覽').uncheck();
  await expect(names).toHaveCount(0);
  await page.getByLabel('🧪 練習預覽').check();
  await expect(page.locator('ol li').first().getByRole('button', { name: '✓ 已唱名' })).toBeVisible();
  expect(state.writes).toEqual([]);
});

test('活動頁全版寬：每排 6 桌的平面圖不必左右捲動', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const state = { ...base(), settingValues: { 'assembly.tables_per_row': 6 } };
  await mockSupabase(page, state);
  await loginAs(page);
  await page.goto('/o/miwu/events/ev-1');
  await page.getByRole('button', { name: '桌次' }).click();
  await page.getByRole('button', { name: '平面圖' }).click();
  const scroller = page.locator('div.overflow-x-auto', { has: page.locator('div.grid.gap-6') }).first();
  await expect(scroller).toBeVisible();
  const { scrollWidth, clientWidth } = await scroller.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(clientWidth).toBeGreaterThan(1400);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  await page.screenshot({ path: test.info().outputPath('floor-wide.png') });
});

test('已唱名存進資料庫：電腦按了，平板（另一台裝置）也看到同樣進度', async ({ page, browser }) => {
  const state = base();
  state.attendees = [
    { ...guest('王董', '米屋智農', '貴賓', 1, true), seq_no: 1, roll_call: true } as never,
    { ...guest('李總', '彰化縣農會', '貴賓', 1, true), seq_no: 2, roll_call: true } as never,
  ];
  await mockSupabase(page, state);
  await loginAs(page);
  await page.goto('/o/miwu/events/ev-1/roll-call');
  await page.locator('ol li').first().getByRole('button', { name: '✓ 已唱名' }).click();
  await expect(page.locator('ol li').first().getByRole('button', { name: '↺ 取消' })).toBeVisible();
  expect(state.rpcBodies?.['/rest/v1/rpc/set_called']).toEqual([{ p_attendee: state.attendees[0].id, p_called: true }]);

  // 另開一個瀏覽器環境＝另一台裝置（不共用 localStorage）
  const tabletContext = await browser.newContext();
  const tablet = await tabletContext.newPage();
  await mockSupabase(tablet, state);
  await loginAs(tablet);
  await tablet.goto(new URL('/o/miwu/events/ev-1/roll-call', page.url()).toString());
  await expect(tablet.locator('ol li').first().getByRole('button', { name: '↺ 取消' })).toBeVisible();
  await expect(tablet.locator('ol li').nth(1).getByRole('button', { name: '✓ 已唱名' })).toBeVisible();
  await expect(tablet.getByText('已唱名 1')).toBeVisible();
  await tabletContext.close();
});

test('名單搜尋：手機（含連字號、末碼）、葷素、桌號、唱名都能搜', async ({ page }) => {
  const state = base();
  state.attendees = [
    { ...guest('王董', '米屋智農', '貴賓', 1, false), seq_no: 1, guest_mobile: '0912345678', diet: '素', roll_call: true } as never,
    { ...guest('李總', '彰化縣農會', '貴賓', 5, false), seq_no: 2, guest_mobile: '0933444555', diet: '葷' } as never,
  ];
  await mockSupabase(page, state);
  await loginAs(page);
  await page.goto('/o/miwu/events/ev-1');
  const search = page.getByLabel('搜尋名單');
  const expectOnly = async (query: string, name: string) => {
    await search.fill(query);
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expect(page.getByText(name === '王董' ? '李總' : '王董', { exact: true })).toHaveCount(0);
  };
  await expectOnly('0912-345', '王董');
  await expectOnly('4555', '李總');
  await expectOnly('素', '王董');
  await expectOnly('第5桌', '李總');
  await expectOnly('唱名', '王董');
});
