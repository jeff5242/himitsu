import { useEffect, useState } from 'react';
import { formatMemberNo, parseRule } from '../lib/memberNo';
import type { MemberNoRule } from '../lib/memberNo';

interface MemberNoRuleCardProps {
  rule: unknown;
  nextSeq: unknown;
  isOverridden: boolean;
  canWrite: boolean;
  onSave: (value: MemberNoRule) => Promise<void>;
  onReset: () => Promise<void>;
}

/** 會員編號規則卡（AC-7 操作點）：樣板＋補零位數＋下一號即時預覽 */
export default function MemberNoRuleCard({
  rule,
  nextSeq,
  isOverridden,
  canWrite,
  onSave,
  onReset,
}: MemberNoRuleCardProps) {
  const saved = parseRule(rule);
  const [template, setTemplate] = useState(saved.template);
  const [pad, setPad] = useState(saved.pad);

  useEffect(() => {
    setTemplate(saved.template);
    setPad(saved.pad);
  }, [saved.template, saved.pad]);

  const seq = typeof nextSeq === 'number' ? nextSeq : 1;
  const preview = formatMemberNo({ template, pad }, seq);
  const isDirty = template !== saved.template || pad !== saved.pad;
  const isTemplateValid = template.includes('{seq}');

  return (
    <section className="bg-white rounded-xl shadow p-5 space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="font-bold">會員編號規則</h3>
        {!isOverridden && (
          <span className="text-xs rounded-full bg-stone-100 px-2 py-0.5 text-stone-400">使用預設</span>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="block">
          <span className="text-stone-600">樣板（{'{seq}'} 代入流水號）</span>
          <input
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            disabled={!canWrite}
            className="mt-1 w-48 rounded border border-stone-300 px-3 py-2 font-mono disabled:bg-stone-50"
          />
        </label>
        <label className="block">
          <span className="text-stone-600">補零位數</span>
          <input
            type="number"
            min={0}
            max={10}
            value={pad}
            onChange={(e) => setPad(Number(e.target.value))}
            disabled={!canWrite}
            className="mt-1 w-24 rounded border border-stone-300 px-3 py-2 disabled:bg-stone-50"
          />
        </label>
        <p className="pb-2">
          下一號預覽：
          <code className="ml-1 rounded bg-amber-50 border border-amber-200 px-2 py-1 font-bold">
            {isTemplateValid ? preview : '樣板需含 {seq}'}
          </code>
        </p>
        {canWrite && (
          <span className="ml-auto flex gap-2 pb-1">
            <button
              onClick={() => void onSave({ template, pad })}
              disabled={!isDirty || !isTemplateValid}
              className="rounded bg-amber-600 px-4 py-2 font-bold text-white hover:bg-amber-700 disabled:opacity-40"
            >
              儲存
            </button>
            {isOverridden && (
              <button
                onClick={() => void onReset()}
                className="rounded border border-stone-300 px-3 py-2 hover:bg-stone-100"
              >
                恢復預設
              </button>
            )}
          </span>
        )}
      </div>
      <p className="text-xs text-stone-400">
        改規則只影響之後新建的會員編號，既有編號不變；流水號目前到 {seq - 1}。
      </p>
    </section>
  );
}
