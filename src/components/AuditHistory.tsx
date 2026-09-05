import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { AuditEntry } from '../lib/types';

interface AuditHistoryProps {
  table: string;
  rowId: string;
}

// 這些欄位不值得在歷史裡逐筆列 diff
const SKIPPED_KEYS = new Set(['created_at']);

/** 一筆資料的異動歷史（AC-4：audit_log 的 UI 檢視） */
export default function AuditHistory({ table, rowId }: AuditHistoryProps) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);

  useEffect(() => {
    let isCancelled = false;
    supabase
      .from('audit_log')
      .select('*')
      .eq('tbl', table)
      .eq('row_id', rowId)
      .order('at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (!isCancelled) setEntries((data as AuditEntry[]) ?? []);
      });
    return () => {
      isCancelled = true;
    };
  }, [table, rowId]);

  if (entries === null) return <p className="text-sm text-stone-400 p-2">歷史載入中…</p>;
  if (entries.length === 0) return <p className="text-sm text-stone-400 p-2">沒有異動紀錄。</p>;

  return (
    <ul className="text-sm divide-y divide-stone-100 bg-stone-50 rounded p-2">
      {entries.map((entry) => (
        <li key={entry.id} className="py-2 space-y-0.5">
          <p className="text-xs text-stone-500">
            {new Date(entry.at).toLocaleString('zh-TW')}｜{actionLabel(entry.action)}｜
            操作者 {entry.actor ? entry.actor.slice(0, 8) : '系統'}
          </p>
          {describeChanges(entry).map((line) => (
            <p key={line} className="text-stone-700">{line}</p>
          ))}
        </li>
      ))}
    </ul>
  );
}

function actionLabel(action: AuditEntry['action']): string {
  if (action === 'INSERT') return '新增';
  if (action === 'DELETE') return '刪除';
  return '修改';
}

function describeChanges(entry: AuditEntry): string[] {
  if (entry.action === 'INSERT') return ['（建立資料）'];
  if (entry.action === 'DELETE') return ['（刪除資料）'];
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const lines: string[] = [];
  for (const key of keys) {
    if (SKIPPED_KEYS.has(key)) continue;
    const oldValue = before[key];
    const newValue = after[key];
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      lines.push(`${key}：${formatValue(oldValue)} → ${formatValue(newValue)}`);
    }
  }
  return lines.length > 0 ? lines : ['（無欄位變更）'];
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '（空）';
  return typeof value === 'string' ? value : JSON.stringify(value);
}
