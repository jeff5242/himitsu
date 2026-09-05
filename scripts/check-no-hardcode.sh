#!/usr/bin/env bash
# 禁止任何寫死的 Supabase 專案位址／金鑰進入程式碼（TADA 污染事故的絕緣措施）
set -euo pipefail
PATTERN='supabase\.co|sb_publishable_|sb_secret_|eyJhbGciOi'
HITS=$(grep -rnE "$PATTERN" src supabase --include='*' 2>/dev/null | grep -v '.env.example' || true)
if [ -n "$HITS" ]; then
  echo "❌ 發現寫死的連線資訊，請改用環境變數："
  echo "$HITS"
  exit 1
fi
echo "✓ no hardcoded credentials"
