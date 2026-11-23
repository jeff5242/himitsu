import { expect, test } from '@playwright/test';
import { ORG, loginAs, mockSupabase } from './support/supabaseMock';
import type { MockState } from './support/supabaseMock';

// 功能開關：米屋關閉會員／會費／裝置後，選單、名單頁會員匯入卡、設定頁會員項目都隱藏（假後端）

const base = (): MockState => ({ writes: [], attendees: [], greetings: [], submitted: [], rpcBodies: {}, categories: [], links: [] });
const OFF = [
  { org_id: ORG.id, key: 'features.members', value: false },
  { org_id: ORG.id, key: 'features.fees', value: false },
  { org_id: ORG.id, key: 'features.devices', value: false },
];
const CATALOG = [
  { key: 'member_no.next_seq', category: '會員編號', label: '下一個流水號', description: null, value_type: 'number', default_value: 1, sort: 11 },
  { key: 'fees.group_annual', category: '會費', label: '團體常年會費', description: null, value_type: 'number', default_value: 5000, sort: 20 },
  { key: 'features.members', category: '功能開關', label: '會員模組', description: '關閉後隱藏「會員」', value_type: 'boolean', default_value: true, sort: 48 },
];

test('功能開關關閉：隱藏會員、會費、裝置', async ({ page }) => {
  const state = { ...base(), orgSettings: OFF, catalog: CATALOG };
  await mockSupabase(page, state);
  await loginAs(page);

  await page.goto('/o/miwu/events/ev-1');
  const nav = page.getByRole('navigation').first();
  await expect(nav.getByRole('link', { name: '活動' })).toBeVisible();
  await expect(nav.getByRole('link', { name: '會員' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: '會費' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: '裝置' })).toHaveCount(0);
  await expect(page.getByText('CSV 匯入來賓')).toBeVisible();
  await expect(page.getByText('依會籍狀態匯入')).toHaveCount(0);
  await expect(page.getByText('依人員分類匯入')).toHaveCount(0);

  await page.goto('/o/miwu/members');
  await expect(page.getByText('這個協會已關閉「會員」功能')).toBeVisible();

  await page.goto('/o/miwu/settings');
  await expect(page.getByText('會員模組')).toBeVisible();
  await expect(page.getByText('人員分類')).toHaveCount(0);
  await expect(page.getByText('團體常年會費')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/features-off.png', fullPage: true });
});

test('功能開關預設全開：會員、會費、裝置都在', async ({ page }) => {
  await mockSupabase(page, { ...base(), catalog: CATALOG });
  await loginAs(page);
  await page.goto('/o/miwu/events/ev-1');
  const nav = page.getByRole('navigation').first();
  await expect(nav.getByRole('link', { name: '會員' })).toBeVisible();
  await expect(nav.getByRole('link', { name: '會費' })).toBeVisible();
  await expect(nav.getByRole('link', { name: '裝置' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '依人員分類匯入' })).toBeVisible();
});
