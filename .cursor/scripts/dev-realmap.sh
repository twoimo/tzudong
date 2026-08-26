#!/usr/bin/env bash
# Opt-in dev terminal: local Supabase stack (seeded data) + the REAL Naver map.
# Requires the public NEXT_PUBLIC_NAVER_CLIENT_ID (Naver Cloud ncpKeyId) in the
# environment (add it as a secret). Serves on http://127.0.0.1:8080 like dev.sh,
# so stop the default web-dev terminal first (they share the port).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/lib.sh"
tzudong_activate_toolchain
unset DOCKER_HOST DOCKER_CONTEXT || true
docker context use "${TZUDONG_DOCKER_CONTEXT}" >/dev/null 2>&1 || true

exec node "${SCRIPT_DIR}/dev-realmap.mjs"
