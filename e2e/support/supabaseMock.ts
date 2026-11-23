import { readFileSync } from 'node:fs';
import type { Page, Route } from '@playwright/test';

// E2E 共用假後端：所有打向 Supabase 的請求都被攔截並以假資料回應（未攔截者一律 abort），
// 不會讀寫任何真實資料；登入態以假 session 注入 localStorage。

function supabaseHost(): string {
  const env = readFileSync('.env.local', 'utf-8');
  const match = /^VITE_SUPABASE_URL=(.+)$/m.exec(env);
  if (!match) throw new Error('.env.local 缺少 VITE_SUPABASE_URL');
  return new URL(match[1].trim()).host;
}

export const HOST = supabaseHost();
export const STORAGE_KEY = `sb-${HOST.split('.')[0]}-auth-token`;
const USER_ID = '00000000-0000-4000-8000-0000000000aa';
export const ORG = { id: 'org-1', slug: 'miwu', name: '米屋智農', logo_url: null, theme_color: null };
export const EVENT = { id: 'ev-1', org_id: 'org-1', name: '2026 忘年會', kind: 'banquet', status: 'open', starts_at: null, venue: null };

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'staff@example.com' };
  return {
    access_token: `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url({ sub: USER_ID, exp, role: 'authenticated' })}.sig`,
    token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'fake-refresh', user,
  };
}

let seq = 0;
export function guest(name: string, org: string | null, tag: string, tableNo: number | null, checkedIn = false) {
  seq += 1;
  return {
    id: `att-${seq}`, event_id: EVENT.id, seq_no: seq, identity_id: null, guest_name: name, guest_org: org,
    guest_tag: tag, category: 'guest', table_no: tableNo, source: 'import',
    checked_in_at: checkedIn ? '2026-12-20T10:00:00Z' : null, removed_at: null, identities: null,
  };
}

export function person(id: string, name: string, affiliation: string | null = null) {
  return { id, org_id: ORG.id, name, mobile: null, email: null, note: null, affiliation, created_at: '2026-11-21T00:00:00Z', identities: [] };
}

export interface MockState {
  event?: typeof EVENT | (Omit<typeof EVENT, 'status'> & { status: string });
  writes?: string[];
  pickupItems?: { id: string; key: string; label: string; sort: number }[];
  attendees: ReturnType<typeof guest>[];
  greetings: Record<string, unknown>[];
  submitted: { p_greeting: string | null; p_signature: string | null }[];
  persons?: ReturnType<typeof person>[];
  categories?: { id: string; name: string; sort: number }[];
  links?: { person_id: string; category_id: string }[];
  rpcBodies?: Record<string, unknown[]>;
  orgSettings?: { org_id: string; key: string; value: unknown }[];
  catalog?: Record<string, unknown>[];
  settingValues?: Record<string, unknown>;
}

/** PostgREST 查詢參數 `col=eq.value` 取值 */
const eqParam = (url: URL, col: string): string | null => url.searchParams.get(col)?.replace(/^eq\./, '') ?? null;

export async function loginAs(page: Page): Promise<void> {
  await page.addInitScript(([key, session]) => {
    localStorage.setItem(key as string, session as string);
  }, [STORAGE_KEY, JSON.stringify(fakeSession())]);
}

export async function mockSupabase(page: Page, state: MockState): Promise<void> {
  await page.route('**/*', async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.host !== HOST) return route.continue();
    const wantsObject = (route.request().headers().accept ?? '').includes('vnd.pgrst.object');
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    const one = (rows: unknown[]) => json(wantsObject ? rows[0] ?? null : rows);
    const path = url.pathname;
    const method = route.request().method();
    const body = () => route.request().postDataJSON() as Record<string, unknown>;

    // 先記錄所有寫入（RPC 與非 GET 的表操作），再分派回應——放在最前面才不會漏記
    if (path.startsWith('/rest/v1/rpc/') && path !== '/rest/v1/rpc/get_setting') {
      state.writes?.push(path);
      if (state.rpcBodies) state.rpcBodies[path] = [...(state.rpcBodies[path] ?? []), body()];
    }
    if (method !== 'GET' && method !== 'HEAD' && path.startsWith('/rest/v1/') && !path.startsWith('/rest/v1/rpc/')) {
      state.writes?.push(`${method} ${path}`);
    }

    if (path.startsWith('/auth/v1/')) return json({ user: fakeSession().user });
    if (path === '/rest/v1/organizations') return one([ORG]);
    if (path === '/rest/v1/org_users') return one([{ role: 'secretary_general' }]);
    if (path === '/rest/v1/role_permissions') {
      return json(['events.write', 'checkin.write', 'persons.write', 'org_settings.write'].map((perm) => ({ perm })));
    }
    if (path === '/rest/v1/events') return one([state.event ?? EVENT]);
    if (path === '/rest/v1/event_attendees') {
      if (method === 'PATCH') {
        const id = eqParam(url, 'id');
        const patch = body();
        state.attendees = state.attendees.map((a) => (a.id === id ? { ...a, ...patch } : a));
        return json(state.attendees.filter((a) => a.id === id));
      }
      if (method === 'POST') return json(null);
      const rollCallOnly = url.searchParams.get('roll_call') === 'eq.true';
      return json(rollCallOnly ? state.attendees.filter((a) => (a as Record<string, unknown>).roll_call) : state.attendees);
    }
    if (path === '/rest/v1/event_tables') {
      return json([{ id: 't1', table_no: 1, capacity: 10, label: '貴賓桌' }, { id: 't5', table_no: 5, capacity: 10, label: null }]);
    }
    if (path === '/rest/v1/attendee_greetings') return json(state.greetings);
    if (path === '/rest/v1/pickup_items') return json(state.pickupItems ?? []);
    if (path === '/rest/v1/fee_invoices') return json([]);
    if (path === '/rest/v1/attendee_pickups') return json(method === 'GET' ? [] : null);
    if (path === '/rest/v1/settings_catalog') return json(state.catalog ?? []);
    if (path === '/rest/v1/org_settings') return json(method === 'GET' ? state.orgSettings ?? [] : null);
    if (path === '/rest/v1/persons') return json(state.persons ?? []);
    if (path === '/rest/v1/person_categories') {
      if (method === 'POST') {
        const row = body();
        state.categories = [...(state.categories ?? []), { id: `cat-${(state.categories ?? []).length + 1}`, name: String(row.name), sort: Number(row.sort) }];
        return json(null);
      }
      return json(state.categories ?? []);
    }
    if (path === '/rest/v1/person_category_links') {
      if (method === 'POST') {
        const row = body();
        state.links = [...(state.links ?? []), { person_id: String(row.person_id), category_id: String(row.category_id) }];
        return json(null);
      }
      if (method === 'DELETE') {
        const personId = eqParam(url, 'person_id');
        const categoryId = eqParam(url, 'category_id');
        state.links = (state.links ?? []).filter((l) => !(l.person_id === personId && l.category_id === categoryId));
        return json(null);
      }
      return json(state.links ?? []);
    }
    if (path === '/rest/v1/rpc/import_people_by_category') return json({ ok: true, inserted: 1, skipped: 0 });
    if (path === '/rest/v1/rpc/import_guests') return json({ ok: true, inserted: 2, skipped: 0, tables_created: 0 });
    if (path === '/rest/v1/rpc/import_members') return json({ ok: true, created: 2, merged: 1, categories_created: 2, links_added: 4 });
    if (path === '/rest/v1/rpc/undo_checkin') return json({ ok: true });
    if (path === '/rest/v1/rpc/add_walkin') return json({ ok: true });
    if (path === '/rest/v1/rpc/get_setting') {
      const { p_key: key } = body() as { p_key: string };
      if (state.settingValues && key in state.settingValues) return json(state.settingValues[key]);
      return json(key === 'vip.greeting_phrases' ? ['生意興隆，年年有餘', '風調雨順，五穀豐收'] : null);
    }
    if (path === '/rest/v1/rpc/check_in') {
      const { p_attendee: id } = body() as { p_attendee: string };
      state.attendees = state.attendees.map((a) =>
        a.id === id ? { ...a, checked_in_at: new Date().toISOString() } : a);
      return json({ ok: true, already: false });
    }
    if (path === '/rest/v1/rpc/submit_greeting') {
      const greeting = body() as { p_attendee: string; p_greeting: string | null; p_signature: string | null };
      state.submitted.push(greeting);
      const attendee = state.attendees.find((a) => a.id === greeting.p_attendee);
      state.greetings.push({
        attendee_id: greeting.p_attendee, greeting: greeting.p_greeting, signature: greeting.p_signature, hidden_at: null,
        updated_at: new Date().toISOString(), event_attendees: { ...attendee },
      });
      return json({ ok: true });
    }
    return route.abort();  // 未預期的請求一律擋下，絕不打到真實後端
  });
}
