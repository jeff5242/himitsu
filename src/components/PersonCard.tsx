import { useState } from 'react';
import { supabase } from '../lib/supabase';
import AuditHistory from './AuditHistory';
import { KIND_LABELS, STATUS_LABELS, STATUS_BADGE_CLASS } from '../lib/labels';
import type { PersonWithDetails } from '../lib/types';

interface PersonCardProps {
  person: PersonWithDetails;
  onSaved: () => Promise<void>;
  onRejected: (message: string) => void;
}

/** 成員清單的一列＝一個自然人；雙身分的人在同一列並排顯示全部身分（AC-5） */
export default function PersonCard({ person, onSaved, onRejected }: PersonCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [mobile, setMobile] = useState(person.mobile ?? '');
  const [showHistory, setShowHistory] = useState(false);

  const handleSave = async () => {
    // .select() 讓 RLS 擋下時拿得到「0 列生效」的訊號（PostgREST 不回錯誤）
    const { data, error } = await supabase
      .from('persons')
      .update({ mobile: mobile.trim() || null })
      .eq('id', person.id)
      .select();
    if (error || !data || data.length === 0) {
      onRejected(`修改被拒${error ? `：${error.message}` : '（權限不足，變更 0 列）'}`);
      setMobile(person.mobile ?? '');
    } else {
      onRejected('');
      await onSaved();
    }
    setIsEditing(false);
  };

  const hasMultipleIdentities = person.identities.length >= 2;

  return (
    <div className="p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-bold">{person.name}</span>
        {hasMultipleIdentities && (
          <span className="text-xs rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 font-bold">
            {person.identities.length} 身分
          </span>
        )}
        {isEditing ? (
          <span className="flex items-center gap-2 text-sm">
            <input
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              className="w-40 rounded border border-stone-300 px-2 py-1"
              placeholder="手機號"
            />
            <button onClick={() => void handleSave()} className="rounded bg-amber-600 px-3 py-1 text-white">
              儲存
            </button>
            <button onClick={() => setIsEditing(false)} className="text-stone-500">取消</button>
          </span>
        ) : (
          <span className="text-sm text-stone-500">{person.mobile ?? '（無手機）'}</span>
        )}
        <span className="ml-auto flex gap-2 text-sm">
          {!isEditing && (
            <button
              onClick={() => setIsEditing(true)}
              className="rounded border border-stone-300 px-3 py-1 hover:bg-stone-100"
            >
              改手機
            </button>
          )}
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="rounded border border-stone-300 px-3 py-1 hover:bg-stone-100"
          >
            {showHistory ? '收合歷史' : '歷史'}
          </button>
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {person.identities.length === 0 && (
          <span className="text-xs text-stone-400">（尚未建立身分）</span>
        )}
        {person.identities.map((identity) => (
          <span
            key={identity.id}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50 px-2 py-1 text-xs"
          >
            <span className="font-medium">{KIND_LABELS[identity.kind]}</span>
            {identity.legal_entities && (
              <span className="text-stone-500">
                @{identity.legal_entities.name}
                {identity.title ? `·${identity.title}` : ''}
              </span>
            )}
            {identity.memberships.map((membership) => (
              <span
                key={membership.id}
                className={`rounded-full border px-1.5 py-0.5 font-mono ${STATUS_BADGE_CLASS[membership.status]}`}
              >
                {membership.member_no}·{STATUS_LABELS[membership.status]}
              </span>
            ))}
            {identity.memberships.length === 0 && (
              <span className="rounded-full border border-stone-200 bg-white px-1.5 py-0.5 text-stone-400">
                無會籍
              </span>
            )}
          </span>
        ))}
      </div>

      {showHistory && <AuditHistory table="persons" rowId={person.id} />}
    </div>
  );
}
