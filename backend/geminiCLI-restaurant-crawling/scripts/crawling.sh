#!/bin/bash
# Gemini CLI 기반 음식점 크롤링 스크립트
# GitHub Actions 환경에서 실행 가능하도록 설계

set -e  # 에러 발생 시 즉시 종료

# .env 파일 로드 (GitHub Actions에서 환경변수 전달용)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "[$(date '+%H:%M:%S')] 📂 SCRIPT_DIR: $SCRIPT_DIR"
echo "[$(date '+%H:%M:%S')] 📂 PROJECT_ROOT: $PROJECT_ROOT"

# .env 파일 경로들 (우선순위: 프로젝트 > backend)
ENV_FILES=(
    "$PROJECT_ROOT/.env"
    "$PROJECT_ROOT/../.env"
)

ENV_LOADED=false
for env_file in "${ENV_FILES[@]}"; do
    echo "[$(date '+%H:%M:%S')] 🔍 .env 파일 확인 중: $env_file"
    if [ -f "$env_file" ]; then
        echo "[$(date '+%H:%M:%S')] ✅ .env 파일 발견! 로드 중..."
        echo "[$(date '+%H:%M:%S')] 📝 .env 파일 내용:"
        cat "$env_file" | while read line; do
            # 값은 마스킹하고 키만 표시
            key=$(echo "$line" | cut -d'=' -f1)
            val=$(echo "$line" | cut -d'=' -f2-)
            if [ -n "$val" ]; then
                echo "[$(date '+%H:%M:%S')]    $key=***설정됨***"
            else
                echo "[$(date '+%H:%M:%S')]    $key=(비어있음)"
            fi
        done
        set -a  # export all variables
        source "$env_file"
        set +a
        ENV_LOADED=true
        echo "[$(date '+%H:%M:%S')] 📝 .env 파일 로드 완료: $env_file"
        # 로드 후 환경변수 확인
        if [ -n "$GEMINI_API_KEY" ]; then
            echo "[$(date '+%H:%M:%S')] ✅ GEMINI_API_KEY 로드됨 (길이: ${#GEMINI_API_KEY})"
        else
            echo "[$(date '+%H:%M:%S')] ❌ GEMINI_API_KEY 로드 안됨"
        fi
        break
    else
        echo "[$(date '+%H:%M:%S')] ⚠️ 파일 없음: $env_file"
    fi
done

if [ "$ENV_LOADED" = false ]; then
    echo "[$(date '+%H:%M:%S')] ⚠️ .env 파일을 찾지 못했습니다"
    if [ -n "$GEMINI_API_KEY" ]; then
        echo "[$(date '+%H:%M:%S')] ✅ GEMINI_API_KEY 환경변수로 이미 설정됨"
    else
        echo "[$(date '+%H:%M:%S')] ❌ GEMINI_API_KEY 환경변수 없음"
    fi
fi

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

# 설정 (SCRIPT_DIR, PROJECT_ROOT는 위에서 이미 정의됨)
UTILS_DIR="$(cd "$PROJECT_ROOT/../utils" && pwd)"
PROMPT_FILE="$PROJECT_ROOT/prompts/crawling_prompt.txt"
PARSER_SCRIPT="$SCRIPT_DIR/parse_result.py"
DATA_UTILS_SCRIPT="$UTILS_DIR/data_utils.py"

# Transcript JSON 파일명 (로컬 FastAPI에서 생성)
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

# ============================
# 입력: 모든 날짜 폴더의 URL 파일을 합침
# ============================
# 임시 파일에 모든 URL 수집 (중복 제거)
ALL_URLS_TEMP="$PROJECT_ROOT/temp/all_urls.txt"
mkdir -p "$PROJECT_ROOT/temp"
> "$ALL_URLS_TEMP"  # 파일 초기화

URL_FILE_COUNT=0
for url_file in "$DATA_DIR"/*/tzuyang_youtubeVideo_urls.txt; do
    if [ -f "$url_file" ]; then
        cat "$url_file" >> "$ALL_URLS_TEMP"
        URL_FILE_COUNT=$((URL_FILE_COUNT + 1))
    fi
done

# 중복 제거 및 빈 줄 제거
sort -u "$ALL_URLS_TEMP" | grep -v '^$' > "${ALL_URLS_TEMP}.sorted"
mv "${ALL_URLS_TEMP}.sorted" "$ALL_URLS_TEMP"

# URL 파일로 사용
URL_FILE="$ALL_URLS_TEMP"

# 출력: 오늘 날짜 폴더에 저장
OUTPUT_FILE="${2:-$TODAY_PATH/tzuyang_restaurant_results.jsonl}"
ERROR_LOG="${3:-$TODAY_PATH/tzuyang_restaurant_errors.log}"
# 에러 URL을 재처리할 수 있도록 JSONL로도 저장
ERROR_JSONL="$TODAY_PATH/tzuyang_crawling_errors.jsonl"

# 로그 설정 (새 폴더 구조: report/text/structured)
LOG_BASE_DIR="$PROJECT_ROOT/../log/geminiCLI-restaurant"
LOG_REPORT_DIR=$(python3 "$DATA_UTILS_SCRIPT" log_type_path "$LOG_BASE_DIR" "report" "$TODAY_FOLDER")
LOG_TEXT_DIR=$(python3 "$DATA_UTILS_SCRIPT" log_type_path "$LOG_BASE_DIR" "text" "$TODAY_FOLDER")
LOG_STRUCTURED_DIR=$(python3 "$DATA_UTILS_SCRIPT" log_type_path "$LOG_BASE_DIR" "structured" "$TODAY_FOLDER")
mkdir -p "$LOG_REPORT_DIR" "$LOG_TEXT_DIR" "$LOG_STRUCTURED_DIR"
STAGE_NAME="crawling"
START_TIME=$(date +%s)
START_DATETIME=$(date "+%Y-%m-%d %H:%M:%S")
LOG_FILE="$LOG_REPORT_DIR/${STAGE_NAME}_$(date +%H%M%S).json"

# 타이머 데이터를 저장할 임시 파일
TIMER_DATA_FILE="$PROJECT_ROOT/temp/timer_data.json"
echo '{}' > "$TIMER_DATA_FILE"

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
log_info "  Gemini CLI 음식점 크롤링 시작"
log_info "============================================================"
log_info "시작 시간: $START_DATETIME"
log_info "Gemini 모델: $GEMINI_MODEL"
log_info "오늘 날짜 폴더: $TODAY_FOLDER"
log_info "URL 파일 소스: ${URL_FILE_COUNT}개 폴더에서 수집"
log_info "출력 폴더: $(dirname "$OUTPUT_FILE")"

# 인자 검증
if [ ! -f "$URL_FILE" ] || [ ! -s "$URL_FILE" ]; then
    log_error "URL 파일 없음 또는 비어있음: $URL_FILE"
    log_error "먼저 api-youtube-urls.yml을 실행하여 URL을 수집하세요."
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
    echo "설치 방법: npm install -g @google/gemini-cli" >&2
    exit 1
fi

log_success "Gemini CLI 확인 완료"

# GEMINI_API_KEY 환경변수 확인 (headless 모드 필수)
if [ -z "$GEMINI_API_KEY" ]; then
    # .env에서 GEMINI_API_KEY_BYEON을 GEMINI_API_KEY로 설정
    if [ -n "$GEMINI_API_KEY_BYEON" ]; then
        export GEMINI_API_KEY="$GEMINI_API_KEY_BYEON"
        log_success "GEMINI_API_KEY 설정 완료 (from GEMINI_API_KEY_BYEON)"
    else
        log_error "GEMINI_API_KEY 환경변수가 설정되지 않았습니다"
        log_error "headless 모드에서는 API 키가 필수입니다"
        exit 1
    fi
else
    log_success "GEMINI_API_KEY 환경변수 확인 완료"
fi

# 통계 변수
TOTAL=0
SUCCESS=0
FAILED=0
GEMINI_CALLS=0
TRANSCRIPT_SUCCESS=0
TRANSCRIPT_FAILED=0
TOTAL_GEMINI_TIME=0
TOTAL_PARSE_TIME=0
NO_TRANSCRIPT_COUNT=0

# URL 목록 읽기 (macOS/zsh 호환)
URLS=()
while IFS= read -r line || [ -n "$line" ]; do
    [ -n "$line" ] && URLS+=("$line")
done < "$URL_FILE"
TOTAL=${#URLS[@]}

# 이미 처리된 URL 로드 (중복 처리 방지) - 모든 날짜 폴더에서
PROCESSED_URLS=""
SKIPPED=0

# 모든 날짜 폴더의 결과 파일에서 처리된 URL 수집
for result_file in "$DATA_DIR"/*/tzuyang_restaurant_results.jsonl; do
    if [ -f "$result_file" ]; then
        URLS_FROM_FILE=$(jq -r '.youtube_link' "$result_file" 2>/dev/null | sort -u)
        PROCESSED_URLS="$PROCESSED_URLS"$'\n'"$URLS_FROM_FILE"
    fi
done

if [ -f "$OUTPUT_FILE" ]; then
    URLS_FROM_OUTPUT=$(jq -r '.youtube_link' "$OUTPUT_FILE" 2>/dev/null | sort -u)
    PROCESSED_URLS="$PROCESSED_URLS"$'\n'"$URLS_FROM_OUTPUT"
fi

PROCESSED_URLS=$(echo "$PROCESSED_URLS" | sort -u | grep -v '^$')
PROCESSED_COUNT=$(echo "$PROCESSED_URLS" | grep -c . || echo "0")
log_info "이미 처리된 URL (전체 이력): ${PROCESSED_COUNT}개"

log_info "URL 파일: $URL_FILE"
log_info "출력 파일: $OUTPUT_FILE"
log_info "총 URL 수: $TOTAL"
log_info ""

# ============================
# Transcript JSON 파일 로드 (모든 날짜 폴더에서)
# ============================
log_info "📝 Transcript 파일 로드 중..."

# 모든 transcript를 임시 파일에 모음
TRANSCRIPT_TEMP="$PROJECT_ROOT/temp/all_transcripts.json"
echo '{}' > "$TRANSCRIPT_TEMP"

TRANSCRIPT_FILE_COUNT=0
TOTAL_TRANSCRIPT_COUNT=0

for transcript_file in "$DATA_DIR"/*/"$TRANSCRIPT_FILENAME"; do
    if [ -f "$transcript_file" ]; then
        TRANSCRIPT_FILE_COUNT=$((TRANSCRIPT_FILE_COUNT + 1))
        FILE_COUNT=$(jq 'length' "$transcript_file" 2>/dev/null || echo "0")
        TOTAL_TRANSCRIPT_COUNT=$((TOTAL_TRANSCRIPT_COUNT + FILE_COUNT))
        log_debug "  Transcript 파일 발견: $transcript_file ($FILE_COUNT개)"
    fi
done

log_info "📝 Transcript 파일: ${TRANSCRIPT_FILE_COUNT}개, 총 ${TOTAL_TRANSCRIPT_COUNT}개의 자막"

if [ $TOTAL_TRANSCRIPT_COUNT -eq 0 ]; then
    log_error "⚠️ Transcript가 없습니다. 로컬 FastAPI로 자막을 먼저 수집하세요."
    log_error "   cd backend/transcript-api && uvicorn main:app --reload"
    exit 1
fi

# 프롬프트 템플릿 읽기
PROMPT_TEMPLATE=$(cat "$PROMPT_FILE")
log_debug "프롬프트 템플릿 로드 완료 (${#PROMPT_TEMPLATE}자)"

# ============================
# No Transcript 영구 제외 목록 로드
# ============================
NO_TRANSCRIPT_DIR="$DATA_DIR/no_transcript_link"
NO_TRANSCRIPT_PERMANENT="$NO_TRANSCRIPT_DIR/no_transcript_permanent.json"
mkdir -p "$NO_TRANSCRIPT_DIR"

# 파일이 없으면 빈 배열로 초기화
if [ ! -f "$NO_TRANSCRIPT_PERMANENT" ]; then
    echo '[]' > "$NO_TRANSCRIPT_PERMANENT"
fi

# 영구 제외 목록 (retry_num >= 3) 로드
PERMANENT_SKIP_URLS=$(jq -r '.[] | select(.retry_num >= 3) | .youtube_link' "$NO_TRANSCRIPT_PERMANENT" 2>/dev/null || echo "")
PERMANENT_SKIP_COUNT=$(echo "$PERMANENT_SKIP_URLS" | grep -c . || echo "0")
log_info "📛 영구 제외 URL (retry >= 3): ${PERMANENT_SKIP_COUNT}개"

# Transcript 없는 URL 카운트
NO_TRANSCRIPT_COUNT=0
NO_TRANSCRIPT_LOG="$TODAY_PATH/tzuyang_no_transcript.log"
> "$NO_TRANSCRIPT_LOG"  # 로그 파일 초기화

# 각 URL 처리
for i in "${!URLS[@]}"; do
    URL="${URLS[$i]}"
    INDEX=$((i + 1))
    URL_START_TIME=$(date +%s)
    
    # 빈 줄 건너뛰기
    if [ -z "$URL" ]; then
        continue
    fi
    
    # 영구 제외 URL 스킵 (retry_num >= 3)
    if echo "$PERMANENT_SKIP_URLS" | grep -q "^$URL$"; then
        SKIPPED=$((SKIPPED + 1))
        continue
    fi
    
    # 이미 처리된 URL 스킵
    if echo "$PROCESSED_URLS" | grep -q "^$URL$"; then
        SKIPPED=$((SKIPPED + 1))
        if [ $((SKIPPED % 50)) -eq 1 ]; then
            log_warning "[$INDEX/$TOTAL] 이미 처리됨 (스킵 ${SKIPPED}개)"
        fi
        continue
    fi
    
    log_info "[$INDEX/$TOTAL] 처리중: $URL"
    
    # ============================
    # Transcript JSON에서 자막 조회
    # ============================
    TRANSCRIPT=""
    TRANSCRIPT_FOUND=false
    TRANSCRIPT_LANGUAGE=""
    
    # 모든 날짜 폴더의 transcript 파일에서 검색
    for transcript_file in "$DATA_DIR"/*/"$TRANSCRIPT_FILENAME"; do
        if [ -f "$transcript_file" ]; then
            # jq로 해당 URL의 transcript 추출
            # transcript 배열을 텍스트로 변환 (start + text)
            TRANSCRIPT=$(jq -r --arg url "$URL" '
                .[] | select(.youtube_link == $url) | 
                .transcript | 
                map("[\((.start / 60 | floor | tostring | if length < 2 then "0" + . else . end)):\((.start % 60 | floor | tostring | if length < 2 then "0" + . else . end))] \(.text)") | 
                join("\n")
            ' "$transcript_file" 2>/dev/null)
            
            # language 필드도 추출
            TRANSCRIPT_LANGUAGE=$(jq -r --arg url "$URL" '
                .[] | select(.youtube_link == $url) | .language // "unknown"
            ' "$transcript_file" 2>/dev/null)
            
            if [ -n "$TRANSCRIPT" ]; then
                TRANSCRIPT_FOUND=true
                log_debug "자막 발견: $(echo "$TRANSCRIPT" | wc -c | tr -d ' ')자, 언어: $TRANSCRIPT_LANGUAGE (from $transcript_file)"
                TRANSCRIPT_SUCCESS=$((TRANSCRIPT_SUCCESS + 1))
                break
            fi
        fi
    done
    
    # Transcript가 없으면 스킵 + retry_num 증가
    if [ "$TRANSCRIPT_FOUND" = false ]; then
        NO_TRANSCRIPT_COUNT=$((NO_TRANSCRIPT_COUNT + 1))
        TRANSCRIPT_FAILED=$((TRANSCRIPT_FAILED + 1))
        
        # no_transcript_permanent.json에 retry_num 증가
        CURRENT_RETRY=$(jq -r --arg url "$URL" '.[] | select(.youtube_link == $url) | .retry_num' "$NO_TRANSCRIPT_PERMANENT" 2>/dev/null || echo "0")
        if [ -z "$CURRENT_RETRY" ] || [ "$CURRENT_RETRY" = "null" ]; then
            CURRENT_RETRY=0
        fi
        NEW_RETRY=$((CURRENT_RETRY + 1))
        
        # 기존 항목 업데이트 또는 새 항목 추가
        if [ "$CURRENT_RETRY" -eq 0 ]; then
            # 새 항목 추가
            jq --arg url "$URL" --argjson retry "$NEW_RETRY" '. += [{"youtube_link": $url, "retry_num": $retry}]' "$NO_TRANSCRIPT_PERMANENT" > "${NO_TRANSCRIPT_PERMANENT}.tmp" && mv "${NO_TRANSCRIPT_PERMANENT}.tmp" "$NO_TRANSCRIPT_PERMANENT"
        else
            # 기존 항목 업데이트
            jq --arg url "$URL" --argjson retry "$NEW_RETRY" '(.[] | select(.youtube_link == $url) | .retry_num) = $retry' "$NO_TRANSCRIPT_PERMANENT" > "${NO_TRANSCRIPT_PERMANENT}.tmp" && mv "${NO_TRANSCRIPT_PERMANENT}.tmp" "$NO_TRANSCRIPT_PERMANENT"
        fi
        
        if [ "$NEW_RETRY" -ge 3 ]; then
            log_warning "[$INDEX/$TOTAL] ⚠️ Transcript 없음 (retry $NEW_RETRY/3) - 영구 제외: $URL"
        else
            log_warning "[$INDEX/$TOTAL] ⚠️ Transcript 없음 (retry $NEW_RETRY/3) - 스킵: $URL"
        fi
        echo "$URL" >> "$NO_TRANSCRIPT_LOG"
        continue
    fi
    
    # 프롬프트에 URL 삽입 (<유튜브 링크> 플레이스홀더 치환)
    PROMPT="${PROMPT_TEMPLATE//<유튜브 링크>/$URL}"
    
    # 자막이 있으면 프롬프트 끝에 추가 (언어 정보 포함)
    if [ -n "$TRANSCRIPT" ]; then
        PROMPT="$PROMPT

<참고: YouTube 자막>
아래는 해당 영상의 자막입니다. 음식점 이름, 위치 힌트, 메뉴 정보 등을 파악하는 데 참고하세요.
[자막 언어: $TRANSCRIPT_LANGUAGE]
※ 자막이 한국어가 아닐 수 있지만, 모든 결과(reasoning_basis, tzuyang_review 등)는 반드시 한국어로 작성하세요.
---
$TRANSCRIPT
---
</참고: YouTube 자막>"
    fi
    
    # 임시 응답 파일
    TEMP_RESPONSE="$PROJECT_ROOT/temp/response_$INDEX.json"
    
    # Gemini CLI 호출 (GEMINI_MODEL 환경변수로 모델 설정)
    # 프롬프트를 파일로 저장하고 -p 플래그로 전달 (각 요청이 독립적인 세션으로 실행)
    # --yolo: 도구 사용 시 자동 승인 (확인 프롬프트 없이 진행)
    # -p: 단일 프롬프트 모드 (이전 대화 히스토리 없이 독립 실행)
    # stderr는 별도 파일로 분리 (JSON 파싱 오류 방지)
    TEMP_PROMPT="$PROJECT_ROOT/temp/prompt_$INDEX.txt"
    TEMP_STDERR="$PROJECT_ROOT/temp/stderr_$INDEX.log"
    echo "$PROMPT" > "$TEMP_PROMPT"
    
    GEMINI_START=$(date +%s)
    if gemini -p "$(cat "$TEMP_PROMPT")" --output-format json --yolo > "$TEMP_RESPONSE" 2>"$TEMP_STDERR"; then
        GEMINI_END=$(date +%s)
        GEMINI_DURATION=$((GEMINI_END - GEMINI_START))
        TOTAL_GEMINI_TIME=$((TOTAL_GEMINI_TIME + GEMINI_DURATION))
        GEMINI_CALLS=$((GEMINI_CALLS + 1))
        log_debug "Gemini CLI 응답 완료 (${GEMINI_DURATION}s)"
        
        # 파서 실행 (최대 2회 시도)
        PARSE_SUCCESS=false
        for PARSE_ATTEMPT in 1 2; do
            PARSE_START=$(date +%s)
            if python3 "$PARSER_SCRIPT" "$URL" "$TEMP_RESPONSE" "$OUTPUT_FILE"; then
                PARSE_END=$(date +%s)
                PARSE_DURATION=$((PARSE_END - PARSE_START))
                TOTAL_PARSE_TIME=$((TOTAL_PARSE_TIME + PARSE_DURATION))
                SUCCESS=$((SUCCESS + 1))
                PARSE_SUCCESS=true
                
                URL_END_TIME=$(date +%s)
                URL_DURATION=$((URL_END_TIME - URL_START_TIME))
                log_success "성공 ($SUCCESS/$TOTAL) - 총 ${URL_DURATION}s (Gemini: ${GEMINI_DURATION}s, Parse: ${PARSE_DURATION}s)"
                break
            else
                PARSE_END=$(date +%s)
                PARSE_DURATION=$((PARSE_END - PARSE_START))
                TOTAL_PARSE_TIME=$((TOTAL_PARSE_TIME + PARSE_DURATION))
                
                if [ $PARSE_ATTEMPT -eq 1 ]; then
                    log_warning "파서 실패 (1차 시도) - 재시도 중..."
                    sleep 1
                    # Gemini CLI 재호출
                    GEMINI_START=$(date +%s)
                    if gemini -p "$(cat "$TEMP_PROMPT")" --output-format json --yolo > "$TEMP_RESPONSE" 2>"$TEMP_STDERR"; then
                        GEMINI_END=$(date +%s)
                        GEMINI_DURATION=$((GEMINI_END - GEMINI_START))
                        TOTAL_GEMINI_TIME=$((TOTAL_GEMINI_TIME + GEMINI_DURATION))
                        GEMINI_CALLS=$((GEMINI_CALLS + 1))
                        log_debug "Gemini CLI 재시도 응답 완료 (${GEMINI_DURATION}s)"
                    else
                        log_error "Gemini CLI 재시도 실패"
                        break
                    fi
                fi
            fi
        done
        
        if [ "$PARSE_SUCCESS" = false ]; then
            FAILED=$((FAILED + 1))
            log_error "파서 실패 (2회 시도 후) ($FAILED/$TOTAL)"
            echo "[$(date)] 파서 실패 (2회 시도 후): $URL" >> "$ERROR_LOG"
            # 에러 URL을 JSONL로 저장 (재처리용)
            echo "{\"youtube_link\": \"$URL\", \"error_type\": \"parser_error\", \"timestamp\": \"$(date -Iseconds)\"}" >> "$ERROR_JSONL"
        fi
    else
        GEMINI_END=$(date +%s)
        GEMINI_DURATION=$((GEMINI_END - GEMINI_START))
        TOTAL_GEMINI_TIME=$((TOTAL_GEMINI_TIME + GEMINI_DURATION))
        GEMINI_CALLS=$((GEMINI_CALLS + 1))
        FAILED=$((FAILED + 1))
        log_error "Gemini CLI 호출 실패 ($FAILED/$TOTAL) - ${GEMINI_DURATION}s"
        echo "[$(date)] Gemini CLI 실패: $URL" >> "$ERROR_LOG"
        cat "$TEMP_RESPONSE" >> "$ERROR_LOG"
        # stderr 로그도 출력 (디버깅용)
        if [ -f "$TEMP_STDERR" ] && [ -s "$TEMP_STDERR" ]; then
            log_error "Gemini CLI stderr:"
            cat "$TEMP_STDERR"
            echo "[$(date)] Gemini CLI stderr:" >> "$ERROR_LOG"
            cat "$TEMP_STDERR" >> "$ERROR_LOG"
        fi
        # 에러 URL을 JSONL로 저장 (재처리용)
        echo "{\"youtube_link\": \"$URL\", \"error_type\": \"gemini_error\", \"timestamp\": \"$(date -Iseconds)\"}" >> "$ERROR_JSONL"
    fi
    
    # 임시 파일 정리
    rm -f "$TEMP_RESPONSE" "$TEMP_PROMPT" "$TEMP_STDERR"
    
    # Rate Limit 준수 (60 RPM = 1초 대기)
    if [ $INDEX -lt $TOTAL ]; then
        sleep 1
    fi
done

# 크롤링 종료 시간
CRAWL_END_TIME=$(date +%s)
CRAWL_DURATION=$((CRAWL_END_TIME - START_TIME))

# 결과 출력
log_info ""
log_info "========================================"
log_success "크롤링 완료"
log_info "========================================"
log_info "⏱️  총 소요 시간: $(format_duration $CRAWL_DURATION)"
log_info ""
log_info "📊 처리 통계:"
log_success "  성공: $SUCCESS"
log_warning "  건너뜀 (이미 처리됨): $SKIPPED"
log_warning "  건너뜀 (Transcript 없음): $NO_TRANSCRIPT_COUNT"
log_error "  실패: $FAILED"
log_info "  총 URL: $TOTAL"
log_info ""
log_info "🤖 Gemini CLI 통계:"
log_info "  총 호출 수: $GEMINI_CALLS"
log_info "  총 Gemini 시간: $(format_duration $TOTAL_GEMINI_TIME)"
if [ $GEMINI_CALLS -gt 0 ]; then
    AVG_GEMINI=$((TOTAL_GEMINI_TIME / GEMINI_CALLS))
    log_info "  평균 Gemini 시간: $(format_duration $AVG_GEMINI)"
fi
log_info ""
log_info "📝 Transcript 통계:"
log_info "  Transcript 있음: $TRANSCRIPT_SUCCESS"
log_info "  Transcript 없음: $TRANSCRIPT_FAILED"
if [ $NO_TRANSCRIPT_COUNT -gt 0 ]; then
    log_warning "  ⚠️ Transcript 없는 URL 로그: $NO_TRANSCRIPT_LOG"
fi
log_info ""
log_info "⚙️  파서 통계:"
log_info "  총 파싱 시간: $(format_duration $TOTAL_PARSE_TIME)"
log_info "========================================"

# ========================================
# 좌표 Enrichment (카카오 API)
# ========================================
ENRICH_SUCCESS=0
ENRICH_DURATION=0
ENRICH_COUNT=0
if [ $SUCCESS -gt 0 ]; then
    log_info ""
    log_info "========================================"
    log_info "📍 좌표 Enrichment 시작 (카카오 API)..."
    log_info "========================================"
    
    ENRICH_SCRIPT="$SCRIPT_DIR/enrich-coordinates.js"
    
    if [ -f "$ENRICH_SCRIPT" ]; then
        ENRICH_START=$(date +%s)
        # node 실행 전 npm 패키지 확인 (PROJECT_ROOT에서 실행)
        if [ -f "$PROJECT_ROOT/package.json" ]; then
            cd "$PROJECT_ROOT"
            npm install --silent 2>/dev/null || true
            cd "$SCRIPT_DIR"
        fi
        
        if node "$ENRICH_SCRIPT" "$OUTPUT_FILE" 2>&1 | tee -a "$LOG_TEXT_DIR/enrich_coordinates.log"; then
            ENRICH_END=$(date +%s)
            ENRICH_DURATION=$((ENRICH_END - ENRICH_START))
            ENRICH_SUCCESS=1
            # 보완된 좌표 개수 추출 (로그에서 파싱)
            ENRICH_COUNT=$(grep -o '좌표 보완됨: [0-9]*' "$LOG_TEXT_DIR/enrich_coordinates.log" | grep -o '[0-9]*' || echo "0")
            log_success "좌표 Enrichment 완료 ($(format_duration $ENRICH_DURATION)) - ${ENRICH_COUNT}개 보완"
        else
            ENRICH_END=$(date +%s)
            ENRICH_DURATION=$((ENRICH_END - ENRICH_START))
            log_warning "좌표 Enrichment 실패 ($(format_duration $ENRICH_DURATION))"
        fi
    else
        log_warning "좌표 Enrichment 스크립트 없음, 스킵: $ENRICH_SCRIPT"
    fi
fi

# ========================================
# YouTube 메타데이터 추가
# ========================================
META_SUCCESS=0
META_DURATION=0
if [ $SUCCESS -gt 0 ]; then
    log_info ""
    log_info "========================================"
    log_info "📹 YouTube 메타데이터 추가 중..."
    log_info "========================================"
    
    OUTPUT_WITH_META="${OUTPUT_FILE%.jsonl}_with_meta.jsonl"
    META_SCRIPT="$SCRIPT_DIR/api-youtube-meta.py"
    
    if [ -f "$META_SCRIPT" ]; then
        META_START=$(date +%s)
        if python3 "$META_SCRIPT" "$OUTPUT_FILE" "$OUTPUT_WITH_META"; then
            META_END=$(date +%s)
            META_DURATION=$((META_END - META_START))
            META_SUCCESS=1
            log_success "YouTube 메타데이터 추가 완료 ($(format_duration $META_DURATION))"
            log_info "📂 메타데이터 포함 파일: $OUTPUT_WITH_META"
        else
            META_END=$(date +%s)
            META_DURATION=$((META_END - META_START))
            log_error "YouTube 메타데이터 추가 실패 ($(format_duration $META_DURATION))"
        fi
    else
        log_warning "메타데이터 스크립트 없음, 스킵"
    fi
fi

# 최종 종료 시간
END_TIME=$(date +%s)
END_DATETIME=$(date "+%Y-%m-%d %H:%M:%S")
TOTAL_DURATION=$((END_TIME - START_TIME))

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
    "total_urls": $TOTAL,
    "success": $SUCCESS,
    "failed": $FAILED,
    "skipped_already_processed": $SKIPPED,
    "skipped_no_transcript": $NO_TRANSCRIPT_COUNT,
    "success_rate": "$(echo "scale=2; $SUCCESS * 100 / ($SUCCESS + $FAILED + 1)" | bc 2>/dev/null || echo "N/A")%"
  },
  "gemini_stats": {
    "total_calls": $GEMINI_CALLS,
    "total_time_seconds": $TOTAL_GEMINI_TIME,
    "total_time_formatted": "$(format_duration $TOTAL_GEMINI_TIME)",
    "average_time_seconds": $((GEMINI_CALLS > 0 ? TOTAL_GEMINI_TIME / GEMINI_CALLS : 0))
  },
  "transcript_stats": {
    "found": $TRANSCRIPT_SUCCESS,
    "not_found": $TRANSCRIPT_FAILED,
    "no_transcript_log": "$NO_TRANSCRIPT_LOG"
  },
  "parser_stats": {
    "total_time_seconds": $TOTAL_PARSE_TIME,
    "total_time_formatted": "$(format_duration $TOTAL_PARSE_TIME)"
  },
  "meta_stats": {
    "success": $META_SUCCESS,
    "duration_seconds": $META_DURATION,
    "duration_formatted": "$(format_duration $META_DURATION)"
  },
  "enrich_stats": {
    "success": $ENRICH_SUCCESS,
    "enriched_count": $ENRICH_COUNT,
    "duration_seconds": $ENRICH_DURATION,
    "duration_formatted": "$(format_duration $ENRICH_DURATION)"
  },
  "files": {
    "url_file": "$URL_FILE",
    "output_file": "$OUTPUT_FILE",
    "error_log": "$ERROR_LOG"
  }
}
EOF

log_info ""
log_success "로그 파일 저장: $LOG_FILE"

# 최종 결과
log_info ""
log_info "========================================"
log_success "🎉 전체 파이프라인 완료"
log_info "========================================"
log_info "시작: $START_DATETIME"
log_info "종료: $END_DATETIME"
log_info "총 소요 시간: $(format_duration $TOTAL_DURATION)"
log_info ""
log_info "📂 크롤링 결과: $OUTPUT_FILE"
if [ -f "${OUTPUT_FILE%.jsonl}_with_meta.jsonl" ]; then
    log_info "📂 메타 포함: ${OUTPUT_FILE%.jsonl}_with_meta.jsonl"
fi
log_info "📂 로그 파일: $LOG_FILE"
log_info "========================================"

# 실패가 있으면 종료 코드 1
if [ $FAILED -gt 0 ]; then
    exit 1
fi
