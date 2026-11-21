import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { categoryCounts, sortCategories } from '../../lib/personCategories';
import type { CategoryLink, PersonCategory } from '../../lib/personCategories';
import type { Organization, OrgEvent } from '../../lib/types';

interface ImportByCategoryCardProps {
  org: Organization;
  event: OrgEvent;
  onDone: () => Promise<void>;
}

const RPC_ERRORS: Record<string, string> = {
  forbidden: '沒有名單編輯權限（需負責人／秘書長／秘書）',
  no_category: '請至少勾選一個分類',
  event_not_found: '找不到這場活動',
};

/** 名單分頁：勾選人員分類，把會員庫裡這些分類的人一次加進活動名單（身分＝分類名稱） */
export default function ImportByCategoryCard({ org, event, onDone }: ImportByCategoryCardProps) {
  const [categories, setCategories] = useState<PersonCategory[]>([]);
  const [links, setLinks] = useState<CategoryLink[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const load = useCallback(async () => {
    const [{ data: categoryRows }, { data: linkRows }] = await Promise.all([
      supabase.from('person_categories').select('id, name, sort').eq('org_id', org.id),
      supabase.from('person_category_links').select('person_id, category_id').eq('org_id', org.id),
    ]);
    setCategories(sortCategories((categoryRows as PersonCategory[]) ?? []));
    setLinks((linkRows as CategoryLink[]) ?? []);
  }, [org.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const personIds = [...new Set(links.map((l) => l.person_id))].map((id) => ({ id }));
    return categoryCounts(personIds, links, categories).filter((c) => categories.some((cat) => cat.id === c.id));
  }, [links, categories]);

  const toggle = (id: string) =>
    setSelected(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  const handleImport = async () => {
    setIsImporting(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.rpc('import_people_by_category', {
        p_event: event.id, p_category_ids: selected,
      });
      const result = data as { ok: boolean; error?: string; detail?: string; inserted?: number; skipped?: number } | null;
      if (error || !result?.ok) {
        setMessage(`匯入失敗，名單沒有任何變動：${result?.detail ?? RPC_ERRORS[result?.error ?? ''] ?? error?.message ?? '未知錯誤'}`);
        return;
      }
      setMessage(`已匯入 ${result.inserted} 人${result.skipped ? `、略過已在名單 ${result.skipped} 人` : ''}`);
      setSelected([]);
      await onDone();
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <section className="bg-white rounded-xl shadow p-4 space-y-2 text-sm">
      <h3 className="font-bold">依人員分類匯入</h3>
      {categories.length === 0 ? (
        <p className="text-stone-500">
          還沒有人員分類。到
          <Link to={`/o/${org.slug}/settings`} className="mx-1 underline">設定</Link>
          新增分類，再到
          <Link to={`/o/${org.slug}/members`} className="mx-1 underline">會員</Link>
          替會員勾選。
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {counts.map((c) => (
              <label key={c.id} className="inline-flex items-center gap-1">
                <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
                {c.name}<span className="text-stone-400 tabular-nums">（{c.count} 人）</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-stone-500">身分會帶入分類名稱；已在名單上的人自動略過。</p>
          <button type="button" onClick={() => void handleImport()} disabled={isImporting || selected.length === 0}
            className="rounded bg-amber-600 px-4 py-2 font-bold text-white hover:bg-amber-700 disabled:opacity-40">
            {isImporting ? '匯入中…' : '依分類匯入'}
          </button>
        </>
      )}
      {message && <p className="text-stone-700">{message}</p>}
    </section>
  );
}
