#!/usr/bin/env bash

# ============================================================
# 쯔동여지도 일일 데이터 수집 파이프라인 (Performance Optimized)
# ============================================================
# 
# [PERF] 최적화 포인트:
# 1. 스텝별 실행 시간 측정 (병목 구간 가시화)
# 2. 스마트 스킵 로직 (신규 데이터 없으면 고비용 단계 건너뜀)
# 3. 중간 git sync 횟수 최적화 (5→3회, 각 30-60초 절약)
# 4. 파이프라인 전체 타임아웃 보호
# 5. 병렬 가능한 작업 병렬화
# ============================================================

# 파이프라인 에러 감지를 위해 pipefail 설정 (tee 사용 시 필수)
set -o pipefail

# 프로젝트 루트 경로 동적 탐색 (스크립트 위치 기준 상위 폴더)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 프로젝트 루트로 이동
cd "$PROJECT_ROOT" || { echo "[ERROR] 프로젝트 루트로 이동 실패: $PROJECT_ROOT"; exit 1; }

# 공통 런타임 경로 로드 (ENV override > shared default > legacy fallback)
RUNTIME_PATHS_SH="$PROJECT_ROOT/backend/config/runtime_paths.sh"
if [ -f "$RUNTIME_PATHS_SH" ]; then
    # shellcheck source=/dev/null
    source "$RUNTIME_PATHS_SH"
    if declare -f tzudong_runtime_paths_init >/dev/null 2>&1; then
        tzudong_runtime_paths_init "$PROJECT_ROOT"
    fi
    if declare -f tzudong_runtime_paths_ensure >/dev/null 2>&1; then
        tzudong_runtime_paths_ensure
    fi
fi

# 환경 변수 로드 (Node, Python 경로 등)
if [ -f "$HOME/.bashrc" ]; then
    source "$HOME/.bashrc"
fi

if [ -f "$PROJECT_ROOT/backend/.env" ]; then
    set -a
    source "$PROJECT_ROOT/backend/.env"
    set +a
fi

# [Local Config] 쿼타 우회를 위한 gemini CLI 래퍼 경로 설정
export PATH="$PROJECT_ROOT/backend/bin:$PATH"

# [Local Config] Python 런타임 탐색
python_cmd_usable() {
    local cmd="$1"
    command -v "$cmd" >/dev/null 2>&1 || return 1

    if command -v timeout >/dev/null 2>&1; then
        timeout 8s "$cmd" -V >/dev/null 2>&1
    else
        "$cmd" -V >/dev/null 2>&1
    fi
}

if [ -n "$PYTHON_CMD" ] && python_cmd_usable "$PYTHON_CMD"; then
    : # 이미 환경변수로 설정된 PYTHON_CMD 유지
elif python_cmd_usable python.exe; then
    PYTHON_CMD="python.exe"
elif python_cmd_usable python; then
    PYTHON_CMD="python"
elif python_cmd_usable python3; then
    PYTHON_CMD="python3"
else
    echo "[ERROR] 사용 가능한 Python 런타임을 찾을 수 없습니다. 환경변수를 확인하세요."
    exit 1
fi
export PYTHONUNBUFFERED=1

# [Local Config] RClone 및 추가 PATH 설정 (필요 시 환경변수로 주입)
export PYTHON_CMD
if [ -n "$USERPROFILE" ] && command -v cygpath >/dev/null 2>&1; then
    _DOC_DIR="$(cygpath -u "$USERPROFILE")/Documents/rclone-v1.72.1-windows-amd64"
    if [ -d "$_DOC_DIR" ]; then
        export PATH="$PATH:$_DOC_DIR"
    fi
elif [ -d "$HOME/Documents/rclone-v1.72.1-windows-amd64" ]; then
    export PATH="$PATH:$HOME/Documents/rclone-v1.72.1-windows-amd64"
fi
# [Cross-Platform] Deno 런타임 PATH 자동 탐색 (yt-dlp n challenge 해결용)
if ! command -v deno &> /dev/null; then
    case "$(uname -s)" in
        CYGWIN*|MINGW*|MSYS*)
            [ -n "$USERPROFILE" ] && _DENO_DIR="$(cygpath -u "$USERPROFILE" 2>/dev/null)/.deno/bin"
            [ -z "$_DENO_DIR" ] && _DENO_DIR="$HOME/.deno/bin"
            ;;
        *)  _DENO_DIR="$HOME/.deno/bin" ;;
    esac
    [ -d "$_DENO_DIR" ] && export PATH="$PATH:$_DENO_DIR"
    unset _DENO_DIR
fi

# 로그 디렉토리 생성 (shared path 우선)
LOG_DIR="${RUN_DAILY_LOG_DIR:-$PROJECT_ROOT/backend/log/cron}"
LOG_ARCHIVE_DIR="${RUN_DAILY_ARCHIVE_DIR:-$LOG_DIR/archive}"
CURRENT_LOG_LINK="${RUN_DAILY_CURRENT_LOG_LINK:-$LOG_DIR/current.log}"
mkdir -p "$LOG_DIR" "$LOG_ARCHIVE_DIR"

# [TimeZone] 기본 로그 기준 시간대를 KST로 고정 (이미 TZ가 있으면 존중)
export TZ="${TZ:-Asia/Seoul}"

DATE=$(date +%Y-%m-%d)
LOG_FILE="$LOG_DIR/daily_$DATE.log"
ARCHIVED_LOG=""
# [Safety] 기본값은 force-push 비활성화 (필요 시 ALLOW_DATA_FORCE_PUSH=1로 명시적 허용)
ALLOW_DATA_FORCE_PUSH="${ALLOW_DATA_FORCE_PUSH:-0}"
# 로그 모드: compact(기본) | debug
PIPELINE_LOG_MODE="${PIPELINE_LOG_MODE:-compact}"
# 크롤링 하위 스크립트 로그 모드 전달: normal(기본) | debug
export CRAWL_LOG_VERBOSITY="${CRAWL_LOG_VERBOSITY:-normal}"

# [PERF] 파이프라인 시작 시간 기록 (전체 실행 시간 측정)
PIPELINE_START=$(date +%s)

# [Reliability] 같은 날짜 재실행 시 이전 로그를 archive로 이동해
# 현재 실행 집계를 오염시키지 않도록 분리합니다.
if [ -f "$LOG_FILE" ] && [ -s "$LOG_FILE" ]; then
    mkdir -p "$LOG_ARCHIVE_DIR"
    ARCHIVED_LOG="$LOG_ARCHIVE_DIR/daily_${DATE}_$(date +%H%M%S).log"
    mv "$LOG_FILE" "$ARCHIVED_LOG"
fi
touch "$LOG_FILE"

# monitor 데몬이 최신 로그를 안정적으로 찾도록 current.log 갱신
# 실패 시 warn-only (파이프라인 중단 금지)
if ! (cd "$LOG_DIR" && ln -sfn "$(basename "$LOG_FILE")" "$(basename "$CURRENT_LOG_LINK")") 2>/dev/null; then
    if ! ln -sfn "$LOG_FILE" "$CURRENT_LOG_LINK" 2>/dev/null; then
        echo "[WARN] current.log 링크 갱신 실패 (warn-only): $CURRENT_LOG_LINK"
    fi
fi

# [Stability] 비대화형(non-tty) 환경에서 stdout pipe 역압으로 tee가 정체되는 문제 방지
# - auto(기본): TTY 또는 CI=true에서만 stdout 유지, 그 외에는 /dev/null로 전환
# - on: stdout 유지
# - off: stdout 비활성화
PIPELINE_STDOUT_MODE="${PIPELINE_STDOUT_MODE:-auto}"
PIPELINE_EMIT_STDOUT=1
case "$PIPELINE_STDOUT_MODE" in
    on|ON|true|TRUE|1)
        PIPELINE_EMIT_STDOUT=1
        ;;
    off|OFF|false|FALSE|0)
        PIPELINE_EMIT_STDOUT=0
        ;;
    auto|AUTO|*)
        if [ -t 1 ] || [ "${CI:-false}" = "true" ]; then
            PIPELINE_EMIT_STDOUT=1
        else
            PIPELINE_EMIT_STDOUT=0
        fi
        ;;
esac
if [ "$PIPELINE_EMIT_STDOUT" -eq 0 ]; then
    exec >/dev/null 2>&1
fi

# ============================================================
# 유틸리티 함수
# ============================================================

# 로그 출력 함수 (화면 + 파일 동시 출력)
log() {
  local LEVEL=$1
  local MESSAGE=$2
  local TIMESTAMP=$(date "+%H:%M:%S")
  
  case "$LEVEL" in
    "INFO"|"WARN"|"ERROR"|"OK") ;;
    *) LEVEL="INFO" ;;
  esac
  echo "[$TIMESTAMP] [$LEVEL] $MESSAGE" | tee -a "$LOG_FILE"
}

# ANSI 색상 코드 제거 함수
strip_ansi() {
    sed 's/\x1b\[[0-9;]*m//g'
}

# 명령 출력 로그 필터 (기본 compact)
filter_step_log() {
    if [ "${PIPELINE_LOG_MODE}" = "debug" ]; then
        cat
        return 0
    fi

    awk '
    {
        gsub(/\r/, "", $0)
        line=$0

        # yt-dlp/rclone 진행률 바 노이즈 제거
        if (line ~ /^\[download\][[:space:]]+[0-9.]+% of/) next
        if (line ~ /^Transferred:[[:space:]]/) next
        if (line ~ /^Elapsed time:[[:space:]]/) next

        # 연속 공백 라인 압축
        if (line ~ /^[[:space:]]*$/) {
            if (blank == 1) next
            blank=1
            print ""
            next
        }
        blank=0
        print line
        fflush()
    }'
}

# truthy 환경변수 판별 (1/true/yes/on)
is_truthy() {
    case "${1:-}" in
        1|true|TRUE|yes|YES|on|ON) return 0 ;;
        *) return 1 ;;
    esac
}

# git 명령 타임아웃 실행 헬퍼 (GNU timeout 사용 가능 시)
run_git_with_timeout() {
    local timeout_sec="${1:-30}"
    shift
    if command -v timeout >/dev/null 2>&1; then
        timeout --foreground "${timeout_sec}s" "$@"
    else
        "$@"
    fi
}

# 데이터 경로 변경 여부를 빠르게 판별 (status 스캔 정체 회피)
has_pending_data_changes() {
    local detect_timeout="${RUN_DAILY_GIT_DETECT_TIMEOUT_SEC:-20}"
    local diff_exit ls_exit untracked_sample

    # 1) tracked 변경 감지
    run_git_with_timeout "$detect_timeout" \
        git diff --quiet -- backend/restaurant-crawling/data/ backend/restaurant-evaluation/data/
    diff_exit=$?
    case "$diff_exit" in
        0) ;;
        1)
            return 0
            ;;
        124|137)
            log "WARN" "데이터 변경 감지(diff) 시간 초과(${detect_timeout}s). 안전하게 동기화를 시도합니다."
            return 0
            ;;
        *)
            log "WARN" "데이터 변경 감지(diff) 실패(exit=$diff_exit). 안전하게 동기화를 시도합니다."
            return 0
            ;;
    esac

    # 2) untracked 변경 감지
    untracked_sample="$(
        run_git_with_timeout "$detect_timeout" \
            bash -c 'git ls-files --others --exclude-standard -- backend/restaurant-crawling/data/ backend/restaurant-evaluation/data/ 2>/dev/null | grep -E "\.(jsonl|txt|json)$" | head -n 1'
    )"
    ls_exit=$?
    if [ "$ls_exit" -eq 124 ] || [ "$ls_exit" -eq 137 ]; then
        log "WARN" "데이터 변경 감지(ls-files) 시간 초과(${detect_timeout}s). 안전하게 동기화를 시도합니다."
        return 0
    elif [ "$ls_exit" -ne 0 ] && [ "$ls_exit" -ne 1 ]; then # grep -vE pipe exit code 1 if empty
        log "WARN" "데이터 변경 감지(ls-files) 실패(exit=$ls_exit). 안전하게 동기화를 시도합니다."
        return 0
    fi

    [ -n "$untracked_sample" ]
}

# [PERF] 스텝 타이밍 함수 - 각 단계의 실행 시간 측정
step_start() {
    STEP_START_TIME=$(date +%s)
}

step_end() {
    local STEP_NAME="$1"
    local STEP_END_TIME=$(date +%s)
    local DURATION=$((STEP_END_TIME - STEP_START_TIME))
    local MINUTES=$((DURATION / 60))
    local SECONDS=$((DURATION % 60))
    log "INFO" "[TIMING] $STEP_NAME: ${MINUTES}m ${SECONDS}s"
}

FAILED_REQUIRED_STEPS=()
SKIPPED_STEPS=()

record_required_failure() {
    local step_name="$1"
    local reason="${2:-}"
    local entry="$step_name"

    if [ -n "$reason" ]; then
        entry="$entry - $reason"
    fi

    FAILED_REQUIRED_STEPS+=("$entry")
    log "ERROR" "$step_name 실패${reason:+: $reason}"
}

record_skipped_step() {
    local step_name="$1"
    local reason="${2:-}"
    local entry="$step_name"

    if [ -n "$reason" ]; then
        entry="$entry - $reason"
    fi

    SKIPPED_STEPS+=("$entry")
    log "WARN" "$step_name 건너뜀${reason:+: $reason}"
}

record_exit_if_failed() {
    local step_name="$1"
    local exit_code="$2"
    local reason="${3:-}"

    if [ "$exit_code" -eq 0 ]; then
        return 0
    fi

    if [ -n "$reason" ]; then
        record_required_failure "$step_name" "$reason (exit=$exit_code)"
    else
        record_required_failure "$step_name" "exit=$exit_code"
    fi
    return 1
}

has_any_env() {
    local key
    for key in "$@"; do
        if [ -n "${!key:-}" ]; then
            return 0
        fi
    done
    return 1
}

has_git_identity() {
    [ -n "$(git config user.name 2>/dev/null)" ] && [ -n "$(git config user.email 2>/dev/null)" ]
}

is_ci_mode() {
    [ "${CI:-false}" = "true" ]
}

record_external_dependency_issue() {
    local step_name="$1"
    local reason="$2"

    if is_ci_mode; then
        record_required_failure "$step_name" "$reason"
    else
        record_skipped_step "$step_name" "$reason"
    fi
}

has_supabase_migration_credentials() {
    [ -n "${SUPABASE_URL:-}" ] && has_any_env SUPABASE_SERVICE_ROLE_KEY SUPABASE_KEY
}

has_supabase_insert_credentials() {
    [ -n "${SUPABASE_URL:-}" ] && has_any_env SUPABASE_SERVICE_ROLE_KEY VITE_SUPABASE_PUBLISHABLE_KEY
}

has_youtube_api_key() {
    [ -n "${YOUTUBE_API_KEY_BYEON:-}" ]
}

has_gemini_api_key() {
    has_any_env GEMINI_API_KEY GEMINI_API_KEY_BYEON
}

has_gemini_web_fallback_session() {
    [ -s "$PROJECT_ROOT/backend/restaurant-crawling/data/gemini_cookies.json" ] || [ -d "$PROJECT_ROOT/backend/restaurant-crawling/data/camoufox_profile" ]
}

has_gemini_chunk_runtime() {
    has_gemini_api_key || has_gemini_web_fallback_session
}

missing_backend_node_packages() {
    local pkg path
    local missing=()

    for pkg in "$@"; do
        path="$PROJECT_ROOT/backend/node_modules/$pkg"
        if [ ! -e "$path" ]; then
            missing+=("$pkg")
        fi
    done

    if [ "${#missing[@]}" -gt 0 ]; then
        printf '%s' "${missing[*]}"
        return 0
    fi

    return 1
}

emit_step_summary_log() {
    local item

    if [ "${#SKIPPED_STEPS[@]}" -gt 0 ]; then
        log "WARN" "건너뛴 단계 요약 (${#SKIPPED_STEPS[@]}건)"
        for item in "${SKIPPED_STEPS[@]}"; do
            log "WARN" " - $item"
        done
    fi

    if [ "${#FAILED_REQUIRED_STEPS[@]}" -gt 0 ]; then
        log "ERROR" "실패한 필수 단계 요약 (${#FAILED_REQUIRED_STEPS[@]}건)"
        for item in "${FAILED_REQUIRED_STEPS[@]}"; do
            log "ERROR" " - $item"
        done
    fi
}

# [PERF] 파이프라인 경과 시간 확인 (타임아웃 보호)
check_timeout() {
    local MAX_MINUTES=${1:-45}  # 기본 45분 타임아웃 (GH 스텝 50분 - 5분 여유)
    local ELAPSED=$(( $(date +%s) - PIPELINE_START ))
    local ELAPSED_MIN=$((ELAPSED / 60))
    if [ "$ELAPSED_MIN" -ge "$MAX_MINUTES" ]; then
        log "WARN" "파이프라인 시간 제한 도달 (${ELAPSED_MIN}m/${MAX_MINUTES}m). 남은 단계 건너뜁니다."
        return 1
    fi
    return 0
}

# [PERF] 병렬 실행 유틸리티 - 두 작업을 동시에 실행하고 로그를 순차 출력
# Usage: run_parallel "Label_A" "command_A" "Label_B" "command_B"
run_parallel() {
    local LABEL_A="$1" CMD_A="$2" LABEL_B="$3" CMD_B="$4"
    local TEMP_LOG_A TEMP_LOG_B PID_A PID_B EXIT_A EXIT_B

    TEMP_LOG_A=$(mktemp)
    TEMP_LOG_B=$(mktemp)

    eval "$CMD_A" > "$TEMP_LOG_A" 2>&1 &
    PID_A=$!
    eval "$CMD_B" > "$TEMP_LOG_B" 2>&1 &
    PID_B=$!

    wait $PID_A; EXIT_A=$?
    wait $PID_B; EXIT_B=$?

    # 로그 순서대로 출력 (섞임 방지)
    log "INFO" "--- [$LABEL_A] ---"
    cat "$TEMP_LOG_A" | strip_ansi | filter_step_log | tee -a "$LOG_FILE"
    log "INFO" "--- [$LABEL_B] ---"
    cat "$TEMP_LOG_B" | strip_ansi | filter_step_log | tee -a "$LOG_FILE"

    rm -f "$TEMP_LOG_A" "$TEMP_LOG_B"

    if [ $EXIT_A -ne 0 ]; then
        log "WARN" "[$LABEL_A] 비정상 종료 (exit: $EXIT_A)"
    fi
    if [ $EXIT_B -ne 0 ]; then
        log "WARN" "[$LABEL_B] 비정상 종료 (exit: $EXIT_B)"
    fi

    if [ $EXIT_A -ne 0 ] || [ $EXIT_B -ne 0 ]; then
        return 1
    fi
    return 0
}

# [PERF] source_dir에는 있고 target_dir에는 없는 *.jsonl 파일 수 계산
count_pending_jsonl() {
    local source_dir="$1"
    local target_dir="$2"
    local source_list target_list

    if [ ! -d "$source_dir" ]; then
        echo 0
        return 0
    fi

    source_list=$(mktemp)
    target_list=$(mktemp)

    find "$source_dir" -maxdepth 1 -type f -name "*.jsonl" -exec basename {} \; | sort > "$source_list"
    if [ -d "$target_dir" ]; then
        find "$target_dir" -maxdepth 1 -type f -name "*.jsonl" -exec basename {} \; | sort > "$target_list"
    else
        : > "$target_list"
    fi

    comm -23 "$source_list" "$target_list" | grep -c "." || true
    rm -f "$source_list" "$target_list"
}

# [Function] 데이터 커밋 함수 (data 브랜치에서 직접 실행)
sync_data_to_remote() {
    local STEP_NAME="$1"
    local stage_timeout="${RUN_DAILY_GIT_STAGE_TIMEOUT_SEC:-1200}"
    local network_timeout="${RUN_DAILY_GIT_NETWORK_TIMEOUT_SEC:-300}"
    log "INFO" "------------------------------------------------------------"
    log "INFO" "데이터 동기화 시작 (Trigger: $STEP_NAME)"

    # 데이터 폴더 변경 감지 (status 전체 스캔 대신 diff/ls-files 기반)
    if ! has_pending_data_changes; then
        log "INFO" "변경 된 데이터가 없습니다. (Skip)"
        return 0
    fi

    if ! has_git_identity; then
        log "ERROR" "git user.name/user.email 미설정으로 데이터 동기화를 진행할 수 없습니다."
        return 1
    fi

    log "INFO" "변경 된 데이터를 커밋합니다."

    # 데이터 파일 추가 (git ls-files 기반으로 매우 빠르고 효율적으로 staging)
    if ! run_git_with_timeout "$stage_timeout" \
        bash -c 'git ls-files --others --modified --exclude-standard backend/restaurant-crawling/data/ backend/restaurant-evaluation/data/ | grep -E "\.(jsonl|txt|json)$" | xargs -r git add' 2>&1 | tee -a "$LOG_FILE"; then
        log "ERROR" "데이터 파일 stage 실패 (timeout=${stage_timeout}s)"
        return 1
    fi

    # [PERF] .gitignore에 크롤링 임시/대용량 데이터가 선언되어 있으므로, git rm -r --cached 연산을 최소화
    # 만약 추적된 흔적이 남아있을 경우를 대비해 빠른 fail-soft를 지정합니다.
    git rm -r --quiet --cached backend/restaurant-crawling/data/*/frames 2>/dev/null || true
    git rm -r --quiet --cached backend/restaurant-crawling/data/*/video_cache 2>/dev/null || true
    git rm -r --quiet --cached backend/restaurant-crawling/data/*/temp_video 2>/dev/null || true
    git rm -r --quiet --cached backend/restaurant-crawling/data/*/thumbnails 2>/dev/null || true
    git rm -r --quiet --cached backend/restaurant-crawling/data/frames 2>/dev/null || true
    git rm --quiet --cached backend/restaurant-crawling/data/credentials.json 2>/dev/null || true
    git rm --quiet --cached backend/restaurant-crawling/data/cookies.txt 2>/dev/null || true

    COMMIT_MSG="chore(data): update crawling data ($DATE) - $STEP_NAME"

    if git diff --staged --quiet; then
        log "INFO" "No changes to commit."
        return 0
    fi

    log "INFO" "Committing changes..."
    if ! git commit -q -m "$COMMIT_MSG" 2>&1 | tee -a "$LOG_FILE"; then
        log "ERROR" "Commit failed"
        return 1
    fi

    # 원격 변경사항 동기화 (충돌 방지)
    log "INFO" "원격 변경사항 확인 및 Rebase..."
    if ! run_git_with_timeout "$network_timeout" git pull --rebase --autostash origin data 2>&1 | tee -a "$LOG_FILE"; then
        local LOCAL_HEAD REMOTE_HEAD DIVERGENCE_STATE
        log "WARN" "Rebase 실패 - rebase 중단 후 안전 동기화 전략으로 전환"
        git rebase --abort 2>/dev/null || true

        # 네트워크/일시 오류 가능성을 고려해 일반 push를 한 번 더 시도
        log "INFO" "Rebase 실패 후 일반 push 재시도..."
        if run_git_with_timeout "$network_timeout" git push origin data 2>&1 | tee -a "$LOG_FILE"; then
            log "OK" "data 브랜치 업데이트 완료 ($STEP_NAME)"
            return 0
        fi

        # push 실패 시 로컬/원격 관계를 로그로 남겨 원인 파악 용이하게 함
        if ! run_git_with_timeout "$network_timeout" git fetch origin data 2>&1 | tee -a "$LOG_FILE"; then
            log "WARN" "원격 상태 재조회(fetch) 실패 - divergence 판별 정확도가 낮을 수 있습니다."
        fi

        LOCAL_HEAD=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
        REMOTE_HEAD=$(git rev-parse --short origin/data 2>/dev/null || echo "unknown")
        if git merge-base --is-ancestor origin/data HEAD 2>/dev/null; then
            DIVERGENCE_STATE="local_ahead_or_equal"
        elif git merge-base --is-ancestor HEAD origin/data 2>/dev/null; then
            DIVERGENCE_STATE="local_behind_remote"
        else
            DIVERGENCE_STATE="diverged"
        fi
        log "WARN" "data 동기화 충돌 감지 (local=${LOCAL_HEAD}, remote=${REMOTE_HEAD}, state=${DIVERGENCE_STATE})"

        if is_truthy "$ALLOW_DATA_FORCE_PUSH"; then
            log "WARN" "ALLOW_DATA_FORCE_PUSH=$ALLOW_DATA_FORCE_PUSH 감지 - force-with-lease를 명시적으로 수행합니다."
            if ! run_git_with_timeout "$network_timeout" git push --force-with-lease origin data 2>&1 | tee -a "$LOG_FILE"; then
                log "ERROR" "force-with-lease push 실패"
                return 1
            fi
        else
            log "ERROR" "안전 모드: 기본 동작에서는 force-push를 수행하지 않습니다."
            log "ERROR" "원격 이력 보호를 위해 동기화를 중단합니다. 필요 시 ALLOW_DATA_FORCE_PUSH=1로 재실행하세요."
            return 1
        fi
    else
        log "INFO" "Pushing to remote..."
        if ! run_git_with_timeout "$network_timeout" git push origin data 2>&1 | tee -a "$LOG_FILE"; then
            log "ERROR" "Failed to push to data branch"
            return 1
        fi
    fi

    log "OK" "data 브랜치 업데이트 완료 ($STEP_NAME)"
}

# ============================================================
# 파이프라인 시작
# ============================================================

log "INFO" "============================================================"
log "INFO" "일일 데이터 수집 파이프라인 시작"
log "INFO" "============================================================"

# [Branch Check] 'data' 브랜치인지 확인
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
TARGET_BRANCH="data"

log "INFO" "현재 브랜치 확인: $CURRENT_BRANCH"

if [ "$CURRENT_BRANCH" != "$TARGET_BRANCH" ]; then
    log "WARN" "현재 브랜치가 '$TARGET_BRANCH'가 아닙니다. (현재: $CURRENT_BRANCH)"
    
    if [ "${FORCE_BRANCH_SWITCH:-0}" = "1" ] || [ "${CI:-false}" = "true" ]; then
        log "INFO" "FORCE_BRANCH_SWITCH=1 또는 CI 환경 감지됨. '$TARGET_BRANCH'로 전환을 시도합니다."
        git fetch origin
        
        if git show-ref --verify --quiet refs/heads/$TARGET_BRANCH; then
            git checkout $TARGET_BRANCH || { log "ERROR" "브랜치 전환 실패. 변경사항을 커밋하거나 스태시하세요."; exit 1; }
        else
            git checkout -b $TARGET_BRANCH origin/$TARGET_BRANCH || { log "ERROR" "원격 브랜치 체크아웃 실패."; exit 1; }
        fi
        
        log "OK" "브랜치 전환 완료: $TARGET_BRANCH"
    else
        log "ERROR" "안전 모드: FORCE_BRANCH_SWITCH=1 환경변수 없이 자동으로 브랜치를 전환하지 않습니다."
        log "ERROR" "작업 중인 파일이 유실될 수 있으므로 직접 'git checkout $TARGET_BRANCH' 후 다시 실행해주세요."
        exit 1
    fi
fi

# 충돌 방지를 위해 최신 변경사항 Pull
log "INFO" "'$TARGET_BRANCH' 브랜치 최신화 (Pull)..."
if ! run_git_with_timeout "${RUN_DAILY_GIT_NETWORK_TIMEOUT_SEC:-300}"     git pull origin "$TARGET_BRANCH" 2>&1 | tee -a "$LOG_FILE"; then
    log "WARN" "Pull 실패 (무시하고 진행)."
fi

log "INFO" "현재 작업 브랜치: $(git rev-parse --abbrev-ref HEAD)"

# ============================================================
# [Phase 1] 데이터 수집 및 전처리 (Collection & Preprocessing)
# ============================================================

# 1. URL 수집 (새로운 영상 탐색)
echo "::group::[Step 1] URL Collection"
step_start
if ! has_youtube_api_key; then
    record_external_dependency_issue "Step 1 (URL Collection)" "YouTube API 키(YOUTUBE_API_KEY_BYEON) 미설정으로 실행 생략"
else
    log "INFO" "[Step 1] URL 수집 중..."
    $PYTHON_CMD backend/restaurant-crawling/scripts/01-collect-urls.py --channel tzuyang 2>&1 | tee -a "$LOG_FILE"
    STEP_1_EXIT=${PIPESTATUS[0]}
    record_exit_if_failed "Step 1 (URL Collection)" "$STEP_1_EXIT"
fi
step_end "Step 1 (URL Collection)"
echo "::endgroup::"

# [PERF] 스마트 스킵 플래그 - 신규 URL이 없으면 고비용 단계 최적화
NEW_URL_COUNT=$(grep -c "\[New URL\]" "$LOG_FILE" 2>/dev/null || true)
HAS_NEW_DATA=false
if [ "$NEW_URL_COUNT" -gt 0 ]; then
    HAS_NEW_DATA=true
    log "INFO" "신규 URL ${NEW_URL_COUNT}개 감지 -> 전체 파이프라인 실행"
else
    log "INFO" "신규 URL 없음 -> 스마트 모드 (변경분만 처리)"
    # [PERF] 신규 URL이 없으면 고비용 AI 분석(Phase 3)을 건너뜁니다.
    # 단, 보류 중인 크롤링(Step 8) 또는 LAAJ 평가(Step 11)가 있는지 확인합니다.
    
    PENDING_CRAWL=$(count_pending_jsonl \
        "backend/restaurant-crawling/data/tzuyang/transcript" \
        "backend/restaurant-crawling/data/tzuyang/crawling")

    PENDING_LAAJ=$(count_pending_jsonl \
        "backend/restaurant-evaluation/data/tzuyang/evaluation/rule_results" \
        "backend/restaurant-evaluation/data/tzuyang/evaluation/laaj_results")

    if [ "$PENDING_CRAWL" -gt 0 ] || [ "$PENDING_LAAJ" -gt 0 ]; then
        log "INFO" "보류 중인 크롤링 ${PENDING_CRAWL}건, LAAJ 평가 ${PENDING_LAAJ}건 발견 -> Phase 3 실행"
        HAS_NEW_DATA=true
    else
        SKIP_PHASE3=true
        log "INFO" "처리 대기 중인 데이터가 없습니다. (Phase 3 스킵)"
    fi
fi

# 2. 메타데이터 수집 & 스케줄링 (관제탑 역할)
echo "::group::[Step 2] Metadata Collection"
step_start
if ! has_youtube_api_key; then
    record_external_dependency_issue "Step 2 (Metadata)" "YouTube API 키(YOUTUBE_API_KEY_BYEON) 미설정으로 실행 생략"
else
    log "INFO" "[Step 2] 메타데이터 수집 및 스케줄링..."
    $PYTHON_CMD backend/restaurant-crawling/scripts/02-collect-meta.py --channel tzuyang 2>&1 | tee -a "$LOG_FILE"
    STEP_2_EXIT=${PIPESTATUS[0]}
    record_exit_if_failed "Step 2 (Metadata)" "$STEP_2_EXIT"
fi
step_end "Step 2 (Metadata)"
echo "::endgroup::"

# [PERF] 2.1 + 2.5 병렬 실행 (충돌 없음: 2.1은 Supabase 쓰기, 2.5는 orphan 삭제)
echo "::group::[Step 2.1+2.5] Meta Migration + Orphan Cleanup (Parallel)"
step_start
log "INFO" "[Step 2.1+2.5] Meta Migration + Orphan Cleanup (병렬 실행)..."
if has_supabase_migration_credentials; then
    run_parallel \
        "Step 2.1 Meta Migration" \
        "$PYTHON_CMD backend/restaurant-crawling/scripts/02.1-migrate-meta-to-supabase.py --channel tzuyang" \
        "Step 2.5 Orphan Cleanup" \
        "$PYTHON_CMD backend/restaurant-crawling/scripts/02.5-cleanup-orphans.py --channel tzuyang"
    STEP_21_EXIT=$?
    if [ $STEP_21_EXIT -ne 0 ]; then
        record_required_failure "Step 2.1+2.5 (Migration+Cleanup)" "parallel step 중 하나 이상 실패"
    fi
else
    record_external_dependency_issue "Step 2.1 (Meta Migration)" "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY 미설정으로 실행 생략"
    $PYTHON_CMD backend/restaurant-crawling/scripts/02.5-cleanup-orphans.py --channel tzuyang 2>&1 | tee -a "$LOG_FILE"
    STEP_25_EXIT=${PIPESTATUS[0]}
    record_exit_if_failed "Step 2.5 (Orphan Cleanup)" "$STEP_25_EXIT"
fi
step_end "Step 2.1+2.5 (Migration+Cleanup)"
echo "::endgroup::"

# [PERF] Sync #1: 메타데이터/정리 완료 후 저장
if ! sync_data_to_remote "Phase 1 (Meta/Cleanup)"; then
    record_required_failure "Sync #1 (Phase 1 Meta/Cleanup)" "data 동기화 실패"
fi

# ============================================================
# [Phase 2] 멀티모달 데이터 확보 (Multi-modal Processing)
# ============================================================

# [PERF] Step 3 + Step 4 병렬 실행 (충돌 없음: 3은 transcript/, 4는 heatmap/+frames/)
# Step 3 완료 후 Step 3.1 실행, Step 4는 백그라운드 유지
echo "::group::[Step 3+4] Transcript + Frames (Parallel)"
step_start
log "INFO" "[Step 3+4] 자막 수집 + 프레임 추출 (병렬 실행)..."

STEP34_NODE_MISSING=""
TEMP_LOG_3=""
TEMP_LOG_4=""
EXIT_3=0
EXIT_4=0

if STEP34_NODE_MISSING="$(missing_backend_node_packages dotenv ffmpeg-static ffprobe-static 2>/dev/null)"; then
    record_required_failure "Step 3 (Transcript)" "필수 Node 패키지 누락(${STEP34_NODE_MISSING})으로 실행 생략. 먼저 'cd backend && npm ci' 를 실행하세요."
    record_required_failure "Step 4 (Heatmap & Frames)" "필수 Node 패키지 누락(${STEP34_NODE_MISSING})으로 실행 생략. 먼저 'cd backend && npm ci' 를 실행하세요."
    EXIT_3=1
    EXIT_4=1
else
    TEMP_LOG_3=$(mktemp)
    TEMP_LOG_4=$(mktemp)

    # Step 3 (Transcript) + Step 4 (Frames) 동시 시작
    node backend/restaurant-crawling/scripts/03-collect-transcript.js --channel tzuyang > "$TEMP_LOG_3" 2>&1 &
    PID_3=$!
    node backend/restaurant-crawling/scripts/04-extract-frames-with-heatmap.js --channel tzuyang --delete-cache > "$TEMP_LOG_4" 2>&1 &
    PID_4=$!

    # Step 3 완료 대기 -> 로그 출력
    wait $PID_3; EXIT_3=$?
    log "INFO" "--- [Step 3 Transcript] ---"
    cat "$TEMP_LOG_3" | tee -a "$LOG_FILE"
    if [ $EXIT_3 -ne 0 ]; then
        log "WARN" "[Step 3] Transcript 비정상 종료 (exit: $EXIT_3)"
        record_required_failure "Step 3 (Transcript)" "exit=$EXIT_3"
    fi
    rm -f "$TEMP_LOG_3"
fi
echo "::endgroup::"

# Step 3.1 실행 (Step 3 완료 필요, Step 4는 백그라운드 계속)
echo "::group::[Step 3.1] Context Generation"
log "INFO" "[Step 3.1] 자막 문맥 생성 중..."
# [Config] 실행 모드에 따른 배치 크기 제한
if [ -z "$CI" ]; then
    MAX_VIDEOS=-1
else
    MAX_VIDEOS=${MAX_CONTEXT_VIDEOS:-0}
fi

if [ $EXIT_3 -ne 0 ]; then
    record_skipped_step "Step 3.1 (Context Generation)" "Step 3 transcript 실패"
elif [[ "$MAX_VIDEOS" -eq -1 ]]; then
    log "INFO" "Context Generation Skipped (Configured as -1)"
else
    if [[ "$MAX_VIDEOS" -gt 0 ]]; then
        log "INFO" "Context Generation Limit: $MAX_VIDEOS videos (Configured)"
    else
        log "INFO" "Context Generation Limit: Unlimited"
    fi
    $PYTHON_CMD backend/restaurant-crawling/scripts/03.1-generate-transcript-context.py --max-videos "$MAX_VIDEOS" 2>&1 | tee -a "$LOG_FILE"
    STEP_31_EXIT=${PIPESTATUS[0]}
    record_exit_if_failed "Step 3.1 (Context Generation)" "$STEP_31_EXIT"
fi
echo "::endgroup::"

# Step 4 완료 대기 (실시간 로그 스트리밍)
echo "::group::[Step 4] Heatmap & Frames (Awaiting)"
log "INFO" "--- [Step 4 Frames] (실시간 로그) ---"
if [ -n "$TEMP_LOG_4" ]; then
    tail -f "$TEMP_LOG_4" 2>/dev/null &
    TAIL_PID=$!
    wait $PID_4; EXIT_4=$?
    sleep 1
    kill $TAIL_PID 2>/dev/null; wait $TAIL_PID 2>/dev/null
    cat "$TEMP_LOG_4" >> "$LOG_FILE"
    if [ $EXIT_4 -ne 0 ]; then
        log "WARN" "[Step 4] Frames 비정상 종료 (exit: $EXIT_4)"
        record_required_failure "Step 4 (Heatmap & Frames)" "exit=$EXIT_4"
    fi
    rm -f "$TEMP_LOG_4"
else
    log "WARN" "[Step 4] 필수 Node 패키지 누락으로 프레임 추출을 실행하지 않았습니다."
fi

step_end "Step 3+4 (Transcript+Frames+Context)"
echo "::endgroup::"

# [PERF] Sync #2: 자막/프레임 완료 후 저장 (Phase 2 통합 - 기존 3회 → 1회)
if ! sync_data_to_remote "Phase 2 (Transcript/Frames)"; then
    record_required_failure "Sync #2 (Phase 2 Transcript/Frames)" "data 동기화 실패"
fi

# [PERF] 타임아웃 체크 - Phase 3 진입 전 시간 확인
if ! check_timeout 45; then
    log "WARN" "시간 제한으로 Phase 3 건너뜁니다. 다음 실행에서 이어집니다."
    record_skipped_step "Phase 3" "전체 타임아웃 도달"
    if ! sync_data_to_remote "Timeout Safety Sync"; then
        record_required_failure "Sync (Timeout Safety Sync)" "data 동기화 실패"
    fi
    # Summary 생성으로 점프
    SKIP_PHASE3=true
fi

# ============================================================
# [Phase 3] AI 분석 및 평가 (Analysis & Evaluation)
# ============================================================

if [ "${SKIP_PHASE3:-false}" != "true" ]; then

# 6.1. 자막 문서에 메타데이터 추가 (음식점 + Peak)
echo "::group::[Step 6.1] Enrich Subtitles"
step_start
log "INFO" "[Step 6.1] 자막 문서 메타데이터 추가 중..."
$PYTHON_CMD backend/restaurant-crawling/scripts/06.1-transcript-document-with-meta.py --channel tzuyang 2>&1 | tee -a "$LOG_FILE"
STEP_61_EXIT=${PIPESTATUS[0]}
record_exit_if_failed "Step 6.1 (Enrich)" "$STEP_61_EXIT"
step_end "Step 6.1 (Enrich)"
echo "::endgroup::"

# 7. Gemini 기반 데이터 분석 (비활성화: 08-chunk-multimodal-crawling.sh가 전담)
# echo "::group::[Step 7] Gemini Data Analysis"
# step_start
# log "INFO" "[Step 7] Gemini 데이터 분석 중..."
# bash backend/restaurant-crawling/scripts/07-gemini-crawling.sh --channel tzuyang 2>&1 | tee -a "$LOG_FILE"
# step_end "Step 7 (Gemini)"
# echo "::endgroup::"
log "INFO" "[Step 7] 비활성화됨 → Step 08 (Chunk Multimodal)이 전담 처리"

# 8. 구간(Chunk) 분할 멀티모달 크롤링
echo "::group::[Step 08] Chunk Multimodal Crawling"
step_start
log "INFO" "[Step 08] Chunk Multimodal 분석 중..."
STEP08_NODE_MISSING=""
if STEP08_NODE_MISSING="$(missing_backend_node_packages @google/genai 2>/dev/null)"; then
    record_required_failure "Step 08 (Chunk Multimodal)" "필수 Node 패키지 누락(${STEP08_NODE_MISSING})으로 실행 생략. 먼저 'cd backend && npm ci' 를 실행하세요."
    SKIP_EVALUATION=true
    record_skipped_step "Step 09~13 (Evaluation)" "Step 08 Node prerequisite 미충족"
elif ! has_gemini_chunk_runtime; then
    record_required_failure "Step 08 (Chunk Multimodal)" "Gemini API 키 또는 Web fallback 세션(gemini_cookies.json/camoufox_profile) 미설정으로 실행 생략"
    SKIP_EVALUATION=true
    record_skipped_step "Step 09~13 (Evaluation)" "Step 08 Gemini runtime prerequisite 미충족"
else
    set +o pipefail
    bash backend/restaurant-crawling/scripts/08-chunk-multimodal-crawling.sh --channel tzuyang 2>&1 | filter_step_log | tee -a "$LOG_FILE"
    CHUNK_EXIT_CODE=${PIPESTATUS[0]}
    set -o pipefail
    if [ $CHUNK_EXIT_CODE -eq 42 ]; then
        log "WARN" "할당량 초과(Quota Error) 감지됨. 데이터 일관성을 위해 이후 평가 단계(Step 09~13)를 모두 건너뜁니다."
        SKIP_EVALUATION=true
        record_skipped_step "Step 09~13 (Evaluation)" "Step 08 quota 초과"
    elif [ $CHUNK_EXIT_CODE -eq 44 ]; then
        log "ERROR" "[CRITICAL] 구글 로그인 세션 만료! 웹 폴백을 더 이상 진행할 수 없습니다."
        log "INFO" "해결 방법: 'python backend/restaurant-crawling/scripts/gemini_scrapling_fallback.py --login' 을 실행하여 수동 로그인하세요."
        record_required_failure "Step 08 (Chunk Multimodal)" "Google 로그인 세션 만료 (exit=44)"
        SKIP_EVALUATION=true
        record_skipped_step "Step 09~13 (Evaluation)" "Step 08 로그인 prerequisite 미충족"
    elif [ $CHUNK_EXIT_CODE -ne 0 ]; then
        record_required_failure "Step 08 (Chunk Multimodal)" "exit=$CHUNK_EXIT_CODE"
        SKIP_EVALUATION=true
        record_skipped_step "Step 09~13 (Evaluation)" "Step 08 실패"
    fi
fi
step_end "Step 08 (Chunk Multimodal)"
echo "::endgroup::"

if [ "${SKIP_EVALUATION:-false}" != "true" ]; then

# 9. 평가 대상 선정
echo "::group::[Step 09] Target Selection"
step_start
log "INFO" "[Step 09] Target Selection..."
$PYTHON_CMD backend/restaurant-evaluation/scripts/09-target-selection.py --channel tzuyang \
  --crawling-path backend/restaurant-crawling/data/tzuyang \
  --evaluation-path backend/restaurant-evaluation/data/tzuyang 2>&1 | tee -a "$LOG_FILE"
STEP_09_EXIT=${PIPESTATUS[0]}
STEP_09_OK=true
if ! record_exit_if_failed "Step 09 (Target Selection)" "$STEP_09_EXIT"; then
    STEP_09_OK=false
    record_skipped_step "Step 10~13 (Evaluation downstream)" "Step 09 실패"
fi
step_end "Step 09 (Target)"
echo "::endgroup::"

# 10. Rule 기반 평가 (위치/상호 검증)
if [ "${STEP_09_OK}" = "true" ]; then

echo "::group::[Step 10] Rule Evaluation"
step_start
log "INFO" "[Step 10] Rule Evaluation..."
$PYTHON_CMD backend/restaurant-evaluation/scripts/10-rule-evaluation.py --channel tzuyang \
  --evaluation-path backend/restaurant-evaluation/data/tzuyang 2>&1 | tee -a "$LOG_FILE"
STEP_10_EXIT=${PIPESTATUS[0]}
grep "Rule 평가 완료!" -A 5 "$LOG_FILE" | tail -n 6 | strip_ansi | while read -r line; do echo "::notice::$line"; done
STEP_10_OK=true
if ! record_exit_if_failed "Step 10 (Rule Evaluation)" "$STEP_10_EXIT"; then
    STEP_10_OK=false
    record_skipped_step "Step 11~13 (Evaluation downstream)" "Step 10 실패"
fi
step_end "Step 10 (Rule Eval)"
echo "::endgroup::"

if [ "${STEP_10_OK}" = "true" ]; then
    # [PERF] Sync #3: Rule 평가 완료 후 저장 (LAAJ 전 백업 - 중요)
    if ! sync_data_to_remote "Phase 3a (Rule Eval)"; then
        record_required_failure "Sync #3 (Phase 3a Rule Eval)" "data 동기화 실패"
    fi

    # [PERF] 타임아웃 체크 - LAAJ 진입 전 시간 확인 (가장 오래 걸리는 단계)
    STEP_11_OK=true
    if ! check_timeout 45; then
        log "WARN" "시간 제한으로 LAAJ 평가를 건너뜁니다. 다음 실행에서 이어집니다."
        STEP_11_OK=false
        record_skipped_step "Step 11 (LAAJ Evaluation)" "LAAJ 진입 전 타임아웃 도달"
    else

    # 11. LAAJ (LLM) 기반 평가
    echo "::group::[Step 11] LAAJ Evaluation"
    step_start
    log "INFO" "[Step 11] LAAJ Evaluation..."
    bash backend/restaurant-evaluation/scripts/11-laaj-evaluation.sh --channel tzuyang \
      --crawling-path backend/restaurant-crawling/data/tzuyang \
      --evaluation-path backend/restaurant-evaluation/data/tzuyang 2>&1 | tee -a "$LOG_FILE"
    STEP_11_EXIT=${PIPESTATUS[0]}
    grep "LAAJ 평가 완료" -A 5 "$LOG_FILE" | tail -n 6 | strip_ansi | while read -r line; do echo "::notice::$line"; done
    if ! record_exit_if_failed "Step 11 (LAAJ Evaluation)" "$STEP_11_EXIT"; then
        STEP_11_OK=false
        record_skipped_step "Step 12~13 (Evaluation downstream)" "Step 11 실패"
    fi
    step_end "Step 11 (LAAJ Eval)"
    echo "::endgroup::"

    fi # LAAJ 타임아웃 체크 종료

    if [ "${STEP_11_OK}" = "true" ]; then
        # 12. 결과 변환 (Transforms)
        echo "::group::[Step 12] Transform Results"
        step_start
        log "INFO" "[Step 12] Transform Results..."
        $PYTHON_CMD backend/restaurant-evaluation/scripts/12-transform.py --channel tzuyang \
          --crawling-path backend/restaurant-crawling/data/tzuyang \
          --evaluation-path backend/restaurant-evaluation/data/tzuyang 2>&1 | tee -a "$LOG_FILE"
        STEP_12_EXIT=${PIPESTATUS[0]}
        STEP_12_OK=true
        if ! record_exit_if_failed "Step 12 (Transform Results)" "$STEP_12_EXIT"; then
            STEP_12_OK=false
            record_skipped_step "Step 13 (Supabase)" "Step 12 실패"
        fi
        step_end "Step 12 (Transform)"
        echo "::endgroup::"

        if [ "${STEP_12_OK}" = "true" ]; then
            # 13. Supabase 결과 삽입
            echo "::group::[Step 13] Insert to Supabase"
            step_start
            if ! has_supabase_insert_credentials; then
                record_external_dependency_issue "Step 13 (Supabase)" "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY 또는 VITE_SUPABASE_PUBLISHABLE_KEY 미설정으로 실행 생략"
            else
                log "INFO" "[Step 13] Insert to Supabase..."
                $PYTHON_CMD backend/restaurant-evaluation/scripts/13-supabase-insert.py --channel tzuyang \
                  --evaluation-path backend/restaurant-evaluation/data/tzuyang 2>&1 | tee -a "$LOG_FILE"
                STEP_13_EXIT=${PIPESTATUS[0]}
                record_exit_if_failed "Step 13 (Supabase)" "$STEP_13_EXIT"
                if [ $STEP_13_EXIT -eq 0 ]; then
                    grep "성공 (Insert):" "$LOG_FILE" | tail -n 1 | strip_ansi | while read -r line; do echo "::notice::DB Sync - $line"; done
                fi
            fi
            step_end "Step 13 (Supabase)"
            echo "::endgroup::"
        fi
    fi
fi
fi

fi # SKIP_EVALUATION 종료

fi # SKIP_PHASE3 종료 (Timeout)

# ============================================================
# [Phase 4] 최종 동기화 및 보고
# ============================================================

log "INFO" "============================================================"
log "INFO" "일일 데이터 수집 파이프라인 종료 (최종 상태 집계 중)"
log "INFO" "============================================================"

# [PERF] Final Sync (모든 Phase의 남은 변경사항 통합 커밋)
log "INFO" "[Final] 'data' 브랜치에 최종 데이터 저장..."
if ! sync_data_to_remote "Final Sync"; then
    record_required_failure "Final Sync" "data 동기화 실패"
fi

# 코드 에디터 동기화 신호
SYNC_TRIGGER_FILE="$PROJECT_ROOT/backend/.sync_trigger"
echo "$(date)" > "$SYNC_TRIGGER_FILE"
log "INFO" "코드 에디터 동기화용 트리거 파일 생성됨"

# [PERF] 전체 실행 시간 출력
PIPELINE_END=$(date +%s)
TOTAL_DURATION=$((PIPELINE_END - PIPELINE_START))
TOTAL_MIN=$((TOTAL_DURATION / 60))
TOTAL_SEC=$((TOTAL_DURATION % 60))
emit_step_summary_log

FINAL_EXIT_CODE=0
FINAL_STATUS_LABEL="OK"
FINAL_STATUS_MESSAGE="모든 필수 단계가 완료되었습니다! (총 실행 시간: ${TOTAL_MIN}m ${TOTAL_SEC}s)"

if [ "${#FAILED_REQUIRED_STEPS[@]}" -gt 0 ]; then
    FINAL_EXIT_CODE=1
    FINAL_STATUS_LABEL="ERROR"
    FINAL_STATUS_MESSAGE="필수 단계 실패가 감지되었습니다. summary/log를 확인하세요. (총 실행 시간: ${TOTAL_MIN}m ${TOTAL_SEC}s)"
elif [ "${#SKIPPED_STEPS[@]}" -gt 0 ]; then
    FINAL_STATUS_LABEL="WARN"
    FINAL_STATUS_MESSAGE="일부 단계가 건너뛰어졌지만 필수 단계는 완료되었습니다. (총 실행 시간: ${TOTAL_MIN}m ${TOTAL_SEC}s)"
fi

log "$FINAL_STATUS_LABEL" "============================================================"
log "$FINAL_STATUS_LABEL" "$FINAL_STATUS_MESSAGE"
log "$FINAL_STATUS_LABEL" "============================================================"

# ============================================================
# GitHub Actions Summary 생성
# ============================================================

SUMMARY_MD="${RUN_DAILY_SUMMARY_PATH:-$PROJECT_ROOT/summary.md}"
echo "## Daily Crawling Report ($DATE)" > "$SUMMARY_MD"
echo "" >> "$SUMMARY_MD"

echo "### 🔰 초보자를 위한 파이프라인 요약 가이드" >> "$SUMMARY_MD"
echo "이 리포트는 쯔양 채널에 새로 올라온 영상을 자동으로 찾아 분석해주는 로봇의 작업 결과입니다! 🤖" >> "$SUMMARY_MD"
echo "1. **수집 단계**: 유튜브에서 누락된 영상이나 신규 영상을 찾고, 자막과 화면을 가져옵니다." >> "$SUMMARY_MD"
echo "2. **AI 분석 단계**: AI(Gemini)가 똑똑하게 영상을 보고 '어떤 식당을 갔는지', '위치가 어디인지' 찾아냅니다." >> "$SUMMARY_MD"
echo "3. **저장 단계**: 찾아낸 식당 정보를 한 번 더 검증한 뒤, 우리 서비스 앱(지도)에 보여줄 수 있도록 데이터베이스(Supabase)에 반영합니다." >> "$SUMMARY_MD"
echo "아래 항목들에서 오늘 얼마나 많은 영상이 수집되고 성공적으로 처리되었는지 한눈에 확인할 수 있습니다. 🚀" >> "$SUMMARY_MD"
echo "" >> "$SUMMARY_MD"

# [PERF] 실행 시간 요약 (가장 먼저 표시)
echo "### Execution Time" >> "$SUMMARY_MD"
echo "| Metric | Value |" >> "$SUMMARY_MD"
echo "|--------|-------|" >> "$SUMMARY_MD"
echo "| Total Runtime | **${TOTAL_MIN}분 ${TOTAL_SEC}초** |" >> "$SUMMARY_MD"
echo "| New Videos | ${NEW_URL_COUNT:-0} |" >> "$SUMMARY_MD"
echo "| Mode | $([ "${HAS_NEW_DATA}" = "true" ] && echo "Full Pipeline" || echo "Smart (Delta Only)") |" >> "$SUMMARY_MD"
if [ -n "$ARCHIVED_LOG" ]; then
    echo "| Archived Previous Log | \`${ARCHIVED_LOG#"$PROJECT_ROOT/"}\` |" >> "$SUMMARY_MD"
fi
if [ "${SKIP_PHASE3:-false}" = "true" ]; then
    echo "| Note | Phase 3 skipped (timeout) |" >> "$SUMMARY_MD"
fi
if [ "${#SKIPPED_STEPS[@]}" -gt 0 ]; then
    echo "| Skipped Steps | ${#SKIPPED_STEPS[@]} |" >> "$SUMMARY_MD"
fi
if [ "${#FAILED_REQUIRED_STEPS[@]}" -gt 0 ]; then
    echo "| Failed Required Steps | ${#FAILED_REQUIRED_STEPS[@]} |" >> "$SUMMARY_MD"
fi
echo "" >> "$SUMMARY_MD"

if [ "${#SKIPPED_STEPS[@]}" -gt 0 ]; then
    echo "### Skipped Steps" >> "$SUMMARY_MD"
    for item in "${SKIPPED_STEPS[@]}"; do
        echo "- $item" >> "$SUMMARY_MD"
    done
    echo "" >> "$SUMMARY_MD"
fi

if [ "${#FAILED_REQUIRED_STEPS[@]}" -gt 0 ]; then
    echo "### Failed Required Steps" >> "$SUMMARY_MD"
    for item in "${FAILED_REQUIRED_STEPS[@]}"; do
        echo "- $item" >> "$SUMMARY_MD"
    done
    echo "" >> "$SUMMARY_MD"
fi

# 스텝별 타이밍 로그 추출
echo "### Step Timings" >> "$SUMMARY_MD"
echo "| Step | Duration |" >> "$SUMMARY_MD"
echo "|------|----------|" >> "$SUMMARY_MD"
grep "\[TIMING\]" "$LOG_FILE" | strip_ansi | while IFS= read -r line; do
    STEP_NAME=$(echo "$line" | sed 's/.*\[TIMING\] //;s/:.*//')
    STEP_TIME=$(echo "$line" | sed 's/.*\[TIMING\] [^:]*: //')
    echo "| $STEP_NAME | $STEP_TIME |" >> "$SUMMARY_MD"
done
echo "" >> "$SUMMARY_MD"

# 상세 처리 통계
echo "### Process Statistics" >> "$SUMMARY_MD"
echo "| Step | Count | Status |" >> "$SUMMARY_MD"
echo "|------|-------|--------|" >> "$SUMMARY_MD"

if [ -f "$LOG_FILE" ]; then
    # 1. URL 수집 현황
    if grep -q "URL 수집 중" "$LOG_FILE"; then
        URL_LINE=$(grep "tzuyang: 신규" "$LOG_FILE" | tail -n 1 | strip_ansi)
        URL_CNT=$(echo "$URL_LINE" | sed 's/.*tzuyang: //')
        echo "| URLs | $URL_CNT | Collected |" >> "$SUMMARY_MD"
    else
        echo "| URLs | - | Error |" >> "$SUMMARY_MD"
        URL_LINE=""
    fi

    # 2. 메타데이터
    if grep -q "메타데이터 수집" "$LOG_FILE"; then
        META_LINE=$(grep "업데이트 [0-9]*개" "$LOG_FILE" | tail -n 1 | strip_ansi)
        META_CNT=$(echo "$META_LINE" | sed 's/.*완료: //' | tr -cd '0-9')
        if [ -z "$META_CNT" ]; then META_CNT="0"; fi
        echo "| Metadata | $META_CNT | Updated |" >> "$SUMMARY_MD"
    else
        echo "| Metadata | - | Skipped/Fail |" >> "$SUMMARY_MD"
        META_CNT="0"
    fi

    # 3. 자막
    TRANSCRIPT_CNT=$(grep "성공 [0-9]*개" "$LOG_FILE" | grep "자막 수집 완료" -A 1 | tail -n 1 | strip_ansi | sed 's/.*성공 //;s/개.*//')
    if [ -n "$TRANSCRIPT_CNT" ]; then
        echo "| Transcripts | $TRANSCRIPT_CNT | Saved |" >> "$SUMMARY_MD"
    else
        echo "| Transcripts | 0 | Skipped |" >> "$SUMMARY_MD"
        TRANSCRIPT_CNT="0"
    fi

    # 3.1 문맥 생성
    CONTEXT_CNT=$(grep -c "Context generation for .* completed" "$LOG_FILE" 2>/dev/null || true)
    echo "| Contexts | $CONTEXT_CNT | Generated |" >> "$SUMMARY_MD"

    # 4. 히트맵
    HEATMAP_CNT=$(grep -c "Heatmap saved" "$LOG_FILE" 2>/dev/null || true)
    echo "| Heatmaps | $HEATMAP_CNT | Saved |" >> "$SUMMARY_MD"

    # 4. 프레임
    FRAME_CNT=$(grep -c "Frames extracted" "$LOG_FILE" 2>/dev/null || true)
    echo "| Frames | $FRAME_CNT | Extracted |" >> "$SUMMARY_MD"

    # 구글 드라이브 & 유튜브
    GDRIVE_CNT=$(grep -c "\[GDrive\] 영상 발견.*다운로드 시도" "$LOG_FILE" 2>/dev/null || true)
    YOUTUBE_CNT=$(grep -c "\[YouTube\] 다운로드 시도" "$LOG_FILE" 2>/dev/null || true)
    echo "| GDrive Cache | $GDRIVE_CNT | Hits |" >> "$SUMMARY_MD"
    if [ "$YOUTUBE_CNT" -gt 0 ]; then
        echo "| YouTube DL | **$YOUTUBE_CNT** | Success |" >> "$SUMMARY_MD"
    else
        echo "| YouTube DL | 0 | (Blocked) |" >> "$SUMMARY_MD"
    fi

    # 5. 지도 URL
    MAP_CNT=$(grep -c "지도 URL 수집 완료" "$LOG_FILE" 2>/dev/null || true)
    if [ "$MAP_CNT" -gt 0 ]; then
        echo "| Map Crawling | $MAP_CNT | Collected |" >> "$SUMMARY_MD"
    fi

    # 6. 재미나이
    if grep -q "Gemini 분석 완료" "$LOG_FILE"; then
        GEMINI_CALLS=$(grep "총 호출 수:" "$LOG_FILE" | tail -n 1 | strip_ansi | sed 's/.*: //')
        GEMINI_SUCCESS=$(grep "성공:" "$LOG_FILE" | tail -n 1 | strip_ansi | sed 's/.*: //')
        GEMINI_SUCCESS_LINE="Calls: $GEMINI_CALLS / Success: $GEMINI_SUCCESS"
        echo "| Gemini Analysis | $GEMINI_SUCCESS | (Calls: $GEMINI_CALLS) |" >> "$SUMMARY_MD"
    else
        echo "| Gemini Analysis | - | Skipped |" >> "$SUMMARY_MD"
    fi

    # 08. Chunk Multimodal
    CHUNK_SUCCESS=$(grep -c "청크 멀티모달 크롤링 완료" "$LOG_FILE" 2>/dev/null || true)
    if [ "$CHUNK_SUCCESS" -gt 0 ]; then
        echo "| Chunk Multimodal | $CHUNK_SUCCESS | Analyzed |" >> "$SUMMARY_MD"
    fi

    # 09. 평가 대상 선정
    if grep -q "대상 비디오:" "$LOG_FILE"; then
        TARGET_CNT=$(grep "대상 비디오:" "$LOG_FILE" | tail -n 1 | strip_ansi | sed 's/.*비디오: //;s/개.*//')
        echo "| Target Selection | $TARGET_CNT | Selected |" >> "$SUMMARY_MD"
    fi

    # 10. 규칙 기반 평가
    if grep -q "Rule 평가 완료!" "$LOG_FILE"; then
        RULE_SUCCESS=$(grep "성공:" "$LOG_FILE" | grep -v "LAAJ" | tail -n 1 | strip_ansi | sed 's/.*: //')
        echo "| Rule Eval | $RULE_SUCCESS | Verified |" >> "$SUMMARY_MD"
    fi

    # 11. LAAJ 평가
    if grep -q "LAAJ 평가 완료" "$LOG_FILE"; then
        LAAJ_SUCCESS=$(grep "성공:" "$LOG_FILE" | grep "LAAJ" -A 5 | tail -n 5 | grep "성공:" | strip_ansi | sed 's/.*: //')
        echo "| LAAJ Eval | $LAAJ_SUCCESS | Verified |" >> "$SUMMARY_MD"
    fi

    # 12. 결과 변환
    if grep -q "변환 완료:" "$LOG_FILE"; then
        TRANS_CNT=$(grep "변환 완료:" "$LOG_FILE" | tail -n 1 | strip_ansi | sed 's/.* 완료: //;s/개.*//')
        echo "| Transform | $TRANS_CNT | Processed |" >> "$SUMMARY_MD"
    fi

    # 13. Supabase 저장
    SUPA_INSERTED=$(grep "성공 (Insert):" "$LOG_FILE" | tail -n 1 | strip_ansi | sed 's/.*Insert): //' | tr -cd '0-9')
    if [ -n "$SUPA_INSERTED" ]; then
        SUPA_SKIPPED=$(grep "건너뜀 (중복):" "$LOG_FILE" | tail -n 1 | strip_ansi | sed 's/.*중복): //' | tr -cd '0-9')
        echo "| DB Insert | $SUPA_INSERTED | (Skip: $SUPA_SKIPPED) |" >> "$SUMMARY_MD"
    else
        echo "| DB Insert | - | Skipped |" >> "$SUMMARY_MD"
    fi
else
    echo "Log file not found at $LOG_FILE. Statistics unavailable." >> "$SUMMARY_MD"
fi

echo "" >> "$SUMMARY_MD"

echo "### Details" >> "$SUMMARY_MD"
echo "<details><summary>Click to expand execution details</summary>" >> "$SUMMARY_MD"
echo "" >> "$SUMMARY_MD"

# 1. 신규 URL 목록
if [ -f "$LOG_FILE" ] && [ "${URL_CNT:-0}" != "0" ] && [ "${URL_CNT:--}" != "-" ]; then
    echo "**New URLs ($URL_CNT)**" >> "$SUMMARY_MD"
    grep "\[New URL\]" "$LOG_FILE" | strip_ansi | sed 's/.*\[New URL\] /- /' >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
fi

# 2. 메타데이터 업데이트
if [ "${META_CNT:-0}" != "0" ] && [ "${META_CNT:--}" != "-" ]; then
    echo "**Metadata Updates ($META_CNT)**" >> "$SUMMARY_MD"
    if [ "$META_CNT" -le 20 ]; then
        grep "\[Meta Updated\]" "$LOG_FILE" | strip_ansi | sed 's/.*\[Meta Updated\] /- /' >> "$SUMMARY_MD"
    else
        grep "\[Meta Updated\]" "$LOG_FILE" | strip_ansi | sed 's/.*\[Meta Updated\] /- /' | head -n 20 >> "$SUMMARY_MD"
        echo "- ... (Total $META_CNT items)" >> "$SUMMARY_MD"
    fi
    echo "" >> "$SUMMARY_MD"
fi

# 3. 자막 저장 내역
if [ "${TRANSCRIPT_CNT:-0}" != "0" ]; then
    echo "**Transcripts Saved**" >> "$SUMMARY_MD"
    grep "\[Transcript Saved\]" "$LOG_FILE" | strip_ansi | sed 's/.*\[Transcript Saved\] /- /' >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
fi

# 4. 히트맵 처리
if [ "${HEATMAP_CNT:-0}" -gt 0 ] 2>/dev/null; then
    echo "**Heatmaps Processed**" >> "$SUMMARY_MD"
    grep "\[Heatmap Saved\]" "$LOG_FILE" | strip_ansi | sed 's/.*\[Heatmap Saved\] /- /' >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
fi

# 5. 프레임 추출
FRAME_VIDEO_CNT=$(grep -c "\[Frames Extracted\]" "$LOG_FILE" 2>/dev/null || true)
if [ "$FRAME_VIDEO_CNT" -gt 0 ]; then
    echo "**Frames Extracted (Videos: $FRAME_VIDEO_CNT)**" >> "$SUMMARY_MD"
    grep "\[Frames Extracted\]" "$LOG_FILE" | strip_ansi | sed 's/.*\[Frames Extracted\] /- /' >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
fi

# 6. 재미나이
if [ -n "${GEMINI_SUCCESS_LINE:-}" ]; then
    echo "**Gemini Analysis**" >> "$SUMMARY_MD"
    echo "- $GEMINI_SUCCESS_LINE" >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
fi

if [ "${YOUTUBE_CNT:-0}" -gt 0 ] 2>/dev/null; then
    echo "**YouTube Downloads**" >> "$SUMMARY_MD"
    grep "\[Cache\] 비디오 캐시 저장 완료" "$LOG_FILE" | strip_ansi | sed 's/^/- /' >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
fi

if [ "${CONTEXT_CNT:-0}" -gt 0 ] 2>/dev/null; then
    echo "**Context Generation**" >> "$SUMMARY_MD"
    grep "Context generation for" "$LOG_FILE" | strip_ansi | sed 's/^/- /' >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
fi

if [ -n "${SUPA_INSERTED:-}" ]; then
    echo "**Supabase Status**" >> "$SUMMARY_MD"
    echo "- Inserted: $SUPA_INSERTED" >> "$SUMMARY_MD"
    echo "- Skipped: ${SUPA_SKIPPED:-0}" >> "$SUMMARY_MD"
    grep "오류:" "$LOG_FILE" | strip_ansi | sed 's/^/- /' >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
fi

echo "</details>" >> "$SUMMARY_MD"
echo "" >> "$SUMMARY_MD"

# 실패 목록 (유튜브 다운로드 실패)
FAILED_DOWNLOADS=$(grep "비디오 파일 확보 실패" "$LOG_FILE" 2>/dev/null | head -n 10)

if [ "${#FAILED_REQUIRED_STEPS[@]}" -gt 0 ]; then
    echo "### Pipeline Attention Required" >> "$SUMMARY_MD"
    echo "> 필수 단계 실패가 감지되었습니다. 위 Failed Required Steps / 로그를 확인하세요." >> "$SUMMARY_MD"
elif [ -n "$FAILED_DOWNLOADS" ]; then
    echo "### Manual Action Required (Missing Videos)" >> "$SUMMARY_MD"
    echo "> **Note**: 아래 영상들은 구글 드라이브에 없어 수집에 실패했습니다. 로컬에서 받아 드라이브에 올려주세요." >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
    echo "\`\`\`text" >> "$SUMMARY_MD"
    FAILED_LIST_FILE="$PROJECT_ROOT/backend/restaurant-crawling/data/tzuyang/failed_urls.txt"
    if [ -f "$FAILED_LIST_FILE" ]; then
        head -n 10 "$FAILED_LIST_FILE" >> "$SUMMARY_MD"
        COUNT=$(wc -l < "$FAILED_LIST_FILE")
        if [ "$COUNT" -gt 10 ]; then
            echo "... (Total $COUNT failed)" >> "$SUMMARY_MD"
        fi
    else
        echo "No failed_urls.txt found (Check logs)" >> "$SUMMARY_MD"
    fi
    echo "\`\`\`" >> "$SUMMARY_MD"
else
    echo "### All Systems Go" >> "$SUMMARY_MD"
    echo "모든 영상이 정상적으로 처리되었습니다." >> "$SUMMARY_MD"
fi

echo "" >> "$SUMMARY_MD"

echo "### Quick Links" >> "$SUMMARY_MD"
LOG_FILE_REL="${LOG_FILE#$PROJECT_ROOT/}"
echo "- **Log File**: \`$LOG_FILE_REL\`" >> "$SUMMARY_MD"
if [ -n "${ARCHIVED_LOG:-}" ]; then
    echo "- **Archived Previous Log**: \`${ARCHIVED_LOG#$PROJECT_ROOT/}\`" >> "$SUMMARY_MD"
fi
echo "- **Data Branch**: [\`data\`](https://github.com/twoimo/tzudong/tree/data)" >> "$SUMMARY_MD"
echo "" >> "$SUMMARY_MD"

echo "### 🗺️ 파이프라인 전체 흐름도 (초보자용)" >> "$SUMMARY_MD"
echo "\`\`\`" >> "$SUMMARY_MD"
cat <<'EOF' >> "$SUMMARY_MD"
+----------------------------------------------------------------------------------------------------------+
|                                    TZUDONG PIPELINE FLOW (데이터 자동 수집)                                |
+----------------------------------------------------------------------------------------------------------+
|                                                                                                          |
|  [Phase 1: 데이터 수집 준비]                                                                             |
|  1. 최신 영상/누락 영상의 주소를 찾습니다.                                                                 |
|  2. 제목, 재생시간 등 껍데기(메타데이터) 정보를 채워 넣습니다.                                               |
|                                                                                                          |
|  [Phase 2: 영상 본문 뜯어오기]                                                                             |
|  3. 영상의 자막과 영상 캡처 화면(프레임)을 추출합니다.                                                       |
|                                                                                                          |
|  [Phase 3: 인공지능(AI) 식당 탐색 & 검증]                                                                  |
|  4. Gemini AI에게 자막과 화면을 보여주고 "어떤 식당을 방문했는지" 찾게 시킵니다.                             |
|  5. AI가 찾은 정보가 맞는지, 이상한 말은 없는지 규칙과 다른 AI(LAAJ 평가)로 두 번, 세 번 검증합니다.             |
|                                                                                                          |
|  [Phase 4: 데이터베이스 등록]                                                                              |
|  6. 최종적으로 합격한 식당 정보들만 모아서 서비스 데이터베이스(Supabase)에 정식으로 올립니다! 🎉             |
|                                                                                                          |
+----------------------------------------------------------------------------------------------------------+
EOF
echo "\`\`\`" >> "$SUMMARY_MD"
exit "$FINAL_EXIT_CODE"
