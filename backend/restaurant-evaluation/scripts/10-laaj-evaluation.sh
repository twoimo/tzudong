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
#   ./10-laaj-evaluation.sh --channel tzuyang --crawling-path data/tzuyang --evaluation-path data/tzuyang

set -e

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

log_info() { echo -e "${BLUE}[$(date '+%H:%M:%S')] ℹ️  $1${NC}"; }
log_success() { echo -e "${GREEN}[$(date '+%H:%M:%S')] ✅ $1${NC}"; }
log_warning() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠️  $1${NC}"; }
log_error() { echo -e "${RED}[$(date '+%H:%M:%S')] ❌ $1${NC}" >&2; }
log_debug() { echo -e "${CYAN}[$(date '+%H:%M:%S')] 🔍 $1${NC}"; }

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
    else
        echo "$1"
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
if command -v python &> /dev/null; then
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

ENV_FILES=(
    "$PROJECT_ROOT/.env"
    "$PROJECT_ROOT/../.env"
)

for env_file in "${ENV_FILES[@]}"; do
    if [ -f "$env_file" ]; then
        set -a
        source "$env_file"
        set +a
        break
    fi
done

# API Key 정리 (Windows 호환성)
if [ -n "$GEMINI_API_KEY" ]; then
    GEMINI_API_KEY=$(echo "$GEMINI_API_KEY" | tr -d '\r')
    export GEMINI_API_KEY
fi

# OAuth 설정 체크
FORCE_CLI_FALLBACK=false

if [ -z "$GEMINI_API_KEY" ]; then
    if [ -n "$GEMINI_API_KEY_BYEON" ]; then
        export GEMINI_API_KEY="$GEMINI_API_KEY_BYEON"
        log_success "GEMINI_API_KEY 설정 완료 (from GEMINI_API_KEY_BYEON)"
    elif [ -f "$HOME/.gemini/oauth_creds.json" ]; then
        log_warning "GEMINI_API_KEY 없음. OAuth 모드(CLI)로 강제 전환합니다."
        FORCE_CLI_FALLBACK=true
    elif [ -n "$GEMINI_CREDENTIALS_BASE64" ]; then
        log_info "GEMINI_CREDENTIALS_BASE64 감지됨 - 인증 파일 생성 중..."
        mkdir -p "$HOME/.gemini"
        echo "$GEMINI_CREDENTIALS_BASE64" | base64 -d > "$HOME/.gemini/oauth_creds.json"
        FORCE_CLI_FALLBACK=true
    else
        log_error "GEMINI_API_KEY 또는 OAuth 자격 증명이 없습니다."
        exit 1
    fi
fi

if [ -n "$USE_OAUTH" ] && [ "$USE_OAUTH" = "true" ]; then
    FORCE_CLI_FALLBACK=true
fi

# Gemini 모델 설정
export PRIMARY_MODEL="${PRIMARY_MODEL:-gemini-3-flash-preview}"
export FALLBACK_MODEL="${FALLBACK_MODEL:-gemini-2.5-flash}"
export CURRENT_MODEL="$PRIMARY_MODEL"
export TZ="Asia/Seoul"

# ================================
# 인자 파싱 (Argument Parsing)
# ================================
CHANNEL=""
CRAWLING_PATH=""
EVALUATION_PATH=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --channel|-c) CHANNEL="$2"; shift 2 ;;
        --crawling-path) CRAWLING_PATH="$2"; shift 2 ;;
        --evaluation-path) EVALUATION_PATH="$2"; shift 2 ;;
        *) echo "알 수 없는 옵션: $1"; exit 1 ;;
    esac
done

if [ -z "$CHANNEL" ] || [ -z "$CRAWLING_PATH" ] || [ -z "$EVALUATION_PATH" ]; then
    echo "사용법: $0 --channel <채널명> --crawling-path <크롤링경로> --evaluation-path <평가경로>"
    exit 1
fi

FULL_CRAWLING_PATH="$PROJECT_ROOT/$CRAWLING_PATH"
FULL_EVALUATION_PATH="$PROJECT_ROOT/$EVALUATION_PATH"

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
log_info "모드: $(if [ "$FORCE_CLI_FALLBACK" = true ]; then echo "Gemini CLI only"; else echo "Node.js API + Sticky Fallback"; fi)"
log_info "모델: $CURRENT_MODEL"

# 필수 파일 확인
if [ ! -f "$PROMPT_FILE" ]; then
    log_error "프롬프트 파일 없음: $PROMPT_FILE"
    exit 1
fi
if [ ! -d "$RULE_RESULTS_DIR" ]; then
    log_error "rule_results 폴더 없음: $RULE_RESULTS_DIR"
    exit 1
fi

# Gemini CLI 확인 (Fallback용)
if ! command -v gemini > /dev/null 2>&1; then
    log_error "Gemini CLI 미설치 (Fallback 불가)"
    exit 1
fi

GEMINI_API_SCRIPT="$SCRIPT_DIR/gemini_api_request.mjs"

PROMPT_TEMPLATE=$(cat "$PROMPT_FILE")

# ================================
# Gemini Health Check (Pre-flight)
# ================================
log_info "🏥 Gemini Health Check (1+1=?) 수행 중..."
HEALTH_CHECK_PROMPT="$TEMP_DIR/health_check_prompt.txt"
HEALTH_CHECK_RESPONSE="$TEMP_DIR/health_check_response.json"
echo "1+1=?" > "$HEALTH_CHECK_PROMPT"

HEALTH_CHECK_PASSED=false

# 1. Node.js Check
if [ "$FORCE_CLI_FALLBACK" = false ] && [ -n "$NODE_EXE" ]; then
    WIN_SCRIPT=$(normalize_path "$GEMINI_API_SCRIPT")
    WIN_PROMPT=$(normalize_path "$HEALTH_CHECK_PROMPT")
    WIN_RESPONSE=$(normalize_path "$HEALTH_CHECK_RESPONSE")
    
    set +e
    "$NODE_EXE" "$WIN_SCRIPT" "$WIN_PROMPT" "$WIN_RESPONSE" > /dev/null 2>&1
    EXIT_CODE=$?
    set -e
    
    if [ $EXIT_CODE -eq 0 ]; then
        HEALTH_CHECK_PASSED=true
        log_success "Health Check 성공 (Node.js API)"
    else
        log_warning "Health Check 실패 (Node.js API) -> Sticky Fallback 활성화"
        FORCE_CLI_FALLBACK=true
    fi
fi

# 2. CLI Check (Fallback or Primary)
if [ "$HEALTH_CHECK_PASSED" = false ]; then
    if gemini -p "1+1=?" --model "$CURRENT_MODEL" --output-format json < /dev/null > "$HEALTH_CHECK_RESPONSE" 2>/dev/null; then
        HEALTH_CHECK_PASSED=true
        log_success "Health Check 성공 (Gemini CLI)"
    else
        log_error "Health Check 실패 (Gemini CLI)"
        log_error "제미나이 API/CLI가 모두 응답하지 않습니다. 네트워크나 API Key를 확인하세요."
        exit 1
    fi
fi

rm -f "$HEALTH_CHECK_PROMPT" "$HEALTH_CHECK_RESPONSE"

# ================================
# 처리할 video_id 수집
# ================================
VIDEO_IDS=()
for f in "$RULE_RESULTS_DIR"/*.jsonl; do
    [ -f "$f" ] && VIDEO_IDS+=("$(basename "$f" .jsonl)")
done

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
        SKIPPED_NO_TARGET=$((SKIPPED_NO_TARGET + 1))
        continue
    fi
    
    # 평가 대상만 추출
    RESTAURANTS_TO_EVALUATE=$(echo "$RULE_DATA" | jq_wrapper -c '
        .restaurants as $rests |
        .evaluation_target as $targets |
        .evaluation_results.location_match_TF as $loc_evals |
        $rests | map(
            select($targets[.origin_name] == true) |
            . as $r |
            ($loc_evals | map(select(.origin_name == $r.origin_name)) | first // null) as $loc |
            del(.origin_name) |
            . + {name: (if $loc and $loc.naver_name then $loc.naver_name else $r.origin_name end)}
        )
    ')
    
    RESTAURANT_COUNT=$(echo "$RESTAURANTS_TO_EVALUATE" | jq_wrapper 'length')
    if [ "$RESTAURANT_COUNT" -eq 0 ]; then
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
    
    # 1. Node.js API 시도 (Sticky Fallback이 아닐 때만)
    if [ "$FORCE_CLI_FALLBACK" = false ] && [ -n "$NODE_EXE" ]; then
        log_debug "Node.js API 호출 시도..."
        
        WIN_SCRIPT=$(normalize_path "$GEMINI_API_SCRIPT")
        WIN_PROMPT=$(normalize_path "$TEMP_PROMPT")
        WIN_RESPONSE=$(normalize_path "$TEMP_RESPONSE")
        
        set +e
        "$NODE_EXE" "$WIN_SCRIPT" "$WIN_PROMPT" "$WIN_RESPONSE"
        EXIT_CODE=$?
        set -e
        
        if [ $EXIT_CODE -eq 0 ]; then
            GEMINI_SUCCESS=true
            log_debug "Node.js 호출 성공"
        else
            log_warning "Node.js 호출 실패 (Code: $EXIT_CODE) - Sticky Fallback 활성화 (이후 CLI 사용)"
            FORCE_CLI_FALLBACK=true
        fi
    fi
    
    # 2. Gemini CLI 시도 (Node 실패 또는 Sticky 모드일 때)
    if [ "$GEMINI_SUCCESS" = false ]; then
        log_debug "Gemini CLI 호출 (모델: $CURRENT_MODEL)"
        
        if gemini --model "$CURRENT_MODEL" --output-format json --yolo < "$TEMP_PROMPT" > "$TEMP_RESPONSE" 2>"$TEMP_STDERR"; then
            GEMINI_SUCCESS=true
        else
            # Error logging
            log_error "Gemini CLI Error Output:"
            cat "$TEMP_STDERR"
            
            # Rate Limit 체크
            ERROR_REPORT=$(ls -t /tmp/gemini-client-error-*.json 2>/dev/null | head -1)
            if [ -f "$ERROR_REPORT" ] && grep -q "exhausted\|429" "$ERROR_REPORT" 2>/dev/null; then
               if [ "$CURRENT_MODEL" = "$PRIMARY_MODEL" ]; then
                   log_warning "할당량 소진 -> Fallback 모델($FALLBACK_MODEL) 전환"
                   CURRENT_MODEL="$FALLBACK_MODEL"
                   sleep 10
                   if gemini --model "$CURRENT_MODEL" --output-format json --yolo < "$TEMP_PROMPT" > "$TEMP_RESPONSE" 2>"$TEMP_STDERR"; then
                       GEMINI_SUCCESS=true
                   fi
               fi
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
            if "$PYTHON_EXE" "$PARSER_SCRIPT" \
                --channel "$CHANNEL" \
                --evaluation-path "$EVALUATION_PATH" \
                --video-id="$VIDEO_ID" \
                --response-file "$TEMP_RESPONSE" \
                --rule-file "$RULE_FILE"; then
                
                SUCCESS=$((SUCCESS + 1))
                PARSE_SUCCESS=true
                log_success "완료 [$INDEX/$TOTAL] - ${GEMINI_DURATION}s"
                break
            else
                # 파싱 실패 시 retry (CLI로 재요청)
                if [ $PARSE_ATTEMPT -lt 3 ]; then
                    log_warning "파싱 실패 (${PARSE_ATTEMPT}/3) - 재요청..."
                    sleep 10
                    gemini --model "$CURRENT_MODEL" --output-format json --yolo < "$TEMP_PROMPT" > "$TEMP_RESPONSE" 2>/dev/null
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
    sleep 10 # Rate Limit
done

log_info "============================================================"
log_info "🎉 LAAJ 평가 완료: $CHANNEL"
log_info "성공: $SUCCESS / 실패: $FAILED / 스킵: $SKIPPED_EXISTS"
log_info "Gemini 호출: $GEMINI_CALLS회 ($(format_duration $TOTAL_GEMINI_TIME))"
log_info "============================================================"
