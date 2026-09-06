# HiMitsu 專案守則

公協會 AI 秘書處作業系統。多租戶產品，源於 TADA 2026 會員大會實戰。

## 鐵律（違反即停手）
1. **只操作 `himitsu` schema**。同一個 Supabase 專案裡有 TADA 正式系統（public schema、`tada_*` 表）——任何 SQL、migration、查詢都不得觸碰 public schema；`DROP`/`ALTER` 前必確認 schema 前綴。
2. **連線資訊只走環境變數**（.env.local）；`npm run check:no-hardcode` 是 CI 防線，禁止寫死任何 supabase.co 位址或金鑰。
3. **不碰 TADA repo**（~/CodeRepository/tada-association-manager）——那是另一個 session 的地盤。

## 技術棧
- Vite + React 18 + TypeScript + Tailwind CSS v4
- Supabase：REST 走 `Accept-Profile: himitsu`（client 已在 src/lib/supabase.ts 固定 db.schema）
- Migration：supabase/migrations/*.sql，目前由使用者貼 SQL Editor 執行
- 部署：EC2 berth（berth MCP）、deploy_type=docker（nginx serve 本機 build 的 dist，SPA fallback）、route=alb（milkidea.com DNS 在 GoDaddy 非 Cloudflare）；網域 himitsu.milkidea.com → CNAME 指 pony ALB

## 規格文件
- 產品規劃：https://claude.ai/code/artifact/e668187e-a3f1-4f04-911d-b0426c1c8a15
- EPIC-0 地基規格（含 AC-1~7 驗收）：https://claude.ai/code/artifact/1eb7c3e7-0b50-4749-8fb3-7b49b80cb383
- 大會實戰檢討（需求源頭）：https://claude.ai/code/artifact/3d363730-c3a4-4bad-8e8a-6c6f761964b7

## 進度
- [x] L1 鷹架（CI／no-hardcode／init migration）
- [x] L2 六表 Schema＋RLS —— migration `20260905000002_core_tables.sql`（待使用者貼 SQL Editor 執行）＋隔離測試 `supabase/tests/rls_isolation_test.sql`（含 AC-1/AC-4/AC-6 自動驗證，全程 ROLLBACK）
- [x] L3 Auth＋角色＋審計 —— migration `20260905000003_auth_roles.sql`（權限矩陣 role_permissions＋has_perm RLS 細分＋邀請流程 invitations/invite_user/accept_invitation＋owner 守衛；待使用者貼 SQL Editor 執行）＋測試 `supabase/tests/role_matrix_test.sql`（AC-3/AC-4 全自動驗證）＋前端（magic link＋密碼備援登入、協會清單、成員頁含審計歷史、團隊頁邀請流程、受邀頁 /invite/:token）
- [x] L4 租戶精靈＋設定中心 —— migration `20260905000004_wizard_settings.sql`（settings_catalog 目錄＝預設值單一來源、get_setting fallback、next_member_no 併發安全產號、create_organization 改 4 參數帶 LOGO/主題色；待使用者貼 SQL Editor 執行）＋測試 `supabase/tests/settings_test.sql`（AC-7 自動驗證）＋前端（/new 四步精靈、/o/:slug/settings 設定中心含編號規則卡＋分類設定、OrgLayout 主題色/LOGO）
- [x] L5 種子資料＋成員清單（雙身分聚合）—— 種子 `supabase/seed/demo_org.sql`（pg_temp 函式、80 會籍含全部地雷型態：雙身分/榮譽/永久/團體5代表/同名/隱藏籍/待審核/待續會/退會/除籍；可重複執行；`npm run seed` 複製到剪貼簿；使用者需改最後一行 email 再貼 SQL Editor）＋成員清單頁改為自然人聚合（身分徽章＋會籍狀態 chip＋搜尋＋統計列）
- [x] L6 收尾 —— Vitest 單元測試（memberNo/settingsValue，12 tests）＋Playwright 煙霧 E2E（未登入 5 條，`npm run test:e2e`）＋README 重寫（從零 ≤15 分鐘含 Supabase 步驟與部署手冊）＋`docs/tada-field-mapping.md` 欄位對照表＋CI 加 npm test

EPIC-0 完成。下一步：部署（berth、網域拼字待核對）→ EPIC-1（報到/繳費/宴會桌次）、官網與 LINE@ 屬加值服務層（見產品規劃）。
