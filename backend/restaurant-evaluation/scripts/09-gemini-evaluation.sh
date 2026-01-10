#!/bin/bash
# Gemini CLI 기반 LAAJ 음식점 평가 스크립트
# rule_results 데이터를 읽어서 LAAJ 평가 수행
#
# 기존 backup 로직 그대로 유지:
# - 자막 로드
# - 프롬프트 구성
# - Gemini CLI 호출 (rate limit, fallback)
# - 에러 처리 및 재시도
#
# 사용법:
#   ./08-gemini-evaluation.sh --channel tzuyang --data-path data/tzuyang

set -e

# ================================
# 환경 설정
# ================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROMPT_FILE="$SCRIPT_DIR/../prompts/evaluation_prompt.txt"
PARSER_SCRIPT="$SCRIPT_DIR/parse_laaj_evaluation.py"

# .env 파일 로드
ENV_FILES=(
    "$PROJECT_ROOT/.env"
    "$PROJECT_ROOT/../.env"
)

ENV_LOADED=false
for env_file in "${ENV_FILES[@]}"; do
    if [ -f "$env_file" ]; then
        set -a
        source "$env_file"
        set +a
        ENV_LOADED=true
        break
    fi
done

# Gemini 모델 설정
export PRIMARY_MODEL="${PRIMARY_MODEL:-gemini-3-flash-preview}"
export FALLBACK_MODEL="${FALLBACK_MODEL:-gemini-2.5-flash}"
export CURRENT_MODEL="$PRIMARY_MODEL"

# 한국 시간대 설정
export TZ="Asia/Seoul"

# 색상 코드
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# ================================
# 로그 함수
# ================================
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

# ================================
# 인자 파싱
# ================================
CHANNEL=""
DATA_PATH=""
while [[ $# -gt 0 ]]; do
    case $1 in
        --channel|-c) CHANNEL="$2"; shift 2 ;;
        --data-path) DATA_PATH="$2"; shift 2 ;;
        *) echo "알 수 없는 옵션: $1"; exit 1 ;;
    esac
done

if [ -z "$CHANNEL" ] || [ -z "$DATA_PATH" ]; then
    echo "사용법: $0 --channel <채널명> --data-path <데이터경로>"
    exit 1
fi

FULL_DATA_PATH="$PROJECT_ROOT/$DATA_PATH"
RULE_RESULTS_DIR="$FULL_DATA_PATH/evaluation/rule_results"
LAAJ_RESULTS_DIR="$FULL_DATA_PATH/evaluation/laaj_results"
ERRORS_DIR="$FULL_DATA_PATH/evaluation/errors"
TRANSCRIPT_DIR="$FULL_DATA_PATH/transcript"
TEMP_DIR="$SCRIPT_DIR/../temp"

mkdir -p "$LAAJ_RESULTS_DIR" "$ERRORS_DIR" "$TEMP_DIR"

log_info "============================================================"
log_info "  Gemini CLI LAAJ 음식점 평가 시작"
log_info "============================================================"
log_info "채널: $CHANNEL"
log_info "데이터 경로: $FULL_DATA_PATH"
log_info "Gemini 모델: $CURRENT_MODEL (fallback: $FALLBACK_MODEL)"

# 필수 파일 확인
if [ ! -f "$PROMPT_FILE" ]; then
    log_error "프롬프트 파일 없음: $PROMPT_FILE"
    exit 1
fi

if [ ! -d "$RULE_RESULTS_DIR" ]; then
    log_error "rule_results 폴더 없음: $RULE_RESULTS_DIR"
    exit 1
fi

# Gemini CLI 확인
if ! command -v gemini &> /dev/null; then
    log_error "Gemini CLI 미설치"
    exit 1
fi

log_success "Gemini CLI 확인 완료"

# 프롬프트 템플릿 로드
PROMPT_TEMPLATE=$(cat "$PROMPT_FILE")

# ================================
# 처리할 video_id 수집
# ================================
VIDEO_IDS=()
for f in "$RULE_RESULTS_DIR"/*.jsonl; do
    if [ -f "$f" ]; then
        VIDEO_IDS+=("$(basename "$f" .jsonl)")
    fi
done

TOTAL=${#VIDEO_IDS[@]}
log_info "총 rule_results 파일: $TOTAL 개"

# 통계 변수
PROCESSED=0
SUCCESS=0
FAILED=0
SKIPPED_EXISTS=0
SKIPPED_NO_TARGET=0
SKIPPED_NO_TRANSCRIPT=0
GEMINI_CALLS=0
TOTAL_GEMINI_TIME=0

# ================================
# 각 video 처리
# ================================
for i in "${!VIDEO_IDS[@]}"; do
    VIDEO_ID="${VIDEO_IDS[$i]}"
    INDEX=$((i + 1))
    
    RULE_FILE="$RULE_RESULTS_DIR/${VIDEO_ID}.jsonl"
    OUTPUT_FILE="$LAAJ_RESULTS_DIR/${VIDEO_ID}.jsonl"
    ERROR_FILE="$ERRORS_DIR/${VIDEO_ID}.jsonl"
    TRANSCRIPT_FILE="$TRANSCRIPT_DIR/${VIDEO_ID}.jsonl"
    
    # 중복 검사: 이미 처리된 파일 (성공 또는 에러)
    if [ -f "$OUTPUT_FILE" ] || [ -f "$ERROR_FILE" ]; then
        SKIPPED_EXISTS=$((SKIPPED_EXISTS + 1))
        if [ $((SKIPPED_EXISTS % 50)) -eq 1 ]; then
            log_warning "[$INDEX/$TOTAL] 이미 처리됨 (스킵 ${SKIPPED_EXISTS}개)"
        fi
        continue
    fi
    
    # rule_results 데이터 로드
    RULE_DATA=$(tail -n 1 "$RULE_FILE")
    YOUTUBE_LINK=$(echo "$RULE_DATA" | jq -r '.youtube_link')
    CHANNEL_NAME=$(echo "$RULE_DATA" | jq -r '.channel_name // ""')
    EVALUATION_TARGET=$(echo "$RULE_DATA" | jq -c '.evaluation_target // {}')
    RESTAURANTS=$(echo "$RULE_DATA" | jq -c '.restaurants // []')
    EVAL_RESULTS=$(echo "$RULE_DATA" | jq -c '.evaluation_results // {}')
    
    # evaluation_target에 true 값이 있는 경우만 평가
    HAS_TRUE_TARGET=$(echo "$EVALUATION_TARGET" | jq 'to_entries | map(select(.value == true)) | length')
    if [ "$HAS_TRUE_TARGET" -eq 0 ]; then
        SKIPPED_NO_TARGET=$((SKIPPED_NO_TARGET + 1))
        continue
    fi
    
    # 평가 대상 음식점 추출 (evaluation_target[name] == true인 것만)
    RESTAURANTS_TO_EVALUATE=$(echo "$RULE_DATA" | jq -c '
        .restaurants as $rests |
        .evaluation_target as $targets |
        $rests | map(select($targets[.name] == true))
    ')
    RESTAURANT_COUNT=$(echo "$RESTAURANTS_TO_EVALUATE" | jq 'length')
    
    if [ "$RESTAURANT_COUNT" -eq 0 ]; then
        SKIPPED_NO_TARGET=$((SKIPPED_NO_TARGET + 1))
        continue
    fi
    
    # 자막 로드
    TRANSCRIPT=""
    TRANSCRIPT_LANGUAGE="unknown"
    
    if [ -f "$TRANSCRIPT_FILE" ]; then
        TRANSCRIPT_DATA=$(tail -n 1 "$TRANSCRIPT_FILE")
        TRANSCRIPT_LANGUAGE=$(echo "$TRANSCRIPT_DATA" | jq -r '.language // "ko"')
        
        # 자막을 [MM:SS] 형식으로 변환
        TRANSCRIPT=$(echo "$TRANSCRIPT_DATA" | jq -r '
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
    
    log_info "[$INDEX/$TOTAL] LAAJ 평가 중: $VIDEO_ID (${RESTAURANT_COUNT}개 음식점)"
    
    # 평가용 데이터 구성
    EVALUATION_DATA=$(jq -n \
        --arg yl "$YOUTUBE_LINK" \
        --argjson rest "$RESTAURANTS_TO_EVALUATE" \
        '{youtube_link: $yl, restaurants: $rest}')
    
    # 프롬프트 생성
    PROMPT="${PROMPT_TEMPLATE//\{restaurant_data\}/$EVALUATION_DATA}"
    
    # 자막 추가
    PROMPT="$PROMPT

<참고: YouTube 자막>
아래는 해당 영상의 자막입니다. 유튜버의 실제 발언, 음식점 언급, 리뷰 내용을 확인하는 데 참고하세요.
[자막 언어: $TRANSCRIPT_LANGUAGE]
※ 자막이 한국어가 아닐 수 있지만, 모든 평가 결과(eval_basis 등)는 반드시 한국어로 작성하세요.
---
$TRANSCRIPT
---
</참고: YouTube 자막>"
    
    # 임시 파일
    TEMP_PROMPT="$TEMP_DIR/eval_prompt_${VIDEO_ID}.txt"
    TEMP_RESPONSE="$TEMP_DIR/eval_response_${VIDEO_ID}.json"
    TEMP_STDERR="$TEMP_DIR/eval_stderr_${VIDEO_ID}.log"
    
    echo "$PROMPT" > "$TEMP_PROMPT"
    
    # Gemini CLI 호출
    GEMINI_START=$(date +%s)
    GEMINI_SUCCESS=false
    
    log_debug "Gemini 모델: $CURRENT_MODEL"
    if gemini -p "$(cat "$TEMP_PROMPT")" --model "$CURRENT_MODEL" --output-format json --yolo < /dev/null > "$TEMP_RESPONSE" 2>"$TEMP_STDERR"; then
        GEMINI_SUCCESS=true
    else
        # rate limit 확인 및 fallback
        ERROR_REPORT=$(ls -t /tmp/gemini-client-error-*.json 2>/dev/null | head -1)
        if [ -f "$ERROR_REPORT" ] && grep -q "exhausted your daily quota\|rate\|limit\|429" "$ERROR_REPORT" 2>/dev/null; then
            if [ "$CURRENT_MODEL" = "$PRIMARY_MODEL" ]; then
                log_warning "$PRIMARY_MODEL 할당량 소진 - $FALLBACK_MODEL 으로 전환"
                CURRENT_MODEL="$FALLBACK_MODEL"
                sleep 12
                if gemini -p "$(cat "$TEMP_PROMPT")" --model "$CURRENT_MODEL" --output-format json --yolo < /dev/null > "$TEMP_RESPONSE" 2>"$TEMP_STDERR"; then
                    GEMINI_SUCCESS=true
                fi
            fi
        fi
    fi
    
    GEMINI_END=$(date +%s)
    GEMINI_DURATION=$((GEMINI_END - GEMINI_START))
    TOTAL_GEMINI_TIME=$((TOTAL_GEMINI_TIME + GEMINI_DURATION))
    GEMINI_CALLS=$((GEMINI_CALLS + 1))
    
    if [ "$GEMINI_SUCCESS" = true ]; then
        # 응답 파싱
        if python3 "$PARSER_SCRIPT" \
            --channel "$CHANNEL" \
            --data-path "$DATA_PATH" \
            --video-id "$VIDEO_ID" \
            --response-file "$TEMP_RESPONSE" \
            --rule-file "$RULE_FILE"; then
            
            SUCCESS=$((SUCCESS + 1))
            log_success "성공 [$INDEX/$TOTAL] - ${GEMINI_DURATION}s"
        else
            FAILED=$((FAILED + 1))
            
            # 에러 저장
            jq -n \
                --arg yl "$YOUTUBE_LINK" \
                --arg vid "$VIDEO_ID" \
                --arg err "파싱 실패" \
                '{youtube_link: $yl, video_id: $vid, error: $err}' > "$ERROR_FILE"
            
            log_error "파싱 실패 [$INDEX/$TOTAL]"
        fi
    else
        FAILED=$((FAILED + 1))
        
        # 에러 저장
        jq -n \
            --arg yl "$YOUTUBE_LINK" \
            --arg vid "$VIDEO_ID" \
            --arg err "Gemini CLI 호출 실패" \
            '{youtube_link: $yl, video_id: $vid, error: $err}' > "$ERROR_FILE"
        
        log_error "Gemini CLI 실패 [$INDEX/$TOTAL] - ${GEMINI_DURATION}s"
    fi
    
    PROCESSED=$((PROCESSED + 1))
    
    # 임시 파일 정리
    rm -f "$TEMP_RESPONSE" "$TEMP_PROMPT" "$TEMP_STDERR"
    
    # Rate Limit 준수 (12초 대기)
    sleep 12
done

# ================================
# 결과 출력
# ================================
log_info ""
log_info "============================================================"
log_success "🎉 LAAJ 평가 완료: $CHANNEL"
log_info "============================================================"
log_info "📊 처리 통계:"
log_success "  성공: $SUCCESS"
log_warning "  건너뜀 (이미 처리됨): $SKIPPED_EXISTS"
log_warning "  건너뜀 (평가 대상 없음): $SKIPPED_NO_TARGET"
log_warning "  건너뜀 (자막 없음): $SKIPPED_NO_TRANSCRIPT"
log_error "  실패: $FAILED"
log_info "  총 파일: $TOTAL"
log_info ""
log_info "🤖 Gemini CLI 통계:"
log_info "  총 호출 수: $GEMINI_CALLS"
log_info "  총 Gemini 시간: $(format_duration $TOTAL_GEMINI_TIME)"
log_info "============================================================"
