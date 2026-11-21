import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { supabase } from '../lib/supabase';
import { decodeCsvBytes } from '../lib/guestCsv';
import { parseMemberCsv, planMemberImport } from '../lib/memberCsv';
import type { ExistingPerson, MemberImportPlan, MemberRowError } from '../lib/memberCsv';
import type { PersonCategory } from '../lib/personCategories';

interface MemberImportCardProps {
  orgId: string;
  existingPersons: ExistingPerson[];
  categories: PersonCategory[];
  /** 有設定權（可新增分類）才能匯入含新分類的檔案 */
  canCreateCategories: boolean;
  onDone: () => Promise<void>;
}

interface Preview {
  fileName: string;
  errors: MemberRowError[];
  plan: MemberImportPlan;
}

const TEMPLATE_CSV = '﻿姓名,單位,手機,分類\n陳大華,二林鎮,0912345678,農民\n王貴賓,彰化縣農會,,貴賓、農會代表\n林阿土,芳苑鄉,,農民\n';

const RPC_ERRORS: Record<string, string> = {
  forbidden: '沒有會員編輯權限（需負責人／秘書長／秘書）',
  empty: '檔案裡沒有可匯入的資料',
  too_many: '一次最多 2000 筆，請分批匯入',
};

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = '會員匯入範本.csv';
  link.click();
  URL.revokeObjectURL(url);
}

/** 會員頁：CSV 匯入會員（姓名、單位、手機、分類）——先預覽再匯入，缺的分類自動建立並勾選 */
export default function MemberImportCard({
  orgId, existingPersons, categories, canCreateCategories, onDone,
}: MemberImportCardProps) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const handleFile = async (changeEvent: ChangeEvent<HTMLInputElement>) => {
    const file = changeEvent.target.files?.[0];
    changeEvent.target.value = '';
    if (!file) return;
    setMessage(null);
    try {
      const { rows, errors } = parseMemberCsv(decodeCsvBytes(new Uint8Array(await file.arrayBuffer())));
      setPreview({ fileName: file.name, errors, plan: planMemberImport(rows, existingPersons, categories) });
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : '讀取檔案失敗');
    }
  };

  const handleImport = async () => {
    if (!preview) return;
    setIsBusy(true);
    try {
      const rows = [...preview.plan.toCreate, ...preview.plan.toMerge]
        .sort((a, b) => a.line - b.line)
        .map((r) => ({ line: r.line, name: r.name, affiliation: r.affiliation, mobile: r.mobile, categories: r.categories }));
      const { data, error } = await supabase.rpc('import_members', { p_org: orgId, p_rows: rows });
      const result = data as {
        ok: boolean; error?: string; detail?: string;
        created?: number; merged?: number; categories_created?: number; links_added?: number;
      } | null;
      if (error || !result?.ok) {
        setMessage(`匯入失敗，會員資料沒有任何變動：${result?.detail ?? RPC_ERRORS[result?.error ?? ''] ?? error?.message ?? '未知錯誤'}`);
        return;
      }
      setMessage([
        `新增 ${result.created} 位會員`,
        result.merged ? `更新既有 ${result.merged} 位` : '',
        result.categories_created ? `新建 ${result.categories_created} 個分類` : '',
        `勾選分類 ${result.links_added} 筆`,
      ].filter(Boolean).join('、'));
      setPreview(null);
      await onDone();
    } finally {
      setIsBusy(false);
    }
  };

  const plan = preview?.plan;
  const lacksCategoryPermission = !!plan && plan.newCategories.length > 0 && !canCreateCategories;
  const isBlocked = !plan || preview.errors.length > 0 || lacksCategoryPermission
    || plan.toCreate.length + plan.toMerge.length === 0;

  return (
    <section className="bg-white rounded-xl shadow p-4 space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-bold">CSV 匯入會員</h3>
        <span className="text-xs text-stone-500">欄位：姓名（必填）、單位、手機、分類（多個用「、」分隔）</span>
        <button type="button" onClick={downloadTemplate} className="ml-auto text-xs text-amber-700 underline">下載範本</button>
      </div>
      <p className="text-xs text-stone-500">
        Excel 用「另存新檔」存成 CSV 即可。同姓名＋同單位已是會員的人不會重複新增，只補空白的手機並勾上分類；
        檔案裡的新分類會自動建立。
      </p>
      <input type="file" accept=".csv,text/csv" disabled={isBusy} onChange={(e) => void handleFile(e)}
        aria-label="選擇會員 CSV 檔" className="block text-sm" />

      {preview && plan && (
        <div className="space-y-2 rounded border border-stone-200 p-3">
          <p className="font-bold">{preview.fileName}</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            <li className="text-green-700">新增 {plan.toCreate.length} 位</li>
            {plan.toMerge.length > 0 && <li className="text-stone-600">已是會員、更新 {plan.toMerge.length} 位</li>}
            {plan.newCategories.length > 0 && <li className="text-amber-700">自動建立分類：{plan.newCategories.join('、')}</li>}
            <li className="text-stone-600">勾選分類 {plan.categoryTicks} 筆</li>
            {preview.errors.length > 0 && <li className="font-bold text-red-600">錯誤 {preview.errors.length} 列</li>}
          </ul>
          {preview.errors.length > 0 && (
            <ul className="max-h-40 overflow-y-auto rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700">
              {preview.errors.map((e) => <li key={`${e.line}-${e.message}`}>第 {e.line} 列：{e.message}</li>)}
            </ul>
          )}
          {lacksCategoryPermission && (
            <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700">
              檔案裡有新分類（{plan.newCategories.join('、')}）。只有負責人或秘書長能新增分類：請他們先到「設定 → 人員分類」新增，或由他們匯入。
            </p>
          )}
          <div className="max-h-56 overflow-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-stone-500">
                <tr><th className="py-1 pr-2">列</th><th className="pr-2">姓名</th><th className="pr-2">單位</th><th className="pr-2">手機</th><th className="pr-2">分類</th><th>處理</th></tr>
              </thead>
              <tbody>
                {[...plan.toCreate.map((r) => ({ r, isNew: true })), ...plan.toMerge.map((r) => ({ r, isNew: false }))]
                  .sort((a, b) => a.r.line - b.r.line)
                  .map(({ r, isNew }) => (
                    <tr key={r.line} className="border-t border-stone-100">
                      <td className="py-1 pr-2 font-mono text-stone-400">{r.line}</td>
                      <td className="pr-2">{r.name}</td>
                      <td className="pr-2 text-stone-500">{r.affiliation ?? ''}</td>
                      <td className="pr-2 tabular-nums">{r.mobile ?? ''}</td>
                      <td className="pr-2">{r.categories.join('、')}</td>
                      <td className={isNew ? 'text-green-700' : 'text-stone-500'}>{isNew ? '新增' : '更新'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void handleImport()} disabled={isBlocked || isBusy}
              className="rounded bg-amber-600 px-4 py-2 font-bold text-white hover:bg-amber-700 disabled:opacity-40">
              {isBusy ? '匯入中…' : `確認匯入 ${plan.toCreate.length + plan.toMerge.length} 位`}
            </button>
            <button type="button" onClick={() => setPreview(null)}
              className="rounded border border-stone-300 px-4 py-2 hover:bg-stone-100">取消</button>
          </div>
          {preview.errors.length > 0 && <p className="text-xs text-red-600">修正 Excel 後重新選檔；有錯誤時不能匯入。</p>}
        </div>
      )}
      {message && <p className="text-stone-700">{message}</p>}
    </section>
  );
}
