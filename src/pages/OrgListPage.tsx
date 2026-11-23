import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import type { Organization } from '../lib/types';
import { FEATURE_KEYS } from '../lib/features';

export default function OrgListPage() {
  const { session } = useAuth();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // 關閉「會員」功能的協會：主按鈕改進「活動」
  const [membersOff, setMembersOff] = useState<ReadonlySet<string>>(new Set());

  const reload = useCallback(async () => {
    const [{ data }, { data: flagRows }] = await Promise.all([
      supabase.from('organizations').select('*').order('created_at'),
      supabase.from('org_settings').select('org_id, value').eq('key', FEATURE_KEYS.members),
    ]);
    setOrgs(data ?? []);
    setMembersOff(new Set(((flagRows ?? []) as { org_id: string; value: unknown }[])
      .filter((r) => r.value === false).map((r) => r.org_id)));
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <main className="min-h-screen bg-stone-50 text-stone-800">
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-black">🐝 我的協會</h1>
          <div className="text-sm text-stone-500 flex items-center gap-3">
            <span>{session?.user.email}</span>
            <button
              onClick={() => void supabase.auth.signOut()}
              className="rounded border border-stone-300 px-2 py-1 hover:bg-stone-100"
            >
              登出
            </button>
          </div>
        </header>

        <section className="bg-white rounded-xl shadow p-5">
          {isLoading && <p className="text-stone-400">載入中…</p>}
          {!isLoading && orgs.length === 0 && (
            <p className="text-stone-500">還沒有協會——先建立一個，或等待邀請連結。</p>
          )}
          <ul className="divide-y divide-stone-100">
            {orgs.map((org) => (
              <li key={org.id} className="py-3 flex items-center justify-between">
                <div>
                  <p className="font-bold">{org.name}</p>
                  <p className="text-xs text-stone-400">/{org.slug}</p>
                </div>
                <div className="flex gap-2 text-sm">
                  <Link
                    to={`/o/${org.slug}/${membersOff.has(org.id) ? 'events' : 'members'}`}
                    className="rounded bg-amber-600 px-3 py-1.5 text-white hover:bg-amber-700"
                  >
                    {membersOff.has(org.id) ? '活動' : '會員'}
                  </Link>
                  <Link
                    to={`/o/${org.slug}/team`}
                    className="rounded border border-stone-300 px-3 py-1.5 hover:bg-stone-100"
                  >
                    團隊
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <Link
          to="/new"
          className="block text-center rounded-xl border-2 border-dashed border-stone-300 py-4 text-stone-500 hover:border-amber-500 hover:text-amber-700"
        >
          ＋ 開新協會（精靈：名稱 → 代號 → LOGO → 主題色）
        </Link>
        <SetPasswordCard />
      </div>
    </main>
  );
}

function SetPasswordCard() {
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const { error } = await supabase.auth.updateUser({ password });
    setMessage(error ? `設定失敗：${error.message}` : '密碼已設定，之後可用密碼登入。');
    if (!error) setPassword('');
  };

  return (
    <section className="bg-white rounded-xl shadow p-5 space-y-3">
      <h2 className="font-bold">密碼備援</h2>
      <p className="text-xs text-stone-500">平常用 Email 登入連結即可；設定密碼後多一條備援登入路徑。</p>
      <form onSubmit={handleSubmit} className="flex gap-2 text-sm">
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="新密碼（至少 8 碼）"
          className="flex-1 rounded border border-stone-300 px-3 py-2"
        />
        <button type="submit" className="rounded border border-stone-300 px-4 py-2 hover:bg-stone-100">
          設定密碼
        </button>
      </form>
      {message && <p className="text-sm text-stone-600">{message}</p>}
    </section>
  );
}
