#!/usr/bin/env bash
# Shared helpers for the Tzudong Cloud Agent environment.
#
# The Cloud Agent runtime injects an /exec-daemon directory at the front of PATH
# whose bundled `node` is not the Node 24.x the repository requires. Every phase
# therefore resolves an explicit Node 24 bin directory and puts it (plus Bun)
# ahead of the runtime PATH before running repository commands.
set -euo pipefail

# The repository root that contains this file's parent .cursor directory.
TZUDONG_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export TZUDONG_REPO_ROOT

# Local-only Supabase docker socket (Docker Desktop-style path). local-stack.py
# rejects the default /var/run/docker.sock and requires a user-owned socket.
export TZUDONG_DOCKER_SOCK="${HOME}/.docker/run/docker.sock"
export TZUDONG_DOCKER_CONTEXT="tzudong-local"

log() { printf '[tzudong-env] %s\n' "$*" >&2; }

# Print a bin directory containing a Node 24.x `node`, or empty when none found.
tzudong_find_node24_bin() {
  local candidate
  for candidate in \
    "${HOME}"/.nvm/versions/node/v24*/bin \
    /usr/local/node24/bin \
    /usr/bin \
    /usr/local/bin; do
    if [ -x "${candidate}/node" ] && "${candidate}/node" --version 2>/dev/null | grep -q '^v24\.'; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  return 1
}

# Put Node 24 and Bun ahead of PATH and export the Node 24 executable that the
# Bun-based unit test harness uses for its Linux PID-namespace supervisor.
tzudong_activate_toolchain() {
  local node24_bin
  if node24_bin="$(tzudong_find_node24_bin)"; then
    export PATH="${node24_bin}:${HOME}/.bun/bin:${PATH}"
    export TZUDONG_NODE24_EXECUTABLE="${node24_bin}/node"
  else
    export PATH="${HOME}/.bun/bin:${PATH}"
    log "WARNING: no Node 24.x runtime found on PATH"
  fi
}

# True when a Docker daemon is reachable through the local user-owned context.
tzudong_docker_ready() {
  docker context inspect "${TZUDONG_DOCKER_CONTEXT}" >/dev/null 2>&1 \
    && docker --context "${TZUDONG_DOCKER_CONTEXT}" info >/dev/null 2>&1
}
