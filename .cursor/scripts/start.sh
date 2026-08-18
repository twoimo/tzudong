#!/usr/bin/env bash
# Per-boot startup for the Tzudong Cloud Agent environment.
# Brings up the local-only Docker daemon, the pinned 14-service Supabase stack,
# applies the canonical migrations, and seeds the two synthetic restaurants.
# Idempotent: on a warm boot it restarts existing containers and is a no-op for
# already-applied migrations. Reaches readiness, then returns so the dev server
# terminal can start.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/lib.sh"
tzudong_activate_toolchain

# Docker rejects context/host overrides for the local stack admission checks.
unset DOCKER_HOST DOCKER_CONTEXT || true

start_docker_daemon() {
  if tzudong_docker_ready; then
    log "start: docker daemon already reachable"
    return 0
  fi
  log "start: launching local docker daemon"
  echo '{ "storage-driver": "fuse-overlayfs" }' | sudo tee /etc/docker/daemon.json >/dev/null
  mkdir -p "$(dirname "${TZUDONG_DOCKER_SOCK}")"
  # Fully detach so the daemon survives the detached start phase exiting.
  sudo bash -c "setsid dockerd -H unix://${TZUDONG_DOCKER_SOCK} -H unix:///var/run/docker.sock \
    >/tmp/tzudong-dockerd.log 2>&1 < /dev/null &"

  local i
  for i in $(seq 1 30); do
    [ -S "${TZUDONG_DOCKER_SOCK}" ] && break
    sleep 1
  done
  if [ ! -S "${TZUDONG_DOCKER_SOCK}" ]; then
    log "start: FATAL docker socket did not appear"
    tail -n 20 /tmp/tzudong-dockerd.log >&2 || true
    return 1
  fi
  sudo chown "$(id -u):$(id -g)" "${TZUDONG_DOCKER_SOCK}"

  docker context inspect "${TZUDONG_DOCKER_CONTEXT}" >/dev/null 2>&1 \
    || docker context create "${TZUDONG_DOCKER_CONTEXT}" \
         --docker "host=unix://${TZUDONG_DOCKER_SOCK}" >/dev/null
  docker context use "${TZUDONG_DOCKER_CONTEXT}" >/dev/null

  local j
  for j in $(seq 1 30); do
    tzudong_docker_ready && break
    sleep 1
  done
  tzudong_docker_ready || { log "start: FATAL docker daemon not ready"; return 1; }
  log "start: docker daemon ready"
}

configure_bridge_networking() {
  # In the nested Cloud Agent VM, bridged inter-container traffic is filtered by
  # iptables and fails to connect. Let intra-bridge L2 traffic bypass iptables
  # so the Supabase services can reach one another.
  sudo sysctl -w net.bridge.bridge-nf-call-iptables=0 >/dev/null 2>&1 || true
  sudo sysctl -w net.bridge.bridge-nf-call-ip6tables=0 >/dev/null 2>&1 || true
}

# True when local-stack status reports all 14 services running.
stack_running() {
  python3 backend/supabase/scripts/local-stack.py status 2>/dev/null \
    | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin)
except Exception:
    sys.exit(1)
services=d.get("services") or []
running=[s for s in services if s.get("state")=="running"]
sys.exit(0 if d.get("ok") and len(running)==14 else 1)'
}

bring_up_supabase_stack() {
  cd "${TZUDONG_REPO_ROOT}"
  python3 backend/supabase/scripts/local-stack.py render >/dev/null
  # local-stack.py start binds host ports, so it is not safe to run against an
  # already-running stack (it fails port_in_use). Only start when not running.
  if stack_running; then
    log "start: local Supabase stack already running"
  else
    log "start: starting local Supabase stack (may pull images on first boot)"
    python3 backend/supabase/scripts/local-stack.py start >/tmp/tzudong-stack-start.json
  fi
  local project state db
  project="$(python3 backend/supabase/scripts/local-stack.py status 2>/dev/null \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["project_name"])')"
  state="backend/supabase/volumes/.local-stack/${project}"
  db="$(docker ps --filter "label=com.docker.compose.project=${project}" \
        --filter 'label=com.docker.compose.service=db' --format '{{.ID}}')"
  log "start: stack project=${project} db=${db}"

  # Apply canonical migrations only when the schema is not yet present.
  local has_schema
  has_schema="$(docker exec -i "${db}" psql -U postgres -d postgres -tAc \
    "select to_regclass('public.restaurants') is not null;" 2>/dev/null | tr -d '[:space:]')"
  if [ "${has_schema}" != "t" ]; then
    log "start: applying canonical migrations"
    local bind=(--project "${project}" --state-dir "${state}" --env-file "${state}/stack.env")
    python3 backend/supabase/scripts/local-migrate.py apply-prerequisite \
      --container "${db}" --allow-local "${bind[@]}"
    python3 backend/supabase/scripts/local-migrate.py apply \
      --container "${db}" --allow-local "${bind[@]}"
  else
    log "start: migrations already applied"
  fi

  # Seed the two synthetic restaurants used by the local map (idempotent).
  docker exec -i "${db}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres >/dev/null <<'SQL'
INSERT INTO public.restaurants (
  id, trace_id, approved_name, road_address, jibun_address,
  english_address, categories, lat, lng, phone, status,
  created_at, updated_at, weekly_search_count
) VALUES
  ('00000000-0000-4000-8000-000000000101', 'nightly-trace-1', '정원분식',
   '서울특별시 중구 세종대로 110', '서울특별시 중구 태평로1가 31',
   '110 Sejong-daero, Jung-gu, Seoul', ARRAY['분식'], 37.5665, 126.978,
   '02-0000-0001', 'approved', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 10),
  ('00000000-0000-4000-8000-000000000102', 'nightly-trace-2', '명동칼국수',
   '서울특별시 중구 을지로 30', '서울특별시 을지로1가 50',
   '30 Eulji-ro, Jung-gu, Seoul', ARRAY['한식'], 37.56695, 126.97885,
   '02-0000-0002', 'approved', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z', 8)
ON CONFLICT (id) DO NOTHING;
SQL
  log "start: supabase stack ready"
}

start_docker_daemon
configure_bridge_networking
bring_up_supabase_stack
log "start: complete"
