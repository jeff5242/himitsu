import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ALL_FEATURES_ON, FEATURES_CHANGED_EVENT, FEATURE_KEYS, parseFeatures } from '../lib/features';
import type { OrgFeatures } from '../lib/features';

/** 讀取協會的功能開關；設定頁存檔時會廣播事件，這裡收到就重讀 */
export function useOrgFeatures(orgId: string | undefined): OrgFeatures {
  const [features, setFeatures] = useState<OrgFeatures>(ALL_FEATURES_ON);

  const load = useCallback(async () => {
    if (!orgId) return;
    const { data } = await supabase.from('org_settings').select('key, value')
      .eq('org_id', orgId).in('key', Object.values(FEATURE_KEYS));
    // 讀取失敗（例如離線）時保留目前狀態
    if (data) setFeatures(parseFeatures(data as { key: string; value: unknown }[]));
  }, [orgId]);

  useEffect(() => {
    void load();
    const onChanged = () => void load();
    window.addEventListener(FEATURES_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(FEATURES_CHANGED_EVENT, onChanged);
  }, [load]);

  return features;
}
