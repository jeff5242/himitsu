# HiMitsu 🐝

公協會的 AI 秘書處作業系統（多租戶）。源於 TADA 台灣科技農企業發展協會 2026 年會員大會全程數位化實戰——EPIC-0 為平台地基：多租戶隔離、角色權限、person/identity 資料模型、審計軌跡、設定中心。

## 架構

- 前端：Vite + React 18 + TypeScript + Tailwind CSS v4 + React Router
- 後端：Supabase（Postgres + RLS + Auth）——**只使用 `himitsu` schema**，與同專案內其他系統（public schema）完全隔離
- 權限：`role_permissions` 為單一事實來源，RLS（`has_perm()`）與前端 UI 同源引用
- 審計：全表 trigger 自動記 actor / before / after
- 部署：EC2（berth）

## 從零跑起來（目標 ≤ 15 分鐘）

### 1. 前端（2 分鐘）

```bash
git clone <repo> && cd himitsu
cp .env.example .env.local   # 填入 Supabase Project URL 與 publishable key
npm install
```

### 2. Supabase（10 分鐘）

1. 建立（或沿用）Supabase 專案
2. Dashboard → Settings → API → **Exposed schemas** 加入 `himitsu`
3. Dashboard → Authentication → URL Configuration → **Redirect URLs** 加入 `http://localhost:5173/**`
4. SQL Editor 依序貼上執行 `supabase/migrations/` 下的檔案（檔名時間戳排序）：
   - `..._init_schema.sql`（schema＋health）
   - `..._core_tables.sql`（六表＋狀態機＋審計＋RLS）
   - `..._auth_roles.sql`（權限矩陣＋邀請流程）
   - `..._wizard_settings.sql`（設定目錄＋產號）
5. 驗證：貼上執行 `supabase/tests/` 下的測試（結果表格版直接看 Results；`*_results.sql` 優先）

### 3. 啟動與示範資料（3 分鐘）

```bash
npm run dev                  # http://localhost:5173，用 email 登入連結註冊
npm run seed                 # 複製種子 SQL 到剪貼簿 → 改最後一行 email → 貼 SQL Editor
                             # → 前端開 /o/demo/members 看 80 會籍示範協會
```

## 指令

| 指令 | 用途 |
|---|---|
| `npm run dev` | 開發伺服器 |
| `npm run build` | 型別檢查＋打包 |
| `npm test` | Vitest 單元測試 |
| `npm run test:e2e` | Playwright 煙霧測試（未登入頁面，不寫資料） |
| `npm run check:no-hardcode` | 掃描寫死連線（CI 防線） |
| `npm run seed` | 示範協會種子（複製到剪貼簿） |

SQL 層測試（貼 SQL Editor，全自動 PASS/FAIL）：

- `supabase/tests/rls_isolation_test.sql` —— AC-1 租戶隔離、AC-6 狀態機終態
- `supabase/tests/role_matrix_test.sql` —— AC-3 角色矩陣、AC-4 審計、邀請流程
- `supabase/tests/settings_test_results.sql` —— AC-7 編號規則、設定隔離（表格版）

## 部署（berth / 任何靜態主機）

```bash
npm run build                # 產出 dist/
```

- SPA 需要 **fallback 路由**：所有非檔案路徑都回 `index.html`（nginx：`try_files $uri /index.html;`）
- 部署網域要加進 Supabase 的 **Redirect URLs**（如 `https://<domain>/**`）
- 環境變數：build 時注入 `VITE_SUPABASE_URL`、`VITE_SUPABASE_KEY`（publishable key；安全性由 RLS 承擔）

## 鐵律

1. **只操作 `himitsu` schema**——任何 SQL/migration 不得觸碰 public schema
2. 連線設定只走環境變數（`check:no-hardcode` 是 CI 防線）
3. 權限一律查 `role_permissions`，不在程式碼寫死角色判斷
4. 常數不寫死——進 `settings_catalog` 設定目錄（會費／編號規則／章程參數／功能開關）

## 文件

- `docs/tada-field-mapping.md` —— TADA 舊系統 → HiMitsu 資料模型欄位對照表（匯入前置）
- EPIC-0 規格與驗收條件（AC-1~7）：見 CLAUDE.md 連結
