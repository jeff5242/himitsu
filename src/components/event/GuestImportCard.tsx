import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { decodeCsvBytes, parseGuestCsv, planGuestImport } from '../../lib/guestCsv';
import type { GuestImportPlan, GuestRowError, TableOccupancy } from '../../lib/guestCsv';
import type { Attendee, Organization, OrgEvent } from '../../lib/types';

interface GuestImportCardProps {
  org: Organization;
  event: OrgEvent;
  attendees: Attendee[];
  onDone: () => Promise<void>;
}

interface Preview {
  fileName: string;
  errors: GuestRowError[];
  plan: GuestImportPlan;
}

const FALLBACK_TABLE_CAPACITY = 10;
const TEMPLATE_CSV = '﻿姓名,單位,身分,桌號\n王小明,米屋智農,貴賓,1\n陳大華,後壁鄉,農民,5\n林阿土,,農民,\n';

const RPC_ERRORS: Record<string, string> = {
  forbidden: '沒有名單編輯權限（需負責人／秘書長／秘書）',
  event_not_found: '找不到這場活動',
  empty: '檔案裡沒有可匯入的資料',
  too_many: '一次最多 1000 筆，請分批匯入',
};

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = '來賓匯入範本.csv';
  link.click();
  URL.revokeObjectURL(url);
}

async function loadTableOccupancy(org: Organization, event: OrgEvent, attendees: Attendee[]):
  Promise<{ tables: TableOccupancy[]; defaultCapacity: number }> {
  const [{ data: tableRows, error }, { data: capacitySetting }] = await Promise.all([
    supabase.from('event_tables').select('table_no, capacity').eq('event_id', event.id),
    supabase.rpc('get_setting', { p_org: org.id, p_key: 'assembly.table_capacity' }),
  ]);
  if (error) throw new Error(`讀取桌次失敗：${error.message}`);
  const seated = new Map<number, number>();
  for (const a of attendees) {
    if (!a.removed_at && a.table_no !== null) seated.set(a.table_no, (seated.get(a.table_no) ?? 0) + 1);
  }
  const tables = (tableRows ?? []).map((t: { table_no: number; capacity: number }) => ({
    tableNo: t.table_no, capacity: t.capacity, seated: seated.get(t.table_no) ?? 0,
  }));
  const defaultCapacity = Number(capacitySetting) > 0 ? Number(capacitySetting) : FALLBACK_TABLE_CAPACITY;
  return { tables, defaultCapacity };
}

/** 來賓 CSV 匯入：選檔 → 預覽（錯誤／略過／新桌／爆桌）→ 確認後整批原子寫入 */
export default function GuestImportCard({ org, event, attendees, onDone }: GuestImportCardProps) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const handleFile = async (changeEvent: ChangeEvent<HTMLInputElement>) => {
    const file = changeEvent.target.files?.[0];
    changeEvent.target.value = '';
    if (!file) return;
    setMessage(null);
    setIsBusy(true);
    try {
      const text = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
      const { rows, errors } = parseGuestCsv(text);
      const existing = attendees
        .filter((a) => !a.removed_at && a.guest_name)
        .map((a) => ({ name: a.guest_name as string, org: a.guest_org }));
      const { tables, defaultCapacity } = await loadTableOccupancy(org, event, attendees);
      setPreview({ fileName: file.name, errors, plan: planGuestImport(rows, existing, tables, defaultCapacity) });
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : '讀取檔案失敗');
    } finally {
      setIsBusy(false);
    }
  };

  const handleImport = async () => {
    if (!preview) return;
    setIsBusy(true);
    try {
      const rows = preview.plan.toInsert.map((r) => ({
        line: r.line, name: r.name, org: r.org, tag: r.tag, table_no: r.tableNo,
      }));
      const { data, error } = await supabase.rpc('import_guests', { p_event: event.id, p_rows: rows });
      const result = data as { ok: boolean; error?: string; detail?: string;
        inserted?: number; skipped?: number; tables_created?: number } | null;
      if (error || !result?.ok) {
        setMessage(`匯入失敗，名單沒有任何變動：${result?.detail ?? RPC_ERRORS[result?.error ?? ''] ?? error?.message ?? '未知錯誤'}`);
        return;
      }
      setMessage(`已匯入 ${result.inserted} 人${result.skipped ? `、略過已在名單 ${result.skipped} 人` : ''}${
        result.tables_created ? `、新建 ${result.tables_created} 桌` : ''}`);
      setPreview(null);
      await onDone();
    } finally {
      setIsBusy(false);
    }
  };

  const plan = preview?.plan;
  const isBlocked = !plan || preview.errors.length > 0 || plan.overflows.length > 0 || plan.toInsert.length === 0;

  return (
    <section className="bg-white rounded-xl shadow p-4 space-y-2 text-sm sm:col-span-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-bold">CSV 匯入來賓</h3>
        <span className="text-xs text-stone-500">欄位：姓名（必填）、單位、身分（例：貴賓／農民）、桌號</span>
        <button type="button" onClick={downloadTemplate} className="ml-auto text-xs text-amber-700 underline">
          下載範本
        </button>
      </div>
      <p className="text-xs text-stone-500">
        Excel 用「另存新檔」存成 CSV 即可。桌號不存在會自動建桌；同姓名＋同單位已在名單的人會略過。
      </p>
      <input type="file" accept=".csv,text/csv" disabled={isBusy} onChange={(e) => void handleFile(e)}
        aria-label="選擇 CSV 檔" className="block text-sm" />

      {preview && plan && (
        <div className="space-y-2 rounded border border-stone-200 p-3">
          <p className="font-bold">{preview.fileName}</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            <li className="text-green-700">可匯入 {plan.toInsert.length} 人</li>
            {plan.skipped.length > 0 && <li className="text-stone-500">已在名單、略過 {plan.skipped.length} 人</li>}
            {plan.newTables.length > 0 && <li className="text-amber-700">新建桌：{plan.newTables.join('、')}</li>}
            {preview.errors.length > 0 && <li className="text-red-600 font-bold">錯誤 {preview.errors.length} 列</li>}
          </ul>
          {preview.errors.length > 0 && (
            <ul className="max-h-40 overflow-y-auto rounded bg-red-50 border border-red-200 px-3 py-2 text-red-700">
              {preview.errors.map((e) => <li key={`${e.line}-${e.message}`}>第 {e.line} 列：{e.message}</li>)}
            </ul>
          )}
          {plan.overflows.length > 0 && (
            <ul className="rounded bg-red-50 border border-red-200 px-3 py-2 text-red-700">
              {plan.overflows.map((o) => (
                <li key={o.tableNo}>桌 {o.tableNo} 會坐 {o.total} 人，超過容量 {o.capacity}——請改桌號，或先到「桌次」調大容量</li>
              ))}
            </ul>
          )}
          {plan.toInsert.length > 0 && (
            <div className="max-h-56 overflow-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-stone-500">
                  <tr><th className="py-1 pr-2">列</th><th className="pr-2">姓名</th><th className="pr-2">單位</th><th className="pr-2">身分</th><th>桌號</th></tr>
                </thead>
                <tbody>
                  {plan.toInsert.map((r) => (
                    <tr key={r.line} className="border-t border-stone-100">
                      <td className="py-1 pr-2 font-mono text-stone-400">{r.line}</td>
                      <td className="pr-2">{r.name}</td>
                      <td className="pr-2 text-stone-500">{r.org ?? ''}</td>
                      <td className="pr-2">{r.tag ?? ''}</td>
                      <td>{r.tableNo ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => void handleImport()} disabled={isBlocked || isBusy}
              className="rounded bg-amber-600 px-4 py-2 font-bold text-white hover:bg-amber-700 disabled:opacity-40">
              {isBusy ? '匯入中…' : `確認匯入 ${plan.toInsert.length} 人`}
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
