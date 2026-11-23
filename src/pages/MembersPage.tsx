import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useOrg } from '../hooks/useOrg';
import OrgLayout from '../components/OrgLayout';
import FeatureOffNotice from '../components/FeatureOffNotice';
import { useOrgFeatures } from '../hooks/useOrgFeatures';
import PersonCard from '../components/PersonCard';
import MemberImportCard from '../components/MemberImportCard';
import { categoryCounts, filterPersonsByCategory, sortCategories } from '../lib/personCategories';
import type { CategoryLink, PersonCategory } from '../lib/personCategories';
import type { PersonWithDetails } from '../lib/types';

/**
 * 成員清單（AC-5）：以「自然人」為列聚合全部身分與會籍——
 * 洪柏聲型的雙身分顯示為一人兩身分徽章，不是兩筆資料。
 * L21：人員分類（農民／貴賓…）勾選與篩選；成員單位。
 */
export default function MembersPage() {
  const { slug } = useParams();
  const { org, myRole, can, isLoading, error } = useOrg(slug);
  const features = useOrgFeatures(org?.id);
  const [persons, setPersons] = useState<PersonWithDetails[]>([]);
  const [categories, setCategories] = useState<PersonCategory[]>([]);
  const [links, setLinks] = useState<CategoryLink[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const reload = useCallback(async () => {
    if (!org) return;
    const [{ data: personRows }, { data: categoryRows }, { data: linkRows }] = await Promise.all([
      supabase.from('persons')
        .select('*, identities(id, kind, title, legal_entities(name), memberships(id, identity_id, member_no, member_type, status, joined_at))')
        .eq('org_id', org.id).order('name'),
      supabase.from('person_categories').select('id, name, sort').eq('org_id', org.id),
      supabase.from('person_category_links').select('person_id, category_id').eq('org_id', org.id),
    ]);
    setPersons((personRows as PersonWithDetails[]) ?? []);
    setCategories(sortCategories((categoryRows as PersonCategory[]) ?? []));
    setLinks((linkRows as CategoryLink[]) ?? []);
  }, [org]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const membershipCount = useMemo(
    () => persons.reduce((sum, p) => sum + p.identities.reduce((s, i) => s + i.memberships.length, 0), 0),
    [persons],
  );
  const multiIdentityCount = useMemo(() => persons.filter((p) => p.identities.length >= 2).length, [persons]);
  const counts = useMemo(() => categoryCounts(persons, links, categories), [persons, links, categories]);

  const visiblePersons = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const byCategory = filterPersonsByCategory(persons, links, selectedCategory);
    if (!keyword) return byCategory;
    return byCategory.filter((p) =>
      p.name.toLowerCase().includes(keyword) ||
      p.mobile?.includes(keyword) ||
      (p.affiliation ?? '').toLowerCase().includes(keyword) ||
      p.identities.some((i) =>
        i.legal_entities?.name.toLowerCase().includes(keyword) ||
        i.memberships.some((m) => m.member_no.toLowerCase().includes(keyword))));
  }, [persons, links, selectedCategory, query]);

  if (isLoading) return <p className="p-8 text-stone-400">載入中…</p>;
  if (error || !org) return <p className="p-8 text-red-600">{error ?? '找不到協會'}</p>;
  if (!features.members) {
    return (
      <OrgLayout org={org} myRole={myRole}>
        <FeatureOffNotice orgSlug={org.slug} featureLabel="會員" />
      </OrgLayout>
    );
  }

  const hasWritePerm = can('persons.write');

  const toggleCategory = async (personId: string, categoryId: string) => {
    const isLinked = links.some((l) => l.person_id === personId && l.category_id === categoryId);
    const { error: toggleError } = isLinked
      ? await supabase.from('person_category_links').delete().eq('person_id', personId).eq('category_id', categoryId)
      : await supabase.from('person_category_links').insert({ org_id: org.id, person_id: personId, category_id: categoryId });
    if (toggleError) { setNotice(`分類變更被拒：${toggleError.message}`); return; }
    setNotice(null);
    await reload();
  };

  return (
    <OrgLayout org={org} myRole={myRole}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">會員</h2>
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

      <p className="rounded bg-sky-50 border border-sky-200 text-sky-800 text-sm px-3 py-2">
        「會員」是協會的名冊資料，不會產生登入帳號。要讓某人登入系統操作，請到
        <Link to={`/o/${org.slug}/team`} className="mx-1 font-bold underline">團隊</Link>
        邀請他。
      </p>

      <input value={query} onChange={(e) => setQuery(e.target.value)}
        placeholder="搜尋姓名／手機／單位／會員編號／公司…"
        className="w-full rounded border border-stone-300 px-3 py-2 text-sm" />

      {categories.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm" aria-label="依分類篩選">
          <span className="font-bold text-stone-500">分類</span>
          <button type="button" onClick={() => setSelectedCategory(undefined)}
            className={pillClass(selectedCategory === undefined)}>全部 {persons.length}</button>
          {counts.map((c) => (
            <button key={c.id} type="button" onClick={() => setSelectedCategory(selectedCategory === c.id ? undefined : c.id)}
              className={pillClass(selectedCategory === c.id)}>
              {c.name} {c.count}
            </button>
          ))}
        </div>
      )}
      {categories.length === 0 && hasWritePerm && (
        <p className="text-xs text-stone-500">
          想把會員分成農民、貴賓等類別？先到
          <Link to={`/o/${org.slug}/settings`} className="mx-1 underline">設定</Link>
          的「人員分類」新增分類。
        </p>
      )}

      {notice && (
        <p className="rounded bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{notice}</p>
      )}

      <AddPersonForm orgId={org.id} onDone={reload} onRejected={setNotice} />

      {hasWritePerm && (
        <MemberImportCard orgId={org.id} categories={categories} canCreateCategories={can('org_settings.write')}
          existingPersons={persons.map((p) => ({ id: p.id, name: p.name, affiliation: p.affiliation }))}
          onDone={reload} />
      )}

      <section className="bg-white rounded-xl shadow divide-y divide-stone-100">
        {visiblePersons.length === 0 && (
          <p className="p-4 text-stone-400 text-sm">
            {persons.length === 0 ? '還沒有會員資料。' : '沒有符合條件的會員。'}
          </p>
        )}
        {visiblePersons.map((person) => (
          <div key={person.id}>
            <PersonCard person={person} onSaved={reload} onRejected={setNotice} />
            {(categories.length > 0 || person.affiliation) && (
              <div className="flex flex-wrap items-center gap-2 px-4 pb-3 -mt-1 text-xs">
                {person.affiliation && <span className="text-stone-500">單位：{person.affiliation}</span>}
                {categories.map((c) => {
                  const isOn = links.some((l) => l.person_id === person.id && l.category_id === c.id);
                  if (!hasWritePerm && !isOn) return null;
                  return (
                    <button key={c.id} type="button" disabled={!hasWritePerm}
                      onClick={() => void toggleCategory(person.id, c.id)}
                      aria-pressed={isOn} aria-label={`${person.name} ${c.name}`}
                      className={`rounded-full border px-2.5 py-0.5 ${isOn
                        ? 'border-amber-500 bg-amber-50 font-bold text-amber-800'
                        : 'border-dashed border-stone-300 text-stone-400 hover:border-amber-400'}`}>
                      {isOn ? '✓ ' : '＋ '}{c.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </section>
    </OrgLayout>
  );
}

function pillClass(isActive: boolean): string {
  return `rounded-full border px-3 py-1 ${isActive
    ? 'border-amber-600 bg-amber-600 font-bold text-white'
    : 'border-stone-300 bg-white text-stone-700 hover:border-amber-500'}`;
}

function AddPersonForm({
  orgId, onDone, onRejected,
}: { orgId: string; onDone: () => Promise<void>; onRejected: (message: string) => void }) {
  const [name, setName] = useState('');
  const [affiliation, setAffiliation] = useState('');
  const [mobile, setMobile] = useState('');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const { error } = await supabase.from('persons').insert({
      org_id: orgId, name: name.trim(), affiliation: affiliation.trim() || null, mobile: mobile.trim() || null,
    });
    if (error) {
      onRejected(`新增被拒：${error.message}`);
      return;
    }
    onRejected('');
    setName('');
    setAffiliation('');
    setMobile('');
    await onDone();
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 text-sm">
      <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="姓名"
        className="flex-1 min-w-36 rounded border border-stone-300 px-3 py-2" />
      <input value={affiliation} onChange={(e) => setAffiliation(e.target.value)} placeholder="單位（選填）"
        className="w-44 rounded border border-stone-300 px-3 py-2" />
      <input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="手機（選填）"
        className="w-44 rounded border border-stone-300 px-3 py-2" />
      <button type="submit" className="rounded bg-amber-600 px-4 py-2 font-bold text-white hover:bg-amber-700">
        新增會員
      </button>
    </form>
  );
}
