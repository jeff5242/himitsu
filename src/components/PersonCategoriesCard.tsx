import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { nextCategorySort, sortCategories, validateCategoryName } from '../lib/personCategories';
import type { PersonCategory } from '../lib/personCategories';

interface PersonCategoriesCardProps {
  orgId: string;
  canWrite: boolean;
}

/** 設定頁：會員庫的人員分類（農民、貴賓、農會代表…）新增、改名、刪除 */
export default function PersonCategoriesCard({ orgId, canWrite }: PersonCategoriesCardProps) {
  const [categories, setCategories] = useState<PersonCategory[]>([]);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data } = await supabase.from('person_categories').select('id, name, sort').eq('org_id', orgId);
    setCategories(sortCategories((data as PersonCategory[]) ?? []));
  }, [orgId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const add = async (formEvent: FormEvent) => {
    formEvent.preventDefault();
    const check = validateCategoryName(draft, categories);
    if (!check.ok) { setMessage(check.message); return; }
    const { error } = await supabase.from('person_categories')
      .insert({ org_id: orgId, name: check.name, sort: nextCategorySort(categories) });
    if (error) { setMessage(`新增失敗：${error.message}`); return; }
    setMessage(null);
    setDraft('');
    await reload();
  };

  const rename = async () => {
    if (!editing) return;
    const others = categories.filter((c) => c.id !== editing.id);
    const check = validateCategoryName(editing.name, others);
    if (!check.ok) { setMessage(check.message); return; }
    const { error } = await supabase.from('person_categories').update({ name: check.name }).eq('id', editing.id);
    if (error) { setMessage(`改名失敗：${error.message}`); return; }
    setMessage(null);
    setEditing(null);
    await reload();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('person_categories').delete().eq('id', id);
    setConfirmingId(null);
    if (error) { setMessage(`刪除失敗：${error.message}`); return; }
    setMessage(null);
    await reload();
  };

  return (
    <section className="bg-white rounded-xl shadow p-5 space-y-3 text-sm">
      <div>
        <h3 className="font-bold">人員分類</h3>
        <p className="text-xs text-stone-500">
          每位會員可以勾選多個分類（例如農民、貴賓、農會代表）。活動名單可以依分類一次匯入。
        </p>
      </div>
      <ul className="flex flex-wrap gap-2">
        {categories.length === 0 && <li className="text-stone-400">還沒有分類。</li>}
        {categories.map((c) => (
          <li key={c.id} className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-stone-50 px-3 py-1">
            {editing?.id === c.id ? (
              <>
                <input value={editing.name} onChange={(e) => setEditing({ id: c.id, name: e.target.value })}
                  aria-label="分類新名稱" className="w-28 rounded border border-stone-300 px-2 py-0.5" />
                <button type="button" onClick={() => void rename()} className="font-bold text-amber-700">存</button>
                <button type="button" onClick={() => setEditing(null)} className="text-stone-400">×</button>
              </>
            ) : confirmingId === c.id ? (
              <>
                <span className="text-red-700">刪除「{c.name}」？會員身上的這個分類也會移除</span>
                <button type="button" onClick={() => void remove(c.id)} className="font-bold text-red-700">確定刪除</button>
                <button type="button" onClick={() => setConfirmingId(null)} className="text-stone-500">取消</button>
              </>
            ) : (
              <>
                <span>{c.name}</span>
                {canWrite && (
                  <>
                    <button type="button" onClick={() => setEditing({ id: c.id, name: c.name })}
                      className="text-xs text-stone-400 hover:text-amber-700" aria-label={`改名 ${c.name}`}>改名</button>
                    <button type="button" onClick={() => setConfirmingId(c.id)}
                      className="text-stone-400 hover:text-red-600" aria-label={`刪除 ${c.name}`}>×</button>
                  </>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {canWrite && (
        <form onSubmit={add} className="flex gap-2">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="新分類，例如：農會代表"
            aria-label="新分類名稱" className="flex-1 rounded border border-stone-300 px-3 py-2" />
          <button type="submit" className="rounded bg-amber-600 px-4 py-2 font-bold text-white hover:bg-amber-700">新增分類</button>
        </form>
      )}
      {message && <p className="text-red-600">{message}</p>}
    </section>
  );
}
