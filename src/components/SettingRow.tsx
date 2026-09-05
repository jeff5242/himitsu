import { useEffect, useState } from 'react';
import type { SettingsCatalogItem } from '../lib/types';

interface SettingRowProps {
  item: SettingsCatalogItem;
  /** undefined＝無覆寫（使用目錄預設值） */
  overrideValue: unknown;
  canWrite: boolean;
  onSave: (value: unknown) => Promise<void>;
  onReset: () => Promise<void>;
}

/** 單一設定項：依 value_type 呈現輸入元件，含「使用預設」標示與恢復預設 */
export default function SettingRow({ item, overrideValue, canWrite, onSave, onReset }: SettingRowProps) {
  const isOverridden = overrideValue !== undefined;
  const effective = isOverridden ? overrideValue : item.default_value;
  const [draft, setDraft] = useState<string>(toEditable(item.value_type, effective));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraft(toEditable(item.value_type, effective));
    setErrorMessage(null);
    // effective 以序列化結果當依據，避免物件參照每次不同
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.key, JSON.stringify(effective)]);

  const isDirty = draft !== toEditable(item.value_type, effective);

  const handleSave = async () => {
    const parsed = fromEditable(item.value_type, draft);
    if (parsed.error) {
      setErrorMessage(parsed.error);
      return;
    }
    setErrorMessage(null);
    await onSave(parsed.value);
  };

  const handleToggle = async (isChecked: boolean) => {
    await onSave(isChecked);
  };

  return (
    <div className="py-3 flex flex-wrap items-center gap-3 text-sm">
      <div className="w-56">
        <p className="font-medium">
          {item.label}
          {!isOverridden && (
            <span className="ml-2 text-xs rounded-full bg-stone-100 px-2 py-0.5 text-stone-400">預設</span>
          )}
        </p>
        {item.description && <p className="text-xs text-stone-400">{item.description}</p>}
      </div>

      <div className="flex-1 min-w-48">
        {item.value_type === 'boolean' ? (
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={effective === true}
              disabled={!canWrite}
              onChange={(e) => void handleToggle(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-stone-500">{effective === true ? '開啟' : '關閉'}</span>
          </label>
        ) : item.value_type === 'json' ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={!canWrite}
            rows={2}
            className="w-full rounded border border-stone-300 px-3 py-2 font-mono text-xs disabled:bg-stone-50"
          />
        ) : (
          <input
            type={item.value_type === 'number' ? 'number' : 'text'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={!canWrite}
            className="w-full max-w-72 rounded border border-stone-300 px-3 py-2 disabled:bg-stone-50"
          />
        )}
        {errorMessage && <p className="text-xs text-red-600 mt-1">{errorMessage}</p>}
      </div>

      {canWrite && (
        <span className="flex gap-2">
          {item.value_type !== 'boolean' && (
            <button
              onClick={() => void handleSave()}
              disabled={!isDirty}
              className="rounded bg-amber-600 px-3 py-1.5 font-bold text-white hover:bg-amber-700 disabled:opacity-40"
            >
              儲存
            </button>
          )}
          {isOverridden && (
            <button
              onClick={() => void onReset()}
              className="rounded border border-stone-300 px-3 py-1.5 hover:bg-stone-100"
            >
              恢復預設
            </button>
          )}
        </span>
      )}
    </div>
  );
}

function toEditable(type: SettingsCatalogItem['value_type'], value: unknown): string {
  if (type === 'text') return typeof value === 'string' ? value : '';
  if (type === 'number') return typeof value === 'number' ? String(value) : '';
  if (type === 'boolean') return value === true ? 'true' : 'false';
  return JSON.stringify(value ?? null, null, 0);
}

function fromEditable(
  type: SettingsCatalogItem['value_type'],
  draft: string,
): { value?: unknown; error?: string } {
  if (type === 'text') return { value: draft };
  if (type === 'number') {
    const parsed = Number(draft);
    if (draft.trim() === '' || Number.isNaN(parsed)) return { error: '請輸入數字' };
    return { value: parsed };
  }
  if (type === 'boolean') return { value: draft === 'true' };
  try {
    return { value: JSON.parse(draft) };
  } catch {
    return { error: 'JSON 格式不正確' };
  }
}
