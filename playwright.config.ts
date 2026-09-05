import { defineConfig } from '@playwright/test';

// E2E 煙霧測試：只驗證未登入可及的頁面（登入頁／受邀頁／路由守衛），
// 不寫入任何資料。dev server 用 .env.local 的連線（僅讀 himitsu schema）。
export default defineConfig({
  testDir: './e2e',
  timeout: 15_000,
  use: {
    baseURL: 'http://localhost:5173',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
