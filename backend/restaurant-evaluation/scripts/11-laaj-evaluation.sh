#!/bin/bash
# Gemini CLI 기반 LAAJ 음식점 평가 스크립트
# rule_results 데이터를 읽어서 LAAJ 평가 수행
#
# 주요 기능:
# - Cross-Platform 지원 (Linux/macOS/Windows)
# - Node.js API 호출 실패 시 "Sticky Fallback" (이후 모든 요청을 CLI로 처리)
# - 자막 로드 및 프롬프트 구성
# - 에러 처리 및 재시도
#
# 사용법:
#   ./11-laaj-evaluation.sh --channel tzuyang --crawling-path data/tzuyang --evaluation-path data/tzuyang

set -e
set -o pipefail

# ================================
# 환경 설정 및 유틸리티
# ================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# OS 감지
OS_TYPE="$(uname -s)"
case "${OS_TYPE}" in
    Linux*)     OS_NAME=Linux;;
    Darwin*)    OS_NAME=Mac;;
    CYGWIN*|MINGW*|MSYS*) OS_NAME=Windows;;
    *)          OS_NAME="UNKNOWN:${OS_TYPE}";;
esac

# 색상 코드
if [ -t 1 ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    CYAN='\033[0;36m'
    NC='\033[0m'
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    CYAN=''
    NC=''
fi

log_info() { echo -e "${BLUE}[$(date '+%H:%M:%S')] [INFO] $1${NC}"; }
log_success() { echo -e "${GREEN}[$(date '+%H:%M:%S')] [OK] $1${NC}"; }
log_warning() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] [WARN] $1${NC}"; }
log_error() { echo -e "${RED}[$(date '+%H:%M:%S')] [ERROR] $1${NC}" >&2; }
log_debug() { echo -e "${CYAN}[$(date '+%H:%M:%S')] [DEBUG] $1${NC}"; }

format_duration() {
    local seconds=$1
    local hours=$((seconds / 3600))
    local minutes=$(((seconds % 3600) / 60))
    local secs=$((seconds % 60))
    if [ $hours -gt 0 ]; then echo "${hours}h ${minutes}m ${secs}s"
    elif [ $minutes -gt 0 ]; then echo "${minutes}m ${secs}s"
    else echo "${secs}s"
    fi
}

# 경로 정규화 (Windows의 경우 cygpath -m 사용)
normalize_path() {
    if [[ "$OS_NAME" == "Windows" ]] && command -v cygpath > /dev/null 2>&1; then
        cygpath -m "$1"
    elif command -v wslpath > /dev/null 2>&1; then
        wslpath -m "$1"
    else
        echo "$1"
    fi
}

# 도구가 Windows용(.exe)인 경우에만 경로를 정규화하는 유틸리티
maybe_normalize() {
    local tool="$1"
    local path="$2"
    if [[ "$tool" == *".exe"* ]]; then
        normalize_path "$path"
    else
        echo "$path"
    fi
}

ensure_gemini_cli_oauth_settings() {
    [ -f "$HOME/.gemini/oauth_creds.json" ] || return 0
    mkdir -p "$HOME/.gemini"
    "$PYTHON_EXE" - <<'PY'
import json
from pathlib import Path

path = Path.home() / ".gemini" / "settings.json"
try:
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
except json.JSONDecodeError:
    data = {}

security = data.setdefault("security", {})
auth = security.setdefault("auth", {})
auth["selectedType"] = "oauth-personal"
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY
    chmod 600 "$HOME/.gemini/settings.json" || true
}

run_gemini_cli_request() {
    local prompt_file="$1"
    local response_file="$2"
    local stderr_file="$3"
    local timeout_sec="${GEMINI_CLI_TIMEOUT_SEC:-240}"

    if ! [[ "$timeout_sec" =~ ^[0-9]+$ ]] || [ "$timeout_sec" -lt 1 ]; then
        timeout_sec=240
    fi

    # OAuth 폴백 시 API Key 대신 인증 파일을 강제 사용하도록 GEMINI_API_KEY 해제
    local env_cmd=""
    if [ -f "$HOME/.gemini/oauth_creds.json" ]; then
        ensure_gemini_cli_oauth_settings
        env_cmd="env GEMINI_API_KEY="
    fi

    if command -v timeout >/dev/null 2>&1 && [ "$OS_NAME" != "Windows" ]; then
        $env_cmd timeout --foreground "$timeout_sec" gemini --skip-trust --model "$CURRENT_MODEL" --output-format json --yolo < "$prompt_file" > "$response_file" 2>"$stderr_file"
    else
        $env_cmd gemini --skip-trust --model "$CURRENT_MODEL" --output-format json --yolo < "$prompt_file" > "$response_file" 2>"$stderr_file"
    fi
}

run_agy_cli_request() {
    local prompt_file="$1"
    local response_file="$2"
    local stderr_file="$3"
    local timeout_sec="${AGY_BRIDGE_TIMEOUT_SEC:-360}"
    local print_timeout="${AGY_PRINT_TIMEOUT:-5m0s}"

    if ! [[ "$timeout_sec" =~ ^[0-9]+$ ]] || [ "$timeout_sec" -lt 1 ]; then
        timeout_sec=360
    fi

    "$PYTHON_EXE" "$AGY_BRIDGE_SCRIPT" \
        --prompt-file "$prompt_file" \
        --output "$response_file" \
        --stderr-file "$stderr_file" \
        --print-timeout "$print_timeout" \
        --timeout-sec "$timeout_sec"
}

build_json_retry_prompt() {
    local source_prompt="$1"
    local retry_prompt="$2"

    cat "$source_prompt" > "$retry_prompt"
    cat >> "$retry_prompt" <<'EOF'

<JSON_RETRY_INSTRUCTION>
이전 응답은 파서에서 거부되었습니다. 이번 응답은 반드시 아래 조건을 지키세요.
- 설명, 마크다운, 코드펜스, 사과문, 접두사/접미사를 절대 쓰지 마세요.
- 최상위 값은 JSON 객체 하나여야 합니다.
- 반드시 visit_authenticity, rb_inference_score, rb_grounding_TF, review_faithfulness_score, category_TF 키를 모두 포함하세요.
- 각 키의 값은 기존 평가 스키마와 같은 values 배열 구조를 유지하세요.
- 판단 근거가 부족하면 null 또는 보수적인 값으로 채우되 JSON 형식은 깨지지 않아야 합니다.
</JSON_RETRY_INSTRUCTION>
EOF
}

sleep_before_parse_retry() {
    local sleep_sec="${LAAJ_PARSE_RETRY_SLEEP_SEC:-10}"
    if ! [[ "$sleep_sec" =~ ^[0-9]+$ ]]; then
        sleep_sec=10
    fi
    if [ "$sleep_sec" -gt 0 ]; then
        sleep "$sleep_sec"
    fi
}

is_quota_error() {
    local file="$1"
    [ -f "$file" ] && grep -qi -E '429|quota|rate limit|RESOURCE_EXHAUSTED|Too Many Requests|exhausted' "$file"
}

log_cli_error_tail() {
    local label="$1"
    local file="$2"
    if [ -f "$file" ] && [ -s "$file" ]; then
        log_warning "$label stderr/output tail:"
        sed -n '1,80p' "$file" >&2
    fi
}

# ================================
# 명령어 감지
# ================================

# 1. JQ 감지
if command -v jq &> /dev/null; then
    JQ_EXE="jq"
elif [ -f "$PROJECT_ROOT/backend/bin/jq.exe" ]; then
    JQ_EXE="$PROJECT_ROOT/backend/bin/jq.exe"
else
    log_error "jq 명령어를 찾을 수 없습니다."
    exit 1
fi

# 2. Node 감지
if command -v node &> /dev/null; then
    NODE_EXE="node"
elif [ -f "/c/Program Files/nodejs/node.exe" ]; then
    NODE_EXE="/c/Program Files/nodejs/node.exe"
elif [ -f "/mnt/c/Program Files/nodejs/node.exe" ]; then
    NODE_EXE="/mnt/c/Program Files/nodejs/node.exe"
else
    log_warning "node 명령어를 찾을 수 없습니다. (Gemini CLI 모드로만 동작)"
    NODE_EXE=""
fi

# 3. Python 감지
if command -v python.exe &> /dev/null; then
    PYTHON_EXE="python.exe"
elif command -v python &> /dev/null; then
    PYTHON_EXE="python"
elif command -v python3 &> /dev/null; then
    PYTHON_EXE="python3"
else
    log_error "python 또는 python3 명령어를 찾을 수 없습니다."
    exit 1
fi

# jq 래퍼 함수 (Windows 줄바꿈 처리)
jq_wrapper() {
    "$JQ_EXE" "$@" | tr -d '\r'
}

log_debug "OS: $OS_NAME"
log_debug "JQ: $JQ_EXE"
log_debug "NODE: ${NODE_EXE:-N/A}"
log_debug "PYTHON: $PYTHON_EXE"

# ================================
# 설정 로드
# ================================
PROMPT_FILE="$SCRIPT_DIR/../prompts/evaluation_prompt.txt"
PARSER_SCRIPT="$SCRIPT_DIR/parse_laaj_evaluation.py"
AGY_BRIDGE_SCRIPT="$PROJECT_ROOT/backend/bin/run_agy_prompt.py"

ENV_FILES=(
    "$PROJECT_ROOT/.env"
    "$PROJECT_ROOT/../.env"
)

if [ "${TZUDONG_PIPELINE_ISOLATED:-0}" != "1" ]; then
    for env_file in "${ENV_FILES[@]}"; do
        if [ -f "$env_file" ]; then
            set -a
            source "$env_file"
            set +a
            break
        fi
    done
fi

# API Key 정리 (Windows 호환성)
if [ -n "$GEMINI_API_KEY" ]; then
    GEMINI_API_KEY=$(echo "$GEMINI_API_KEY" | tr -d '\r')
    export GEMINI_API_KEY
fi

# ========================================================
# WSL 환경 특화: Windows의 OAuth 인증 파일 자동 연동
# ========================================================
if [ "${TZUDONG_PIPELINE_ISOLATED:-0}" != "1" ] && grep -qi "microsoft\|wsl" /proc/version 2>/dev/null; then
    if [ ! -f "$HOME/.gemini/oauth_creds.json" ]; then
        # cmd.exe를 통해 Windows의 USERPROFILE 환경변수 추출
        WIN_USER_PROFILE=$(cmd.exe /c "echo %USERPROFILE%" 2>/dev/null | tr -d '\r\n' || true)
        if [ -n "$WIN_USER_PROFILE" ] && [ "$WIN_USER_PROFILE" != "%USERPROFILE%" ]; then
            # WSL 경로로 변환 (wslpath가 없으면 수동 변환)
            if command -v wslpath >/dev/null 2>&1; then
                WSL_WIN_PROFILE=$(wslpath -u "$WIN_USER_PROFILE")
            else
                WSL_WIN_PROFILE="/mnt/c/${WIN_USER_PROFILE#C:\\}"
                WSL_WIN_PROFILE=$(echo "$WSL_WIN_PROFILE" | tr '\\' '/')
            fi
            
            WIN_OAUTH_FILE="$WSL_WIN_PROFILE/.gemini/oauth_creds.json"
            if [ -f "$WIN_OAUTH_FILE" ]; then
                echo "[INFO] WSL 환경 감지: Windows의 OAuth 인증 파일을 동기화합니다."
                mkdir -p "$HOME/.gemini" || true
                if [ -d "$HOME/.gemini/oauth_creds.json" ]; then
                    rm -rf "$HOME/.gemini/oauth_creds.json" || true
                fi
                cp "$WIN_OAUTH_FILE" "$HOME/.gemini/oauth_creds.json" || true
                ensure_gemini_cli_oauth_settings || true
            fi
        fi
    fi
fi

# OAuth CLI 확인 (LAAJ 평가는 텍스트 전용이므로 CLI/OAuth 가능)
HAS_AGY_CLI=false
AGY_MODEL_LABEL="unavailable"
if [ -f "$AGY_BRIDGE_SCRIPT" ] && "$PYTHON_EXE" "$AGY_BRIDGE_SCRIPT" --locate-only >/dev/null 2>&1; then
    HAS_AGY_CLI=true
    AGY_MODEL_LABEL=$("$PYTHON_EXE" "$AGY_BRIDGE_SCRIPT" --print-config-model 2>/dev/null || echo "Antigravity default model")
else
    log_warning "Antigravity CLI(agy) 미설치/미감지 - Gemini CLI OAuth fallback만 사용합니다."
fi

FORCE_CLI_FALLBACK=false

if [ -z "$GEMINI_API_KEY" ]; then
    if [ -n "$GEMINI_API_KEY_BYEON" ]; then
        export GEMINI_API_KEY="$GEMINI_API_KEY_BYEON"
        log_success "GEMINI_API_KEY 설정 완료 (from GEMINI_API_KEY_BYEON)"
    elif [ "$HAS_AGY_CLI" = true ]; then
        log_warning "GEMINI_API_KEY 없음. OAuth 모드(Antigravity CLI 우선)로 강제 전환합니다."
        FORCE_CLI_FALLBACK=true
    elif [ -f "$HOME/.gemini/oauth_creds.json" ]; then
        log_warning "GEMINI_API_KEY 없음. OAuth 모드(Gemini CLI)로 강제 전환합니다."
        FORCE_CLI_FALLBACK=true
    elif [ -n "$GEMINI_CREDENTIALS_BASE64" ]; then
        log_info "GEMINI_CREDENTIALS_BASE64 감지됨 - 인증 파일 생성 중..."
        mkdir -p "$HOME/.gemini"
        echo "$GEMINI_CREDENTIALS_BASE64" | base64 -d > "$HOME/.gemini/oauth_creds.json"
        if [ -n "${GEMINI_CREDENTIALS_BASE64_2:-}" ]; then
            echo "$GEMINI_CREDENTIALS_BASE64_2" | base64 -d > "$HOME/.gemini/oauth_creds_2.json"
        fi
        ensure_gemini_cli_oauth_settings
        FORCE_CLI_FALLBACK=true
    else
        log_error "GEMINI_API_KEY 또는 OAuth CLI 자격 증명이 없습니다."
        if [ "${TZUDONG_PIPELINE_LIVE:-0}" = "1" ]; then
            log_warning "live bounded: no Gemini credentials; cap new LAAJ to 0"
            LIVE_MAX_NEW_ITEMS=0
        else
            exit 1
        fi
    fi
fi

if [ -n "$USE_OAUTH" ] && [ "$USE_OAUTH" = "true" ]; then
    FORCE_CLI_FALLBACK=true
fi

# Gemini API 키 및 모델 설정
export GEMINI_API_KEY="${GEMINI_API_KEY:-$GEMINI_API_KEY_BYEON}"
export PRIMARY_MODEL="${PRIMARY_MODEL:-gemini-3.7-flash}"
export FALLBACK_MODEL="${LAAJ_FALLBACK_MODEL:-gemini-3.7-flash}"
export CURRENT_MODEL="$PRIMARY_MODEL"
export GEMINI_THINKING_LEVEL="${GEMINI_THINKING_LEVEL:-LOW}"
export LAAJ_THINKING_LEVEL="${LAAJ_THINKING_LEVEL:-MEDIUM}"
export TZ="Asia/Seoul"

# ================================
# 인자 파싱 (Argument Parsing)
# ================================
CHANNEL=""
CRAWLING_PATH=""
EVALUATION_PATH=""
VIDEO_ID_FILTER=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --channel|-c) CHANNEL="$2"; shift 2 ;;
        --crawling-path) CRAWLING_PATH="$2"; shift 2 ;;
        --evaluation-path) EVALUATION_PATH="$2"; shift 2 ;;
        --video-id) VIDEO_ID_FILTER="$2"; shift 2 ;;
        *) echo "알 수 없는 옵션: $1"; exit 1 ;;
    esac
done

if [ -z "$CHANNEL" ] || [ -z "$CRAWLING_PATH" ] || [ -z "$EVALUATION_PATH" ]; then
    echo "사용법: $0 --channel <채널명> --crawling-path <크롤링경로> --evaluation-path <평가경로> [--video-id <id>]"
    exit 1
fi

if [[ "$CRAWLING_PATH" = /* ]]; then
    FULL_CRAWLING_PATH="$CRAWLING_PATH"
else
    FULL_CRAWLING_PATH="$PROJECT_ROOT/$CRAWLING_PATH"
fi
if [[ "$EVALUATION_PATH" = /* ]]; then
    FULL_EVALUATION_PATH="$EVALUATION_PATH"
else
    FULL_EVALUATION_PATH="$PROJECT_ROOT/$EVALUATION_PATH"
fi

RULE_RESULTS_DIR="$FULL_EVALUATION_PATH/evaluation/rule_results"
LAAJ_RESULTS_DIR="$FULL_EVALUATION_PATH/evaluation/laaj_results"
ERRORS_DIR="$FULL_EVALUATION_PATH/evaluation/errors"
TRANSCRIPT_DIR="$FULL_CRAWLING_PATH/transcript"
META_DIR="$FULL_CRAWLING_PATH/meta"
TEMP_DIR="$SCRIPT_DIR/../temp"

mkdir -p "$LAAJ_RESULTS_DIR" "$ERRORS_DIR" "$TEMP_DIR"

log_info "============================================================"
log_info "  LAAJ 음식점 평가 시작 (Cross-Platform)"
log_info "============================================================"
log_info "채널: $CHANNEL"
log_info "모드: $(if [ "$FORCE_CLI_FALLBACK" = true ]; then echo "OAuth CLI first"; else echo "Node.js API + Sticky OAuth Fallback"; fi)"
log_info "모델: Node/Gemini CLI=$CURRENT_MODEL (fallback: $FALLBACK_MODEL), thinkingLevel=$LAAJ_THINKING_LEVEL, agy=${AGY_MODEL_LABEL}"

# 필수 파일 확인
if [ ! -f "$PROMPT_FILE" ]; then
    log_error "프롬프트 파일 없음: $PROMPT_FILE"
    exit 1
fi
if [ ! -d "$RULE_RESULTS_DIR" ]; then
    log_error "rule_results 폴더 없음: $RULE_RESULTS_DIR"
    exit 1
fi

# Gemini CLI 확인 (Antigravity quota 소진 시 Fallback용)
HAS_GEMINI_CLI=false
if command -v gemini > /dev/null 2>&1; then
    HAS_GEMINI_CLI=true
else
    log_warning "Gemini CLI 미설치 - Antigravity CLI 또는 Node.js API 모드로 진행합니다."
    if [ "$HAS_AGY_CLI" = false ] && { [ -z "$NODE_EXE" ] || [ ! -f "$SCRIPT_DIR/gemini_api_request.mjs" ]; }; then
        log_error "Antigravity CLI/Gemini CLI/Node.js API(gemini_api_request.mjs)가 모두 없습니다. 평가 불가."
        exit 1
    fi
fi

GEMINI_API_SCRIPT="$SCRIPT_DIR/gemini_api_request.mjs"

PROMPT_TEMPLATE=$(cat "$PROMPT_FILE")

# ================================
# Gemini Health Check (Pre-flight)
# ================================
log_info "Gemini Health Check (1+1=?) 수행 중..."
HEALTH_CHECK_PROMPT="$TEMP_DIR/health_check_prompt.txt"
HEALTH_CHECK_RESPONSE="$TEMP_DIR/health_check_response.json"
echo "1+1=?" > "$HEALTH_CHECK_PROMPT"

HEALTH_CHECK_PASSED=false

# 1. Node.js Check
if [ "$FORCE_CLI_FALLBACK" = false ] && [ -n "$NODE_EXE" ]; then
    WIN_SCRIPT=$(maybe_normalize "$NODE_EXE" "$GEMINI_API_SCRIPT")
    WIN_PROMPT=$(maybe_normalize "$NODE_EXE" "$HEALTH_CHECK_PROMPT")
    WIN_RESPONSE=$(maybe_normalize "$NODE_EXE" "$HEALTH_CHECK_RESPONSE")
    
    set +e
    "$NODE_EXE" "$WIN_SCRIPT" "$WIN_PROMPT" "$WIN_RESPONSE" > /dev/null 2>&1
    EXIT_CODE=$?
    set -e
    
    if [ $EXIT_CODE -eq 0 ]; then
        HEALTH_CHECK_PASSED=true
        log_success "Health Check 성공 (Node.js API)"
    elif [ $EXIT_CODE -eq 42 ]; then
        log_warning "Node.js API 할당량 초과(Quota Error) 감지 -> Sticky Fallback (Gemini CLI) 활성화"
        FORCE_CLI_FALLBACK=true
    else
        log_warning "Health Check 실패 (Node.js API) -> Sticky Fallback (Gemini CLI) 활성화"
        FORCE_CLI_FALLBACK=true
    fi
fi

# 2. Antigravity CLI Check (OAuth primary fallback)
if [ "$HEALTH_CHECK_PASSED" = false ] && [ "$HAS_AGY_CLI" = true ]; then
    health_check_err="$TEMP_DIR/health_check_err.log"
    set +e
    run_agy_cli_request "$HEALTH_CHECK_PROMPT" "$HEALTH_CHECK_RESPONSE" "$health_check_err"
    EXIT_CODE=$?
    set -e
    if [ $EXIT_CODE -eq 0 ]; then
        HEALTH_CHECK_PASSED=true
        log_success "Health Check 성공 (Antigravity CLI, model=${AGY_MODEL_LABEL})"
        rm -f "$health_check_err"
    else
        log_warning "Antigravity CLI Health Check 실패 (exit: $EXIT_CODE)"
        [ -f "$health_check_err" ] && cat "$health_check_err" >&2
        rm -f "$health_check_err"
    fi
fi

# 3. Gemini CLI Check (Agy quota/auth failure fallback)
if [ "$HEALTH_CHECK_PASSED" = false ]; then
    if [ "$HAS_GEMINI_CLI" = true ]; then
        for candidate_model in "$CURRENT_MODEL" "$FALLBACK_MODEL"; do
            [ -n "$candidate_model" ] || continue
            if [ "$candidate_model" != "$CURRENT_MODEL" ] && [ "$candidate_model" = "$PRIMARY_MODEL" ]; then
                continue
            fi
            if [ "$candidate_model" != "$CURRENT_MODEL" ]; then
                log_warning "Gemini CLI Health Check를 fallback 모델($candidate_model)로 재시도합니다."
            fi
            
            env_cmd=""
            if [ -f "$HOME/.gemini/oauth_creds.json" ]; then
                env_cmd="env GEMINI_API_KEY="
            fi
            
            health_check_err="$TEMP_DIR/health_check_err.log"
            set +e
            if command -v timeout >/dev/null 2>&1 && [ "$OS_NAME" != "Windows" ]; then
                $env_cmd timeout --foreground "${GEMINI_CLI_TIMEOUT_SEC:-240}" gemini --skip-trust -p "1+1=?" --model "$candidate_model" --output-format json < /dev/null > "$HEALTH_CHECK_RESPONSE" 2>"$health_check_err"
            else
                $env_cmd gemini --skip-trust -p "1+1=?" --model "$candidate_model" --output-format json < /dev/null > "$HEALTH_CHECK_RESPONSE" 2>"$health_check_err"
            fi
            EXIT_CODE=$?
            set -e
            if [ $EXIT_CODE -eq 0 ]; then
                CURRENT_MODEL="$candidate_model"
                HEALTH_CHECK_PASSED=true
                log_success "Health Check 성공 (Gemini CLI, model=$candidate_model)"
                rm -f "$health_check_err"
                break
            else
                log_error "Gemini CLI Error for $candidate_model (exit: $EXIT_CODE):"
                cat "$health_check_err"
                rm -f "$health_check_err"
            fi
        done

        if [ "$HEALTH_CHECK_PASSED" = false ]; then
            log_warning "Health Check 실패 (Gemini CLI)"
            log_warning "Antigravity/Gemini API/CLI가 모두 응답하지 않습니다. 네트워크나 OAuth/API Key(할당량)를 확인하세요. 평가를 건너뜁니다."
            exit 0
        fi
    else
        log_warning "Node.js API Health Check 실패 & Gemini CLI 미설치. Node API로 평가를 계속합니다."
        FORCE_CLI_FALLBACK=false
        HEALTH_CHECK_PASSED=true
    fi
fi

rm -f "$HEALTH_CHECK_PROMPT" "$HEALTH_CHECK_RESPONSE"

# ================================
# 처리할 video_id 수집
# ================================
mapfile -t VIDEO_IDS < <(
    find "$RULE_RESULTS_DIR" -maxdepth 1 -type f -name "*.jsonl" -exec basename {} \; \
        | sed 's/\.jsonl$//' \
        | sort
)
if [ -n "$VIDEO_ID_FILTER" ]; then
    VIDEO_IDS=("$VIDEO_ID_FILTER")
    log_info "video-id filter: $VIDEO_ID_FILTER"
fi

TOTAL=${#VIDEO_IDS[@]}
log_info "총 대상 파일: $TOTAL 개"

PROCESSED=0
SUCCESS=0
FAILED=0
SKIPPED_EXISTS=0
SKIPPED_NO_TARGET=0
SKIPPED_NO_TRANSCRIPT=0
GEMINI_CALLS=0
TOTAL_GEMINI_TIME=0



# ================================
# 메인 루프 (Main Loop)
# ================================
for i in "${!VIDEO_IDS[@]}"; do
    VIDEO_ID="${VIDEO_IDS[$i]}"
    INDEX=$((i + 1))
    
    RULE_FILE="$RULE_RESULTS_DIR/${VIDEO_ID}.jsonl"
    OUTPUT_FILE="$LAAJ_RESULTS_DIR/${VIDEO_ID}.jsonl"
    ERROR_FILE="$ERRORS_DIR/${VIDEO_ID}.jsonl"
    TRANSCRIPT_FILE="$TRANSCRIPT_DIR/${VIDEO_ID}.jsonl"
    
    # 이미 처리된 파일 스킵
    if [ -f "$OUTPUT_FILE" ]; then
        SKIPPED_EXISTS=$((SKIPPED_EXISTS + 1))
        if [ $((SKIPPED_EXISTS % 50)) -eq 1 ]; then
            log_warning "[$INDEX/$TOTAL] 이미 처리됨 (누적 스킵 ${SKIPPED_EXISTS}개)"
        fi
        continue
    fi

    if [ "${TZUDONG_PIPELINE_LIVE:-0}" = "1" ]; then
        max_new="${LIVE_MAX_NEW_ITEMS:-1}"
        if [ "${GEMINI_CALLS:-0}" -ge "$max_new" ]; then
            SKIPPED_NO_TARGET=$((SKIPPED_NO_TARGET + 1))
            log_info "[$INDEX/$TOTAL] SKIP: live_bounded ($VIDEO_ID)"
            continue
        fi
    fi
    
    # 재시도 로직
    if [ -f "$ERROR_FILE" ]; then
        rm "$ERROR_FILE"
        log_info "[$INDEX/$TOTAL] 재시도: $VIDEO_ID"
    fi
    
    # ---------------------------
    # 데이터 로드 및 전처리
    # ---------------------------
    RULE_DATA=$(tail -n 1 "$RULE_FILE")
    YOUTUBE_LINK=$(echo "$RULE_DATA" | jq_wrapper -r '.youtube_link')
    EVALUATION_TARGET=$(echo "$RULE_DATA" | jq_wrapper -c '.evaluation_target // {}')
    RECOLLECT_VERSION=$(echo "$RULE_DATA" | jq_wrapper -c '.recollect_version // {}')
    TARGET_META_ID=$(echo "$RECOLLECT_VERSION" | jq_wrapper -r '.meta // 0')
    
    # Meta 조회
    META_FILE="$META_DIR/${VIDEO_ID}.jsonl"
    VIDEO_TITLE=""
    if [ -f "$META_FILE" ]; then
        # jq 필터링으로 최적화
        VIDEO_TITLE=$(jq_wrapper -r --arg id "$TARGET_META_ID" \
            'select((.recollect_id // 0 | tostring) == ($id | tostring)) | .title // ""' "$META_FILE" | head -n 1)
        
        # 못 찾으면 마지막 라인 fallback
        if [ -z "$VIDEO_TITLE" ]; then
            VIDEO_TITLE=$(tail -n 1 "$META_FILE" | jq_wrapper -r '.title // ""')
        fi
    fi
    
    # 평가 대상 확인
    HAS_TRUE_TARGET=$(echo "$EVALUATION_TARGET" | jq_wrapper 'to_entries | map(select(.value == true)) | length')
    if [ "$HAS_TRUE_TARGET" -eq 0 ]; then
        cp "$RULE_FILE" "$OUTPUT_FILE"
        SKIPPED_NO_TARGET=$((SKIPPED_NO_TARGET + 1))
        continue
    fi
    
    # 평가 대상만 추출
    RESTAURANTS_TO_EVALUATE=$(echo "$RULE_DATA" | jq_wrapper -c '
        .restaurants as $rests |
        .evaluation_target as $targets |
        .evaluation_results.location_match_TF as $loc_evals |
        $rests | map(
            .origin_name as $origin_name |
            select(($origin_name | type) == "string" and ($origin_name | length) > 0 and ($targets[$origin_name] == true)) |
            . as $r |
            ($loc_evals | map(select(.origin_name == $origin_name)) | first // null) as $loc |
            del(.origin_name) |
            . + {name: (if $loc and $loc.naver_name then $loc.naver_name elif $loc and $loc.google_name then $loc.google_name else $origin_name end)}
        )
    ')
    
    RESTAURANT_COUNT=$(echo "$RESTAURANTS_TO_EVALUATE" | jq_wrapper 'length')
    if [ "$RESTAURANT_COUNT" -eq 0 ]; then
        cp "$RULE_FILE" "$OUTPUT_FILE"
        SKIPPED_NO_TARGET=$((SKIPPED_NO_TARGET + 1))
        continue
    fi
    
    # 자막 로드
    TRANSCRIPT=""
    TRANSCRIPT_LANGUAGE="unknown"
    if [ -f "$TRANSCRIPT_FILE" ]; then
        TRANSCRIPT_DATA=$(tail -n 1 "$TRANSCRIPT_FILE")
        TRANSCRIPT_LANGUAGE=$(echo "$TRANSCRIPT_DATA" | jq_wrapper -r '.language // "ko"')
        TRANSCRIPT=$(echo "$TRANSCRIPT_DATA" | jq_wrapper -r '
            .transcript // [] | 
            map("[" + ((.start / 60 | floor | tostring | if length < 2 then "0" + . else . end)) + ":" + ((.start % 60 | floor | tostring | if length < 2 then "0" + . else . end)) + "] " + .text) | 
            join("\n")
        ' 2>/dev/null)
    fi
    
    if [ -z "$TRANSCRIPT" ] || [ "$TRANSCRIPT" = "null" ]; then
        cp "$RULE_FILE" "$OUTPUT_FILE"
        SKIPPED_NO_TRANSCRIPT=$((SKIPPED_NO_TRANSCRIPT + 1))
        log_warning "[$INDEX/$TOTAL] 자막 없음 - 스킵: $VIDEO_ID"
        continue
    fi
    
    log_info "[$INDEX/$TOTAL] 평가 진행: $VIDEO_ID (${RESTAURANT_COUNT}개 음식점)"
    
    # ---------------------------
    # 프롬프트 생성
    # ---------------------------
    EVALUATION_DATA=$(jq_wrapper -n \
        --arg yl "$YOUTUBE_LINK" \
        --argjson rest "$RESTAURANTS_TO_EVALUATE" \
        '{youtube_link: $yl, restaurants: $rest}')
    
    PROMPT="${PROMPT_TEMPLATE//\{restaurant_data\}/$EVALUATION_DATA}"
    PROMPT="$PROMPT

<영상 정보>
영상 제목: $VIDEO_TITLE
유튜브 링크: $YOUTUBE_LINK
</영상 정보>

<참고: YouTube 자막>
아래는 해당 영상의 자막입니다.
[자막 언어: $TRANSCRIPT_LANGUAGE]
---
$TRANSCRIPT
---
</참고: YouTube 자막>"
    
    TEMP_PROMPT="$TEMP_DIR/eval_prompt_${VIDEO_ID}.txt"
    TEMP_RESPONSE="$TEMP_DIR/eval_response_${VIDEO_ID}.json"
    TEMP_STDERR="$TEMP_DIR/eval_stderr_${VIDEO_ID}.log"
    echo "$PROMPT" > "$TEMP_PROMPT"
    
    # ---------------------------
    # Gemini API 호출 (Node.js -> CLI Fallback)
    # ---------------------------
    GEMINI_START=$(date +%s)
    GEMINI_SUCCESS=false
    LAST_SUCCESS_PROVIDER=""

    # 1. Node.js API 시도 (Sticky Fallback이 아닐 때만)
    if [ "$FORCE_CLI_FALLBACK" = false ] && [ -n "$NODE_EXE" ]; then
        log_debug "Node.js API 호출 시도..."

        WIN_SCRIPT=$(maybe_normalize "$NODE_EXE" "$GEMINI_API_SCRIPT")
        WIN_PROMPT=$(maybe_normalize "$NODE_EXE" "$TEMP_PROMPT")
        WIN_RESPONSE=$(maybe_normalize "$NODE_EXE" "$TEMP_RESPONSE")

        set +e
        "$NODE_EXE" "$WIN_SCRIPT" "$WIN_PROMPT" "$WIN_RESPONSE"
        EXIT_CODE=$?
        set -e

        if [ $EXIT_CODE -eq 0 ]; then
            GEMINI_SUCCESS=true
            LAST_SUCCESS_PROVIDER="node"
            log_debug "Node.js 호출 성공"
        else
            log_warning "Node.js 호출 실패 (Code: $EXIT_CODE) - Sticky Fallback 활성화 (이후 CLI 사용)"
            FORCE_CLI_FALLBACK=true
        fi
    fi

    # 2. Antigravity CLI 시도 (Node 실패 또는 Sticky 모드일 때)
    if [ "$GEMINI_SUCCESS" = false ] && [ "$HAS_AGY_CLI" = true ]; then
        log_debug "Antigravity CLI 호출 (모델: ${AGY_MODEL_LABEL})"

        if run_agy_cli_request "$TEMP_PROMPT" "$TEMP_RESPONSE" "$TEMP_STDERR"; then
            GEMINI_SUCCESS=true
            LAST_SUCCESS_PROVIDER="agy"
        else
            log_warning "Antigravity CLI 호출 실패 - Gemini CLI OAuth fallback 확인"
            if [ -f "$TEMP_STDERR" ] && [ -s "$TEMP_STDERR" ]; then
                cat "$TEMP_STDERR" >&2
            fi
            if is_quota_error "$TEMP_STDERR" || is_quota_error "$TEMP_RESPONSE"; then
                log_warning "Antigravity CLI 할당량 소진 감지 -> Gemini CLI OAuth($CURRENT_MODEL)로 전환"
            fi
        fi
    fi

    # 3. Gemini CLI 시도 (Agy 실패/쿼타 소진 또는 Sticky 모드일 때)
    if [ "$GEMINI_SUCCESS" = false ] && [ "$HAS_GEMINI_CLI" = true ]; then
        log_debug "Gemini CLI 호출 (모델: $CURRENT_MODEL)"

        if run_gemini_cli_request "$TEMP_PROMPT" "$TEMP_RESPONSE" "$TEMP_STDERR"; then
            GEMINI_SUCCESS=true
            LAST_SUCCESS_PROVIDER="gemini-cli"
        else
            # Error logging
            log_error "Gemini CLI Error Output:"
            if [ -f "$TEMP_STDERR" ] && [ -s "$TEMP_STDERR" ]; then
                cat "$TEMP_STDERR"
            fi

            # Rate Limit 체크
            ERROR_REPORT=$(ls -t /tmp/gemini-client-error-*.json 2>/dev/null | head -1)
            if { [ -f "$ERROR_REPORT" ] && grep -q "exhausted\|429" "$ERROR_REPORT" 2>/dev/null; } || is_quota_error "$TEMP_STDERR"; then
               if [ "$CURRENT_MODEL" = "$PRIMARY_MODEL" ]; then
                   log_warning "할당량 소진 -> Fallback 모델($FALLBACK_MODEL) 전환"
                   CURRENT_MODEL="$FALLBACK_MODEL"
                   sleep 10
                   if run_gemini_cli_request "$TEMP_PROMPT" "$TEMP_RESPONSE" "$TEMP_STDERR"; then
                       GEMINI_SUCCESS=true
                       LAST_SUCCESS_PROVIDER="gemini-cli"
                   fi
               fi
            elif grep -qi 'timed out\|SIGTERM\|signal 15' "$TEMP_STDERR" 2>/dev/null; then
               log_warning "Gemini CLI 타임아웃 감지 -> 다음 비디오로 진행합니다."
            fi
        fi
    fi

    GEMINI_END=$(date +%s)
    GEMINI_DURATION=$((GEMINI_END - GEMINI_START))
    TOTAL_GEMINI_TIME=$((TOTAL_GEMINI_TIME + GEMINI_DURATION))
    GEMINI_CALLS=$((GEMINI_CALLS + 1))    
    # ---------------------------
    # 결과 파싱
    # ---------------------------
    if [ "$GEMINI_SUCCESS" = true ]; then
        PARSE_SUCCESS=false
        for PARSE_ATTEMPT in 1 2 3; do
            win_parser=$(maybe_normalize "$PYTHON_EXE" "$PARSER_SCRIPT")
            win_eval_path=$(maybe_normalize "$PYTHON_EXE" "$EVALUATION_PATH")
            win_temp_response=$(maybe_normalize "$PYTHON_EXE" "$TEMP_RESPONSE")
            win_rule_file=$(maybe_normalize "$PYTHON_EXE" "$RULE_FILE")
            if "$PYTHON_EXE" "$win_parser" \
                --channel "$CHANNEL" \
                --evaluation-path "$win_eval_path" \
                --video-id="$VIDEO_ID" \
                --response-file "$win_temp_response" \
                --rule-file "$win_rule_file"; then
                
                SUCCESS=$((SUCCESS + 1))
                PARSE_SUCCESS=true
                log_success "완료 [$INDEX/$TOTAL] - ${GEMINI_DURATION}s"
                break
            else
                # 파싱 실패 시 JSON 전용 프롬프트로 같은 provider를 먼저 재요청하고,
                # agy 응답이 계속 파싱 불가하면 Gemini CLI OAuth로 명시적으로 전환한다.
                if [ $PARSE_ATTEMPT -lt 3 ]; then
                    log_warning "파싱 실패 (${PARSE_ATTEMPT}/3, provider=${LAST_SUCCESS_PROVIDER:-unknown}) - JSON 전용 재요청..."
                    sleep_before_parse_retry
                    RETRY_PROMPT="$TEMP_DIR/eval_prompt_${VIDEO_ID}_json_retry_${PARSE_ATTEMPT}.txt"
                    build_json_retry_prompt "$TEMP_PROMPT" "$RETRY_PROMPT"

                    RETRY_REQUESTED=false
                    if [ "$LAST_SUCCESS_PROVIDER" = "agy" ] && [ "$HAS_AGY_CLI" = true ] && [ "$PARSE_ATTEMPT" -eq 1 ]; then
                        log_warning "Antigravity CLI JSON 전용 재요청 (모델: ${AGY_MODEL_LABEL})"
                        if run_agy_cli_request "$RETRY_PROMPT" "$TEMP_RESPONSE" "$TEMP_STDERR"; then
                            RETRY_REQUESTED=true
                            LAST_SUCCESS_PROVIDER="agy"
                        else
                            log_warning "Antigravity CLI JSON 재요청 실패 - Gemini CLI OAuth fallback 확인"
                            if is_quota_error "$TEMP_STDERR" || is_quota_error "$TEMP_RESPONSE"; then
                                log_warning "Antigravity CLI 할당량 소진 감지 -> Gemini CLI OAuth($CURRENT_MODEL)로 전환"
                            fi
                        fi
                    elif [ "$LAST_SUCCESS_PROVIDER" = "agy" ] && [ "$HAS_GEMINI_CLI" = true ]; then
                        log_warning "Antigravity CLI JSON 재요청도 파싱 실패 -> Gemini CLI OAuth로 전환"
                    fi

                    if [ "$RETRY_REQUESTED" = false ] && [ "$HAS_GEMINI_CLI" = true ]; then
                        log_warning "Gemini CLI JSON 전용 재요청 (모델: $CURRENT_MODEL)"
                        if run_gemini_cli_request "$RETRY_PROMPT" "$TEMP_RESPONSE" "$TEMP_STDERR"; then
                            LAST_SUCCESS_PROVIDER="gemini-cli"
                        elif is_quota_error "$TEMP_STDERR" || is_quota_error "$TEMP_RESPONSE"; then
                            log_warning "Gemini CLI 할당량/레이트리밋 감지 - 다음 파싱 시도 전 응답 유지"
                            log_cli_error_tail "Gemini CLI JSON 재요청 실패" "$TEMP_STDERR"
                        else
                            log_cli_error_tail "Gemini CLI JSON 재요청 실패" "$TEMP_STDERR"
                        fi
                    elif [ "$RETRY_REQUESTED" = false ] && [ -n "$NODE_EXE" ]; then
                        log_warning "Node.js API JSON 전용 재요청"
                        if "$NODE_EXE" "$(maybe_normalize "$NODE_EXE" "$GEMINI_API_SCRIPT")" "$(maybe_normalize "$NODE_EXE" "$RETRY_PROMPT")" "$(maybe_normalize "$NODE_EXE" "$TEMP_RESPONSE")" 2>"$TEMP_STDERR"; then
                            LAST_SUCCESS_PROVIDER="node"
                        fi
                    fi
                fi
            fi
        done
        
        if [ "$PARSE_SUCCESS" = false ]; then
            FAILED=$((FAILED + 1))
            log_error "최종 파싱 실패: $VIDEO_ID"
            # 에러 파일 기록 로직은 복잡도를 줄이기 위해 생략하거나 필요 시 추가
            jq_wrapper -n \
                --arg yl "$YOUTUBE_LINK" \
                --arg vid "$VIDEO_ID" \
                --arg err "파싱 실패 (3회)" \
                --argjson rv "$RECOLLECT_VERSION" \
                '{youtube_link: $yl, video_id: $vid, error: $err, recollect_version: $rv}' > "$ERROR_FILE"
        fi
    else
        FAILED=$((FAILED + 1))
        log_error "API/CLI 호출 모두 실패: $VIDEO_ID"
        jq_wrapper -n \
            --arg yl "$YOUTUBE_LINK" \
            --arg vid "$VIDEO_ID" \
            --arg err "Gemini 호출 실패" \
            --argjson rv "$RECOLLECT_VERSION" \
            '{youtube_link: $yl, video_id: $vid, error: $err, recollect_version: $rv}' > "$ERROR_FILE"
    fi
    
    PROCESSED=$((PROCESSED + 1))
    rm -f "$TEMP_RESPONSE" "$TEMP_PROMPT" "$TEMP_STDERR"
    sleep 2 # Rate Limit
done

log_info "============================================================"
log_info "LAAJ 평가 완료: $CHANNEL"
log_info "성공: $SUCCESS / 실패: $FAILED / 스킵: $SKIPPED_EXISTS"
log_info "Gemini 호출: $GEMINI_CALLS회 ($(format_duration $TOTAL_GEMINI_TIME))"
log_info "============================================================"
