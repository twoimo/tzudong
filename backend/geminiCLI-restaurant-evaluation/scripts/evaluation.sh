#!/usr/bin/env zsh
# Gemini CLI 기반 LAAJ 음식점 평가 스크립트
# RULE 평가 결과를 입력으로 받아 5개 LAAJ 평가 항목을 평가합니다.
# GitHub Actions 환경에서 실행 가능하도록 설계
# Note: zsh 사용 (macOS 기본 bash는 3.x로 연관 배열 미지원)

set -e  # 에러 발생 시 즉시 종료

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
LATEST_PATH=$(python3 "$DATA_UTILS_SCRIPT" latest_path "$DATA_DIR")

# 디렉토리 생성
mkdir -p "$TODAY_PATH"

# 입력: 오늘 또는 최신 폴더의 rule_results 파일
INPUT_FILE="$TODAY_PATH/tzuyang_restaurant_evaluation_rule_results.jsonl"
if [ ! -f "$INPUT_FILE" ] && [ -f "$LATEST_PATH/tzuyang_restaurant_evaluation_rule_results.jsonl" ]; then
    INPUT_FILE="$LATEST_PATH/tzuyang_restaurant_evaluation_rule_results.jsonl"
fi

# 출력: 오늘 날짜 폴더에 저장
OUTPUT_FILE="$TODAY_PATH/tzuyang_restaurant_evaluation_results.jsonl"
ERROR_FILE="$TODAY_PATH/tzuyang_restaurant_evaluation_errors.jsonl"
ERROR_LOG="$TODAY_PATH/tzuyang_restaurant_evaluation_errors.log"

# 로그 설정 (새 폴더 구조: report/text/structured)
LOG_BASE_DIR="$PROJECT_ROOT/../log/geminiCLI-restaurant"
LOG_REPORT_DIR=$(python3 "$DATA_UTILS_SCRIPT" log_type_path "$LOG_BASE_DIR" "report" "$TODAY_FOLDER")
LOG_TEXT_DIR=$(python3 "$DATA_UTILS_SCRIPT" log_type_path "$LOG_BASE_DIR" "text" "$TODAY_FOLDER")
LOG_STRUCTURED_DIR=$(python3 "$DATA_UTILS_SCRIPT" log_type_path "$LOG_BASE_DIR" "structured" "$TODAY_FOLDER")
mkdir -p "$LOG_REPORT_DIR" "$LOG_TEXT_DIR" "$LOG_STRUCTURED_DIR"
STAGE_NAME="evaluation"
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

# 디렉토리 생성
mkdir -p "$PROJECT_ROOT/temp"

log_info "============================================================"
log_info "  Gemini CLI LAAJ 음식점 평가 시작"
log_info "============================================================"
log_info "시작 시간: $START_DATETIME"
log_info "Gemini 모델: $GEMINI_MODEL"
log_info "오늘 날짜 폴더: $TODAY_FOLDER"
log_info "입력 폴더: $(dirname "$INPUT_FILE")"
log_info "출력 폴더: $(dirname "$OUTPUT_FILE")"

# 인자 검증
if [ ! -f "$INPUT_FILE" ]; then
    log_error "입력 파일 없음: $INPUT_FILE"
    log_warning "먼저 evaluation-rule.py를 실행하세요"
    exit 1
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

log_success "Gemini CLI 확인 완료"

# 이미 처리된 youtube_link 로드 - 모든 날짜 폴더에서
log_info "기존 처리 내역 확인 중..."
PROCESSED_LINKS=""

# 모든 날짜 폴더의 결과 파일에서 처리된 링크 수집
for result_file in "$DATA_DIR"/*/tzuyang_restaurant_evaluation_results.jsonl; do
    if [ -f "$result_file" ]; then
        LINKS_FROM_FILE=$(jq -r '.youtube_link' "$result_file" 2>/dev/null | sort -u)
        PROCESSED_LINKS="$PROCESSED_LINKS"$'\n'"$LINKS_FROM_FILE"
    fi
done

# 에러 파일에서도 수집
for error_file in "$DATA_DIR"/*/tzuyang_restaurant_evaluation_errors.jsonl; do
    if [ -f "$error_file" ]; then
        ERROR_LINKS=$(jq -r '.youtube_link' "$error_file" 2>/dev/null | sort -u)
        PROCESSED_LINKS="$PROCESSED_LINKS"$'\n'"$ERROR_LINKS"
    fi
done

PROCESSED_LINKS=$(echo "$PROCESSED_LINKS" | sort -u | grep -v '^$')
PROCESSED_COUNT=$(echo "$PROCESSED_LINKS" | grep -c . || echo "0")
log_info "이미 처리된 레코드 (전체 이력): ${PROCESSED_COUNT}개"

# youtube_meta 로드 (크롤링 결과 파일에서 - 오늘 또는 최신 폴더)
CRAWL_DATA_DIR="$PROJECT_ROOT/../geminiCLI-restaurant-crawling/data"
META_FILE="$CRAWL_DATA_DIR/$TODAY_FOLDER/tzuyang_restaurant_results_with_meta.jsonl"
if [ ! -f "$META_FILE" ]; then
    CRAWL_LATEST_PATH=$(python3 "$DATA_UTILS_SCRIPT" latest_path "$CRAWL_DATA_DIR")
    META_FILE="$CRAWL_LATEST_PATH/tzuyang_restaurant_results_with_meta.jsonl"
fi

declare -A META_MAP
if [ -f "$META_FILE" ]; then
    log_info "youtube_meta 데이터 로드 중... ($META_FILE)"
    while IFS= read -r meta_line || [ -n "$meta_line" ]; do
        meta_link=$(echo "$meta_line" | jq -r '.youtube_link' 2>/dev/null)
        meta_data=$(echo "$meta_line" | jq -c '.youtube_meta // {}' 2>/dev/null)
        if [ -n "$meta_link" ] && [ "$meta_link" != "null" ]; then
            META_MAP["$meta_link"]="$meta_data"
        fi
    done < "$META_FILE"
    log_success "youtube_meta 로드 완료: ${#META_MAP[@]}개"
else
    log_warning "youtube_meta 파일 없음 - youtube_meta 없이 진행합니다."
fi
log_info ""

# 통계 변수
TOTAL=0
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

# 입력 파일에서 레코드 수 계산
TOTAL=$(wc -l < "$INPUT_FILE" | tr -d ' ')

log_info "입력 파일: $INPUT_FILE"
log_info "출력 파일: $OUTPUT_FILE"
log_info "에러 파일: $ERROR_FILE"
log_info "총 레코드 수: $TOTAL"
log_info ""

# 프롬프트 템플릿 읽기
PROMPT_TEMPLATE=$(cat "$PROMPT_FILE")
log_debug "프롬프트 템플릿 로드 완료 (${#PROMPT_TEMPLATE}자)"

# 각 레코드 처리
LINE_NUM=0
while IFS= read -r line; do
    LINE_NUM=$((LINE_NUM + 1))
    RECORD_START_TIME=$(date +%s)
    
    # 빈 줄 건너뛰기
    if [ -z "$line" ]; then
        continue
    fi
    
    # JSON 파싱 (jq 사용)
    YOUTUBE_LINK=$(echo "$line" | jq -r '.youtube_link')
    EVALUATION_TARGET=$(echo "$line" | jq -c '.evaluation_target')
    RESTAURANTS=$(echo "$line" | jq -c '.restaurants')
    
    # youtube_meta는 크롤링 결과 파일에서 로드한 META_MAP에서 가져옴
    YOUTUBE_META="${META_MAP["$YOUTUBE_LINK"]}"
    if [[ -z "$YOUTUBE_META" ]]; then
        YOUTUBE_META="{}"
    fi
    
    # 이미 처리된 레코드인지 확인
    if echo "$PROCESSED_LINKS" | grep -q "^$YOUTUBE_LINK$"; then
        SKIPPED=$((SKIPPED + 1))
        if [ $((SKIPPED % 100)) -eq 1 ]; then
            log_warning "[$LINE_NUM/$TOTAL] 건너뜀 (이미 처리됨)"
        fi
        continue
    fi
    
    # evaluation_target에서 true인 식당만 필터링
    # jq로 evaluation_target의 키가 true인 식당만 선택
    RESTAURANTS_TO_EVALUATE=$(echo "$line" | jq -c --argjson et "$EVALUATION_TARGET" '[.restaurants[] | select($et[.name] == true)]' 2>/dev/null)
    
    # 필터링 실패 시 전체 restaurants 사용
    if [[ -z "$RESTAURANTS_TO_EVALUATE" ]] || [[ "$RESTAURANTS_TO_EVALUATE" = "null" ]] || [[ "$RESTAURANTS_TO_EVALUATE" = "[]" ]]; then
        RESTAURANTS_TO_EVALUATE="$RESTAURANTS"
    fi
    
    RESTAURANT_COUNT=$(echo "$RESTAURANTS_TO_EVALUATE" | jq 'length' 2>/dev/null || echo "0")
    
    if [[ "$RESTAURANT_COUNT" -eq 0 ]] || [[ -z "$RESTAURANT_COUNT" ]]; then
        log_warning "[$LINE_NUM/$TOTAL] 건너뜀 - 평가 대상 없음"
        SKIPPED=$((SKIPPED + 1))
        continue
    fi
    
    TOTAL_RESTAURANTS_EVALUATED=$((TOTAL_RESTAURANTS_EVALUATED + RESTAURANT_COUNT))
    log_info "[$LINE_NUM/$TOTAL] 평가중: $YOUTUBE_LINK"
    log_debug "평가 대상 음식점: ${RESTAURANT_COUNT}개"
    
    # YouTube 자막 가져오기 (필수 - 자막 없으면 평가 스킵)
    TRANSCRIPT=""
    if [ -f "$TRANSCRIPT_SCRIPT" ]; then
        TRANSCRIPT_START=$(date +%s)
        TRANSCRIPT=$(python3 "$TRANSCRIPT_SCRIPT" "$YOUTUBE_LINK" 50000 2>/dev/null || echo "")
        TRANSCRIPT_END=$(date +%s)
        TRANSCRIPT_DURATION=$((TRANSCRIPT_END - TRANSCRIPT_START))
        TOTAL_TRANSCRIPT_TIME=$((TOTAL_TRANSCRIPT_TIME + TRANSCRIPT_DURATION))
        
        if [ -n "$TRANSCRIPT" ]; then
            log_debug "자막 로드 완료 (${#TRANSCRIPT}자, ${TRANSCRIPT_DURATION}s)"
            TRANSCRIPT_SUCCESS=$((TRANSCRIPT_SUCCESS + 1))
        else
            log_warning "[$LINE_NUM/$TOTAL] 건너뜀 - 자막 없음 (${TRANSCRIPT_DURATION}s)"
            TRANSCRIPT_FAILED=$((TRANSCRIPT_FAILED + 1))
            SKIPPED=$((SKIPPED + 1))
            continue
        fi
    else
        log_warning "[$LINE_NUM/$TOTAL] 건너뜀 - 자막 스크립트 없음"
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
    
    # 자막이 있으면 프롬프트 끝에 추가
    if [ -n "$TRANSCRIPT" ]; then
        PROMPT="$PROMPT

<참고: YouTube 자막>
아래는 해당 영상의 자막입니다. 유튜버의 실제 발언, 음식점 언급, 리뷰 내용을 확인하는 데 참고하세요.
---
$TRANSCRIPT
---
</참고: YouTube 자막>"
    fi
    
    # 임시 응답 파일
    TEMP_RESPONSE="$PROJECT_ROOT/temp/eval_response_$LINE_NUM.json"
    TEMP_PROMPT="$PROJECT_ROOT/temp/eval_prompt_$LINE_NUM.txt"
    TEMP_STDERR="$PROJECT_ROOT/temp/eval_stderr_$LINE_NUM.log"
    TEMP_META="$PROJECT_ROOT/temp/eval_meta_$LINE_NUM.json"
    
    # youtube_meta를 임시 파일로 저장 (JSON 이스케이프 문제 방지)
    echo "$YOUTUBE_META" > "$TEMP_META"
    
    # 프롬프트를 파일로 저장 (특수문자 이스케이프 문제 방지)
    echo "$PROMPT" > "$TEMP_PROMPT"
    
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
            --output-file "$OUTPUT_FILE" \
            --evaluation-target "$EVALUATION_TARGET" \
            --restaurants "$RESTAURANTS" \
            --youtube-meta-file "$TEMP_META" \
            --rule-results-file "$INPUT_FILE"; then
            
            PARSE_END=$(date +%s)
            PARSE_DURATION=$((PARSE_END - PARSE_START))
            TOTAL_PARSE_TIME=$((TOTAL_PARSE_TIME + PARSE_DURATION))
            SUCCESS=$((SUCCESS + 1))
            
            RECORD_END_TIME=$(date +%s)
            RECORD_DURATION=$((RECORD_END_TIME - RECORD_START_TIME))
            log_success "성공 ($SUCCESS/$TOTAL) - 총 ${RECORD_DURATION}s (Gemini: ${GEMINI_DURATION}s, Parse: ${PARSE_DURATION}s)"
        else
            PARSE_END=$(date +%s)
            PARSE_DURATION=$((PARSE_END - PARSE_START))
            TOTAL_PARSE_TIME=$((TOTAL_PARSE_TIME + PARSE_DURATION))
            FAILED=$((FAILED + 1))
            log_error "파서 실패 ($FAILED/$TOTAL)"
            echo "[$(date)] 파서 실패: $YOUTUBE_LINK" >> "$ERROR_LOG"
            
            # 에러 레코드 저장 (youtube_meta 포함) - 파일에서 읽기
            ERROR_RECORD=$(echo "$line" | jq -c --slurpfile meta "$TEMP_META" '. + {youtube_meta: $meta[0]}')
            echo "$ERROR_RECORD" >> "$ERROR_FILE"
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
        
        # 에러 레코드 저장 (youtube_meta 포함) - 파일에서 읽기
        ERROR_RECORD=$(echo "$line" | jq -c --slurpfile meta "$TEMP_META" '. + {youtube_meta: $meta[0]}')
        echo "$ERROR_RECORD" >> "$ERROR_FILE"
    fi
    
    # 임시 파일 정리
    rm -f "$TEMP_RESPONSE" "$TEMP_PROMPT" "$TEMP_META"
    
    # Rate Limit 준수 (60 RPM = 1초 대기)
    sleep 1
    
done < "$INPUT_FILE"

# 최종 종료 시간
END_TIME=$(date +%s)
END_DATETIME=$(date "+%Y-%m-%d %H:%M:%S")
TOTAL_DURATION=$((END_TIME - START_TIME))

# 결과 출력
log_info ""
log_info "========================================"
log_success "LAAJ 평가 완료"
log_info "========================================"
log_info "⏱️  총 소요 시간: $(format_duration $TOTAL_DURATION)"
log_info ""
log_info "📊 처리 통계:"
log_success "  성공: $SUCCESS"
log_warning "  건너뜀: $SKIPPED"
log_error "  실패: $FAILED"
log_info "  총 레코드: $TOTAL"
log_info "  총 음식점 평가: $TOTAL_RESTAURANTS_EVALUATED"
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
log_info ""
log_info "⚙️  파서 통계:"
log_info "  총 파싱 시간: $(format_duration $TOTAL_PARSE_TIME)"
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
    "total_records": $TOTAL,
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
    "input_file": "$INPUT_FILE",
    "output_file": "$OUTPUT_FILE",
    "error_file": "$ERROR_FILE",
    "error_log": "$ERROR_LOG"
  }
}
EOF

log_info ""
log_success "로그 파일 저장: $LOG_FILE"

if [ $FAILED -gt 0 ]; then
    log_warning "실패한 레코드는 $ERROR_FILE에 저장되었습니다."
    log_info "재실행: $SCRIPT_DIR/retry_errors.sh"
fi
