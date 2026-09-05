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
- 部署：EC2 berth（berth MCP）；網域 himizsu.milkidea.com（拼字部署前再核對）

## 規格文件
- 產品規劃：https://claude.ai/code/artifact/e668187e-a3f1-4f04-911d-b0426c1c8a15
- EPIC-0 地基規格（含 AC-1~7 驗收）：https://claude.ai/code/artifact/1eb7c3e7-0b50-4749-8fb3-7b49b80cb383
- 大會實戰檢討（需求源頭）：https://claude.ai/code/artifact/3d363730-c3a4-4bad-8e8a-6c6f761964b7

## 進度
- [x] L1 鷹架（CI／no-hardcode／init migration）
- [x] L2 六表 Schema＋RLS —— migration `20260905000002_core_tables.sql`（待使用者貼 SQL Editor 執行）＋隔離測試 `supabase/tests/rls_isolation_test.sql`（含 AC-1/AC-4/AC-6 自動驗證，全程 ROLLBACK）
- [ ] L3 Auth＋角色＋審計
- [ ] L4 租戶精靈＋設定中心
- [ ] L5 種子資料＋成員清單（雙身分聚合）
- [ ] L6 收尾（E2E／文件／TADA 欄位對照表）
