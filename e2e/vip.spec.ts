import { expect, test } from '@playwright/test';
import { EVENT, STORAGE_KEY, fakeSession, guest, mockSupabase } from './support/supabaseMock';
import type { MockState } from './support/supabaseMock';

// 貴賓報到＋祝福牆＋練習模式＋報到台的畫面流程測試（假後端見 support/supabaseMock.ts）。

test.describe('貴賓報到（假資料）', () => {
  test.use({ viewport: { width: 1180, height: 820 } });  // iPad Air 橫放

  test('篩選、報到、歡迎卡桌號、祝福＋簽名、祝福牆', async ({ page }) => {
    const state: MockState = {
      attendees: [
        guest('王小明', '米屋智農', '貴賓', 1),
        guest('李美華', '米屋智農', '貴賓', 1, true),
        guest('陳大華', '後壁鄉', '農民', 5),
        guest('陳阿土', '後壁鄉', '農民', 5),
        guest('林小美', '新營區', '農民', null),
      ],
      greetings: [],
      submitted: [],
    };
    await mockSupabase(page, state);
    await page.addInitScript(([key, session]) => {
      localStorage.setItem(key as string, session as string);
    }, [STORAGE_KEY, JSON.stringify(fakeSession())]);

    await page.goto('/o/miwu/events/ev-1/vip');
    await expect(page.getByRole('heading', { name: '貴賓報到' })).toBeVisible();
    await expect(page.getByText('已報到 1／5')).toBeVisible();

    // 身分篩選：農民 3 位，計數 0/3
    await page.getByRole('button', { name: /^農民/ }).click();
    await expect(page.locator('article')).toHaveCount(3);
    await page.getByRole('button', { name: '全部' }).first().click();
    await expect(page.locator('article')).toHaveCount(5);
    await page.screenshot({ path: 'test-results/vip-list.png', fullPage: true });

    // 報到 → 歡迎卡顯示桌號與桌名
    const card = page.locator('article', { hasText: '王小明' });
    await card.getByRole('button', { name: '貴賓報到' }).click();
    const welcome = page.getByRole('dialog', { name: '歡迎蒞臨' });
    await expect(welcome.getByText('第 1 桌')).toBeVisible();
    await expect(welcome.getByText('貴賓桌')).toBeVisible();

    // 選祝福詞＋簽名
    await welcome.getByRole('button', { name: '生意興隆，年年有餘' }).click();
    await welcome.getByRole('button', { name: /簽名/ }).click();
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas 沒有出現');
    await page.mouse.move(box.x + 60, box.y + 150);
    await page.mouse.down();
    for (let i = 1; i <= 12; i += 1) await page.mouse.move(box.x + 60 + i * 40, box.y + 150 + (i % 2 ? -50 : 50));
    await page.mouse.up();
    await page.getByRole('button', { name: '✓ 確定' }).click();
    await expect(welcome.getByAltText('您的簽名')).toBeVisible();
    await page.screenshot({ path: 'test-results/vip-welcome.png' });

    await welcome.getByRole('button', { name: '送出祝福' }).click();
    await expect(welcome.getByText('已收到您的祝福，謝謝！')).toBeVisible();
    expect(state.submitted[0].p_greeting).toBe('生意興隆，年年有餘');
    expect(state.submitted[0].p_signature).toMatch(/^data:image\/png;base64,/);
    expect(state.submitted[0].p_signature!.length).toBeLessThan(200_000);

    await welcome.getByRole('button', { name: '完成' }).click();
    await expect(page.getByText('已報到 2／5')).toBeVisible();
    await expect(card.getByRole('button', { name: /✓ 已報到/ })).toBeVisible();

    // 祝福牆
    await page.goto('/o/miwu/events/ev-1/blessings');
    await expect(page.getByText('「生意興隆，年年有餘」')).toBeVisible();
    await expect(page.getByAltText('王小明 的簽名')).toBeVisible();
    await expect(page.getByText('份祝福')).toContainText('1');
    await page.screenshot({ path: 'test-results/blessing-wall.png' });
  });

  test('報到練習：籌備中、名單空白也能演練，且完全不寫入', async ({ page }) => {
    const state: MockState = {
      event: { ...EVENT, status: 'draft' },
      writes: [],
      attendees: [],
      greetings: [],
      submitted: [],
    };
    await mockSupabase(page, state);
    await page.addInitScript(([key, session]) => {
      localStorage.setItem(key as string, session as string);
    }, [STORAGE_KEY, JSON.stringify(fakeSession())]);

    await page.goto('/o/miwu/events/ev-1/practice');
    await expect(page.getByRole('heading', { name: '報到練習' })).toBeVisible();
    await expect(page.getByText(/練習模式/)).toBeVisible();
    await expect(page.getByText('先用 10 位範例來賓練習')).toBeVisible();
    await expect(page.getByText('已報到 0／10')).toBeVisible();
    await expect(page.getByText('活動目前不是「報到開放」狀態')).toHaveCount(0);

    const card = page.locator('article', { hasText: '王小明' });
    await card.getByRole('button', { name: '貴賓報到' }).click();
    const welcome = page.getByRole('dialog', { name: '歡迎蒞臨' });
    await expect(welcome.getByText('第 1 桌')).toBeVisible();
    await expect(welcome.getByText('主桌')).toBeVisible();
    await welcome.getByRole('button', { name: '生意興隆，年年有餘' }).click();
    await welcome.getByRole('button', { name: '送出祝福' }).click();
    await expect(welcome.getByText('已收到您的祝福，謝謝！')).toBeVisible();
    await welcome.getByRole('button', { name: '完成' }).click();
    await expect(page.getByText('已報到 1／10')).toBeVisible();
    await page.screenshot({ path: 'test-results/vip-practice.png', fullPage: true });

    await page.getByRole('button', { name: '↺ 重新練習' }).click();
    await expect(page.getByText('已報到 0／10')).toBeVisible();

    expect(state.writes).toEqual([]);
    expect(state.submitted).toEqual([]);
  });

  test('報到台練習：籌備中可用，報到／發放／現場報名／撤銷都不寫入', async ({ page }) => {
    const state: MockState = { event: { ...EVENT, status: 'draft' }, writes: [], attendees: [], greetings: [], submitted: [] };
    await mockSupabase(page, state);
    await page.addInitScript(([key, session]) => {
      localStorage.setItem(key as string, session as string);
    }, [STORAGE_KEY, JSON.stringify(fakeSession())]);

    await page.goto('/o/miwu/events/ev-1/checkin-practice');
    await expect(page.getByRole('heading', { name: '報到台練習' })).toBeVisible();
    await expect(page.getByText('已報到 0／10')).toBeVisible();

    await page.getByLabel('搜尋名單').fill('陳大華');
    const card = page.locator('section', { hasText: '陳大華' });
    await card.getByRole('button', { name: '報到', exact: true }).click();
    await expect(card.getByText('✓ 已報到')).toBeVisible();
    await card.getByRole('button', { name: '伴手禮' }).click();
    await expect(card.getByRole('button', { name: '✓ 伴手禮' })).toBeVisible();

    await page.getByPlaceholder('姓名', { exact: true }).fill('路過的阿伯');
    await page.getByRole('button', { name: '加入名單' }).click();
    await expect(page.getByText('已報到 1／11')).toBeVisible();

    await card.getByRole('button', { name: '撤銷報到' }).click();
    await expect(page.getByText('已報到 0／11')).toBeVisible();
    await page.getByLabel('搜尋名單').fill('');
    await page.screenshot({ path: 'test-results/checkin-practice.png', fullPage: true });

    await page.getByRole('button', { name: '↺ 重新練習' }).click();
    await expect(page.getByText('已報到 0／10')).toBeVisible();
    expect(state.writes).toEqual([]);
  });

  test('正式報到台（拆元件後回歸）：報到、發放、現場報名都會寫入', async ({ page }) => {
    const state: MockState = {
      writes: [], greetings: [], submitted: [],
      attendees: [guest('陳大華', '二林鎮', '農民', 2)],
      pickupItems: [{ id: 'pi-1', key: 'gift', label: '伴手禮', sort: 0 }],
    };
    await mockSupabase(page, state);
    await page.addInitScript(([key, session]) => {
      localStorage.setItem(key as string, session as string);
    }, [STORAGE_KEY, JSON.stringify(fakeSession())]);

    await page.goto('/o/miwu/events/ev-1');
    await page.getByRole('button', { name: '報到台' }).click();
    const card = page.locator('section', { hasText: '陳大華' });
    await card.getByRole('button', { name: '報到', exact: true }).click();
    await expect(card.getByText('✓ 已報到')).toBeVisible();
    await card.getByRole('button', { name: '伴手禮' }).click();
    await page.getByPlaceholder('姓名', { exact: true }).fill('路過的阿伯');
    await page.getByRole('button', { name: '加入名單' }).click();
    await expect.poll(() => state.writes).toEqual(expect.arrayContaining([
      '/rest/v1/rpc/check_in', 'POST /rest/v1/attendee_pickups', '/rest/v1/rpc/add_walkin',
    ]));
  });
});
