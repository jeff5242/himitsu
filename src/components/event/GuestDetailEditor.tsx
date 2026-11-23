import { useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import type { Attendee } from '../../lib/types';

interface GuestDetailEditorProps {
  attendee: Attendee;
  /** 成功傳 null；失敗傳錯誤訊息 */
  onDone: (error: string | null) => Promise<void>;
}

/** 名單列的詳細欄位編輯：職稱、聯絡手機、葷素、攜伴人數（增加攜伴若超過桌子容量，DB 會擋） */
export default function GuestDetailEditor({ attendee, onDone }: GuestDetailEditorProps) {
  const [title, setTitle] = useState(attendee.guest_title ?? '');
  const [mobile, setMobile] = useState(attendee.guest_mobile ?? '');
  const [diet, setDiet] = useState(attendee.diet ?? '');
  const [companions, setCompanions] = useState(attendee.companions ?? 0);

  const handleSubmit = async (formEvent: FormEvent) => {
    formEvent.preventDefault();
    const { data, error } = await supabase.from('event_attendees').update({
      guest_title: title.trim() || null, guest_mobile: mobile.trim() || null,
      diet: diet.trim() || null, companions,
    }).eq('id', attendee.id).select();
    if (error) { await onDone(`儲存失敗：${error.message}`); return; }
    if (!data?.length) { await onDone('儲存被拒（權限不足）'); return; }
    await onDone(null);
  };

  return (
    <form onSubmit={handleSubmit} className="w-full flex flex-wrap items-center gap-2 rounded bg-stone-50 p-2 text-sm">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="職稱" aria-label="職稱"
        className="w-28 rounded border border-stone-300 px-2 py-1" />
      <input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="聯絡手機" aria-label="聯絡手機"
        className="w-32 rounded border border-stone-300 px-2 py-1" />
      <input value={diet} onChange={(e) => setDiet(e.target.value)} placeholder="葷素" aria-label="葷素" maxLength={10}
        list="diet-options" className="w-24 rounded border border-stone-300 px-2 py-1" />
      <datalist id="diet-options">
        <option value="葷" /><option value="素" /><option value="蛋奶素" />
      </datalist>
      <label className="inline-flex items-center gap-1">攜伴
        <input type="number" min={0} max={20} value={companions} aria-label="攜伴人數"
          onChange={(e) => setCompanions(Math.max(0, Math.min(20, Number(e.target.value) || 0)))}
          className="w-16 rounded border border-stone-300 px-2 py-1" />人
      </label>
      <button type="submit" className="rounded bg-amber-600 px-3 py-1 font-bold text-white">儲存</button>
      <button type="button" onClick={() => void onDone(null)} className="text-stone-500">取消</button>
    </form>
  );
}
