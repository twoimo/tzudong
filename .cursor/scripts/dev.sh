#!/usr/bin/env bash
# Long-running web dev-server terminal for the Tzudong Cloud Agent environment.
# Runs the repository's validated local dev path, which admits only the local
# Supabase stack (brought up by start.sh) and serves on http://127.0.0.1:8080.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/lib.sh"
tzudong_activate_toolchain
unset DOCKER_HOST DOCKER_CONTEXT || true
docker context use "${TZUDONG_DOCKER_CONTEXT}" >/dev/null 2>&1 || true

cd "${TZUDONG_REPO_ROOT}/apps/web"
exec bun run dev
