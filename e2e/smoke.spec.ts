import { expect, test } from '@playwright/test';

test.describe('未登入煙霧測試', () => {
  test('redirects unauthenticated visitor from home to login with next param', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'HiMitsu' })).toBeVisible();
  });

  test('protected org page redirects to login and keeps next path', async ({ page }) => {
    await page.goto('/o/demo/members');
    await expect(page).toHaveURL(/\/login\?next=%2Fo%2Fdemo%2Fmembers/);
  });

  test('login page offers magic link first and password as fallback', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: '寄送登入連結' })).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);

    await page.getByRole('button', { name: '改用密碼登入' }).click();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: '登入', exact: true })).toBeVisible();

    await page.getByRole('button', { name: '改用 Email 登入連結' }).click();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });

  test('invite page asks unauthenticated visitor to log in with invited email', async ({ page }) => {
    await page.goto('/invite/00000000-0000-4000-8000-000000000000');
    await expect(page.getByRole('heading', { name: 'HiMitsu 邀請' })).toBeVisible();
    await expect(page.getByPlaceholder('受邀 Email')).toBeVisible();
  });

  test('unknown route falls back to login redirect', async ({ page }) => {
    await page.goto('/no-such-page');
    await expect(page).toHaveURL(/\/login/);
  });

  test('kiosk page loads without auth and guides when local agent is absent', async ({ page }) => {
    await page.goto('/kiosk');
    await expect(page).toHaveURL(/\/kiosk/); // 免登入：不得被導去 /login
    await expect(page.getByText('找不到本地代理')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('kiosk-agent.py run')).toBeVisible();
  });
});
