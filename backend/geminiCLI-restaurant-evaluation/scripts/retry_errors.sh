#!/usr/bin/env zsh
# Gemini CLI 기반 에러 레코드 재평가 스크립트
# evaluation_errors.jsonl에서 에러를 읽어 재평가 수행

# set -e 제거 - jq 파싱 실패 등에서 스크립트가 멈추지 않도록

# Gemini 모델 설정 (gemini-2.5-pro 사용)
export GEMINI_MODEL="${GEMINI_MODEL:-gemini-2.5-pro}"

# 한국 시간대 설정 (KST, UTC+9)
export TZ="Asia/Seoul"

# 색상 코드
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 설정
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
UTILS_DIR="$(cd "$PROJECT_ROOT/../utils" && pwd)"
PROMPT_FILE="$PROJECT_ROOT/prompts/evaluation_prompt.txt"
PARSER_SCRIPT="$SCRIPT_DIR/parse_laaj_evaluation.py"
DATA_UTILS_SCRIPT="$UTILS_DIR/data_utils.py"

# 수집쪽 데이터 디렉토리 (transcript 파일 위치)
CRAWLING_DATA_DIR="$PROJECT_ROOT/../geminiCLI-restaurant-crawling/data"
TRANSCRIPT_FILENAME="tzuyang_restaurant_transcripts.json"

# 날짜별 폴더 경로 계산
DATA_DIR="$PROJECT_ROOT/data"

# PIPELINE_DATE 환경변수가 있으면 사용 (GitHub Actions에서 설정)
# 없으면 오늘 날짜 사용
if [ -n "$PIPELINE_DATE" ]; then
    TODAY_FOLDER="$PIPELINE_DATE"
else
    TODAY_FOLDER=$(python3 "$DATA_UTILS_SCRIPT" today_folder "$DATA_DIR")
fi

TODAY_PATH="$DATA_DIR/$TODAY_FOLDER"
LATEST_PATH=$(python3 "$DATA_UTILS_SCRIPT" latest_path "$DATA_DIR")

# 디렉토리 생성
mkdir -p "$TODAY_PATH"
mkdir -p "$PROJECT_ROOT/temp"

# 입력/출력 파일 경로 (날짜별 폴더)
ERROR_FILE="$TODAY_PATH/tzuyang_restaurant_evaluation_errors.jsonl"
RESULTS_FILE="$TODAY_PATH/tzuyang_restaurant_evaluation_results.jsonl"
RULE_RESULTS_FILE="$TODAY_PATH/tzuyang_restaurant_evaluation_rule_results.jsonl"
ERROR_LOG="$TODAY_PATH/tzuyang_restaurant_retry_errors.log"

# 최신 폴더에서 rule_results 찾기
if [ ! -f "$RULE_RESULTS_FILE" ] && [ -f "$LATEST_PATH/tzuyang_restaurant_evaluation_rule_results.jsonl" ]; then
    RULE_RESULTS_FILE="$LATEST_PATH/tzuyang_restaurant_evaluation_rule_results.jsonl"
fi

# 로그 설정 (새 폴더 구조: report/text/structured)
LOG_BASE_DIR="$PROJECT_ROOT/../log/geminiCLI-restaurant"
LOG_REPORT_DIR=$(python3 "$DATA_UTILS_SCRIPT" log_type_path "$LOG_BASE_DIR" "report" "$TODAY_FOLDER")
LOG_TEXT_DIR=$(python3 "$DATA_UTILS_SCRIPT" log_type_path "$LOG_BASE_DIR" "text" "$TODAY_FOLDER")
LOG_STRUCTURED_DIR=$(python3 "$DATA_UTILS_SCRIPT" log_type_path "$LOG_BASE_DIR" "structured" "$TODAY_FOLDER")
mkdir -p "$LOG_REPORT_DIR" "$LOG_TEXT_DIR" "$LOG_STRUCTURED_DIR"
STAGE_NAME="evaluation_retry"
START_TIME=$(date +%s)
START_DATETIME=$(date "+%Y-%m-%d %H:%M:%S")
LOG_FILE="$LOG_REPORT_DIR/${STAGE_NAME}_$(date +%H%M%S).json"

# 시간 포맷팅 함수
format_duration() {
    local seconds=$1
    local hours=$((seconds / 3600))
    local minutes=$(((seconds % 3600) / 60))
    local secs=$((seconds % 60))
    
    if [ $hours -gt 0 ]; then
        echo "${hours}h ${minutes}m ${secs}s"
    elif [ $minutes -gt 0 ]; then
        echo "${minutes}m ${secs}s"
    else
        echo "${secs}s"
    fi
}

# 로그 함수
log_info() {
    echo -e "${BLUE}[$(date '+%H:%M:%S')] ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}[$(date '+%H:%M:%S')] ✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}[$(date '+%H:%M:%S')] ❌ $1${NC}" >&2
}

log_debug() {
    echo -e "${CYAN}[$(date '+%H:%M:%S')] 🔍 $1${NC}"
}

# 에러 파일 확인
if [ ! -f "$ERROR_FILE" ]; then
    log_info "에러 파일이 없습니다: $ERROR_FILE"
    log_success "재평가할 에러가 없습니다!"
    exit 0
fi

# 에러 파일이 비어있는지 확인
ERROR_COUNT=$(wc -l < "$ERROR_FILE" 2>/dev/null | tr -d ' ')
if [ "$ERROR_COUNT" -eq 0 ]; then
    log_success "재평가할 에러가 없습니다!"
    exit 0
fi

if [ ! -f "$PROMPT_FILE" ]; then
    log_error "프롬프트 파일 없음: $PROMPT_FILE"
    exit 1
fi

if [ ! -f "$PARSER_SCRIPT" ]; then
    log_error "파서 스크립트 없음: $PARSER_SCRIPT"
    exit 1
fi

# Gemini CLI 설치 확인
if ! command -v gemini &> /dev/null; then
    log_error "Gemini CLI가 설치되지 않았습니다"
    echo "설치 방법: npm install -g @google/generative-ai-cli" >&2
    exit 1
fi

log_info "============================================================"
log_info "  Gemini CLI LAAJ 에러 재평가 시작"
log_info "============================================================"
log_info "시작 시간: $START_DATETIME"
log_info "Gemini 모델: $GEMINI_MODEL"
log_info "날짜 폴더: $TODAY_FOLDER"
log_info "에러 파일: $ERROR_FILE"
log_info "결과 파일: $RESULTS_FILE"
log_info "에러 수: $ERROR_COUNT"
log_info ""

# 통계 변수
TOTAL=$ERROR_COUNT
SUCCESS=0
FAILED=0
SKIPPED=0
GEMINI_CALLS=0
TOTAL_GEMINI_TIME=0
TOTAL_PARSE_TIME=0
TOTAL_TRANSCRIPT_TIME=0
TRANSCRIPT_SUCCESS=0
TRANSCRIPT_FAILED=0
TOTAL_RESTAURANTS_EVALUATED=0

# 이미 성공한 youtube_link 로드 (중복 처리 방지) - 모든 날짜 폴더에서
ALREADY_SUCCESS=""
for result_file in "$DATA_DIR"/*/tzuyang_restaurant_evaluation_results.jsonl; do
    if [ -f "$result_file" ]; then
        LINKS_FROM_FILE=$(jq -r '.youtube_link' "$result_file" 2>/dev/null | sort -u)
        ALREADY_SUCCESS="$ALREADY_SUCCESS"$'\n'"$LINKS_FROM_FILE"
    fi
done
ALREADY_SUCCESS=$(echo "$ALREADY_SUCCESS" | sort -u | grep -v '^$')
ALREADY_COUNT=$(echo "$ALREADY_SUCCESS" | grep -c . || echo "0")
log_info "이미 성공한 레코드 (전체 이력): ${ALREADY_COUNT}개"

# 시작 전에 이미 성공한 레코드를 에러 파일에서 제거
if [ "$ALREADY_COUNT" -gt 0 ]; then
    log_info "🗑️  이미 성공한 레코드를 에러 파일에서 제거 중..."
    TEMP_ERROR_FILE="$PROJECT_ROOT/temp/temp_errors_init.jsonl"
    > "$TEMP_ERROR_FILE"
    REMOVED_COUNT=0
    
    while IFS= read -r line || [ -n "$line" ]; do
        LINK=$(echo "$line" | jq -r '.youtube_link' 2>/dev/null)
        if echo "$ALREADY_SUCCESS" | grep -q "^$LINK$"; then
            REMOVED_COUNT=$((REMOVED_COUNT + 1))
        else
            echo "$line" >> "$TEMP_ERROR_FILE"
        fi
    done < "$ERROR_FILE"
    
    if [ "$REMOVED_COUNT" -gt 0 ]; then
        mv "$TEMP_ERROR_FILE" "$ERROR_FILE"
        TOTAL=$(wc -l < "$ERROR_FILE" | tr -d ' ')
        log_success "${REMOVED_COUNT}개 제거됨 (남은 에러: ${TOTAL}개)"
    else
        rm -f "$TEMP_ERROR_FILE"
    fi
    
    if [ "$TOTAL" -eq 0 ]; then
        log_success "🎉 모든 에러가 이미 처리되었습니다!"
        exit 0
    fi
fi
log_info ""

# youtube_meta 로드 (크롤링 결과 파일에서)
CRAWL_DATA_DIR="$PROJECT_ROOT/../geminiCLI-restaurant-crawling/data"
META_FILE="$CRAWL_DATA_DIR/$TODAY_FOLDER/tzuyang_restaurant_results_with_meta.jsonl"
if [ ! -f "$META_FILE" ]; then
    CRAWL_LATEST_PATH=$(python3 "$DATA_UTILS_SCRIPT" latest_path "$CRAWL_DATA_DIR")
    META_FILE="$CRAWL_LATEST_PATH/tzuyang_restaurant_results_with_meta.jsonl"
fi

# 프롬프트 템플릿 읽기
PROMPT_TEMPLATE=$(cat "$PROMPT_FILE")

# 성공한 youtube_link 저장용 임시 파일
SUCCESS_LINKS_FILE="$PROJECT_ROOT/temp/success_links.txt"
> "$SUCCESS_LINKS_FILE"

# 각 레코드 처리
LINE_NUM=0
while IFS= read -r line || [ -n "$line" ]; do
    LINE_NUM=$((LINE_NUM + 1))
    
    # 빈 줄 건너뛰기
    if [ -z "$line" ]; then
        continue
    fi
    
    # JSON 파싱 (jq 사용)
    YOUTUBE_LINK=$(echo "$line" | jq -r '.youtube_link')
    
    # 이미 성공한 레코드 스킵
    if echo "$ALREADY_SUCCESS" | grep -q "^$YOUTUBE_LINK$"; then
        SKIPPED=$((SKIPPED + 1))
        log_warning "[$LINE_NUM/$TOTAL] 이미 성공 - 스킵: $YOUTUBE_LINK"
        # 성공한 것으로 기록 (에러 파일에서 제거하기 위해)
        echo "$YOUTUBE_LINK" >> "$SUCCESS_LINKS_FILE"
        continue
    fi
    
    EVALUATION_TARGET=$(echo "$line" | jq -c '.evaluation_target')
    RESTAURANTS=$(echo "$line" | jq -c '.restaurants')
    YOUTUBE_META=$(echo "$line" | jq -c '.youtube_meta // {}')
    
    # evaluation_target에서 true인 식당만 필터링
    RESTAURANTS_TO_EVALUATE=$(echo "$line" | jq -c '[.restaurants[] | select(.name as $n | .evaluation_target[$n] == true)]' 2>/dev/null || echo "$RESTAURANTS")
    
    RESTAURANT_COUNT=$(echo "$RESTAURANTS_TO_EVALUATE" | jq 'length')
    
    if [ "$RESTAURANT_COUNT" -eq 0 ]; then
        SKIPPED=$((SKIPPED + 1))
        log_warning "[$LINE_NUM/$TOTAL] 건너뜀 - 평가 대상 없음"
        continue
    fi
    
    TOTAL_RESTAURANTS_EVALUATED=$((TOTAL_RESTAURANTS_EVALUATED + RESTAURANT_COUNT))
    log_info "[$LINE_NUM/$TOTAL] 재평가중: $YOUTUBE_LINK"
    log_debug "평가 대상 음식점: ${RESTAURANT_COUNT}개"
    
    # 수집쪽 transcript 파일에서 자막 가져오기
    TRANSCRIPT=""
    TRANSCRIPT_FOUND=false
    TRANSCRIPT_START=$(date +%s)
    
    # 모든 날짜 폴더에서 transcript 검색
    for transcript_file in "$CRAWLING_DATA_DIR"/*/"$TRANSCRIPT_FILENAME"; do
        if [ -f "$transcript_file" ]; then
            # jq로 해당 URL의 transcript 추출 (start + text 형식으로 변환)
            TRANSCRIPT=$(jq -r --arg url "$YOUTUBE_LINK" '
                .[] | select(.youtube_link == $url) | 
                .transcript | 
                map("[" + ((.start / 60 | floor | tostring) + ":" + ((.start % 60 | floor) | tostring | if length == 1 then "0" + . else . end)) + "] " + .text) | 
                join("\n")
            ' "$transcript_file" 2>/dev/null)
            
            if [ -n "$TRANSCRIPT" ] && [ "$TRANSCRIPT" != "null" ]; then
                TRANSCRIPT_FOUND=true
                log_debug "자막 발견: $(echo "$TRANSCRIPT" | wc -c | tr -d ' ')자 (from $transcript_file)"
                break
            fi
        fi
    done
    
    TRANSCRIPT_END=$(date +%s)
    TRANSCRIPT_DURATION=$((TRANSCRIPT_END - TRANSCRIPT_START))
    TOTAL_TRANSCRIPT_TIME=$((TOTAL_TRANSCRIPT_TIME + TRANSCRIPT_DURATION))
    
    if [ "$TRANSCRIPT_FOUND" = true ]; then
        TRANSCRIPT_SUCCESS=$((TRANSCRIPT_SUCCESS + 1))
    else
        log_warning "[$LINE_NUM/$TOTAL] 건너뜀 - Transcript 없음 (수집쪽 데이터에 없음)"
        TRANSCRIPT_FAILED=$((TRANSCRIPT_FAILED + 1))
        SKIPPED=$((SKIPPED + 1))
        continue
    fi
    
    # 평가용 데이터 구성
    EVALUATION_DATA=$(jq -n \
        --arg yl "$YOUTUBE_LINK" \
        --argjson rest "$RESTAURANTS_TO_EVALUATE" \
        '{youtube_link: $yl, restaurants: $rest}')
    
    # 프롬프트에 데이터 삽입
    PROMPT="${PROMPT_TEMPLATE//\{restaurant_data\}/$EVALUATION_DATA}"
    
    # 자막이 있으면 프롬프트에 추가
    if [ -n "$TRANSCRIPT" ]; then
        PROMPT="${PROMPT}

## YouTube 영상 자막

아래는 해당 YouTube 영상의 자막입니다. 이 자막을 참고하여 음식점 정보를 검증하세요:

\`\`\`
${TRANSCRIPT}
\`\`\`"
    fi
    
    # 임시 응답 파일
    TEMP_RESPONSE="$PROJECT_ROOT/temp/retry_response_$LINE_NUM.json"
    TEMP_PROMPT="$PROJECT_ROOT/temp/retry_prompt_$LINE_NUM.txt"
    TEMP_META="$PROJECT_ROOT/temp/retry_meta_$LINE_NUM.json"
    
    # 프롬프트를 파일로 저장 (특수문자 이스케이프 문제 방지)
    echo "$PROMPT" > "$TEMP_PROMPT"
    
    # youtube_meta를 임시 파일로 저장 (JSON 이스케이프 문제 방지)
    echo "$YOUTUBE_META" > "$TEMP_META"
    
    TEMP_STDERR="$PROJECT_ROOT/temp/retry_stderr_$LINE_NUM.log"
    
    # Gemini CLI 호출
    # -p: 단일 프롬프트 모드 (이전 대화 히스토리 없이 독립 실행)
    # --yolo: 도구 사용 자동 승인, stderr 분리
    GEMINI_START=$(date +%s)
    if gemini -p "$(cat "$TEMP_PROMPT")" --output-format json --yolo > "$TEMP_RESPONSE" 2>"$TEMP_STDERR"; then
        GEMINI_END=$(date +%s)
        GEMINI_DURATION=$((GEMINI_END - GEMINI_START))
        TOTAL_GEMINI_TIME=$((TOTAL_GEMINI_TIME + GEMINI_DURATION))
        GEMINI_CALLS=$((GEMINI_CALLS + 1))
        log_debug "Gemini CLI 응답 완료 (${GEMINI_DURATION}s)"
        
        # 파서 실행
        PARSE_START=$(date +%s)
        if python3 "$PARSER_SCRIPT" \
            --youtube-link "$YOUTUBE_LINK" \
            --response-file "$TEMP_RESPONSE" \
            --output-file "$RESULTS_FILE" \
            --rule-results-file "$RULE_RESULTS_FILE" \
            --evaluation-target "$EVALUATION_TARGET" \
            --restaurants "$RESTAURANTS" \
            --youtube-meta-file "$TEMP_META"; then
            
            PARSE_END=$(date +%s)
            PARSE_DURATION=$((PARSE_END - PARSE_START))
            TOTAL_PARSE_TIME=$((TOTAL_PARSE_TIME + PARSE_DURATION))
            SUCCESS=$((SUCCESS + 1))
            log_success "성공 ($SUCCESS/$TOTAL) - Gemini: ${GEMINI_DURATION}s, Parse: ${PARSE_DURATION}s"
            
            # 성공한 youtube_link 기록
            echo "$YOUTUBE_LINK" >> "$SUCCESS_LINKS_FILE"
        else
            PARSE_END=$(date +%s)
            PARSE_DURATION=$((PARSE_END - PARSE_START))
            TOTAL_PARSE_TIME=$((TOTAL_PARSE_TIME + PARSE_DURATION))
            FAILED=$((FAILED + 1))
            log_error "파서 실패 ($FAILED/$TOTAL)"
            echo "[$(date)] 파서 실패: $YOUTUBE_LINK" >> "$ERROR_LOG"
        fi
    else
        GEMINI_END=$(date +%s)
        GEMINI_DURATION=$((GEMINI_END - GEMINI_START))
        TOTAL_GEMINI_TIME=$((TOTAL_GEMINI_TIME + GEMINI_DURATION))
        GEMINI_CALLS=$((GEMINI_CALLS + 1))
        FAILED=$((FAILED + 1))
        log_error "Gemini CLI 호출 실패 ($FAILED/$TOTAL) - ${GEMINI_DURATION}s"
        echo "[$(date)] Gemini CLI 실패: $YOUTUBE_LINK" >> "$ERROR_LOG"
        cat "$TEMP_STDERR" >> "$ERROR_LOG" 2>/dev/null || true
    fi
    
    # 임시 파일 정리
    rm -f "$TEMP_RESPONSE" "$TEMP_PROMPT" "$TEMP_META"
    
    # Rate Limit 준수 (60 RPM = 1초 대기)
    if [ $LINE_NUM -lt $TOTAL ]; then
        sleep 1
    fi
done < "$ERROR_FILE"

# 성공한 레코드를 에러 파일에서 제거
if [ -s "$SUCCESS_LINKS_FILE" ]; then
    log_info ""
    log_info "🗑️  성공한 레코드를 에러 파일에서 제거 중..."
    
    # 성공하지 않은 레코드만 남기기
    TEMP_ERROR_FILE="$PROJECT_ROOT/temp/temp_errors.jsonl"
    > "$TEMP_ERROR_FILE"
    REMOVED_COUNT=0
    
    while IFS= read -r line; do
        YOUTUBE_LINK=$(echo "$line" | jq -r '.youtube_link')
        if grep -q "^$YOUTUBE_LINK$" "$SUCCESS_LINKS_FILE" 2>/dev/null; then
            REMOVED_COUNT=$((REMOVED_COUNT + 1))
        else
            echo "$line" >> "$TEMP_ERROR_FILE"
        fi
    done < "$ERROR_FILE"
    
    mv "$TEMP_ERROR_FILE" "$ERROR_FILE"
    REMAINING=$(wc -l < "$ERROR_FILE" | tr -d ' ')
    log_success "에러 파일 업데이트 완료 (제거: ${REMOVED_COUNT}개, 남음: ${REMAINING}개)"
fi

# 임시 파일 정리
rm -f "$SUCCESS_LINKS_FILE"

# 최종 종료 시간
END_TIME=$(date +%s)
END_DATETIME=$(date "+%Y-%m-%d %H:%M:%S")
TOTAL_DURATION=$((END_TIME - START_TIME))

# 결과 출력
log_info ""
log_info "========================================"
log_success "LAAJ 에러 재평가 완료"
log_info "========================================"
log_info "⏱️  총 소요 시간: $(format_duration $TOTAL_DURATION)"
log_info ""
log_info "📊 처리 통계:"
log_success "  성공: $SUCCESS"
log_warning "  건너뜀: $SKIPPED"
log_error "  실패: $FAILED"
log_info "  총 에러: $TOTAL"
log_info ""
log_info "🤖 Gemini CLI 통계:"
log_info "  총 호출 수: $GEMINI_CALLS"
log_info "  총 Gemini 시간: $(format_duration $TOTAL_GEMINI_TIME)"
if [ $GEMINI_CALLS -gt 0 ]; then
    AVG_GEMINI=$((TOTAL_GEMINI_TIME / GEMINI_CALLS))
    log_info "  평균 Gemini 시간: $(format_duration $AVG_GEMINI)"
fi
log_info ""
log_info "📝 자막 통계:"
log_info "  자막 성공: $TRANSCRIPT_SUCCESS"
log_info "  자막 실패: $TRANSCRIPT_FAILED"
log_info "  총 자막 시간: $(format_duration $TOTAL_TRANSCRIPT_TIME)"
log_info "========================================"

# JSON 로그 저장
cat > "$LOG_FILE" << EOF
{
  "stage": "$STAGE_NAME",
  "started_at": "$START_DATETIME",
  "ended_at": "$END_DATETIME",
  "duration_seconds": $TOTAL_DURATION,
  "duration_formatted": "$(format_duration $TOTAL_DURATION)",
  "gemini_model": "$GEMINI_MODEL",
  "statistics": {
    "total_errors": $TOTAL,
    "success": $SUCCESS,
    "failed": $FAILED,
    "skipped": $SKIPPED,
    "total_restaurants_evaluated": $TOTAL_RESTAURANTS_EVALUATED,
    "success_rate": "$(echo "scale=2; $SUCCESS * 100 / ($SUCCESS + $FAILED + 1)" | bc 2>/dev/null || echo "N/A")%"
  },
  "gemini_stats": {
    "total_calls": $GEMINI_CALLS,
    "total_time_seconds": $TOTAL_GEMINI_TIME,
    "total_time_formatted": "$(format_duration $TOTAL_GEMINI_TIME)",
    "average_time_seconds": $((GEMINI_CALLS > 0 ? TOTAL_GEMINI_TIME / GEMINI_CALLS : 0))
  },
  "transcript_stats": {
    "success": $TRANSCRIPT_SUCCESS,
    "failed": $TRANSCRIPT_FAILED,
    "total_time_seconds": $TOTAL_TRANSCRIPT_TIME,
    "total_time_formatted": "$(format_duration $TOTAL_TRANSCRIPT_TIME)"
  },
  "parser_stats": {
    "total_time_seconds": $TOTAL_PARSE_TIME,
    "total_time_formatted": "$(format_duration $TOTAL_PARSE_TIME)"
  },
  "files": {
    "error_file": "$ERROR_FILE",
    "results_file": "$RESULTS_FILE",
    "retry_error_log": "$ERROR_LOG"
  }
}
EOF

log_info ""
log_success "로그 파일 저장: $LOG_FILE"

# 최종 상태 출력
REMAINING=$(wc -l < "$ERROR_FILE" 2>/dev/null | tr -d ' ')
if [ "$REMAINING" -eq 0 ]; then
    log_success "🎉 모든 에러가 성공적으로 처리되었습니다!"
else
    log_warning "⚠️  아직 ${REMAINING}개의 에러가 남아있습니다."
    log_info "   다시 실행하려면: $0"
fi
