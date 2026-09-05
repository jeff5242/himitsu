import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useOrg } from '../hooks/useOrg';
import OrgLayout from '../components/OrgLayout';
import PersonCard from '../components/PersonCard';
import type { PersonWithDetails } from '../lib/types';

/**
 * 成員清單（AC-5）：以「自然人」為列聚合全部身分與會籍——
 * 洪柏聲型的雙身分顯示為一人兩身分徽章，不是兩筆資料。
 * AC-3/AC-4 的驗證入口（改手機／歷史）仍在每列上。
 */
export default function MembersPage() {
  const { slug } = useParams();
  const { org, myRole, can, isLoading, error } = useOrg(slug);
  const [persons, setPersons] = useState<PersonWithDetails[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const reload = useCallback(async () => {
    if (!org) return;
    const { data } = await supabase
      .from('persons')
      .select('*, identities(id, kind, title, legal_entities(name), memberships(id, identity_id, member_no, member_type, status, joined_at))')
      .eq('org_id', org.id)
      .order('name');
    setPersons((data as PersonWithDetails[]) ?? []);
  }, [org]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const membershipCount = useMemo(
    () => persons.reduce((sum, p) => sum + p.identities.reduce((s, i) => s + i.memberships.length, 0), 0),
    [persons],
  );
  const multiIdentityCount = useMemo(
    () => persons.filter((p) => p.identities.length >= 2).length,
    [persons],
  );

  const visiblePersons = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return persons;
    return persons.filter((p) => {
      if (p.name.toLowerCase().includes(keyword)) return true;
      if (p.mobile?.includes(keyword)) return true;
      return p.identities.some(
        (i) =>
          i.legal_entities?.name.toLowerCase().includes(keyword) ||
          i.memberships.some((m) => m.member_no.toLowerCase().includes(keyword)),
      );
    });
  }, [persons, query]);

  if (isLoading) return <p className="p-8 text-stone-400">載入中…</p>;
  if (error || !org) return <p className="p-8 text-red-600">{error ?? '找不到協會'}</p>;

  const hasWritePerm = can('persons.write');

  return (
    <OrgLayout org={org} myRole={myRole}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">成員</h2>
        <span className="text-sm text-stone-500">
          {persons.length} 人／{membershipCount} 會籍
          {multiIdentityCount > 0 && `／雙身分 ${multiIdentityCount} 人`}
        </span>
        {!hasWritePerm && (
          <span className="ml-auto text-xs rounded-full bg-stone-200 px-2 py-1 text-stone-500">
            目前角色為唯讀——寫入會被資料庫拒絕
          </span>
        )}
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜尋姓名／手機／會員編號／公司…"
        className="w-full rounded border border-stone-300 px-3 py-2 text-sm"
      />

      {notice && (
        <p className="rounded bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">
          {notice}
        </p>
      )}

      <AddPersonForm orgId={org.id} onDone={reload} onRejected={setNotice} />

      <section className="bg-white rounded-xl shadow divide-y divide-stone-100">
        {visiblePersons.length === 0 && (
          <p className="p-4 text-stone-400 text-sm">
            {persons.length === 0 ? '還沒有成員資料。' : '沒有符合搜尋的成員。'}
          </p>
        )}
        {visiblePersons.map((person) => (
          <PersonCard key={person.id} person={person} onSaved={reload} onRejected={setNotice} />
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
