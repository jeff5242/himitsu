# 報到機佈署手冊（樹莓派）

> EPIC-2 交付物。適用樹莓派 4B/5（任何 Linux/macOS 也能跑 agent，樹莓派章節僅雙螢幕部分特有）。
> 血淚教訓來源：TADA 2026-09 實戰。

## 一、快速開始（任何機器）

```bash
# 1. 後台「裝置」分頁 → 產生註冊碼（15 分鐘一次性）
# 2. 在機器上（repo 的 scripts/kiosk/ 下）：
python3 kiosk-agent.py register \
  --supabase-url https://<project>.supabase.co \
  --anon-key <publishable key> \
  --code <註冊碼>
# 3. 跑起來：
python3 kiosk-agent.py run
# 4. 後台「裝置」分頁：綁定場次 → 60 秒內 agent 完成快照
# 5. 瀏覽器開 http://127.0.0.1:8080/kiosk
```

- 強制離線測試：`touch /tmp/kiosk-agent-offline`（移除即復線）
- 資料目錄 `~/.himitsu-kiosk/`：config.json（帳密，chmod 600）、kiosk.db（快照＋佇列）、webcache/（SPA 資產）、agent.log
- **斷電安全**：佇列在 SQLite，重開機不掉；開機腳本會自動續跑

## 二、樹莓派 kiosk 開機

1. Raspberry Pi OS（Bookworm，labwc/Wayland）
2. repo 只需要 `scripts/kiosk/` 三個檔案，複製到 `~/kiosk/`
3. 完成上面的 register
4. autostart（`~/.config/labwc/autostart` 或 systemd user unit）：
   ```
   ~/kiosk/kiosk-start.sh &
   ```
   kiosk-start.sh 行為：等網路 → 起 agent → 等 `/agent/status` ready（含快照）才用
   `http://127.0.0.1:8080/kiosk`，等不到就退線上版（有網才有意義）

## 三、雙螢幕（DSI 觸控＋HDMI 投影）——教訓都用血換的

- **絕對不要用 wlr-randr 鏡像（重疊輸出）**：grim 截圖看起來正常，但**實體面板必黑屏**——勿信截圖
- 正解＝**延伸桌面雙視窗**：DSI 跑互動報到（`/kiosk`），HDMI 開第二個 Chromium 實例跑投影頁
  （`/o/<slug>/events/<id>/screen`，桌次列表/平面圖皆可）
- 視窗定位用 Xwayland＋CDP（參考 TADA 的 `cdp-fullscreen.py` 做法）：
  **先移動視窗 → 輪詢確認就位 → 再全螢幕**——labwc 依視窗「當下位置」決定全螢幕落在哪顆螢幕
- **HDMI 全程保持開啟**只調位置：開機階段 `--off/--on` 切換常常回不來
- HDMI 黑屏先驗電源：`vcgencmd get_throttled` 非 `0x0` ＝低電壓（換 5V/3A+ 電源再說）

## 四、營運判讀（後台「裝置」分頁）

| 燈號/欄位 | 意義 | 行動 |
|---|---|---|
| 綠燈 | 45 秒內有心跳 | 正常 |
| 灰燈＋待同步 0 | 關機或沒網、手上沒有未回傳資料 | 不急 |
| 灰燈＋**待同步 >0 且持續不歸零** | 斷網且握有未回傳報到 | **去現場看那台機器** |
| 受管關閉 | agent 停止下載快照（遙控） | 維修/下線時使用 |

- 停用一台機＝把它的 kiosk 帳號停用（org_users status→disabled），心跳立即失效
- kiosk 帳號權限只有 `checkin.write`：機器遺失也動不了會籍/會費

## 五、兩機 merge 驗收（AC-18，不需要真樹莓派）

```bash
# 後台產兩個註冊碼，各註冊到獨立資料目錄：
python3 kiosk-agent.py register --data-dir ~/.kiosk-a --code CODE1 --supabase-url … --anon-key …
python3 kiosk-agent.py register --data-dir ~/.kiosk-b --code CODE2 --supabase-url … --anon-key …
# 後台把兩台裝置都綁定同一場活動，然後：
python3 merge_test.py --dir-a ~/.kiosk-a --dir-b ~/.kiosk-b
```

腳本自動：兩實例起機 → 都斷網 → 同一人兩邊各報到＋發放 → A 先復線、B 後復線 →
驗證 server 有效報到僅 1 筆、發放聯集不重複，輸出 PASS/FAIL。
