#!/usr/bin/env bash
# Shared runtime path governance for backend pipeline scripts.
# Precedence: ENV override > defaults from this file > legacy fallback in callers.

# shellcheck disable=SC2034

# Resolve and export runtime path variables.
# Usage: tzudong_runtime_paths_init [project_root]
tzudong_runtime_paths_init() {
  local project_root="${1:-}"
  if [ -z "$project_root" ]; then
    local here
    here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    project_root="$(dirname "$(dirname "$here")")"
  fi

  export TZUDONG_PROJECT_ROOT="${TZUDONG_PROJECT_ROOT:-$project_root}"
  export TZUDONG_BACKEND_ROOT="${TZUDONG_BACKEND_ROOT:-$TZUDONG_PROJECT_ROOT/backend}"

  export RUN_DAILY_SCRIPT_PATH="${RUN_DAILY_SCRIPT_PATH:-$TZUDONG_BACKEND_ROOT/run_daily.sh}"
  export RUN_DAILY_LOG_DIR="${RUN_DAILY_LOG_DIR:-$TZUDONG_BACKEND_ROOT/log/cron}"
  export RUN_DAILY_ARCHIVE_DIR="${RUN_DAILY_ARCHIVE_DIR:-$RUN_DAILY_LOG_DIR/archive}"
  export RUN_DAILY_CURRENT_LOG_LINK="${RUN_DAILY_CURRENT_LOG_LINK:-$RUN_DAILY_LOG_DIR/current.log}"

  export RUN_DAILY_MONITOR_LOG="${RUN_DAILY_MONITOR_LOG:-$RUN_DAILY_LOG_DIR/monitor.log}"
  export RUN_DAILY_MONITOR_PID_FILE="${RUN_DAILY_MONITOR_PID_FILE:-$RUN_DAILY_LOG_DIR/run_daily_monitor.pid}"
  export RUN_DAILY_PID_FILE="${RUN_DAILY_PID_FILE:-$RUN_DAILY_LOG_DIR/run_daily.pid}"

  export RUN_DAILY_SUMMARY_PATH="${RUN_DAILY_SUMMARY_PATH:-$TZUDONG_PROJECT_ROOT/summary.md}"
}

# Print required runtime directories, one per line.
tzudong_runtime_required_dirs() {
  cat <<DIRS
$RUN_DAILY_LOG_DIR
$RUN_DAILY_ARCHIVE_DIR
$TZUDONG_BACKEND_ROOT/log/restaurant-crawling
$TZUDONG_BACKEND_ROOT/data/no_transcript_link
$TZUDONG_BACKEND_ROOT/restaurant-crawling/temp
$TZUDONG_BACKEND_ROOT/restaurant-crawling/temp/web_fallback_dumps
$TZUDONG_BACKEND_ROOT/restaurant-evaluation/temp
DIRS
}

# Create required runtime directories/files.
tzudong_runtime_paths_ensure() {
  local dir
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    mkdir -p "$dir"
  done < <(tzudong_runtime_required_dirs)

  mkdir -p "$(dirname "$RUN_DAILY_SUMMARY_PATH")"
  touch "$RUN_DAILY_MONITOR_LOG"
}

# Validate required runtime directories/files. Returns non-zero on failure.
tzudong_runtime_paths_check() {
  local ok=0
  local dir
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    if [ ! -d "$dir" ]; then
      echo "[MISSING_DIR] $dir" >&2
      ok=1
    fi
  done < <(tzudong_runtime_required_dirs)

  if [ ! -f "$RUN_DAILY_MONITOR_LOG" ]; then
    echo "[MISSING_FILE] $RUN_DAILY_MONITOR_LOG" >&2
    ok=1
  fi

  local summary_parent
  summary_parent="$(dirname "$RUN_DAILY_SUMMARY_PATH")"
  if [ ! -d "$summary_parent" ]; then
    echo "[MISSING_DIR] $summary_parent" >&2
    ok=1
  fi

  return "$ok"
}

# Print effective runtime path map.
tzudong_runtime_paths_print() {
  cat <<EOF_PRINT
TZUDONG_PROJECT_ROOT=$TZUDONG_PROJECT_ROOT
TZUDONG_BACKEND_ROOT=$TZUDONG_BACKEND_ROOT
RUN_DAILY_SCRIPT_PATH=$RUN_DAILY_SCRIPT_PATH
RUN_DAILY_LOG_DIR=$RUN_DAILY_LOG_DIR
RUN_DAILY_ARCHIVE_DIR=$RUN_DAILY_ARCHIVE_DIR
RUN_DAILY_CURRENT_LOG_LINK=$RUN_DAILY_CURRENT_LOG_LINK
RUN_DAILY_MONITOR_LOG=$RUN_DAILY_MONITOR_LOG
RUN_DAILY_MONITOR_PID_FILE=$RUN_DAILY_MONITOR_PID_FILE
RUN_DAILY_PID_FILE=$RUN_DAILY_PID_FILE
RUN_DAILY_SUMMARY_PATH=$RUN_DAILY_SUMMARY_PATH
EOF_PRINT
}
