#!/usr/bin/env bash
set -euo pipefail

readonly expected_npm_version='11.6.2'
readonly max_attempts=3
readonly repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
readonly retry_log="$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/tzudong-backend-npm-ci.XXXXXX")"

cleanup() {
  rm -f -- "$retry_log"
}
trap cleanup EXIT

is_transient_network_failure() {
  LC_ALL=C grep -Eiq \
    'ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|ECONNREFUSED|ERR_SOCKET_CONNECTION_TIMEOUT|ERR_SOCKET_TIMEOUT|socket hang up' \
    "$retry_log"
}

attempt=1
while (( attempt <= max_attempts )); do
  npm_bin="$(command -v npm || true)"
  if [[ -z "$npm_bin" ]]; then
    echo 'backend npm ci failed: npm is unavailable' >&2
    exit 127
  fi

  actual_npm_version="$("$npm_bin" --version)"
  if [[ "$actual_npm_version" != "$expected_npm_version" ]]; then
    echo "backend npm ci failed: expected npm ${expected_npm_version}, got ${actual_npm_version}" >&2
    exit 1
  fi

  : > "$retry_log"
  set +e
  (
    cd "$repository_root"
    "$npm_bin" ci --prefix backend
  ) 2>&1 | tee "$retry_log"
  pipeline_status=("${PIPESTATUS[@]}")
  set -e

  npm_status="${pipeline_status[0]}"
  tee_status="${pipeline_status[1]}"
  if (( tee_status != 0 )); then
    exit "$tee_status"
  fi
  if (( npm_status == 0 )); then
    exit 0
  fi

  if (( attempt == max_attempts )) || ! is_transient_network_failure; then
    exit "$npm_status"
  fi

  backoff_seconds=$((attempt * 10))
  echo "backend npm ci encountered a transient network failure; retrying in ${backoff_seconds}s (${attempt}/${max_attempts})" >&2
  sleep "$backoff_seconds"
  attempt=$((attempt + 1))
done

exit 1
