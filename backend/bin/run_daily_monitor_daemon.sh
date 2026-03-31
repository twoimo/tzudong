#!/usr/bin/env bash
set -uo pipefail

# ============================================================
# run_daily.sh 상시 감시 데몬
# - run_daily 프로세스가 죽으면 자동 재시작
# - 로그가 장시간 갱신되지 않으면 정체(stall)로 판단 후 재시작
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
RUNTIME_PATHS_SH="$PROJECT_ROOT/backend/config/runtime_paths.sh"

if [ -f "$RUNTIME_PATHS_SH" ]; then
  # shellcheck source=/dev/null
  source "$RUNTIME_PATHS_SH"
  if declare -f tzudong_runtime_paths_init >/dev/null 2>&1; then
    tzudong_runtime_paths_init "$PROJECT_ROOT"
  fi
fi

BACKEND_DIR="${TZUDONG_BACKEND_ROOT:-$PROJECT_ROOT/backend}"
RUN_DAILY_SCRIPT_PATH="${RUN_DAILY_SCRIPT_PATH:-$BACKEND_DIR/run_daily.sh}"
LOG_DIR="${RUN_DAILY_LOG_DIR:-$BACKEND_DIR/log/cron}"
CURRENT_LOG_LINK="${RUN_DAILY_CURRENT_LOG_LINK:-$LOG_DIR/current.log}"

MONITOR_PID_FILE="${RUN_DAILY_MONITOR_PID_FILE:-$LOG_DIR/run_daily_monitor.pid}"
MONITOR_LOG="${RUN_DAILY_MONITOR_LOG:-$LOG_DIR/monitor.log}"
RUN_DAILY_PID_FILE="${RUN_DAILY_PID_FILE:-$LOG_DIR/run_daily.pid}"

CHECK_INTERVAL_SEC="${RUN_DAILY_MONITOR_INTERVAL_SEC:-30}"
STALL_THRESHOLD_SEC="${RUN_DAILY_STALL_THRESHOLD_SEC:-1800}"  # 30분

if declare -f tzudong_runtime_paths_ensure >/dev/null 2>&1; then
  tzudong_runtime_paths_ensure
else
  mkdir -p "$LOG_DIR"
  touch "$MONITOR_LOG"
fi

log() {
  local level="$1"
  shift
  printf '[%s] [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "$level" "$*" | tee -a "$MONITOR_LOG" >/dev/null
}

read_pid() {
  local pid_file="$1"
  [ -f "$pid_file" ] || return 1
  local pid
  pid="$(tr -dc '0-9' < "$pid_file" || true)"
  [ -n "$pid" ] || return 1
  printf '%s' "$pid"
}

is_pid_alive() {
  local pid="$1"
  [ -n "$pid" ] || return 1
  ps -p "$pid" >/dev/null 2>&1
}

is_run_daily_pid() {
  local pid="$1"
  [ -n "$pid" ] || return 1
  local cmd
  cmd="$(ps -p "$pid" -o cmd= 2>/dev/null || true)"
  [[ "$cmd" == *"$RUN_DAILY_SCRIPT_PATH"* || "$cmd" == *"backend/run_daily.sh"* ]]
}

# PID 파일이 없어도 기존 run_daily 프로세스를 탐지해서 중복 실행을 방지
find_existing_run_daily_pid() {
  local pid
  pid="$(ps -eo pid=,cmd= | awk -v script="$RUN_DAILY_SCRIPT_PATH" '
    index($0, script) && index($0, "run_daily_monitor_daemon.sh") == 0 { print $1; exit }
  ')"

  if [ -z "$pid" ]; then
    pid="$(ps -eo pid=,cmd= | awk '
      index($0, "backend/run_daily.sh") && index($0, "run_daily_monitor_daemon.sh") == 0 { print $1; exit }
    ')"
  fi

  [ -n "$pid" ] || return 1
  printf '%s' "$pid"
}

is_monitor_running() {
  local pid
  pid="$(read_pid "$MONITOR_PID_FILE" 2>/dev/null || true)"
  [ -n "$pid" ] || return 1
  is_pid_alive "$pid" || return 1
  local cmd
  cmd="$(ps -p "$pid" -o cmd= 2>/dev/null || true)"
  [[ "$cmd" == *"run_daily_monitor_daemon.sh run"* ]]
}

get_current_log_file() {
  local current_link="$CURRENT_LOG_LINK"
  if [ -L "$current_link" ] && [ -e "$current_link" ]; then
    readlink -f "$current_link"
    return 0
  fi
  local latest
  latest="$(ls -1t "$LOG_DIR"/daily_*.log 2>/dev/null | head -n 1 || true)"
  [ -n "$latest" ] || return 1
  printf '%s' "$latest"
}

is_log_stale() {
  local logfile
  logfile="$(get_current_log_file 2>/dev/null || true)"
  [ -n "$logfile" ] && [ -f "$logfile" ] || return 1

  local now mtime age
  now="$(date +%s)"
  mtime="$(stat -c %Y "$logfile" 2>/dev/null || true)"
  [ -n "$mtime" ] || return 1
  age=$((now - mtime))

  if [ "$age" -ge "$STALL_THRESHOLD_SEC" ]; then
    log "WARN" "로그 정체 감지: ${age}s >= ${STALL_THRESHOLD_SEC}s (file=$(basename "$logfile"))"
    return 0
  fi
  return 1
}

start_run_daily() {
  local reuse_existing="${1:-1}"
  log "INFO" "run_daily.sh 시작 시도"

  if [ ! -f "$RUN_DAILY_SCRIPT_PATH" ]; then
    log "ERROR" "run_daily 스크립트를 찾을 수 없습니다: $RUN_DAILY_SCRIPT_PATH"
    return 1
  fi

  if [ "$reuse_existing" = "1" ]; then
    local existing_pid
    existing_pid="$(find_existing_run_daily_pid 2>/dev/null || true)"
    if [ -n "$existing_pid" ] && is_pid_alive "$existing_pid" && is_run_daily_pid "$existing_pid"; then
      echo "$existing_pid" > "$RUN_DAILY_PID_FILE"
      log "INFO" "기존 run_daily 프로세스 재사용 (pid=$existing_pid)"
      return 0
    fi
  fi

  # 새 실행은 세션 분리(setsid)하여 프로세스 그룹 단위로 제어 가능하게 함
  (
    cd "$PROJECT_ROOT"
    env -u SHELLOPTS PIPELINE_STDOUT_MODE=off \
      setsid bash "$RUN_DAILY_SCRIPT_PATH" >/dev/null 2>&1 &
    echo "$!" > "$RUN_DAILY_PID_FILE"
  )

  sleep 2
  local pid
  pid="$(read_pid "$RUN_DAILY_PID_FILE" 2>/dev/null || true)"
  if [ -n "$pid" ] && is_pid_alive "$pid" && is_run_daily_pid "$pid"; then
    log "OK" "run_daily.sh 시작 완료 (pid=$pid)"
    return 0
  fi

  log "ERROR" "run_daily.sh 시작 실패"
  return 1
}

stop_run_daily_tree() {
  local pid="$1"
  [ -n "$pid" ] || return 0

  if ! is_pid_alive "$pid"; then
    return 0
  fi

  log "WARN" "run_daily 프로세스 트리 종료 시도 (pid=$pid)"
  # setsid로 띄운 세션/그룹 종료
  kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  sleep 5

  if is_pid_alive "$pid"; then
    log "WARN" "SIGKILL 강제 종료 (pid=$pid)"
    kill -KILL "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  fi
}

ensure_run_daily() {
  local pid
  pid="$(read_pid "$RUN_DAILY_PID_FILE" 2>/dev/null || true)"

  if [ -n "$pid" ] && is_pid_alive "$pid" && is_run_daily_pid "$pid"; then
    # 프로세스는 살아있음. 로그 정체면 재시작.
    if is_log_stale; then
      stop_run_daily_tree "$pid"
      if is_pid_alive "$pid"; then
        log "ERROR" "정체 run_daily 종료 실패 (pid=$pid). 중복 실행 방지를 위해 재시작을 보류합니다."
        return 1
      fi
      start_run_daily 0
    fi
    return 0
  fi

  local live_pid
  live_pid="$(find_existing_run_daily_pid 2>/dev/null || true)"
  if [ -n "$live_pid" ] && is_pid_alive "$live_pid" && is_run_daily_pid "$live_pid"; then
    echo "$live_pid" > "$RUN_DAILY_PID_FILE"
    log "WARN" "PID 파일 복구: 기존 run_daily 프로세스 재사용 (pid=$live_pid)"
    return 0
  fi

  if [ -n "$pid" ]; then
    log "WARN" "stale pid 정리 (pid=$pid)"
  fi
  rm -f "$RUN_DAILY_PID_FILE"
  start_run_daily
}

run_loop() {
  echo "$BASHPID" > "$MONITOR_PID_FILE"
  trap 'log "WARN" "monitor daemon 종료 신호 수신"; rm -f "$MONITOR_PID_FILE"; exit 0' TERM INT
  trap 'ec=$?; if [ "$ec" -ne 0 ]; then log "ERROR" "monitor daemon 비정상 종료 (exit=$ec, cmd=${BASH_COMMAND:-unknown})"; else log "INFO" "monitor daemon 정상 종료"; fi; rm -f "$MONITOR_PID_FILE"' EXIT
  log "INFO" "run_daily monitor daemon 시작 (pid=$BASHPID, interval=${CHECK_INTERVAL_SEC}s, stall=${STALL_THRESHOLD_SEC}s)"

  # 이미 실행 중인 파이프라인이 있으면 재사용, 없으면 시작
  ensure_run_daily

  local tick=0
  while true; do
    ensure_run_daily || true
    tick=$((tick + 1))

    # 과도한 로그 방지: 10회마다 heartbeat
    if [ $((tick % 10)) -eq 0 ]; then
      local pid
      pid="$(read_pid "$RUN_DAILY_PID_FILE" 2>/dev/null || true)"
      if [ -n "$pid" ] && is_pid_alive "$pid"; then
        log "INFO" "heartbeat: run_daily alive (pid=$pid)"
      else
        log "WARN" "heartbeat: run_daily not alive"
      fi
    fi

    sleep "$CHECK_INTERVAL_SEC"
  done
}

start_daemon() {
  if is_monitor_running; then
    local pid
    pid="$(read_pid "$MONITOR_PID_FILE")"
    printf 'already running (pid=%s)\n' "$pid"
    return 0
  fi

  # 세션 분리 + nohup으로 호출 셸 종료/정리 시그널 영향 최소화
  setsid nohup bash "$0" run >/dev/null 2>&1 < /dev/null &
  sleep 1

  if is_monitor_running; then
    local pid
    pid="$(read_pid "$MONITOR_PID_FILE")"
    printf 'started monitor daemon (pid=%s)\n' "$pid"
    return 0
  fi

  printf 'failed to start monitor daemon\n' >&2
  return 1
}

stop_daemon() {
  local pid
  pid="$(read_pid "$MONITOR_PID_FILE" 2>/dev/null || true)"

  if [ -z "$pid" ] || ! is_pid_alive "$pid"; then
    rm -f "$MONITOR_PID_FILE"
    printf 'monitor not running\n'
    return 0
  fi

  kill -TERM "$pid" 2>/dev/null || true
  sleep 1
  if is_pid_alive "$pid"; then
    kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$MONITOR_PID_FILE"
  printf 'stopped monitor daemon (pid=%s)\n' "$pid"
}

status_daemon() {
  local mon_pid run_pid
  mon_pid="$(read_pid "$MONITOR_PID_FILE" 2>/dev/null || true)"
  run_pid="$(read_pid "$RUN_DAILY_PID_FILE" 2>/dev/null || true)"

  if [ -n "$mon_pid" ] && is_pid_alive "$mon_pid"; then
    printf 'monitor: running (pid=%s)\n' "$mon_pid"
  else
    printf 'monitor: stopped\n'
  fi

  if [ -n "$run_pid" ] && is_pid_alive "$run_pid"; then
    printf 'run_daily: running (pid=%s)\n' "$run_pid"
  else
    printf 'run_daily: stopped\n'
  fi

  printf 'monitor_log: %s\n' "$MONITOR_LOG"
}

usage() {
  cat <<USAGE
Usage: $(basename "$0") <start|stop|status|run>

  start   백그라운드 데몬 시작
  stop    데몬 중지
  status  데몬/파이프라인 상태 확인
  run     포그라운드 루프 실행 (내부용)
USAGE
}

cmd="${1:-start}"
case "$cmd" in
  start) start_daemon ;;
  stop) stop_daemon ;;
  status) status_daemon ;;
  run) run_loop ;;
  *) usage; exit 1 ;;
esac
