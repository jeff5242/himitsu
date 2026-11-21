import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

// 貴賓報到＋祝福牆的畫面流程測試。
// 所有打向 Supabase 的請求都被攔截並以假資料回應（未攔截者一律 abort），
// 不會讀寫任何真實資料；登入態以假 session 注入 localStorage。

function supabaseHost(): string {
  const env = readFileSync('.env.local', 'utf-8');
  const match = /^VITE_SUPABASE_URL=(.+)$/m.exec(env);
  if (!match) throw new Error('.env.local 缺少 VITE_SUPABASE_URL');
  return new URL(match[1].trim()).host;
}

const HOST = supabaseHost();
const STORAGE_KEY = `sb-${HOST.split('.')[0]}-auth-token`;
const USER_ID = '00000000-0000-4000-8000-0000000000aa';
const ORG = { id: 'org-1', slug: 'miwu', name: '米屋智農', logo_url: null, theme_color: null };
const EVENT = { id: 'ev-1', org_id: 'org-1', name: '2026 忘年會', kind: 'banquet', status: 'open', starts_at: null, venue: null };

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'staff@example.com' };
  return {
    access_token: `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url({ sub: USER_ID, exp, role: 'authenticated' })}.sig`,
    token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'fake-refresh', user,
  };
}

let seq = 0;
function guest(name: string, org: string | null, tag: string, tableNo: number | null, checkedIn = false) {
  seq += 1;
  return {
    id: `att-${seq}`, event_id: EVENT.id, seq_no: seq, identity_id: null, guest_name: name, guest_org: org,
    guest_tag: tag, category: 'guest', table_no: tableNo, source: 'import',
    checked_in_at: checkedIn ? '2026-12-20T10:00:00Z' : null, removed_at: null, identities: null,
  };
}

interface MockState {
  attendees: ReturnType<typeof guest>[];
  greetings: Record<string, unknown>[];
  submitted: { p_greeting: string | null; p_signature: string | null }[];
}

async function mockSupabase(page: Page, state: MockState) {
  await page.route('**/*', async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.host !== HOST) return route.continue();
    const wantsObject = (route.request().headers().accept ?? '').includes('vnd.pgrst.object');
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    const one = (rows: unknown[]) => json(wantsObject ? rows[0] ?? null : rows);
    const path = url.pathname;

    if (path.startsWith('/auth/v1/')) return json({ user: fakeSession().user });
    if (path === '/rest/v1/organizations') return one([ORG]);
    if (path === '/rest/v1/org_users') return one([{ role: 'secretary' }]);
    if (path === '/rest/v1/role_permissions') return json([{ perm: 'events.write' }, { perm: 'checkin.write' }]);
    if (path === '/rest/v1/events') return one([EVENT]);
    if (path === '/rest/v1/event_attendees') return json(state.attendees);
    if (path === '/rest/v1/event_tables') return json([{ table_no: 1, label: '貴賓桌' }, { table_no: 5, label: null }]);
    if (path === '/rest/v1/attendee_greetings') return json(state.greetings);
    if (path === '/rest/v1/rpc/get_setting') {
      const { p_key: key } = route.request().postDataJSON() as { p_key: string };
      return json(key === 'vip.greeting_phrases' ? ['生意興隆，年年有餘', '風調雨順，五穀豐收'] : null);
    }
    if (path === '/rest/v1/rpc/check_in') {
      const { p_attendee: id } = route.request().postDataJSON() as { p_attendee: string };
      state.attendees = state.attendees.map((a) =>
        a.id === id ? { ...a, checked_in_at: new Date().toISOString() } : a);
      return json({ ok: true, already: false });
    }
    if (path === '/rest/v1/rpc/submit_greeting') {
      const body = route.request().postDataJSON() as { p_attendee: string; p_greeting: string | null; p_signature: string | null };
      state.submitted.push(body);
      const attendee = state.attendees.find((a) => a.id === body.p_attendee);
      state.greetings.push({
        attendee_id: body.p_attendee, greeting: body.p_greeting, signature: body.p_signature, hidden_at: null,
        updated_at: new Date().toISOString(), event_attendees: { ...attendee },
      });
      return json({ ok: true });
    }
    return route.abort();  // 未預期的請求一律擋下，絕不打到真實後端
  });
}

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
});
