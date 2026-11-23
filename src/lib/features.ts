// 協會層「功能開關」：關閉的模組在前端隱藏（資料保留，重新開啟即恢復）
// 開關存在 org_settings；沒有覆寫＝開啟（settings_catalog 的預設值皆為 true）

export interface OrgFeatures {
  members: boolean;
  fees: boolean;
  devices: boolean;
}

export const FEATURE_KEYS: Readonly<Record<keyof OrgFeatures, string>> = {
  members: 'features.members',
  fees: 'features.fees',
  devices: 'features.devices',
};

export const ALL_FEATURES_ON: OrgFeatures = { members: true, fees: true, devices: true };

/** 設定頁存檔後廣播，讓選單等處即時重讀開關 */
export const FEATURES_CHANGED_EVENT = 'himitsu:features-changed';

export function parseFeatures(rows: { key: string; value: unknown }[]): OrgFeatures {
  const valueOf = (key: string): boolean => {
    const value = rows.find((r) => r.key === key)?.value;
    return typeof value === 'boolean' ? value : true;
  };
  return {
    members: valueOf(FEATURE_KEYS.members),
    fees: valueOf(FEATURE_KEYS.fees),
    devices: valueOf(FEATURE_KEYS.devices),
  };
}

export function isFeatureKey(key: string): boolean {
  return Object.values(FEATURE_KEYS).includes(key);
}

/** 設定頁的分類：模組關閉時，隱藏只跟該模組有關的設定 */
export function isSettingCategoryVisible(category: string, features: OrgFeatures): boolean {
  if (category === '會員編號') return features.members;
  if (category === '會費') return features.fees;
  return true;
}
