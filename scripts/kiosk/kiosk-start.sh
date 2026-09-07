#!/usr/bin/env bash
# ============================================================================
# 報到機開機腳本（樹莓派 autostart 用）：
# 等網路 → 起 agent → 等快照就緒才用本地 URL，否則退線上版。
# 需先完成 register（見 docs/kiosk-deploy.md）。
# ============================================================================
set -u

AGENT_DIR="${KIOSK_DATA_DIR:-$HOME/.himitsu-kiosk}"
PORT="${KIOSK_PORT:-8080}"
SITE_URL="${KIOSK_SITE_URL:-https://himitsu.milkidea.com}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHROMIUM="${KIOSK_CHROMIUM:-chromium-browser}"

log() { echo "[kiosk-start] $*"; }

# 1) 等網路（最多 60 秒；等不到也繼續——agent 有快取照樣能開）
for i in $(seq 1 30); do
  if curl -s -m 2 -o /dev/null "$SITE_URL"; then log "網路 OK"; break; fi
  sleep 2
done

# 2) 起 agent（若尚未執行）
if ! curl -s -m 2 "http://127.0.0.1:$PORT/agent/status" >/dev/null; then
  log "啟動 kiosk-agent…"
  nohup python3 "$SCRIPT_DIR/kiosk-agent.py" run --data-dir "$AGENT_DIR" --port "$PORT" \
    >> "$AGENT_DIR/agent.log" 2>&1 &
fi

# 3) 等 agent ready（含快照）最多 90 秒
URL="$SITE_URL"
for i in $(seq 1 45); do
  READY=$(curl -s -m 2 "http://127.0.0.1:$PORT/agent/status" | grep -o '"ready": *true' || true)
  if [ -n "$READY" ]; then
    URL="http://127.0.0.1:$PORT/kiosk"
    log "agent 就緒，使用本地模式"
    break
  fi
  sleep 2
done
[ "$URL" = "$SITE_URL" ] && log "agent 未就緒，退線上版：$URL"

# 4) 全螢幕 kiosk（雙螢幕定位見 docs/kiosk-deploy.md 的 cdp 章節）
exec "$CHROMIUM" --kiosk --noerrdialogs --disable-infobars \
  --disable-session-crashed-bubble --check-for-update-interval=31536000 "$URL"
