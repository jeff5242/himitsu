#!/usr/bin/env bash
# AC-5「一鍵重建示範協會」：目前 migration 走「貼 SQL Editor」流程（無 service key 落地），
# 本指令把種子 SQL 複製到剪貼簿並提示下一步。
set -euo pipefail

SEED_FILE="$(cd "$(dirname "$0")/.." && pwd)/supabase/seed/demo_org.sql"

if [ ! -f "$SEED_FILE" ]; then
  echo "✗ 找不到種子檔：$SEED_FILE" >&2
  exit 1
fi

if command -v pbcopy >/dev/null 2>&1; then
  pbcopy < "$SEED_FILE"
  echo "✓ 種子 SQL 已複製到剪貼簿（supabase/seed/demo_org.sql）"
else
  echo "（此環境無 pbcopy，請手動複製 $SEED_FILE）"
fi

echo "→ 貼到 Supabase SQL Editor"
echo "→ 把最後一行的 your@email.tld 改成你登入 HiMitsu 的 email"
echo "→ 執行後 Results 顯示建置統計：會籍總數應為 80、雙身分 1 人"
echo "→ 前端開 /o/demo/members 看雙身分聚合"
