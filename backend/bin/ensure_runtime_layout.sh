#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
RUNTIME_PATHS_SH="$PROJECT_ROOT/backend/config/runtime_paths.sh"

if [ ! -f "$RUNTIME_PATHS_SH" ]; then
  echo "[ERROR] runtime_paths.sh not found: $RUNTIME_PATHS_SH" >&2
  exit 1
fi

# shellcheck source=/dev/null
source "$RUNTIME_PATHS_SH"
tzudong_runtime_paths_init "$PROJECT_ROOT"

MODE="ensure"
PRINT="0"
QUIET="0"

usage() {
  cat <<USAGE
Usage: $(basename "$0") [--check] [--print] [--quiet]

  --check   Create nothing; validate required runtime layout only
  --print   Print effective runtime path map
  --quiet   Suppress OK message
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE="check" ;;
    --print) PRINT="1" ;;
    --quiet) QUIET="1" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
  shift
done

if [ "$MODE" = "ensure" ]; then
  tzudong_runtime_paths_ensure
fi

if [ "$PRINT" = "1" ]; then
  tzudong_runtime_paths_print
fi

if ! tzudong_runtime_paths_check; then
  echo "[ERROR] runtime layout check failed" >&2
  exit 1
fi

if [ "$QUIET" != "1" ]; then
  echo "[OK] runtime layout ready"
fi
