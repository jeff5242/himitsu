import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const STEPS = ['基本資料', 'LOGO', '主題色', '確認'] as const;
const DEFAULT_THEME_COLOR = '#d97706';

/** 開新協會精靈（EPIC-0 §0-1：名稱→代號→LOGO→主題色，建立者自動成 owner） */
export default function WizardPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [themeColor, setThemeColor] = useState(DEFAULT_THEME_COLOR);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isStepOneValid = name.trim().length > 0 && /^[a-z0-9][a-z0-9-]{1,40}$/.test(slug);

  const handleCreate = async () => {
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('create_organization', {
        p_name: name,
        p_slug: slug,
        p_logo_url: logoUrl.trim() || null,
        p_theme: { primary_color: themeColor },
      });
      if (error) {
        setErrorMessage(error.message);
        return;
      }
      const result = data as { ok: boolean; slug?: string; error?: string };
      if (!result.ok) {
        setErrorMessage(result.error === 'slug_taken' ? '這個代號已被使用，請換一個' : (result.error ?? '建立失敗'));
        setStep(0);
        return;
      }
      navigate(`/o/${result.slug}/settings`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-stone-50 text-stone-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-black">🐝 開新協會</h1>
          <Link to="/" className="text-sm text-stone-500 hover:text-stone-700">← 回我的協會</Link>
        </div>

        <ol className="flex gap-1 text-xs">
          {STEPS.map((label, index) => (
            <li
              key={label}
              className={`flex-1 text-center rounded py-1 ${
                index === step ? 'bg-amber-600 text-white font-bold'
                : index < step ? 'bg-amber-100 text-amber-700' : 'bg-stone-100 text-stone-400'
              }`}
            >
              {label}
            </li>
          ))}
        </ol>

        <div className="bg-white rounded-xl shadow p-6 space-y-4">
          {step === 0 && (
            <>
              <label className="block text-sm">
                <span className="text-stone-600">協會名稱</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例：台灣某某產業協會"
                  className="mt-1 w-full rounded border border-stone-300 px-3 py-2"
                />
              </label>
              <label className="block text-sm">
                <span className="text-stone-600">網址代號（小寫英數與連字號）</span>
                <input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase())}
                  placeholder="例：tada"
                  className="mt-1 w-full rounded border border-stone-300 px-3 py-2 font-mono"
                />
                <span className="text-xs text-stone-400">之後的網址會是 /o/{slug || '…'}/</span>
              </label>
            </>
          )}

          {step === 1 && (
            <label className="block text-sm">
              <span className="text-stone-600">LOGO 網址（選填，可日後再補）</span>
              <input
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://…/logo.png"
                className="mt-1 w-full rounded border border-stone-300 px-3 py-2"
              />
              {logoUrl.trim() && (
                <img src={logoUrl} alt="LOGO 預覽" className="mt-3 h-16 object-contain" />
              )}
            </label>
          )}

          {step === 2 && (
            <label className="block text-sm">
              <span className="text-stone-600">主題色</span>
              <span className="mt-1 flex items-center gap-3">
                <input
                  type="color"
                  value={themeColor}
                  onChange={(e) => setThemeColor(e.target.value)}
                  className="h-10 w-16 cursor-pointer rounded border border-stone-300"
                />
                <code className="text-stone-500">{themeColor}</code>
              </span>
            </label>
          )}

          {step === 3 && (
            <dl className="text-sm space-y-2">
              <Row label="名稱" value={name} />
              <Row label="代號" value={`/o/${slug}/`} />
              <Row label="LOGO" value={logoUrl.trim() || '（未設定）'} />
              <div className="flex gap-3">
                <dt className="w-16 text-stone-500">主題色</dt>
                <dd className="flex items-center gap-2">
                  <span className="inline-block h-4 w-4 rounded" style={{ backgroundColor: themeColor }} />
                  {themeColor}
                </dd>
              </div>
              <p className="text-xs text-stone-400 pt-2">建立後你會自動成為這個協會的負責人（owner）。</p>
            </dl>
          )}

          {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}

          <div className="flex justify-between pt-2">
            <button
              onClick={() => setStep(Math.max(0, step - 1))}
              disabled={step === 0}
              className="rounded border border-stone-300 px-4 py-2 text-sm hover:bg-stone-100 disabled:opacity-40"
            >
              上一步
            </button>
            {step < STEPS.length - 1 ? (
              <button
                onClick={() => setStep(step + 1)}
                disabled={step === 0 && !isStepOneValid}
                className="rounded bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-40"
              >
                下一步
              </button>
            ) : (
              <button
                onClick={() => void handleCreate()}
                disabled={isSubmitting}
                className="rounded bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-40"
              >
                {isSubmitting ? '建立中…' : '建立協會'}
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-16 text-stone-500">{label}</dt>
      <dd className="flex-1 break-all">{value}</dd>
    </div>
  );
}
