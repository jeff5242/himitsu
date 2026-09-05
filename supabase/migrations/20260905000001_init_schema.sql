-- HiMitsu 初始化：獨立 schema，與同專案的 TADA（public schema, tada_* 表）完全隔離。
-- 執行位置：Supabase Dashboard → SQL Editor 貼上執行（之後的 migration 亦同，直到接上 CLI db push）。
CREATE SCHEMA IF NOT EXISTS himitsu;

-- PostgREST 需要的最低權限：schema 可見；表的權限由各表的 RLS 與 GRANT 個別控制
GRANT USAGE ON SCHEMA himitsu TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA himitsu GRANT ALL ON TABLES TO service_role;

-- 煙霧測試表：前端首頁用它驗證「連得上 himitsu schema」
CREATE TABLE IF NOT EXISTS himitsu.health (
  id INT PRIMARY KEY DEFAULT 1,
  note TEXT DEFAULT 'himitsu schema alive',
  checked_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO himitsu.health (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE himitsu.health ENABLE ROW LEVEL SECURITY;
CREATE POLICY health_read ON himitsu.health FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON himitsu.health TO anon, authenticated;
