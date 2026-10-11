#!/bin/zsh
set -euo pipefail

root="${0:A:h:h:h}"
deps="/Users/twoimo/.codex/worktrees/pipeline-continuity-20261009/tzudong/apps/web/node_modules"
owned_link=0
next_pid=''
gateway_pid=''
run_id="${TZUDONG_FIXTURE_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
next_log="performance/knowledge-evidence-untimed-20261011/next-dev-${run_id}.log"
gateway_log="performance/knowledge-evidence-untimed-20261011/fixture-gateway-${run_id}.log"

cleanup() {
  [[ -n "$next_pid" ]] && kill "$next_pid" 2>/dev/null || true
  [[ -n "$gateway_pid" ]] && kill "$gateway_pid" 2>/dev/null || true
  [[ -n "$next_pid" ]] && wait "$next_pid" 2>/dev/null || true
  [[ -n "$gateway_pid" ]] && wait "$gateway_pid" 2>/dev/null || true
  [[ "$owned_link" == 1 && -L "$root/node_modules" ]] && rm "$root/node_modules"
}
on_signal() {
  trap - EXIT
  cleanup
  exit 130
}
trap cleanup EXIT
trap on_signal INT TERM

cd "$root"
for port in 20502 20503 20504; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    print -u2 "port $port is already in use"
    exit 1
  fi
done
if [[ ! -e node_modules ]]; then
  [[ -d "$deps" ]] || { print -u2 'pinned dependency directory is unavailable'; exit 1; }
  ln -s "$deps" node_modules
  owned_link=1
fi
[[ ! -e "$next_log" && ! -e "$gateway_log" ]] || { print -u2 "run logs already exist: $run_id"; exit 1; }

env PATH="/opt/homebrew/opt/node@24/bin:$PATH" \
  NODE_ENV=development \
  TZUDONG_LOCAL_SUPABASE_DEV=1 \
  TZUDONG_NEXT_DIST_DIR=.next-local-18080 \
  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:20503 \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=synthetic-loopback-only \
  SUPABASE_SERVICE_ROLE_KEY=synthetic-loopback-only \
  NEXT_PUBLIC_SITE_URL=http://127.0.0.1:20504 \
  E2E_ADMIN_ROUTE_BYPASS=1 \
  E2E_ADMIN_ROUTE_BYPASS_CONTEXT=playwright \
  E2E_ADMIN_ROUTE_BYPASS_RUNTIME=local-dev-server \
  E2E_ADMIN_ROUTE_BYPASS_TOKEN=design-fixture-local-only \
  /opt/homebrew/opt/node@24/bin/node scripts/dev-prewarm.mjs --port 20502 --host 127.0.0.1 --no-prewarm \
  > "$next_log" 2>&1 &
next_pid=$!

env GRAPH_FIXTURE_EXPORT_DIR="$root/data/knowledge-graph" \
  /Users/twoimo/.bun/bin/bun performance/knowledge-evidence-untimed-20261011/fixture-gateway.mjs \
  > "$gateway_log" 2>&1 &
gateway_pid=$!

for attempt in {1..120}; do
  ready=1
  for port in 20502 20503 20504; do
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 || ready=0
  done
  [[ "$ready" == 1 ]] && break
  sleep 0.25
done
for port in 20502 20503 20504; do
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 || { print -u2 "port $port did not become ready"; exit 1; }
done
for attempt in {1..120}; do
  grep -q 'Ready in' "$next_log" 2>/dev/null && break
  sleep 0.25
done
grep -q 'Ready in' "$next_log" || { print -u2 'Next did not finish startup'; exit 1; }

print 'Viewer: http://127.0.0.1:20504/admin?module=knowledge-graph'
print 'Bootstrap: http://127.0.0.1:20504/fixture-login'
print 'Next:   http://127.0.0.1:20502'
print 'Fixture services: 127.0.0.1:20503 and 127.0.0.1:20504'
print "Logs: $next_log and $gateway_log"
wait "$next_pid" "$gateway_pid"
