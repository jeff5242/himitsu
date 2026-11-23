-- ============================================================================
-- HiMitsu L25：桌次每排桌數（設定中心決定桌次圓桌卡／平面圖／現場投影頁的排版）
-- 執行位置：Supabase SQL Editor 貼上執行一次。
-- 鐵律：本檔只建 himitsu schema 內物件，不觸碰 public。
-- 需求來源：米屋——會場一排六桌，希望畫面照實際排列呈現。
-- ============================================================================

INSERT INTO himitsu.settings_catalog (key, category, label, description, value_type, default_value, sort) VALUES
  ('assembly.tables_per_row', '大會', '桌次每排桌數',
   '桌次分頁（圓桌卡、平面圖）與現場投影頁每排顯示幾桌，照會場實際排列設定（1～12）；0＝依螢幕寬度自動',
   'number', '0', 41)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, description = EXCLUDED.description, category = EXCLUDED.category;
