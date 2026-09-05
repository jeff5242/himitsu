import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { INVITE_ERROR_MESSAGES } from '../lib/roles';

type AcceptResult =
  | { ok: true; org_slug: string; org_name: string; role: string }
  | { ok: false; error: string };

/** 受邀入職頁：/invite/:token——未登入者先寄登入連結（回到本頁），已登入者直接接受邀請 */
export default function InvitePage() {
  const { token } = useParams();
  const { session, isLoading } = useAuth();
  const [result, setResult] = useState<AcceptResult | null>(null);
  const hasAcceptedRef = useRef(false);

  useEffect(() => {
    if (!session || !token || hasAcceptedRef.current) return;
    hasAcceptedRef.current = true;
    supabase
      .rpc('accept_invitation', { p_token: token })
      .then(({ data, error }) => {
        if (error) setResult({ ok: false, error: error.message });
        else setResult(data as AcceptResult);
      });
  }, [session, token]);

  return (
    <main className="min-h-screen bg-stone-50 text-stone-800 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-xl shadow p-6 space-y-4 text-center">
        <div className="text-4xl">🐝</div>
        <h1 className="text-xl font-black">HiMitsu 邀請</h1>

        {isLoading && <p className="text-stone-400">載入中…</p>}

        {!isLoading && !session && <InviteLogin />}

        {session && !result && <p className="text-stone-500">正在確認邀請…</p>}

        {result?.ok && (
          <div className="space-y-3">
            <p className="text-green-700 font-bold">已加入「{result.org_name}」！</p>
            <Link
              to={`/o/${result.org_slug}/members`}
              className="inline-block rounded bg-amber-600 px-4 py-2 font-bold text-white hover:bg-amber-700"
            >
              進入協會
            </Link>
          </div>
        )}
        {result && !result.ok && (
          <p className="text-red-600">
            {INVITE_ERROR_MESSAGES[result.error] ?? `邀請無法使用（${result.error}）`}
          </p>
        )}
      </div>
    </main>
  );
}

function InviteLogin() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href },  // 登入後回到本邀請頁
    });
    setMessage(error ? `寄送失敗：${error.message}` : '登入連結已寄出，請從信箱點回本頁。');
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 text-left">
      <p className="text-sm text-stone-500 text-center">請先以受邀的 Email 登入：</p>
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="受邀 Email"
        className="w-full rounded border border-stone-300 px-3 py-2 text-sm"
      />
      <button
        type="submit"
        className="w-full rounded bg-amber-600 py-2 font-bold text-white hover:bg-amber-700"
      >
        寄送登入連結
      </button>
      {message && <p className="text-sm text-stone-600 text-center">{message}</p>}
    </form>
  );
}
