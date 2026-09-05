import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';

export default function App() {
  const [status, setStatus] = useState<'checking' | 'ok' | 'error'>('checking');

  useEffect(() => {
    // 煙霧測試：能連上 himitsu schema 即為綠燈（表尚未建立時 404/42P01 也算連線成功）
    supabase
      .from('health')
      .select('*')
      .limit(1)
      .then(({ error }) => {
        if (!error || error.code === '42P01' || error.code === 'PGRST205') setStatus('ok');
        else setStatus('error');
      });
  }, []);

  return (
    <main className="min-h-screen bg-stone-50 text-stone-800 flex items-center justify-center">
      <div className="text-center space-y-4 p-8">
        <div className="text-6xl">🐝</div>
        <h1 className="text-3xl font-black tracking-wide">HiMitsu</h1>
        <p className="text-stone-500">公協會的 AI 秘書處作業系統</p>
        <p className="text-sm">
          Supabase（himitsu schema）：
          {status === 'checking' && <span className="text-amber-600">連線中…</span>}
          {status === 'ok' && <span className="text-green-700 font-bold">✓ 連線正常</span>}
          {status === 'error' && <span className="text-red-600 font-bold">✗ 連線失敗</span>}
        </p>
      </div>
    </main>
  );
}
