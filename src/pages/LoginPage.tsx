import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

type Mode = 'magic' | 'password';

export default function LoginPage() {
  const { session, isLoading } = useAuth();
  const [searchParams] = useSearchParams();
  const next = searchParams.get('next') ?? '/';

  const [mode, setMode] = useState<Mode>('magic');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (isLoading) return <Centered>載入中…</Centered>;
  if (session) return <Navigate to={next} replace />;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      if (mode === 'magic') {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: window.location.origin + next },
        });
        if (error) setErrorMessage(`寄送失敗：${error.message}`);
        else setMessage('登入連結已寄出，請到信箱點擊連結完成登入。');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setErrorMessage(`登入失敗：${error.message}`);
        // 成功時 onAuthStateChange 會更新 session，自動導向
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Centered>
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <div className="text-5xl">🐝</div>
          <h1 className="text-2xl font-black">HiMitsu</h1>
          <p className="text-sm text-stone-500">公協會的 AI 秘書處作業系統</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow p-6 space-y-4">
          <label className="block text-sm">
            <span className="text-stone-600">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded border border-stone-300 px-3 py-2"
              placeholder="you@example.com"
            />
          </label>

          {mode === 'password' && (
            <label className="block text-sm">
              <span className="text-stone-600">密碼</span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded border border-stone-300 px-3 py-2"
              />
            </label>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded bg-amber-600 py-2 font-bold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {mode === 'magic' ? '寄送登入連結' : '登入'}
          </button>

          <button
            type="button"
            onClick={() => setMode(mode === 'magic' ? 'password' : 'magic')}
            className="w-full text-sm text-stone-500 hover:text-stone-700"
          >
            {mode === 'magic' ? '改用密碼登入' : '改用 Email 登入連結'}
          </button>

          {message && <p className="text-sm text-green-700">{message}</p>}
          {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}
        </form>
        <p className="text-xs text-stone-400 text-center">
          第一次使用？用「寄送登入連結」即可建立帳號；登入後可在首頁設定密碼備援。
        </p>
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-stone-50 text-stone-800 flex items-center justify-center p-4">
      {children}
    </main>
  );
}
