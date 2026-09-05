import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import type { Organization } from '../lib/types';

export default function OrgListPage() {
  const { session } = useAuth();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const reload = useCallback(async () => {
    const { data } = await supabase.from('organizations').select('*').order('created_at');
    setOrgs(data ?? []);
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
                    to={`/o/${org.slug}/members`}
                    className="rounded bg-amber-600 px-3 py-1.5 text-white hover:bg-amber-700"
                  >
                    成員
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

        <CreateOrgCard onCreated={reload} />
        <SetPasswordCard />
      </div>
    </main>
  );
}

function CreateOrgCard({ onCreated }: { onCreated: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);
    const { data, error } = await supabase.rpc('create_organization', {
      p_name: name,
      p_slug: slug,
    });
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    const result = data as { ok: boolean; error?: string };
    if (!result.ok) {
      setErrorMessage(result.error === 'slug_taken' ? '這個代號已被使用' : (result.error ?? '建立失敗'));
      return;
    }
    setName('');
    setSlug('');
    await onCreated();
  };

  return (
    <section className="bg-white rounded-xl shadow p-5 space-y-3">
      <h2 className="font-bold">建立新協會</h2>
      <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 text-sm">
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="協會名稱"
          className="flex-1 min-w-40 rounded border border-stone-300 px-3 py-2"
        />
        <input
          required
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          placeholder="網址代號（英數）"
          pattern="[a-z0-9][a-z0-9-]{1,40}"
          className="w-44 rounded border border-stone-300 px-3 py-2"
        />
        <button type="submit" className="rounded bg-amber-600 px-4 py-2 font-bold text-white hover:bg-amber-700">
          建立
        </button>
      </form>
      {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}
    </section>
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
