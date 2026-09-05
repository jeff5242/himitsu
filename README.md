# HiMitsu 🐝

公協會的 AI 秘書處作業系統。源於 TADA 台灣科技農企業發展協會 2026 年會員大會全程數位化實戰。

## 架構
- 前端：Vite + React + TypeScript + Tailwind CSS v4
- 後端：Supabase（**himitsu schema** —— 與同專案內 TADA 的 public schema 完全隔離）
- 部署：EC2（berth）

## 開發
```bash
cp .env.example .env.local   # 填入 Supabase URL 與 publishable key
npm install
npm run dev
```

## 鐵律
1. 連線設定只能走環境變數（CI 的 check:no-hardcode 會擋）
2. 只操作 `himitsu` schema；任何 migration 不得觸碰 public schema
3. 規格文件：EPIC-0 地基規格（多租戶／權限／person-identity 模型／設定中心）
