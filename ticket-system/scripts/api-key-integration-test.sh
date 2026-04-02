#!/usr/bin/env bash
# API Key 集成测试（与 .cursor/plans 中方案一致）
# 用法: BASE_URL=... API_KEY=... ./scripts/api-key-integration-test.sh
set -euo pipefail

BASE_URL="${BASE_URL:-https://gongdan-b5fzbtgteqd5gzfb.eastasia-01.azurewebsites.net}"
API_KEY="${API_KEY:-gd_live_a28b3db84385be75d1d3b6b6023784c27200d045}"

die() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "OK: $*"; }

http_code() {
  curl -sS -o /tmp/aki.body -w "%{http_code}" "$@" || die "curl failed"
}

echo "BASE_URL=$BASE_URL"
echo "API_KEY prefix: ${API_KEY:0:16}..."
echo

# --- test-valid: 已授权模块应 200 或 403（模块未开），不得 401 ---
c=$(http_code "$BASE_URL/api/tickets?page=1&pageSize=2" -H "X-Api-Key: $API_KEY")
[[ "$c" == "401" ]] && die "tickets + key: expected 200 or 403, got 401 (JWT 未接受 API Key？)"
[[ "$c" == "200" || "$c" == "403" ]] || die "tickets + key: unexpected HTTP $c"
ok "tickets + valid key -> HTTP $c"

c=$(http_code "$BASE_URL/api/customers" -H "X-Api-Key: $API_KEY")
[[ "$c" == "401" ]] && die "customers + key: expected 200 or 403, got 401"
[[ "$c" == "200" || "$c" == "403" ]] || die "customers + key: unexpected HTTP $c"
ok "customers + valid key -> HTTP $c"

# --- test-boundary: 未授权模块应 403 ---
c=$(http_code "$BASE_URL/api/engineers" -H "X-Api-Key: $API_KEY")
[[ "$c" == "403" ]] || die "engineers + key (boundary): expected 403, got $c"
body=$(cat /tmp/aki.body)
echo "$body" | grep -q "无权访问模块" || echo "WARN: body may not match expected message"
ok "engineers + key (boundary) -> HTTP 403"

# --- test-nokey: 无凭证 / 错误密钥 -> 401 ---
c=$(http_code "$BASE_URL/api/tickets?page=1&pageSize=2")
[[ "$c" == "401" ]] || die "tickets without key: expected 401, got $c"
ok "tickets without credentials -> HTTP 401"

c=$(http_code "$BASE_URL/api/tickets?page=1&pageSize=2" -H "X-Api-Key: gd_live_invalid_key_12345")
[[ "$c" == "401" || "$c" == "403" ]] || die "tickets + bad key: expected 401 or 403, got $c"
ok "tickets + invalid key -> HTTP $c"

# --- test-admin: 密钥不可访问管理接口 -> 401 ---
c=$(http_code "$BASE_URL/api/api-keys" -H "X-Api-Key: $API_KEY")
[[ "$c" == "401" ]] || die "api-keys + key only: expected 401, got $c"
ok "api-keys + key (no JWT) -> HTTP 401"

echo
echo "All API Key integration checks passed."
