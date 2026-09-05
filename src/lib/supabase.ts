import { createClient } from '@supabase/supabase-js';

// 連線設定一律走環境變數——CI 會擋下任何寫死的專案位址（見 scripts/check-no-hardcode.sh）。
// db.schema 固定為 himitsu：與同專案內 TADA 的 public/tada_* 完全隔離，
// 本 client 物理上碰不到 public schema 的任何表。
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_KEY;

if (!url || !key) {
  throw new Error('缺少 VITE_SUPABASE_URL / VITE_SUPABASE_KEY，請依 .env.example 建立 .env.local');
}

export const supabase = createClient(url, key, {
  db: { schema: 'himitsu' },
});
