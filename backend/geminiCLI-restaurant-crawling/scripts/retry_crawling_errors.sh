#!/bin/bash
# Gemini CLI 기반 크롤링 에러 재처리 스크립트
# tzuyang_crawling_errors.jsonl에서 에러를 읽어 재크롤링 수행
# 성공 시 에러 파일에서 해당 행 삭제

# set -e 제거 - jq 파싱 실패 등에서 스크립트가 멈추지 않도록

# Gemini 모델 설정 (gemini-3-flash-preview 사용)
export GEMINI_MODEL="${GEMINI_MODEL:-gemini-3-flash-preview}"

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
PROMPT_FILE="$PROJECT_ROOT/prompts/crawling_prompt.txt"
PARSER_SCRIPT="$SCRIPT_DIR/parse_result.py"
TRANSCRIPT_SCRIPT="$UTILS_DIR/get_transcript.py"
DATA_UTILS_SCRIPT="$UTILS_DIR/data_utils.py"

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

# 디렉토리 생성
mkdir -p "$TODAY_PATH"
mkdir -p "$PROJECT_ROOT/temp"

# 입력/출력 파일 경로
ERROR_JSONL="$TODAY_PATH/tzuyang_crawling_errors.jsonl"
OUTPUT_FILE="$TODAY_PATH/tzuyang_restaurant_results.jsonl"
RETRY_ERROR_LOG="$TODAY_PATH/tzuyang_crawling_retry_errors.log"

# 로그 설정 (새 폴더 구조: report/text/structured)
LOG_BASE_DIR="$PROJECT_ROOT/../log/geminiCLI-restaurant"
LOG_REPORT_DIR=$(python3 "$DATA_UTILS_SCRIPT" log_type_path "$LOG_BASE_DIR" "report" "$TODAY_FOLDER")
LOG_TEXT_DIR=$(python3 "$DATA_UTILS_SCRIPT" log_type_path "$LOG_BASE_DIR" "text" "$TODAY_FOLDER")
LOG_STRUCTURED_DIR=$(python3 "$DATA_UTILS_SCRIPT" log_type_path "$LOG_BASE_DIR" "structured" "$TODAY_FOLDER")
mkdir -p "$LOG_REPORT_DIR" "$LOG_TEXT_DIR" "$LOG_STRUCTURED_DIR"
STAGE_NAME="crawling_retry"
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
if [ ! -f "$ERROR_JSONL" ]; then
    log_info "에러 파일이 없습니다: $ERROR_JSONL"
    log_success "재처리할 에러가 없습니다!"
    exit 0
fi

# 에러 파일이 비어있는지 확인
ERROR_COUNT=$(wc -l < "$ERROR_JSONL" 2>/dev/null | tr -d ' ')
if [ "$ERROR_COUNT" -eq 0 ]; then
    log_success "재처리할 에러가 없습니다!"
    exit 0
fi

# 필수 파일 확인
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
log_info "  Gemini CLI 크롤링 에러 재처리 시작"
log_info "============================================================"
log_info "시작 시간: $START_DATETIME"
log_info "Gemini 모델: $GEMINI_MODEL"
log_info "날짜 폴더: $TODAY_FOLDER"
log_info "에러 파일: $ERROR_JSONL"
log_info "출력 파일: $OUTPUT_FILE"
log_info "에러 수: $ERROR_COUNT"
log_info ""

# 이미 처리된 URL 로드 (중복 처리 방지) - 모든 날짜 폴더에서
PROCESSED_URLS=""
for result_file in "$DATA_DIR"/*/tzuyang_restaurant_results.jsonl; do
    if [ -f "$result_file" ]; then
        URLS_FROM_FILE=$(jq -r '.youtube_link' "$result_file" 2>/dev/null | sort -u)
        PROCESSED_URLS="$PROCESSED_URLS"$'\n'"$URLS_FROM_FILE"
    fi
done
PROCESSED_URLS=$(echo "$PROCESSED_URLS" | sort -u | grep -v '^$')
PROCESSED_COUNT=$(echo "$PROCESSED_URLS" | grep -c . || echo "0")
log_info "이미 처리된 URL (전체 이력): ${PROCESSED_COUNT}개"

# 프롬프트 템플릿 읽기
PROMPT_TEMPLATE=$(cat "$PROMPT_FILE")
log_debug "프롬프트 템플릿 로드 완료 (${#PROMPT_TEMPLATE}자)"

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

# 성공한 URL 저장용 임시 파일
SUCCESS_URLS_FILE="$PROJECT_ROOT/temp/success_urls_retry.txt"
> "$SUCCESS_URLS_FILE"

# 각 에러 URL 처리
LINE_NUM=0
while IFS= read -r line || [ -n "$line" ]; do
    LINE_NUM=$((LINE_NUM + 1))
    URL_START_TIME=$(date +%s)
    
    # 빈 줄 건너뛰기
    if [ -z "$line" ]; then
        continue
    fi
    
    # JSON에서 URL 추출
    URL=$(echo "$line" | jq -r '.youtube_link' 2>/dev/null)
    
    if [ -z "$URL" ] || [ "$URL" = "null" ]; then
        log_warning "[$LINE_NUM/$TOTAL] URL 파싱 실패 - 스킵"
        continue
    fi
    
    # 이미 성공적으로 처리된 URL 스킵
    if echo "$PROCESSED_URLS" | grep -q "^$URL$"; then
        SKIPPED=$((SKIPPED + 1))
        log_warning "[$LINE_NUM/$TOTAL] 이미 처리됨 - 스킵: $URL"
        echo "$URL" >> "$SUCCESS_URLS_FILE"
        continue
    fi
    
    log_info "[$LINE_NUM/$TOTAL] 재처리중: $URL"
    
    # YouTube 자막 가져오기
    TRANSCRIPT=""
    if [ -f "$TRANSCRIPT_SCRIPT" ]; then
        TRANSCRIPT_START=$(date +%s)
        TRANSCRIPT=$(python3 "$TRANSCRIPT_SCRIPT" "$URL" 50000 2>/dev/null || echo "")
        TRANSCRIPT_END=$(date +%s)
        TRANSCRIPT_DURATION=$((TRANSCRIPT_END - TRANSCRIPT_START))
        TOTAL_TRANSCRIPT_TIME=$((TOTAL_TRANSCRIPT_TIME + TRANSCRIPT_DURATION))
        
        if [ -n "$TRANSCRIPT" ]; then
            log_debug "자막 로드 완료 (${#TRANSCRIPT}자, ${TRANSCRIPT_DURATION}s)"
            TRANSCRIPT_SUCCESS=$((TRANSCRIPT_SUCCESS + 1))
        else
            log_warning "자막 없음 (${TRANSCRIPT_DURATION}s)"
            TRANSCRIPT_FAILED=$((TRANSCRIPT_FAILED + 1))
        fi
    fi
    
    # 프롬프트에 URL 삽입
    PROMPT="${PROMPT_TEMPLATE//<유튜브 링크>/$URL}"
    
    # 자막이 있으면 프롬프트 끝에 추가
    if [ -n "$TRANSCRIPT" ]; then
        PROMPT="$PROMPT

<참고: YouTube 자막>
아래는 해당 영상의 자막입니다. 음식점 이름, 위치 힌트, 메뉴 정보 등을 파악하는 데 참고하세요.
---
$TRANSCRIPT
---
</참고: YouTube 자막>"
    fi
    
    # 임시 파일
    TEMP_RESPONSE="$PROJECT_ROOT/temp/retry_response_$LINE_NUM.json"
    TEMP_PROMPT="$PROJECT_ROOT/temp/retry_prompt_$LINE_NUM.txt"
    TEMP_STDERR="$PROJECT_ROOT/temp/retry_stderr_$LINE_NUM.log"
    echo "$PROMPT" > "$TEMP_PROMPT"
    
    # Gemini CLI 호출
    GEMINI_START=$(date +%s)
    if gemini -p "$(cat "$TEMP_PROMPT")" --output-format json --yolo > "$TEMP_RESPONSE" 2>"$TEMP_STDERR"; then
        GEMINI_END=$(date +%s)
        GEMINI_DURATION=$((GEMINI_END - GEMINI_START))
        TOTAL_GEMINI_TIME=$((TOTAL_GEMINI_TIME + GEMINI_DURATION))
        GEMINI_CALLS=$((GEMINI_CALLS + 1))
        log_debug "Gemini CLI 응답 완료 (${GEMINI_DURATION}s)"
        
        # 파서 실행
        PARSE_START=$(date +%s)
        if python3 "$PARSER_SCRIPT" "$URL" "$TEMP_RESPONSE" "$OUTPUT_FILE"; then
            PARSE_END=$(date +%s)
            PARSE_DURATION=$((PARSE_END - PARSE_START))
            TOTAL_PARSE_TIME=$((TOTAL_PARSE_TIME + PARSE_DURATION))
            SUCCESS=$((SUCCESS + 1))
            
            URL_END_TIME=$(date +%s)
            URL_DURATION=$((URL_END_TIME - URL_START_TIME))
            log_success "성공 ($SUCCESS/$TOTAL) - 총 ${URL_DURATION}s (Gemini: ${GEMINI_DURATION}s, Parse: ${PARSE_DURATION}s)"
            
            # 성공한 URL 기록 (에러 파일에서 삭제하기 위해)
            echo "$URL" >> "$SUCCESS_URLS_FILE"
        else
            PARSE_END=$(date +%s)
            PARSE_DURATION=$((PARSE_END - PARSE_START))
            TOTAL_PARSE_TIME=$((TOTAL_PARSE_TIME + PARSE_DURATION))
            FAILED=$((FAILED + 1))
            log_error "파서 실패 ($FAILED/$TOTAL)"
            echo "[$(date)] 재처리 파서 실패: $URL" >> "$RETRY_ERROR_LOG"
        fi
    else
        GEMINI_END=$(date +%s)
        GEMINI_DURATION=$((GEMINI_END - GEMINI_START))
        TOTAL_GEMINI_TIME=$((TOTAL_GEMINI_TIME + GEMINI_DURATION))
        GEMINI_CALLS=$((GEMINI_CALLS + 1))
        FAILED=$((FAILED + 1))
        log_error "Gemini CLI 호출 실패 ($FAILED/$TOTAL) - ${GEMINI_DURATION}s"
        echo "[$(date)] 재처리 Gemini CLI 실패: $URL" >> "$RETRY_ERROR_LOG"
        cat "$TEMP_STDERR" >> "$RETRY_ERROR_LOG" 2>/dev/null || true
    fi
    
    # 임시 파일 정리
    rm -f "$TEMP_RESPONSE" "$TEMP_PROMPT" "$TEMP_STDERR"
    
    # Rate Limit 준수 (60 RPM = 1초 대기)
    if [ $LINE_NUM -lt $TOTAL ]; then
        sleep 1
    fi
    
done < "$ERROR_JSONL"

# 성공한 URL을 에러 파일에서 제거
if [ -s "$SUCCESS_URLS_FILE" ]; then
    log_info ""
    log_info "🗑️  성공한 URL을 에러 파일에서 제거 중..."
    
    TEMP_ERROR_FILE="$PROJECT_ROOT/temp/temp_crawling_errors.jsonl"
    > "$TEMP_ERROR_FILE"
    REMOVED_COUNT=0
    
    while IFS= read -r line || [ -n "$line" ]; do
        URL=$(echo "$line" | jq -r '.youtube_link' 2>/dev/null)
        if grep -q "^$URL$" "$SUCCESS_URLS_FILE" 2>/dev/null; then
            REMOVED_COUNT=$((REMOVED_COUNT + 1))
        else
            echo "$line" >> "$TEMP_ERROR_FILE"
        fi
    done < "$ERROR_JSONL"
    
    mv "$TEMP_ERROR_FILE" "$ERROR_JSONL"
    REMAINING=$(wc -l < "$ERROR_JSONL" 2>/dev/null | tr -d ' ')
    log_success "에러 파일 업데이트 완료 (제거: ${REMOVED_COUNT}개, 남음: ${REMAINING}개)"
fi

# 임시 파일 정리
rm -f "$SUCCESS_URLS_FILE"

# 최종 종료 시간
END_TIME=$(date +%s)
END_DATETIME=$(date "+%Y-%m-%d %H:%M:%S")
TOTAL_DURATION=$((END_TIME - START_TIME))

# 결과 출력
log_info ""
log_info "========================================"
log_success "크롤링 에러 재처리 완료"
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
    "error_file": "$ERROR_JSONL",
    "output_file": "$OUTPUT_FILE",
    "retry_error_log": "$RETRY_ERROR_LOG"
  }
}
EOF

log_info ""
log_success "로그 파일 저장: $LOG_FILE"

# 최종 상태 출력
REMAINING=$(wc -l < "$ERROR_JSONL" 2>/dev/null | tr -d ' ')
if [ "$REMAINING" -eq 0 ]; then
    log_success "🎉 모든 에러가 성공적으로 처리되었습니다!"
else
    log_warning "⚠️  아직 ${REMAINING}개의 에러가 남아있습니다."
    log_info "   다시 실행하려면: $0"
fi
