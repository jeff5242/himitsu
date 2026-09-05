import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useOrg } from '../hooks/useOrg';
import OrgLayout from '../components/OrgLayout';
import AuditHistory from '../components/AuditHistory';
import type { Person } from '../lib/types';

/**
 * 成員頁（L3 驗收用最小版）：人員清單＋改手機號＋異動歷史。
 * AC-3：無 persons.write 權限的角色（staff/finance/viewer）在這裡改資料會被 RLS 拒絕。
 * AC-4：每筆資料的「歷史」直接讀 audit_log。
 * 雙身分聚合的完整清單屬 L5。
 */
export default function MembersPage() {
  const { slug } = useParams();
  const { org, myRole, can, isLoading, error } = useOrg(slug);
  const [persons, setPersons] = useState<Person[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!org) return;
    const { data } = await supabase
      .from('persons')
      .select('*')
      .eq('org_id', org.id)
      .order('created_at');
    setPersons((data as Person[]) ?? []);
  }, [org]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (isLoading) return <p className="p-8 text-stone-400">載入中…</p>;
  if (error || !org) return <p className="p-8 text-red-600">{error ?? '找不到協會'}</p>;

  const hasWritePerm = can('persons.write');

  return (
    <OrgLayout org={org} myRole={myRole}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">成員（{persons.length}）</h2>
        {!hasWritePerm && (
          <span className="text-xs rounded-full bg-stone-200 px-2 py-1 text-stone-500">
            目前角色為唯讀——寫入會被資料庫拒絕
          </span>
        )}
      </div>

      {notice && (
        <p className="rounded bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">
          {notice}
        </p>
      )}

      <AddPersonForm orgId={org.id} onDone={reload} onRejected={setNotice} />

      <section className="bg-white rounded-xl shadow divide-y divide-stone-100">
        {persons.length === 0 && <p className="p-4 text-stone-400 text-sm">還沒有成員資料。</p>}
        {persons.map((person) => (
          <PersonRow key={person.id} person={person} onSaved={reload} onRejected={setNotice} />
        ))}
      </section>
    </OrgLayout>
  );
}

function AddPersonForm({
  orgId,
  onDone,
  onRejected,
}: {
  orgId: string;
  onDone: () => Promise<void>;
  onRejected: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const { error } = await supabase
      .from('persons')
      .insert({ org_id: orgId, name: name.trim(), mobile: mobile.trim() || null });
    if (error) {
      onRejected(`新增被拒：${error.message}`);
      return;
    }
    onRejected('');
    setName('');
    setMobile('');
    await onDone();
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 text-sm">
      <input
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="姓名"
        className="flex-1 min-w-36 rounded border border-stone-300 px-3 py-2"
      />
      <input
        value={mobile}
        onChange={(e) => setMobile(e.target.value)}
        placeholder="手機（選填）"
        className="w-44 rounded border border-stone-300 px-3 py-2"
      />
      <button type="submit" className="rounded bg-amber-600 px-4 py-2 font-bold text-white hover:bg-amber-700">
        新增成員
      </button>
    </form>
  );
}

function PersonRow({
  person,
  onSaved,
  onRejected,
}: {
  person: Person;
  onSaved: () => Promise<void>;
  onRejected: (message: string) => void;
}) {
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

  return (
    <div className="p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-bold">{person.name}</span>
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
            <button onClick={() => setIsEditing(false)} className="text-stone-500">
              取消
            </button>
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
      {showHistory && <AuditHistory table="persons" rowId={person.id} />}
    </div>
  );
}
