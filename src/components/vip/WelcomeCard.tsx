import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import SignaturePad from './SignaturePad';
import type { VipEntry } from '../../lib/vip';

interface WelcomeCardProps {
  entry: VipEntry;
  tableLabel: string | null;
  phrases: string[];
  /** 報到排入離線佇列時為 true：祝福必須等回網才能送 */
  isQueued: boolean;
  onClose: () => void;
}

const GREETING_ERRORS: Record<string, string> = {
  not_checked_in: '報到尚未完成同步，請稍後再送出祝福',
  forbidden: '這個帳號沒有報到權限',
  removed: '此人已從名單除名',
  empty: '請選一句祝福或簽名',
  invalid: '簽名格式不正確，請重新簽名',
};

/** 報到後的歡迎卡：大字桌號＋祝福詞＋手寫簽名（送不出去不影響報到） */
export default function WelcomeCard({ entry, tableLabel, phrases, isQueued, onClose }: WelcomeCardProps) {
  const [phrase, setPhrase] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [isSigning, setIsSigning] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const { attendee } = entry;

  const send = async () => {
    setStatus('sending');
    setMessage(null);
    const { data, error } = await supabase.rpc('submit_greeting', {
      p_attendee: attendee.id, p_greeting: phrase, p_signature: signature,
    });
    const result = data as { ok: boolean; error?: string } | null;
    if (error || !result?.ok) {
      setStatus('idle');
      setMessage(GREETING_ERRORS[result?.error ?? ''] ?? '祝福送出失敗，可以略過，不影響報到');
      return;
    }
    setStatus('sent');
  };

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-stone-950/95 text-stone-50" role="dialog" aria-modal="true"
      aria-label="歡迎蒞臨">
      <div className="mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center gap-6 px-6 py-10 text-center">
        <p className="text-2xl tracking-[0.6em] text-amber-300">歡迎蒞臨</p>
        <div>
          <p className="text-5xl sm:text-6xl font-black">{entry.name}</p>
          <p className="mt-3 text-xl text-stone-300">{[entry.org, entry.tag].filter(Boolean).join('・')}</p>
        </div>

        <div className="w-full max-w-sm rounded-3xl border-2 border-amber-400 bg-amber-400/10 px-6 py-5">
          <p className="text-lg text-amber-200">您的桌號</p>
          {attendee.table_no !== null ? (
            <>
              <p className="text-7xl font-black text-amber-300">第 {attendee.table_no} 桌</p>
              {tableLabel && <p className="mt-1 text-xl text-amber-100">{tableLabel}</p>}
            </>
          ) : (
            <p className="py-4 text-3xl font-bold text-amber-100">請洽接待人員</p>
          )}
        </div>

        {status === 'sent' ? (
          <p className="text-2xl text-green-300">🙏 已收到您的祝福，謝謝！</p>
        ) : (
          <section className="w-full space-y-4">
            <p className="text-xl">🙏 感謝您的蒞臨，留下一句祝福</p>
            <div className="flex flex-wrap justify-center gap-3">
              {phrases.map((p) => (
                <button key={p} type="button" onClick={() => setPhrase(phrase === p ? null : p)}
                  className={`rounded-full border-2 px-5 py-3 text-lg ${phrase === p
                    ? 'border-amber-300 bg-amber-300 font-bold text-stone-900'
                    : 'border-stone-500 hover:border-amber-300'}`}>
                  {p}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {signature && <img src={signature} alt="您的簽名" className="h-16 rounded bg-white" />}
              <button type="button" onClick={() => setIsSigning(true)}
                className="rounded-xl border-2 border-stone-500 px-5 py-3 text-lg hover:border-amber-300">
                ✍️ {signature ? '重新簽名' : '簽名'}
              </button>
            </div>
            {isQueued && <p className="text-amber-200">目前離線，網路恢復後才能送出祝福。</p>}
            {message && <p className="text-red-300">{message}</p>}
          </section>
        )}

        <div className="flex flex-wrap justify-center gap-3 text-lg">
          {status !== 'sent' && (
            <button type="button" onClick={() => void send()}
              disabled={isQueued || status === 'sending' || (!phrase && !signature)}
              className="rounded-xl bg-amber-400 px-8 py-4 font-bold text-stone-900 disabled:opacity-40">
              {status === 'sending' ? '送出中…' : '送出祝福'}
            </button>
          )}
          <button type="button" onClick={onClose}
            className="rounded-xl border-2 border-stone-500 px-8 py-4 hover:border-stone-300">
            {status === 'sent' ? '完成' : '略過，直接入座'}
          </button>
        </div>
      </div>

      {isSigning && (
        <SignaturePad
          onConfirm={(dataUrl) => { setSignature(dataUrl); setIsSigning(false); }}
          onCancel={() => setIsSigning(false)} />
      )}
    </div>
  );
}
