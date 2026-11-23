import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useOrg } from '../hooks/useOrg';
import OrgLayout from '../components/OrgLayout';
import MemberNoRuleCard from '../components/MemberNoRuleCard';
import PersonCategoriesCard from '../components/PersonCategoriesCard';
import SettingRow from '../components/SettingRow';
import type { SettingsCatalogItem } from '../lib/types';
import { FEATURES_CHANGED_EVENT, isFeatureKey, isSettingCategoryVisible, parseFeatures } from '../lib/features';

// member_no.* 由專屬卡片處理，不進一般清單
const MEMBER_NO_KEYS = new Set(['member_no.rule', 'member_no.next_seq']);

/** 設定中心（EPIC-0 §0-4）：目錄預設值＋各協會覆寫，AC-7 的操作介面 */
export default function SettingsPage() {
  const { slug } = useParams();
  const { org, myRole, can, isLoading, error } = useOrg(slug);
  const [catalog, setCatalog] = useState<SettingsCatalogItem[]>([]);
  const [overrides, setOverrides] = useState<Map<string, unknown>>(new Map());
  const [notice, setNotice] = useState<string | null>(null);

  const canWrite = can('org_settings.write');

  const reload = useCallback(async () => {
    if (!org) return;
    const [{ data: catalogRows }, { data: settingRows }] = await Promise.all([
      supabase.from('settings_catalog').select('*').order('sort'),
      supabase.from('org_settings').select('key, value').eq('org_id', org.id),
    ]);
    setCatalog((catalogRows as SettingsCatalogItem[]) ?? []);
    setOverrides(new Map((settingRows ?? []).map((row: { key: string; value: unknown }) => [row.key, row.value])));
  }, [org]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const features = useMemo(
    () => parseFeatures([...overrides].map(([key, value]) => ({ key, value }))), [overrides]);

  const categories = useMemo(() => {
    const grouped = new Map<string, SettingsCatalogItem[]>();
    for (const item of catalog) {
      if (MEMBER_NO_KEYS.has(item.key)) continue;
      if (!isSettingCategoryVisible(item.category, features)) continue;
      const list = grouped.get(item.category) ?? [];
      grouped.set(item.category, [...list, item]);
    }
    return grouped;
  }, [catalog, features]);

  if (isLoading) return <p className="p-8 text-stone-400">載入中…</p>;
  if (error || !org) return <p className="p-8 text-red-600">{error ?? '找不到協會'}</p>;

  const saveSetting = async (key: string, value: unknown) => {
    const { error: saveError } = await supabase
      .from('org_settings')
      .upsert({ org_id: org.id, key, value });
    setNotice(saveError ? `儲存失敗：${saveError.message}` : `「${key}」已儲存`);
    if (!saveError) await reload();
    if (!saveError && isFeatureKey(key)) window.dispatchEvent(new Event(FEATURES_CHANGED_EVENT));
  };

  const resetSetting = async (key: string) => {
    const { error: deleteError } = await supabase
      .from('org_settings')
      .delete()
      .eq('org_id', org.id)
      .eq('key', key);
    setNotice(deleteError ? `重設失敗：${deleteError.message}` : `「${key}」已恢復預設`);
    if (!deleteError) await reload();
    if (!deleteError && isFeatureKey(key)) window.dispatchEvent(new Event(FEATURES_CHANGED_EVENT));
  };

  return (
    <OrgLayout org={org} myRole={myRole}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">設定中心</h2>
        {!canWrite && (
          <span className="text-xs rounded-full bg-stone-200 px-2 py-1 text-stone-500">
            唯讀——修改設定需要「負責人／秘書長」權限
          </span>
        )}
      </div>

      {notice && (
        <p className="rounded bg-stone-100 border border-stone-200 text-stone-600 text-sm px-3 py-2">
          {notice}
        </p>
      )}

      {features.members && <MemberNoRuleCard
        rule={overrides.get('member_no.rule') ?? findDefault(catalog, 'member_no.rule')}
        nextSeq={overrides.get('member_no.next_seq') ?? findDefault(catalog, 'member_no.next_seq')}
        isOverridden={overrides.has('member_no.rule')}
        canWrite={canWrite}
        onSave={(value) => saveSetting('member_no.rule', value)}
        onReset={() => resetSetting('member_no.rule')}
      />}

      {features.members && <PersonCategoriesCard orgId={org.id} canWrite={canWrite} />}

      {[...categories.entries()].map(([category, items]) => (
        <section key={category} className="bg-white rounded-xl shadow p-5 space-y-1">
          <h3 className="font-bold pb-2">{category}</h3>
          <div className="divide-y divide-stone-100">
            {items.map((item) => (
              <SettingRow
                key={item.key}
                item={item}
                overrideValue={overrides.has(item.key) ? overrides.get(item.key) : undefined}
                canWrite={canWrite}
                onSave={(value) => saveSetting(item.key, value)}
                onReset={() => resetSetting(item.key)}
              />
            ))}
          </div>
        </section>
      ))}
    </OrgLayout>
  );
}

function findDefault(catalog: SettingsCatalogItem[], key: string): unknown {
  return catalog.find((item) => item.key === key)?.default_value;
}
