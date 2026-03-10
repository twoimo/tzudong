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

# 환경 변수 로드 (Node, Python 경로 등)
if [ -f "$HOME/.bashrc" ]; then
    source "$HOME/.bashrc"
fi

# [Local Config] Anaconda Python 우선 사용 (패키지 설치 환경)
if [ -f "/c/Users/twoimo/anaconda3/python.exe" ]; then
    PYTHON_CMD="/c/Users/twoimo/anaconda3/python.exe"
    export PATH="/c/Users/twoimo/anaconda3:/c/Users/twoimo/anaconda3/Scripts:$PATH"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON_CMD="python3"
else
    if command -v python >/dev/null 2>&1; then
        PYTHON_CMD="python"
    else
        echo "[ERROR] Python을 찾을 수 없습니다."
        exit 1
    fi
fi
export PYTHONUNBUFFERED=1

# [Local Config] RClone 경로 추가 (사용자 환경)
export PYTHON_CMD
export PATH="$PATH:/c/Users/twoimo/Documents/rclone-v1.72.1-windows-amd64"

# 로그 디렉토리 생성
LOG_DIR="$PROJECT_ROOT/backend/log/cron"
mkdir -p "$LOG_DIR"

DATE=$(date +%Y-%m-%d)
LOG_FILE="$LOG_DIR/daily_${DATE}_bootstrap.log"

# 실행 인자 (workflow_dispatch + schedule 공용)
CHANNEL_SLUG="${CHANNEL_SLUG:-tzuyang}"
CHANNEL_URL="${CHANNEL_URL:-https://www.youtube.com/@tzuyang6145}"
DISPATCH_UUID="${DISPATCH_UUID:-}"
TRIGGER_SOURCE="${TRIGGER_SOURCE:-schedule}"
MAX_CONTEXT_VIDEOS="${MAX_CONTEXT_VIDEOS:--1}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --channel)
            CHANNEL_SLUG="$2"
            shift 2
            ;;
        --channel-url)
            CHANNEL_URL="$2"
            shift 2
            ;;
        --dispatch-uuid)
            DISPATCH_UUID="$2"
            shift 2
            ;;
        --trigger-source)
            TRIGGER_SOURCE="$2"
            shift 2
            ;;
        --max-videos)
            MAX_CONTEXT_VIDEOS="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

if [ -z "$DISPATCH_UUID" ]; then
    DISPATCH_UUID="$("$PYTHON_CMD" - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
fi

LOG_FILE="$LOG_DIR/daily_${DATE}_${DISPATCH_UUID}.log"

# [PERF] 파이프라인 시작 시간 기록 (전체 실행 시간 측정)
PIPELINE_START=$(date +%s)

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

STEP_DURATION_SEC=0
declare -A STEP_START_TS_MAP
declare -A STEP_STATUS_MAP
declare -A STEP_MESSAGE_MAP
declare -A STEP_DURATION_MAP
declare -A STEP_LABEL_MAP=(
    [1]="Step 1"
    [2]="Step 2"
    [3]="Step 2.1+2.5"
    [4]="Step 3"
    [5]="Step 3.1"
    [6]="Step 4"
    [7]="Step 6.1"
    [8]="Step 7"
    [9]="Step 08"
    [10]="Step 09"
    [11]="Step 10"
    [12]="Step 11+12"
)
declare -A STEP_KEY_MAP=(
    [1]="url_collection"
    [2]="metadata_collection"
    [3]="meta_sync_orphan_cleanup"
    [4]="transcript_collection"
    [5]="context_generation"
    [6]="frames_heatmap"
    [7]="transcript_enrichment"
    [8]="gemini_data_analysis"
    [9]="target_selection"
    [10]="rule_evaluation"
    [11]="laaj_evaluation"
    [12]="publish_results"
)
FIRST_FAILURE_STEP_NO=""
FIRST_FAILURE_STEP_KEY=""
TIMEOUT_TRIGGERED=false

normalize_channel_url() {
    local raw="${1:-}"
    echo "$raw" | tr '[:upper:]' '[:lower:]' | sed 's#/$##'
}

resolve_channel_slug_from_url() {
    local input_url="$1"
    local input_slug="$2"
    "$PYTHON_CMD" - "$PROJECT_ROOT/backend/config/channels.yaml" "$input_url" "$input_slug" <<'PY'
import re
import sys
from urllib.parse import urlparse
from pathlib import Path
try:
    import yaml
except Exception:
    yaml = None

config_path = Path(sys.argv[1])
input_url = (sys.argv[2] or "").strip().lower().rstrip("/")
input_slug = (sys.argv[3] or "").strip()
default_slug = "tzuyang"

def sanitize_slug(value: str) -> str:
    value = (value or "").strip().lower()
    value = re.sub(r"[^a-z0-9_.-]+", "-", value)
    return value.strip("-")

if input_slug:
    print(sanitize_slug(input_slug) or default_slug)
    raise SystemExit(0)

if yaml is None or not config_path.exists():
    print(default_slug)
    raise SystemExit(0)

cfg = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
channels = cfg.get("channels", {})

for slug, info in channels.items():
    handle = (info.get("handle") or "").strip().lower().rstrip("/")
    channel_id = (info.get("channel_id") or "").strip().lower()
    if handle and handle in input_url:
        print(slug)
        raise SystemExit(0)
    if channel_id and channel_id in input_url:
        print(slug)
        raise SystemExit(0)

m = re.search(r"/@([a-z0-9_.-]+)", input_url)
if m:
    print(sanitize_slug(m.group(1)) or default_slug)
    raise SystemExit(0)

parsed = urlparse(input_url)
path_parts = [part for part in (parsed.path or "").split("/") if part]
if len(path_parts) >= 2 and path_parts[0].lower() in {"channel", "c", "user"}:
    token = sanitize_slug(path_parts[1])
    if token:
        print(token)
        raise SystemExit(0)

if path_parts:
    token = sanitize_slug(path_parts[-1].replace("@", ""))
    if token:
        print(token)
        raise SystemExit(0)

print(default_slug)
PY
}

prepare_runtime_channels_config() {
    local base_config_path="$1"
    local runtime_config_path="$2"
    local channel_slug="$3"
    local channel_url="$4"
    local channel_id_hint="$5"
    "$PYTHON_CMD" - "$base_config_path" "$runtime_config_path" "$channel_slug" "$channel_url" "$channel_id_hint" <<'PY'
import os
import re
import sys
from pathlib import Path
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen
try:
    import yaml
except Exception:
    yaml = None

base_config_path = Path(sys.argv[1])
runtime_config_path = Path(sys.argv[2])
channel_slug = (sys.argv[3] or "").strip()
channel_url = (sys.argv[4] or "").strip()
channel_id_hint = (sys.argv[5] or "").strip()

def sanitize_slug(value: str) -> str:
    value = (value or "").strip().lower()
    value = re.sub(r"[^a-z0-9_.-]+", "-", value)
    return value.strip("-")

def resolve_channel_id_from_handle(handle: str) -> str:
    api_key = (os.environ.get("YOUTUBE_API_KEY_BYEON") or "").strip()
    if not api_key or not handle:
        return ""
    clean_handle = handle.lstrip("@")
    endpoint = (
        "https://www.googleapis.com/youtube/v3/channels"
        f"?part=id,snippet&forHandle={quote(clean_handle)}&key={quote(api_key)}"
    )
    req = Request(endpoint, headers={"Accept": "application/json"})
    try:
        with urlopen(req, timeout=10) as response:
            import json
            payload = json.loads(response.read().decode("utf-8"))
        items = payload.get("items") or []
        if items:
            return (items[0].get("id") or "").strip()
    except Exception:
        return ""
    return ""

cfg = {}
if yaml is not None and base_config_path.exists():
    cfg = yaml.safe_load(base_config_path.read_text(encoding="utf-8")) or {}
cfg.setdefault("api", {})
cfg.setdefault("collection", {})
channels = cfg.setdefault("channels", {})

slug = sanitize_slug(channel_slug) or "tzuyang"
entry = dict(channels.get(slug) or {})

parsed = urlparse(channel_url)
path = parsed.path or ""
handle_match = re.search(r"/@([A-Za-z0-9_.-]+)", path)
channel_match = re.search(r"/channel/(UC[A-Za-z0-9_-]{20,})", path, re.IGNORECASE)
legacy_match = re.search(r"/(?:c|user)/([A-Za-z0-9_.-]+)", path, re.IGNORECASE)

handle = (entry.get("handle") or "").strip()
if not handle and handle_match:
    handle = f"@{handle_match.group(1)}"
if not handle and legacy_match:
    handle = f"@{legacy_match.group(1)}"
if handle and not handle.startswith("@"):
    handle = f"@{handle}"

channel_id = (entry.get("channel_id") or channel_id_hint or "").strip()
if channel_match:
    channel_id = channel_match.group(1)
if not channel_id and handle:
    channel_id = resolve_channel_id_from_handle(handle)

display_name = (entry.get("name") or "").strip() or (handle.lstrip("@") if handle else slug)
data_path = (entry.get("data_path") or "").strip() or f"restaurant-crawling/data/{slug}"
evaluation_data_path = (entry.get("evaluation_data_path") or "").strip() or f"restaurant-evaluation/data/{slug}"

channels[slug] = {
    "channel_id": channel_id,
    "handle": handle,
    "name": display_name,
    "data_path": data_path,
    "evaluation_data_path": evaluation_data_path,
}

runtime_config_path.parent.mkdir(parents=True, exist_ok=True)
if yaml is not None:
    runtime_config_path.write_text(yaml.safe_dump(cfg, allow_unicode=True, sort_keys=False), encoding="utf-8")

print(f"{slug}\t{channel_id}\t{runtime_config_path.name}")
PY
}

extract_tsv_field() {
    local input="$1"
    local index="$2"
    echo "$input" | awk -F '\t' -v idx="$index" '{print $idx}'
}

count_jsonl_files() {
    local dir_path="$1"
    if [ -d "$dir_path" ]; then
        find "$dir_path" -maxdepth 1 -type f -name '*.jsonl' | wc -l | tr -d ' '
    else
        echo "0"
    fi
}

is_description_map_channel() {
    local config_path="$1"
    local channel_slug="$2"
    "$PYTHON_CMD" - "$config_path" "$channel_slug" <<'PY'
import sys
from pathlib import Path
try:
    import yaml
except Exception:
    yaml = None

config_path = Path(sys.argv[1])
channel_slug = (sys.argv[2] or "").strip()

if yaml is None or not config_path.exists() or not channel_slug:
    print("1" if channel_slug == "meatcreator" else "0")
    raise SystemExit(0)

cfg = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
channel_cfg = (cfg.get("channels", {}) or {}).get(channel_slug) or {}
source = str(channel_cfg.get("description_source") or "").strip().lower()
map_flag = bool(channel_cfg.get("map_url_crawling") is True)

enabled = map_flag or source in {"map_url", "description_map"} or channel_slug == "meatcreator"
print("1" if enabled else "0")
PY
}

emit_signal() {
    if [ ! -f "$PROJECT_ROOT/backend/workflow/workflow_signal.py" ]; then
        return 0
    fi
    "$PYTHON_CMD" "$PROJECT_ROOT/backend/workflow/workflow_signal.py" "$@" 2>> "$LOG_FILE" || true
}

mark_failure_point() {
    local step_no="$1"
    local status="$2"
    if [[ -z "$FIRST_FAILURE_STEP_NO" ]] && [[ "$status" == "failed" || "$status" == "timeout" || "$status" == "partial" ]]; then
        FIRST_FAILURE_STEP_NO="$step_no"
        FIRST_FAILURE_STEP_KEY="${STEP_KEY_MAP[$step_no]}"
    fi
}

canonical_step_start() {
    local step_no="$1"
    local message="$2"
    STEP_START_TS_MAP[$step_no]=$(date +%s)
    emit_signal step-start \
        --run-id "$WORKFLOW_RUN_ID" \
        --step-no "$step_no" \
        --step-key "${STEP_KEY_MAP[$step_no]}" \
        --script-step-label "${STEP_LABEL_MAP[$step_no]}" \
        --message "$message" \
        --attempt 1
}

canonical_step_finish() {
    local step_no="$1"
    local status="$2"
    local message="$3"
    local row_delta_json="${4:-{}}"
    local end_ts=$(date +%s)
    local started_at="${STEP_START_TS_MAP[$step_no]:-$end_ts}"
    STEP_DURATION_SEC=$((end_ts - started_at))
    STEP_STATUS_MAP[$step_no]="$status"
    STEP_MESSAGE_MAP[$step_no]="$message"
    STEP_DURATION_MAP[$step_no]="$STEP_DURATION_SEC"
    mark_failure_point "$step_no" "$status"
    emit_signal step-finish \
        --run-id "$WORKFLOW_RUN_ID" \
        --step-no "$step_no" \
        --step-key "${STEP_KEY_MAP[$step_no]}" \
        --script-step-label "${STEP_LABEL_MAP[$step_no]}" \
        --status "$status" \
        --message "$message" \
        --duration-ms "$((STEP_DURATION_SEC * 1000))" \
        --row-delta-json "$row_delta_json" \
        --attempt 1
}

initialize_step_queue_signals() {
    emit_signal init-steps --run-id "$WORKFLOW_RUN_ID"
}

# [PERF] 파이프라인 경과 시간 확인 (타임아웃 보호)
check_timeout() {
    local MAX_MINUTES=${1:-90}  # 기본 90분 타임아웃
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
    cat "$TEMP_LOG_A" | tee -a "$LOG_FILE"
    log "INFO" "--- [$LABEL_B] ---"
    cat "$TEMP_LOG_B" | tee -a "$LOG_FILE"

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

# [Function] 데이터 커밋 함수 (data 브랜치에서 직접 실행)
sync_data_to_remote() {
    local STEP_NAME="$1"
    log "INFO" "------------------------------------------------------------"
    log "INFO" "데이터 동기화 시작 (Trigger: $STEP_NAME)"

    # 데이터 폴더 변경 감지 (Modified + Untracked)
    if [ -z "$(git status --porcelain backend/restaurant-crawling/data/ backend/restaurant-evaluation/data/)" ]; then
        log "INFO" "변경 된 데이터가 없습니다. (Skip)"
        return 0
    fi

    log "INFO" "변경 된 데이터를 커밋합니다."

    # 데이터 파일 추가
    git add backend/restaurant-crawling/data/ 2>&1 | tee -a "$LOG_FILE"
    git add backend/restaurant-evaluation/data/ 2>&1 | tee -a "$LOG_FILE"

    # 대용량 폴더는 추적에서 제외
    git rm -r --cached backend/restaurant-crawling/data/*/frames 2>/dev/null || true
    git rm -r --cached backend/restaurant-crawling/data/*/video_cache 2>/dev/null || true
    git rm -r --cached backend/restaurant-crawling/data/*/temp_video 2>/dev/null || true
    git rm -r --cached backend/restaurant-crawling/data/*/thumbnails 2>/dev/null || true

    # [Fix] CI 환경 등에서 생성된 루트 frames 폴더 추적 제외
    git rm -r --cached backend/restaurant-crawling/data/frames 2>/dev/null || true
    # [Security] 민감 정보 추적 제외
    git rm --cached backend/restaurant-crawling/data/credentials.json 2>/dev/null || true
    git rm --cached backend/restaurant-crawling/data/cookies.txt 2>/dev/null || true

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
    if ! git pull --rebase origin data 2>&1 | tee -a "$LOG_FILE"; then
        log "WARN" "Rebase 실패 - 강제 푸시 시도"
        if ! git push --force-with-lease origin data 2>&1 | tee -a "$LOG_FILE"; then
            log "ERROR" "Failed to push to data branch"
            return 1
        fi
    else
        log "INFO" "Pushing to remote..."
        if ! git push origin data 2>&1 | tee -a "$LOG_FILE"; then
            log "ERROR" "Failed to push to data branch"
            return 1
        fi
    fi

    log "OK" "data 브랜치 업데이트 완료 ($STEP_NAME)"
}

# ============================================================
# 파이프라인 시작
# ============================================================

CHANNEL_URL_NORMALIZED="$(normalize_channel_url "$CHANNEL_URL")"
if [[ ! "$CHANNEL_URL_NORMALIZED" =~ ^https?://(www\.|m\.)?youtube\.com/ ]]; then
    log "ERROR" "[Workflow] 유효하지 않은 channel_url 입니다. youtube.com 채널 URL만 허용됩니다. (${CHANNEL_URL_NORMALIZED})"
    exit 1
fi

if [[ "$CHANNEL_URL_NORMALIZED" =~ /(watch|results|playlist|shorts|feed)($|[/?#]) ]]; then
    log "ERROR" "[Workflow] 채널 URL 경로가 아닙니다. /@handle, /channel/<id>, /c/<name>, /user/<name> 형식을 사용하세요."
    exit 1
fi

CHANNEL_SLUG="$(resolve_channel_slug_from_url "$CHANNEL_URL_NORMALIZED" "$CHANNEL_SLUG")"
BASE_CHANNEL_CONFIG_PATH="$PROJECT_ROOT/backend/config/channels.yaml"
RUNTIME_CHANNEL_CONFIG_PATH="$PROJECT_ROOT/backend/config/channels.runtime.yaml"
CHANNEL_CONFIG_META="$(prepare_runtime_channels_config "$BASE_CHANNEL_CONFIG_PATH" "$RUNTIME_CHANNEL_CONFIG_PATH" "$CHANNEL_SLUG" "$CHANNEL_URL_NORMALIZED" "$CHANNEL_ID")"
CHANNEL_SLUG="$(extract_tsv_field "$CHANNEL_CONFIG_META" 1)"
CHANNEL_ID="$(extract_tsv_field "$CHANNEL_CONFIG_META" 2)"
CHANNELS_CONFIG_NAME="$(extract_tsv_field "$CHANNEL_CONFIG_META" 3)"
CHANNELS_CONFIG="${CHANNELS_CONFIG_NAME:-channels.yaml}"
export CHANNELS_CONFIG

CRAWLING_PATH="backend/restaurant-crawling/data/$CHANNEL_SLUG"
EVALUATION_PATH="backend/restaurant-evaluation/data/$CHANNEL_SLUG"
mkdir -p "$PROJECT_ROOT/$CRAWLING_PATH" "$PROJECT_ROOT/$EVALUATION_PATH"

if [ -z "$CHANNEL_ID" ]; then
    log "WARN" "[Workflow] channel_id를 해석하지 못했습니다. URL 기반 스텝이 실패할 수 있습니다. (channel_slug=$CHANNEL_SLUG)"
fi

WORKFLOW_RUN_ID="$DISPATCH_UUID"
CORRELATION_KEY="${CHANNEL_SLUG}|${TRIGGER_SOURCE}|${MAX_CONTEXT_VIDEOS}"
export CHANNEL_SLUG CHANNEL_URL CHANNEL_ID DISPATCH_UUID WORKFLOW_RUN_ID TRIGGER_SOURCE MAX_CONTEXT_VIDEOS

log "INFO" "[Workflow] channel=$CHANNEL_SLUG channel_url=$CHANNEL_URL_NORMALIZED trigger=$TRIGGER_SOURCE dispatch_uuid=$DISPATCH_UUID"

WORKFLOW_INIT_RUN_ID="$(
    emit_signal init-run \
        --run-id "$WORKFLOW_RUN_ID" \
        --dispatch-request-id "$DISPATCH_UUID" \
        --correlation-key "$CORRELATION_KEY" \
        --trigger-source "$TRIGGER_SOURCE" \
        --channel-url "$CHANNEL_URL" \
        --channel-url-normalized "$CHANNEL_URL_NORMALIZED" \
        --channel-slug "$CHANNEL_SLUG" \
        --channel-id "$CHANNEL_ID" \
        --workflow-file "daily-crawler.yml" \
        --workflow-ref "${GITHUB_REF_NAME:-data}" \
        --github-run-id "${GITHUB_RUN_ID:-}" \
        --github-run-number "${GITHUB_RUN_NUMBER:-}" \
        --github-run-attempt "${GITHUB_RUN_ATTEMPT:-}" | tail -n 1
)"
if [ -n "$WORKFLOW_INIT_RUN_ID" ]; then
    WORKFLOW_RUN_ID="$WORKFLOW_INIT_RUN_ID"
    export WORKFLOW_RUN_ID
fi
initialize_step_queue_signals

log "INFO" "============================================================"
log "INFO" "일일 데이터 수집 파이프라인 시작"
log "INFO" "============================================================"

# [Branch Check] 'data' 브랜치인지 확인
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
TARGET_BRANCH="data"

log "INFO" "현재 브랜치 확인: $CURRENT_BRANCH"

if [ "$CURRENT_BRANCH" != "$TARGET_BRANCH" ]; then
    log "WARN" "현재 브랜치가 '$TARGET_BRANCH'가 아닙니다. '$TARGET_BRANCH'로 전환을 시도합니다."
    
    git fetch origin
    
    if git show-ref --verify --quiet refs/heads/$TARGET_BRANCH; then
        git checkout $TARGET_BRANCH || { log "ERROR" "브랜치 전환 실패. 변경사항을 커밋하거나 스태시하세요."; exit 1; }
    else
        git checkout -b $TARGET_BRANCH origin/$TARGET_BRANCH || { log "ERROR" "원격 브랜치 체크아웃 실패."; exit 1; }
    fi
    
    log "OK" "브랜치 전환 완료: $TARGET_BRANCH"
fi

# 충돌 방지를 위해 최신 변경사항 Pull
log "INFO" "'$TARGET_BRANCH' 브랜치 최신화 (Pull)..."
git pull origin $TARGET_BRANCH || { log "WARN" "Pull 실패 (무시하고 진행)."; }

log "INFO" "현재 작업 브랜치: $(git rev-parse --abbrev-ref HEAD)"

# ============================================================
# [Phase 1] 데이터 수집 및 전처리 (Collection & Preprocessing)
# ============================================================

# 1. URL 수집 (새로운 영상 탐색)
echo "::group::[Step 1] URL Collection"
step_start
canonical_step_start 1 "collect urls for ${CHANNEL_SLUG}"
log "INFO" "[Step 1] URL 수집 중..."
$PYTHON_CMD backend/restaurant-crawling/scripts/01-collect-urls.py --channel "$CHANNEL_SLUG" 2>&1 | tee -a "$LOG_FILE"
STEP1_EXIT=${PIPESTATUS[0]}
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
fi
if [ "$STEP1_EXIT" -eq 0 ]; then
    canonical_step_finish 1 "success" "url collection completed" "{\"new_urls\":$NEW_URL_COUNT,\"deleted_urls\":0,\"total_urls\":$NEW_URL_COUNT}"
else
    canonical_step_finish 1 "failed" "url collection failed (exit:$STEP1_EXIT)" "{\"new_urls\":0,\"deleted_urls\":0,\"total_urls\":0}"
fi

# 2. 메타데이터 수집 & 스케줄링 (관제탑 역할)
echo "::group::[Step 2] Metadata Collection"
step_start
canonical_step_start 2 "collect metadata for ${CHANNEL_SLUG}"
log "INFO" "[Step 2] 메타데이터 수집 및 스케줄링..."
$PYTHON_CMD backend/restaurant-crawling/scripts/02-collect-meta.py --channel "$CHANNEL_SLUG" 2>&1 | tee -a "$LOG_FILE"
STEP2_EXIT=${PIPESTATUS[0]}
step_end "Step 2 (Metadata)"
if [ "$STEP2_EXIT" -eq 0 ]; then
    META_UPDATED_COUNT=$(grep "업데이트 [0-9]*개" "$LOG_FILE" | tail -n 1 | sed 's/.*업데이트 \([0-9]\+\)개.*/\1/' 2>/dev/null)
    META_UPDATED_COUNT="${META_UPDATED_COUNT:-0}"
    canonical_step_finish 2 "success" "metadata collection completed" "{\"meta_updated\":$META_UPDATED_COUNT,\"meta_skipped\":0}"
else
    canonical_step_finish 2 "failed" "metadata collection failed (exit:$STEP2_EXIT)" "{\"meta_updated\":0,\"meta_skipped\":0}"
fi
echo "::endgroup::"

# [PERF] 2.1 + 2.5 병렬 실행 (충돌 없음: 2.1은 Supabase 쓰기, 2.5는 orphan 삭제)
echo "::group::[Step 2.1+2.5] Meta Migration + Orphan Cleanup (Parallel)"
step_start
canonical_step_start 3 "meta migration + orphan cleanup for ${CHANNEL_SLUG}"
log "INFO" "[Step 2.1+2.5] Meta Migration + Orphan Cleanup (병렬 실행)..."
run_parallel \
    "Step 2.1 Meta Migration" \
    "$PYTHON_CMD backend/restaurant-crawling/scripts/02.1-migrate-meta-to-supabase.py --channel $CHANNEL_SLUG" \
    "Step 2.5 Orphan Cleanup" \
    "$PYTHON_CMD backend/restaurant-crawling/scripts/02.5-cleanup-orphans.py --channel $CHANNEL_SLUG"
STEP3_EXIT=$?
step_end "Step 2.1+2.5 (Migration+Cleanup)"
if [ "$STEP3_EXIT" -eq 0 ]; then
    canonical_step_finish 3 "success" "meta migration + orphan cleanup completed" "{\"meta_upserts\":0,\"orphans_deleted\":0}"
else
    canonical_step_finish 3 "partial" "meta migration/cleanup partial failure (exit:$STEP3_EXIT)" "{\"meta_upserts\":0,\"orphans_deleted\":0}"
fi
echo "::endgroup::"

# [PERF] Sync #1: 메타데이터/정리 완료 후 저장
sync_data_to_remote "Phase 1 (Meta/Cleanup)"

# ============================================================
# [Phase 2] 멀티모달 데이터 확보 (Multi-modal Processing)
# ============================================================

# [PERF] Step 3 + Step 4 병렬 실행 (충돌 없음: 3은 transcript/, 4는 heatmap/+frames/)
# Step 3 완료 후 Step 3.1 실행, Step 4는 백그라운드 유지
echo "::group::[Step 3+4] Transcript + Frames (Parallel)"
step_start
log "INFO" "[Step 3+4] 자막 수집 + 프레임 추출 (병렬 실행)..."
canonical_step_start 4 "collect transcript for ${CHANNEL_SLUG}"
canonical_step_start 6 "extract frames and heatmap for ${CHANNEL_SLUG}"

TEMP_LOG_3=$(mktemp)
TEMP_LOG_4=$(mktemp)

# Step 3 (Transcript) + Step 4 (Frames) 동시 시작
node backend/restaurant-crawling/scripts/03-collect-transcript.js --channel "$CHANNEL_SLUG" > "$TEMP_LOG_3" 2>&1 &
PID_3=$!
node backend/restaurant-crawling/scripts/04-extract-frames-with-heatmap.js --channel "$CHANNEL_SLUG" --delete-cache > "$TEMP_LOG_4" 2>&1 &
PID_4=$!

# Step 3 완료 대기 -> 로그 출력
wait $PID_3; EXIT_3=$?
log "INFO" "--- [Step 3 Transcript] ---"
cat "$TEMP_LOG_3" | tee -a "$LOG_FILE"
if [ $EXIT_3 -ne 0 ]; then
    log "WARN" "[Step 3] Transcript 비정상 종료 (exit: $EXIT_3)"
fi
if [ "$EXIT_3" -eq 0 ]; then
    TRANSCRIPT_SUCCESS=$(grep -E "자막 수집 완료|성공 [0-9]+개" "$LOG_FILE" | tail -n 1 | sed -n 's/.*성공 \([0-9]\+\)개.*/\1/p')
    TRANSCRIPT_SUCCESS="${TRANSCRIPT_SUCCESS:-0}"
    canonical_step_finish 4 "success" "transcript collection completed" "{\"transcript_success\":$TRANSCRIPT_SUCCESS,\"transcript_failed\":0,\"transcript_skipped\":0}"
else
    canonical_step_finish 4 "failed" "transcript collection failed (exit:$EXIT_3)" "{\"transcript_success\":0,\"transcript_failed\":1,\"transcript_skipped\":0}"
fi
rm -f "$TEMP_LOG_3"
echo "::endgroup::"

# Step 3.1 실행 (Step 3 완료 필요, Step 4는 백그라운드 계속)
echo "::group::[Step 3.1] Context Generation"
canonical_step_start 5 "generate transcript context for ${CHANNEL_SLUG}"
log "INFO" "[Step 3.1] 자막 문맥 생성 중..."
# [Config] 실행 모드에 따른 배치 크기 제한
if [ -z "$CI" ]; then
    MAX_VIDEOS=-1
else
    MAX_VIDEOS=${MAX_CONTEXT_VIDEOS:-0}
fi

if [[ "$MAX_VIDEOS" -eq -1 ]]; then
    log "INFO" "Context Generation Skipped (Configured as -1)"
    canonical_step_finish 5 "skipped" "context generation skipped by max_videos=-1" "{\"context_generated\":0,\"context_skipped\":1}"
elif [[ "$CHANNEL_SLUG" != "tzuyang" ]]; then
    log "INFO" "Context Generation Skipped (incompatible channel: $CHANNEL_SLUG)"
    canonical_step_finish 5 "skipped" "context generation incompatible for non-tzuyang channel" "{\"context_generated\":0,\"context_skipped\":1}"
else
    if [[ "$MAX_VIDEOS" -gt 0 ]]; then
        log "INFO" "Context Generation Limit: $MAX_VIDEOS videos (Configured)"
    else
        log "INFO" "Context Generation Limit: Unlimited"
    fi
    $PYTHON_CMD backend/restaurant-crawling/scripts/03.1-generate-transcript-context.py --channel "$CHANNEL_SLUG" --max-videos "$MAX_VIDEOS" 2>&1 | tee -a "$LOG_FILE"
    STEP5_EXIT=${PIPESTATUS[0]}
    CONTEXT_COUNT=$(grep -c "Context generation for .* completed" "$LOG_FILE" 2>/dev/null || true)
    if [ "$STEP5_EXIT" -eq 0 ]; then
        canonical_step_finish 5 "success" "context generation completed" "{\"context_generated\":$CONTEXT_COUNT,\"context_skipped\":0}"
    else
        canonical_step_finish 5 "failed" "context generation failed (exit:$STEP5_EXIT)" "{\"context_generated\":0,\"context_skipped\":0}"
    fi
fi
echo "::endgroup::"

# Step 4 완료 대기
echo "::group::[Step 4] Heatmap & Frames (Awaiting)"
wait $PID_4; EXIT_4=$?
log "INFO" "--- [Step 4 Frames] ---"
cat "$TEMP_LOG_4" | tee -a "$LOG_FILE"
if [ $EXIT_4 -ne 0 ]; then
    log "WARN" "[Step 4] Frames 비정상 종료 (exit: $EXIT_4)"
fi
HEATMAP_COUNT=$(grep -c "Heatmap saved" "$LOG_FILE" 2>/dev/null || true)
FRAME_COUNT=$(grep -c "Frames extracted" "$LOG_FILE" 2>/dev/null || true)
if [ "$EXIT_4" -eq 0 ]; then
    canonical_step_finish 6 "success" "frames + heatmap completed" "{\"frames_extracted\":$FRAME_COUNT,\"heatmaps_generated\":$HEATMAP_COUNT}"
else
    canonical_step_finish 6 "failed" "frames + heatmap failed (exit:$EXIT_4)" "{\"frames_extracted\":$FRAME_COUNT,\"heatmaps_generated\":$HEATMAP_COUNT}"
fi
rm -f "$TEMP_LOG_4"

step_end "Step 3+4 (Transcript+Frames+Context)"
echo "::endgroup::"

# [PERF] Sync #2: 자막/프레임 완료 후 저장 (Phase 2 통합 - 기존 3회 → 1회)
sync_data_to_remote "Phase 2 (Transcript/Frames)"

# [PERF] 타임아웃 체크 - Phase 3 진입 전 시간 확인
if ! check_timeout 90; then
    log "WARN" "시간 제한으로 Phase 3 건너뜁니다. 다음 실행에서 이어집니다."
    sync_data_to_remote "Timeout Safety Sync"
    # Summary 생성으로 점프
    SKIP_PHASE3=true
    TIMEOUT_TRIGGERED=true
    for step_no in 7 8 9 10 11 12; do
        canonical_step_start "$step_no" "phase3 timeout pre-check"
        canonical_step_finish "$step_no" "timeout" "phase3 skipped by timeout guard" "{}"
    done
fi

# ============================================================
# [Phase 3] AI 분석 및 평가 (Analysis & Evaluation)
# ============================================================

if [ "${SKIP_PHASE3:-false}" != "true" ]; then

# 6.1. 자막 문서에 메타데이터 추가 (음식점 + Peak)
echo "::group::[Step 6.1] Enrich Subtitles"
step_start
canonical_step_start 7 "enrich transcript documents for ${CHANNEL_SLUG}"
log "INFO" "[Step 6.1] 자막 문서 메타데이터 추가 중..."
$PYTHON_CMD backend/restaurant-crawling/scripts/06.1-transcript-document-with-meta.py --channel "$CHANNEL_SLUG" 2>&1 | tee -a "$LOG_FILE"
STEP7_EXIT=${PIPESTATUS[0]}
step_end "Step 6.1 (Enrich)"
if [ "$STEP7_EXIT" -eq 0 ]; then
    canonical_step_finish 7 "success" "transcript enrichment completed" "{\"documents_enriched\":0,\"peak_docs\":0}"
else
    canonical_step_finish 7 "failed" "transcript enrichment failed (exit:$STEP7_EXIT)" "{\"documents_enriched\":0,\"peak_docs\":0}"
fi
echo "::endgroup::"

# 7. Gemini 기반 데이터 분석
echo "::group::[Step 7] Gemini Data Analysis"
step_start
canonical_step_start 8 "run gemini analysis for ${CHANNEL_SLUG}"
log "INFO" "[Step 7] Gemini 데이터 분석 중..."

MAP_URL_TABLE_NAME="map_url_crawling"
MAP_URL_STATUS="skipped"
MAP_URL_EXIT=0
MAP_URL_PRE_COUNT=0
MAP_URL_POST_COUNT=0
MAP_URL_DELTA=0
MAP_URL_DIR="$PROJECT_ROOT/$CRAWLING_PATH/$MAP_URL_TABLE_NAME"
DESCRIPTION_MAP_ENABLED="$(is_description_map_channel "$PROJECT_ROOT/backend/config/$CHANNELS_CONFIG" "$CHANNEL_SLUG")"

if [[ "$DESCRIPTION_MAP_ENABLED" == "1" ]]; then
    echo "::group::[Step 5] Description Map URL Crawling"
    log "INFO" "[Step 5] Description 기반 지도 URL 크롤링 실행 (channel=$CHANNEL_SLUG)"
    MAP_URL_PRE_COUNT=$(count_jsonl_files "$MAP_URL_DIR")
    node backend/restaurant-crawling/scripts/05-map-url-crawling.js --channel "$CHANNEL_SLUG" 2>&1 | tee -a "$LOG_FILE"
    MAP_URL_EXIT=${PIPESTATUS[0]}
    MAP_URL_POST_COUNT=$(count_jsonl_files "$MAP_URL_DIR")
    MAP_URL_DELTA=$((MAP_URL_POST_COUNT - MAP_URL_PRE_COUNT))
    if [ "$MAP_URL_EXIT" -eq 0 ]; then
        MAP_URL_STATUS="success"
        log "INFO" "[Step 5] Description map-url 크롤링 완료 (delta=${MAP_URL_DELTA}, total=${MAP_URL_POST_COUNT})"
    else
        MAP_URL_STATUS="failed"
        log "WARN" "[Step 5] Description map-url 크롤링 실패 (exit:$MAP_URL_EXIT, delta=${MAP_URL_DELTA})"
    fi
    echo "::endgroup::"
else
    log "INFO" "[Step 5] Description map-url 크롤링 스킵 (channel=$CHANNEL_SLUG)"
fi

bash backend/restaurant-crawling/scripts/07-gemini-crawling.sh --channel "$CHANNEL_SLUG" 2>&1 | tee -a "$LOG_FILE"
STEP8_EXIT=${PIPESTATUS[0]}
step_end "Step 7 (Gemini)"
GEMINI_CALLS_RAW=$(grep "총 호출 수:" "$LOG_FILE" | tail -n 1 | strip_ansi | sed 's/.*: //')
GEMINI_SUCCESS_RAW=$(grep "성공:" "$LOG_FILE" | tail -n 1 | strip_ansi | sed 's/.*: //')
GEMINI_CALLS="${GEMINI_CALLS_RAW//[^0-9]/}"
GEMINI_SUCCESS="${GEMINI_SUCCESS_RAW//[^0-9]/}"
GEMINI_CALLS="${GEMINI_CALLS:-0}"
GEMINI_SUCCESS="${GEMINI_SUCCESS:-0}"
STEP8_ROW_DELTA="$(printf '{"description_table":"%s","description_row_delta":%s,"description_status":"%s","gemini_calls":%s,"gemini_success":%s,"gemini_fail":%s}' "$MAP_URL_TABLE_NAME" "$MAP_URL_DELTA" "$MAP_URL_STATUS" "${GEMINI_CALLS:-0}" "${GEMINI_SUCCESS:-0}" "$([ "$STEP8_EXIT" -eq 0 ] && echo 0 || echo 1)")"
if [ "$STEP8_EXIT" -eq 0 ] && [ "$MAP_URL_STATUS" != "failed" ]; then
    canonical_step_finish 8 "success" "gemini analysis completed" "$STEP8_ROW_DELTA"
elif [ "$STEP8_EXIT" -eq 0 ] && [ "$MAP_URL_STATUS" = "failed" ]; then
    canonical_step_finish 8 "partial" "gemini completed but description map-url step failed" "$STEP8_ROW_DELTA"
elif [ "$STEP8_EXIT" -ne 0 ] && [ "$MAP_URL_STATUS" = "failed" ]; then
    canonical_step_finish 8 "failed" "gemini + description map-url step failed" "$STEP8_ROW_DELTA"
else
    canonical_step_finish 8 "failed" "gemini analysis failed (exit:$STEP8_EXIT)" "$STEP8_ROW_DELTA"
fi
echo "::endgroup::"

# 8. 평가 대상 선정
echo "::group::[Step 08] Target Selection"
step_start
canonical_step_start 9 "run target selection for ${CHANNEL_SLUG}"
log "INFO" "[Step 08] Target Selection..."
$PYTHON_CMD backend/restaurant-evaluation/scripts/08-target-selection.py --channel "$CHANNEL_SLUG" \
  --crawling-path "$CRAWLING_PATH" \
  --evaluation-path "$EVALUATION_PATH" 2>&1 | tee -a "$LOG_FILE"
STEP9_EXIT=${PIPESTATUS[0]}
step_end "Step 08 (Target)"
TARGET_CNT=$(grep "대상 비디오:" "$LOG_FILE" | tail -n 1 | strip_ansi | sed 's/.*비디오: //;s/개.*//')
TARGET_CNT="${TARGET_CNT:-0}"
if [ "$STEP9_EXIT" -eq 0 ]; then
    canonical_step_finish 9 "success" "target selection completed" "{\"selected_count\":$TARGET_CNT,\"not_selected_count\":0}"
else
    canonical_step_finish 9 "failed" "target selection failed (exit:$STEP9_EXIT)" "{\"selected_count\":0,\"not_selected_count\":0}"
fi
echo "::endgroup::"

# 9. Rule 기반 평가 (위치/상호 검증)
echo "::group::[Step 09] Rule Evaluation"
step_start
canonical_step_start 10 "run rule evaluation for ${CHANNEL_SLUG}"
log "INFO" "[Step 09] Rule Evaluation..."
$PYTHON_CMD backend/restaurant-evaluation/scripts/09-rule-evaluation.py --channel "$CHANNEL_SLUG" \
  --evaluation-path "$EVALUATION_PATH" 2>&1 | tee -a "$LOG_FILE"
STEP10_EXIT=${PIPESTATUS[0]}
grep "Rule 평가 완료!" -A 5 "$LOG_FILE" | tail -n 6 | strip_ansi | while read -r line; do echo "::notice::$line"; done
step_end "Step 09 (Rule Eval)"
RULE_SUCCESS=$(grep "성공:" "$LOG_FILE" | grep -v "LAAJ" | tail -n 1 | strip_ansi | sed 's/.*: //')
RULE_SUCCESS="${RULE_SUCCESS:-0}"
if [ "$STEP10_EXIT" -eq 0 ]; then
    canonical_step_finish 10 "success" "rule evaluation completed" "{\"rule_success\":$RULE_SUCCESS,\"rule_fail\":0}"
else
    canonical_step_finish 10 "failed" "rule evaluation failed (exit:$STEP10_EXIT)" "{\"rule_success\":0,\"rule_fail\":1}"
fi
echo "::endgroup::"

# [PERF] Sync #3: Rule 평가 완료 후 저장 (LAAJ 전 백업 - 중요)
sync_data_to_remote "Phase 3a (Rule Eval)"

# [PERF] 타임아웃 체크 - LAAJ 진입 전 시간 확인 (가장 오래 걸리는 단계)
if ! check_timeout 90; then
    log "WARN" "시간 제한으로 LAAJ 평가를 건너뜁니다. 다음 실행에서 이어집니다."
    TIMEOUT_TRIGGERED=true
    canonical_step_start 11 "laaj timeout guard"
    canonical_step_finish 11 "timeout" "LAAJ skipped by timeout guard" "{\"laaj_success\":0,\"laaj_fail\":0}"
else

# 10. LAAJ (LLM) 기반 평가
echo "::group::[Step 10] LAAJ Evaluation"
step_start
canonical_step_start 11 "run LAAJ evaluation for ${CHANNEL_SLUG}"
log "INFO" "[Step 10] LAAJ Evaluation..."
bash backend/restaurant-evaluation/scripts/10-laaj-evaluation.sh --channel "$CHANNEL_SLUG" \
  --crawling-path "$CRAWLING_PATH" \
  --evaluation-path "$EVALUATION_PATH" 2>&1 | tee -a "$LOG_FILE"
STEP11_EXIT=${PIPESTATUS[0]}
grep "LAAJ 평가 완료" -A 5 "$LOG_FILE" | tail -n 6 | strip_ansi | while read -r line; do echo "::notice::$line"; done
step_end "Step 10 (LAAJ Eval)"
if [ "$STEP11_EXIT" -eq 0 ]; then
    LAAJ_SUCCESS=$(grep "성공:" "$LOG_FILE" | grep "LAAJ" -A 5 | tail -n 5 | grep "성공:" | strip_ansi | sed 's/.*: //')
    LAAJ_SUCCESS="${LAAJ_SUCCESS:-0}"
    canonical_step_finish 11 "success" "LAAJ evaluation completed" "{\"laaj_success\":$LAAJ_SUCCESS,\"laaj_fail\":0}"
else
    canonical_step_finish 11 "failed" "LAAJ evaluation failed (exit:$STEP11_EXIT)" "{\"laaj_success\":0,\"laaj_fail\":1}"
fi
echo "::endgroup::"

fi # LAAJ 타임아웃 체크 종료

# 11. 결과 변환 (Transforms)
echo "::group::[Step 11] Transform Results"
step_start
canonical_step_start 12 "transform + publish results for ${CHANNEL_SLUG}"
log "INFO" "[Step 11] Transform Results..."
$PYTHON_CMD backend/restaurant-evaluation/scripts/11-transform.py --channel "$CHANNEL_SLUG" \
  --crawling-path "$CRAWLING_PATH" \
  --evaluation-path "$EVALUATION_PATH" 2>&1 | tee -a "$LOG_FILE"
STEP12_TRANSFORM_EXIT=${PIPESTATUS[0]}
step_end "Step 11 (Transform)"
echo "::endgroup::"

# 12. Supabase 결과 삽입
echo "::group::[Step 12] Insert to Supabase"
step_start
log "INFO" "[Step 12] Insert to Supabase..."
$PYTHON_CMD backend/restaurant-evaluation/scripts/12-supabase-insert.py --channel "$CHANNEL_SLUG" \
  --evaluation-path "$EVALUATION_PATH" 2>&1 | tee -a "$LOG_FILE"
STEP12_INSERT_EXIT=${PIPESTATUS[0]}
grep "성공 (Insert):" "$LOG_FILE" | tail -n 1 | strip_ansi | while read -r line; do echo "::notice::DB Sync - $line"; done
step_end "Step 12 (Supabase)"
TRANSFORM_COUNT=$(grep "변환 완료:" "$LOG_FILE" | tail -n 1 | strip_ansi | sed 's/.* 완료: //;s/개.*//')
SUPA_INSERTED_STEP=$(grep "성공 (Insert):" "$LOG_FILE" | tail -n 1 | strip_ansi | sed 's/.*Insert): //' | tr -cd '0-9')
SUPA_SKIPPED_STEP=$(grep "건너뜀 (중복):" "$LOG_FILE" | tail -n 1 | strip_ansi | sed 's/.*중복): //' | tr -cd '0-9')
TRANSFORM_COUNT="${TRANSFORM_COUNT:-0}"
SUPA_INSERTED_STEP="${SUPA_INSERTED_STEP:-0}"
SUPA_SKIPPED_STEP="${SUPA_SKIPPED_STEP:-0}"
DB_TARGET_TABLE="restaurants"
STEP12_ROW_DELTA_SUCCESS="$(printf '{"target_table":"%s","db_row_delta":%s,"db_inserted":%s,"db_skipped":%s,"db_failed":0,"transform_rows":%s}' "$DB_TARGET_TABLE" "$SUPA_INSERTED_STEP" "$SUPA_INSERTED_STEP" "$SUPA_SKIPPED_STEP" "$TRANSFORM_COUNT")"
STEP12_ROW_DELTA_PARTIAL="$(printf '{"target_table":"%s","db_row_delta":%s,"db_inserted":%s,"db_skipped":%s,"db_failed":1,"transform_rows":%s}' "$DB_TARGET_TABLE" "$SUPA_INSERTED_STEP" "$SUPA_INSERTED_STEP" "$SUPA_SKIPPED_STEP" "$TRANSFORM_COUNT")"
if [ "$STEP12_TRANSFORM_EXIT" -eq 0 ] && [ "$STEP12_INSERT_EXIT" -eq 0 ]; then
    canonical_step_finish 12 "success" "publish completed (transform+db insert)" "$STEP12_ROW_DELTA_SUCCESS"
elif [ "$STEP12_TRANSFORM_EXIT" -eq 0 ] && [ "$STEP12_INSERT_EXIT" -ne 0 ]; then
    canonical_step_finish 12 "partial" "transform succeeded but db insert failed" "$STEP12_ROW_DELTA_PARTIAL"
else
    canonical_step_finish 12 "failed" "publish failed (transform/db insert)" "$STEP12_ROW_DELTA_PARTIAL"
fi
echo "::endgroup::"

fi # SKIP_PHASE3 종료

# ============================================================
# [Phase 4] 최종 동기화 및 보고
# ============================================================

log "INFO" "============================================================"
log "INFO" "일일 데이터 수집 파이프라인 완료"
log "INFO" "============================================================"

# [PERF] Final Sync (모든 Phase의 남은 변경사항 통합 커밋)
log "INFO" "[Final] 'data' 브랜치에 최종 데이터 저장..."
sync_data_to_remote "Final Sync"

# 코드 에디터 동기화 신호
SYNC_TRIGGER_FILE="$PROJECT_ROOT/backend/.sync_trigger"
echo "$(date)" > "$SYNC_TRIGGER_FILE"
log "INFO" "코드 에디터 동기화용 트리거 파일 생성됨"

# [PERF] 전체 실행 시간 출력
PIPELINE_END=$(date +%s)
TOTAL_DURATION=$((PIPELINE_END - PIPELINE_START))
TOTAL_MIN=$((TOTAL_DURATION / 60))
TOTAL_SEC=$((TOTAL_DURATION % 60))
log "OK" "============================================================"
log "OK" "모든 단계가 완료되었습니다! (총 실행 시간: ${TOTAL_MIN}m ${TOTAL_SEC}s)"
log "OK" "============================================================"

RUN_STATUS="success"
GITHUB_CONCLUSION="success"
ERROR_CODE=""
ERROR_MESSAGE=""

for step_no in {1..12}; do
    step_status="${STEP_STATUS_MAP[$step_no]:-queued}"
    if [[ "$step_status" == "failed" ]]; then
        RUN_STATUS="failed"
        GITHUB_CONCLUSION="failure"
        ERROR_CODE="step_failed"
        ERROR_MESSAGE="canonical step ${step_no} failed: ${STEP_MESSAGE_MAP[$step_no]}"
        break
    fi
    if [[ "$step_status" == "timeout" || "$step_status" == "partial" ]] && [[ "$RUN_STATUS" != "failed" ]]; then
        RUN_STATUS="partial"
        GITHUB_CONCLUSION="neutral"
    fi
done

if [ "$TIMEOUT_TRIGGERED" = "true" ] && [ "$RUN_STATUS" = "success" ]; then
    RUN_STATUS="partial"
    GITHUB_CONCLUSION="neutral"
fi

if [ -n "$FIRST_FAILURE_STEP_NO" ]; then
    log "WARN" "[FailurePoint] canonical_step=${FIRST_FAILURE_STEP_NO} key=${FIRST_FAILURE_STEP_KEY} message=${STEP_MESSAGE_MAP[$FIRST_FAILURE_STEP_NO]}"
fi

emit_signal run-complete \
    --run-id "$WORKFLOW_RUN_ID" \
    --run-status "$RUN_STATUS" \
    --github-status "completed" \
    --github-conclusion "$GITHUB_CONCLUSION" \
    --error-code "$ERROR_CODE" \
    --error-message "$ERROR_MESSAGE" \
    --failure-step-no "$FIRST_FAILURE_STEP_NO" \
    --failure-step-key "$FIRST_FAILURE_STEP_KEY"

# ============================================================
# GitHub Actions Summary 생성
# ============================================================

SUMMARY_MD="$PROJECT_ROOT/summary.md"
echo "## Daily Crawling Report ($DATE)" > "$SUMMARY_MD"
echo "" >> "$SUMMARY_MD"

# [PERF] 실행 시간 요약 (가장 먼저 표시)
echo "### Execution Time" >> "$SUMMARY_MD"
echo "| Metric | Value |" >> "$SUMMARY_MD"
echo "|--------|-------|" >> "$SUMMARY_MD"
echo "| Total Runtime | **${TOTAL_MIN}분 ${TOTAL_SEC}초** |" >> "$SUMMARY_MD"
echo "| New Videos | ${NEW_URL_COUNT:-0} |" >> "$SUMMARY_MD"
echo "| Mode | $([ "${HAS_NEW_DATA}" = "true" ] && echo "Full Pipeline" || echo "Smart (Delta Only)") |" >> "$SUMMARY_MD"
if [ "${SKIP_PHASE3:-false}" = "true" ]; then
    echo "| Note | Phase 3 skipped (timeout) |" >> "$SUMMARY_MD"
fi
echo "| Channel | ${CHANNEL_SLUG} |" >> "$SUMMARY_MD"
echo "| Dispatch UUID | ${DISPATCH_UUID} |" >> "$SUMMARY_MD"
echo "| Run Status | ${RUN_STATUS} |" >> "$SUMMARY_MD"
if [ -n "$FIRST_FAILURE_STEP_NO" ]; then
    echo "| Failure Point | Step ${FIRST_FAILURE_STEP_NO} (${FIRST_FAILURE_STEP_KEY}) |" >> "$SUMMARY_MD"
fi
echo "" >> "$SUMMARY_MD"

echo "### Canonical 12-Step Status" >> "$SUMMARY_MD"
echo "| Canonical Step | Key | Status | Message | Duration(s) |" >> "$SUMMARY_MD"
echo "|---:|---|---|---|---:|" >> "$SUMMARY_MD"
for step_no in {1..12}; do
    echo "| ${step_no} | ${STEP_KEY_MAP[$step_no]} | ${STEP_STATUS_MAP[$step_no]:-queued} | ${STEP_MESSAGE_MAP[$step_no]:-} | ${STEP_DURATION_MAP[$step_no]:-0} |" >> "$SUMMARY_MD"
done
echo "" >> "$SUMMARY_MD"

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
        URL_LINE=$(grep "${CHANNEL_SLUG}: 신규" "$LOG_FILE" | tail -n 1 | strip_ansi)
        URL_CNT=$(echo "$URL_LINE" | sed "s/.*${CHANNEL_SLUG}: //")
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

    # 08. 평가 대상 선정
    if grep -q "대상 비디오:" "$LOG_FILE"; then
        TARGET_CNT=$(grep "대상 비디오:" "$LOG_FILE" | tail -n 1 | strip_ansi | sed 's/.*비디오: //;s/개.*//')
        echo "| Target Selection | $TARGET_CNT | Selected |" >> "$SUMMARY_MD"
    fi

    # 09. 규칙 기반 평가
    if grep -q "Rule 평가 완료!" "$LOG_FILE"; then
        RULE_SUCCESS=$(grep "성공:" "$LOG_FILE" | grep -v "LAAJ" | tail -n 1 | strip_ansi | sed 's/.*: //')
        echo "| Rule Eval | $RULE_SUCCESS | Verified |" >> "$SUMMARY_MD"
    fi

    # 10. LAAJ 평가
    if grep -q "LAAJ 평가 완료" "$LOG_FILE"; then
        LAAJ_SUCCESS=$(grep "성공:" "$LOG_FILE" | grep "LAAJ" -A 5 | tail -n 5 | grep "성공:" | strip_ansi | sed 's/.*: //')
        echo "| LAAJ Eval | $LAAJ_SUCCESS | Verified |" >> "$SUMMARY_MD"
    fi

    # 11. 결과 변환
    if grep -q "변환 완료:" "$LOG_FILE"; then
        TRANS_CNT=$(grep "변환 완료:" "$LOG_FILE" | tail -n 1 | strip_ansi | sed 's/.* 완료: //;s/개.*//')
        echo "| Transform | $TRANS_CNT | Processed |" >> "$SUMMARY_MD"
    fi

    # 12. Supabase 저장
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

if [ -n "$FAILED_DOWNLOADS" ]; then
    echo "### Manual Action Required (Missing Videos)" >> "$SUMMARY_MD"
    echo "> **Note**: 아래 영상들은 구글 드라이브에 없어 수집에 실패했습니다. 로컬에서 받아 드라이브에 올려주세요." >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
    echo "\`\`\`text" >> "$SUMMARY_MD"
    FAILED_LIST_FILE="$PROJECT_ROOT/backend/restaurant-crawling/data/$CHANNEL_SLUG/failed_urls.txt"
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
echo "- **Log File**: \`backend/log/cron/daily_$DATE.log\`" >> "$SUMMARY_MD"
echo "- **Data Branch**: [\`data\`](https://github.com/twoimo/tzudong/tree/data)" >> "$SUMMARY_MD"
echo "" >> "$SUMMARY_MD"

echo "### Pipeline Architecture" >> "$SUMMARY_MD"
echo "\`\`\`" >> "$SUMMARY_MD"
cat <<'EOF' >> "$SUMMARY_MD"
+----------------------------------------------------------------------------------------------------------+
|                                    TZUDONG PIPELINE FLOW (Optimized)                                      |
+----------------------------------------------------------------------------------------------------------+
|                                                                                                          |
|  [Phase 1: Collection]                                                                                   |
|  [Step 1: URLs] → [Step 2: Meta] → [Step 2.1+2.5: Migr+Clean (Parallel)] ══► [Git Sync #1]             |
|                                                                                                          |
|  [Phase 2: Multi-modal]                                                                                  |
|  [Step 3+4: Transcript+Frames (Parallel)] → [Step 3.1: Context] ══► [Git Sync #2]                       |
|                                                                                                          |
|  [Phase 3: AI Analysis]  ── (Timeout Check) ──                                                           |
|  [Step 6.1: Enrich] → [Step 7: Gemini] → [Step 08: Target] → [Step 09: Rule] ══► [Git Sync #3]         |
|  → [Step 10: LAAJ] → [Step 11: Transform] → [Step 12: Supabase]                                         |
|                                                                                                          |
|  [Phase 4: Finalize]                                                                                     |
|  [Final Git Sync] → [Summary Report] ══► Done!                                                           |
+----------------------------------------------------------------------------------------------------------+
EOF
echo "\`\`\`" >> "$SUMMARY_MD"

if [ "$RUN_STATUS" = "failed" ]; then
    exit 1
fi

exit 0
