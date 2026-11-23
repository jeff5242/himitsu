-- ============================================================================
-- HiMitsu L23：協會層功能開關——會員／會費／裝置（關閉＝前端隱藏，資料保留）
-- 執行位置：Supabase SQL Editor 貼上執行一次。
-- 鐵律：本檔只建 himitsu schema 內物件，不觸碰 public。
-- 需求來源：米屋智農是企業辦活動、沒有會員名冊，要把會員、會費、裝置隱藏。
-- 開關沿用 settings_catalog（預設 true）＋ org_settings 覆寫；設定頁「功能開關」分類即可切換
-- （需 org_settings.write＝負責人／秘書長）。
-- ============================================================================

INSERT INTO himitsu.settings_catalog (key, category, label, description, value_type, default_value, sort) VALUES
  ('features.members', '功能開關', '會員模組',
   '關閉後隱藏「會員」選單、名單頁的會員匯入與設定頁的人員分類、會員編號；資料保留', 'boolean', 'true', 48),
  ('features.devices', '功能開關', '報到機裝置',
   '關閉後隱藏「裝置」選單（樹莓派報到機管理）；已註冊的裝置保留', 'boolean', 'true', 49)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, description = EXCLUDED.description, category = EXCLUDED.category, sort = EXCLUDED.sort;

-- 既有但尚未接上畫面的開關：說明寫清楚，避免以為切換有作用
UPDATE himitsu.settings_catalog SET label = '會費模組',
  description = '關閉後隱藏「會費」選單、報到卡的未繳提示與設定頁的會費項目；資料保留'
 WHERE key = 'features.fees';
UPDATE himitsu.settings_catalog SET description = '開發中，目前切換沒有作用' WHERE key = 'features.voting';
UPDATE himitsu.settings_catalog SET description = '目前切換沒有作用（報到功能固定開啟）' WHERE key = 'features.checkin';
UPDATE himitsu.settings_catalog SET description = '尚未開放，目前切換沒有作用' WHERE key = 'features.line_notify';
