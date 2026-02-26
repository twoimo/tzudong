#!/bin/bash
# Gemini CLI 기반 음식점 크롤링 스크립트
# 채널별 처리: urls.txt → meta + transcript → crawling 결과 저장
# 
# 수집 조건:
# - urls.txt에서 video_id 목록 로드
# - crawling/{video_id}.jsonl 없으면 수집
# - meta/{video_id}.jsonl 최신 데이터 로드
# - transcript/{video_id}.jsonl 최신 데이터 로드 (없으면 스킵)
# 
# 사용법:
#   ./07-gemini-crawling.sh --channel tzuyang
#   ./07-gemini-crawling.sh --channel meatcreator
#   ./07-gemini-crawling.sh  # 모든 채널

# set -e  # 에러 발생 시 즉시 종료 (디버깅을 위해 비활성화)

# ================================
# 환경 설정
# ================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# CHANNELS_CONFIG 환경변수로 설정 파일 지정 가능 (테스트용)
CONFIG_NAME="${CHANNELS_CONFIG:-channels.yaml}"
CONFIG_FILE="$PROJECT_ROOT/config/$CONFIG_NAME"
PROMPT_FILE="$SCRIPT_DIR/../prompts/crawling_prompt.txt"
PARSER_SCRIPT="$SCRIPT_DIR/parse_result.py"
GEMINI_API_SCRIPT="$SCRIPT_DIR/gemini_api_request.mjs"

echo "[$(date '+%H:%M:%S')] [INFO] SCRIPT_DIR: $SCRIPT_DIR"
echo "[$(date '+%H:%M:%S')] [INFO] PROJECT_ROOT: $PROJECT_ROOT"

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
        echo "[$(date '+%H:%M:%S')] [OK] .env 파일 로드: $env_file"
        break
    fi
done

if [ "$ENV_LOADED" = false ]; then
    if [ -n "$GEMINI_API_KEY" ]; then
        echo "[$(date '+%H:%M:%S')] [INFO] .env 파일은 없지만 GEMINI_API_KEY 환경변수가 존재합니다 (CI/CD 환경 예상)"
    else
        echo "[$(date '+%H:%M:%S')] [WARN] .env 파일을 찾지 못했습니다"
    fi
fi

# Gemini 모델 설정
export PRIMARY_MODEL="${PRIMARY_MODEL:-gemini-3-flash-preview}"
export FALLBACK_MODEL="${FALLBACK_MODEL:-gemini-2.5-flash}"
export CURRENT_MODEL="$PRIMARY_MODEL"

# 한국 시간대 설정
export TZ="Asia/Seoul"
PYTHON_CMD="${PYTHON_CMD:-python}"

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

# OS 감지
OS_TYPE="$(uname -s)"
case "${OS_TYPE}" in
    Linux*)     OS_NAME=Linux;;
    Darwin*)    OS_NAME=Mac;;
    CYGWIN*|MINGW*|MSYS*) OS_NAME=Windows;;
    *)          OS_NAME="UNKNOWN:${OS_TYPE}";;
esac

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
elif [ -f "$PROJECT_ROOT/bin/jq.exe" ]; then
    JQ_EXE="$PROJECT_ROOT/bin/jq.exe"
else
    # CI/CD 환경이나 Git Bash 일부 환경을 위한 Fallback
    if [ -f "/usr/bin/jq" ]; then
        JQ_EXE="/usr/bin/jq"
    else
        echo "[ERROR] jq 명령어를 찾을 수 없습니다."
        exit 1
    fi
fi

# 2. Node 감지
if command -v node &> /dev/null; then
    NODE_EXE="node"
elif [ -f "/c/Program Files/nodejs/node.exe" ]; then
    NODE_EXE="/c/Program Files/nodejs/node.exe"
elif [ -f "/mnt/c/Program Files/nodejs/node.exe" ]; then
    NODE_EXE="/mnt/c/Program Files/nodejs/node.exe"
else
    NODE_EXE=""
fi

# 3. Python 감지
if command -v python &> /dev/null; then
    PYTHON_CMD="python"
elif command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
else
    echo "python 또는 python3 명령어를 찾을 수 없습니다."
    exit 1
fi

# jq 래퍼 함수 (Windows 줄바꿈 처리)
jq_wrapper() {
    "$JQ_EXE" "$@" | tr -d '\r'
}

# mkdir temp
mkdir -p "$SCRIPT_DIR/../temp"

# ================================
# 로그 함수
# ================================
log_info() {
    echo -e "${BLUE}[$(date '+%H:%M:%S')] [INFO] $1${NC}"
}

log_success() {
    echo -e "${GREEN}[$(date '+%H:%M:%S')] [OK] $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}[$(date '+%H:%M:%S')] [WARN] $1${NC}"
}

log_error() {
    echo -e "${RED}[$(date '+%H:%M:%S')] [ERROR] $1${NC}" >&2
}

log_debug() {
    echo -e "${CYAN}[$(date '+%H:%M:%S')] [DEBUG] $1${NC}"
}

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

# ================================
# 인자 파싱
# ================================
CHANNEL_FILTER=""
while [[ $# -gt 0 ]]; do
    case $1 in
        --channel|-c)
            CHANNEL_FILTER="$2"
            shift 2
            ;;
        *)
            echo "알 수 없는 옵션: $1"
            exit 1
            ;;
    esac
done

# ================================
# 채널 목록 로드 (YAML 파싱)
# ================================
get_channels() {
    if [ -n "$CHANNEL_FILTER" ]; then
        echo "$CHANNEL_FILTER"
    else
        # 간단한 YAML 파싱 (channels: 아래의 키 추출)
        grep -E "^  [a-z]+:" "$CONFIG_FILE" | sed 's/://g' | awk '{print $1}'
    fi
}

get_channel_data_path() {
    local channel=$1
    # YAML에서 data_path 추출 (따옴표 제거)
    grep -A 5 "^  $channel:" "$CONFIG_FILE" | grep "  data_path:" | awk '{print $2}' | tr -d '"'
}

get_channel_name() {
    local channel=$1
    # YAML에서 name 추출
    grep -A 5 "^  $channel:" "$CONFIG_FILE" | grep "name:" | sed 's/.*name: *//' | tr -d '"'
}

# ================================
# JSONL 파일에서 최신 데이터 읽기
# ================================
get_latest_jsonl_data() {
    local file=$1
    if [ -f "$file" ]; then
        tail -n 1 "$file"
    else
        echo ""
    fi
}

# ================================
# URL에서 video_id 추출
# ================================
extract_video_id() {
    local url=$1
    echo "$url" | sed -n 's/.*v=\([^&]*\).*/\1/p'
}

# ================================
# 채널 처리
# ================================
process_channel() {
    local channel=$1
    local data_path
    data_path=$(get_channel_data_path "$channel")
    
    if [ -z "$data_path" ]; then
        log_error "채널 설정 없음: $channel"
        return 1
    fi
    
    local channel_name
    channel_name=$(get_channel_name "$channel")
    
    local full_data_path="$PROJECT_ROOT/$data_path"
    local urls_file="$full_data_path/urls.txt"
    local meta_dir="$full_data_path/meta"
    local transcript_dir="$full_data_path/transcript"
    local crawling_dir="$full_data_path/crawling"
    local errors_dir="$full_data_path/crawling_errors"
    local error_log="$full_data_path/crawling_errors.log"
    
    # 폴더 생성 (errors_dir은 필요 시 생성)
    mkdir -p "$crawling_dir"
    
    log_info ""
    log_info "=========================================="
    log_info "채널 처리: $channel ($channel_name)"
    log_info "데이터 경로: $full_data_path"
    log_info "=========================================="
    
    # urls.txt 확인
    if [ ! -f "$urls_file" ]; then
        log_warning "urls.txt 없음: $urls_file"
        return 0
    fi
    
    # [PERF] 프롬프트 템플릿 사전 캐싱 (루프 내 매번 파일 읽기 방지)
    local PROMPT_TEMPLATE_CACHED
    PROMPT_TEMPLATE_CACHED=$(cat "$PROMPT_FILE" | sed "s/{YOUTUBER_NAME}/$channel_name/g")
    
    # [Smart Filter] 파이썬 스크립트로 처리 대상(Pending) URL만 가져오기
    log_info "[Smart Filter] 처리 대상 영상 선별 중... (parse_result.py scan)"
    
    # parse_result.py scan 실행
    # stderr는 화면에 나오고, stdout만 URLS 배열로 로드
    # [Fix] Windows 환경에서 Python 출력의 \r 제거
    mapfile -t URLS < <($PYTHON_CMD "$PARSER_SCRIPT" scan --channel "$channel" | tr -d '\r')
    
    local TOTAL=${#URLS[@]}
    
    if [ $TOTAL -eq 0 ]; then
        log_success "처리할 대상이 없습니다 (모두 처리됨)"
        return 0
    fi

    log_info "선별 완료: 총 $TOTAL 개 처리 예정"
    
    # [Debug] URLS 배열 내용 확인
    declare -p URLS 2>/dev/null || true
    
    # 통계 변수 (여기서부터는 실제 시도하는 것들임)
    local PROCESSED=0
    local SUCCESS=0
    local FAILED=0
    local SKIPPED=0
    local NO_TRANSCRIPT=0
    local NO_META=0
    local GEMINI_CALLS=0
    local TOTAL_GEMINI_TIME=0

    # [Note] deleted_urls.txt 필터링은 parse_result.py scan 단계에서 이미 수행됨
    # 별도의 임시 파일(deleted_ids.temp) 생성을 생략하여 윈도우/리눅스 경로 호환성 문제 방지
    
    # 각 URL 처리
    for i in "${!URLS[@]}"; do
        URL="${URLS[$i]}"
        INDEX=$((i + 1))
        
        # [Progress] 루프 진입
        log_info "[$INDEX/$TOTAL] 데이터 분석 준비 중... (URL: $URL)"
        
        # 빈 줄 건너뛰기
        if [ -z "$URL" ]; then
            continue
        fi
        
        # video_id 추출
        VIDEO_ID=$(extract_video_id "$URL")
        if [ -z "$VIDEO_ID" ]; then
            log_warning "[$INDEX/$TOTAL] video_id 추출 실패: $URL"
            FAILED=$((FAILED + 1))
            continue
        fi
        
        PROCESSED=$((PROCESSED + 1))
        
        # 이미 처리된 경우 스킵
        CRAWLING_FILE="$crawling_dir/${VIDEO_ID}.jsonl"
        if [ -f "$CRAWLING_FILE" ]; then
            SKIPPED=$((SKIPPED + 1))
            if [ $((SKIPPED % 50)) -eq 1 ]; then
                log_warning "[$INDEX/$TOTAL] 이미 처리됨 (스킵 ${SKIPPED}개)"
            fi
            continue
        fi
        
        # map_url_crawling 파일 존재 시 스킵 (05-map-url-crawling.js에서 처리됨)
        MAP_URL_CRAWLING_FILE="$full_data_path/map_url_crawling/${VIDEO_ID}.jsonl"
        if [ -f "$MAP_URL_CRAWLING_FILE" ]; then
            SKIPPED=$((SKIPPED + 1))
            log_debug "[$INDEX/$TOTAL] map_url_crawling에서 처리됨 - 스킵: $VIDEO_ID"
            continue
        fi

        # 에러 파일 있으면 재시도 대상 (에러 파일 삭제 후 진행)
        ERROR_FILE="$errors_dir/${VIDEO_ID}.jsonl"
        IS_RETRY=false
        if [ -f "$ERROR_FILE" ]; then
            IS_RETRY=true
            rm "$ERROR_FILE"
            log_info "[$INDEX/$TOTAL] 에러 파일 재시도: $VIDEO_ID"
        fi
        
        # 메타데이터 확인
        META_FILE="$meta_dir/${VIDEO_ID}.jsonl"
        if [ ! -f "$META_FILE" ]; then
            NO_META=$((NO_META + 1))
            log_warning "[$INDEX/$TOTAL] 메타 없음: $VIDEO_ID"
            continue
        fi
        
        # 자막 확인
        TRANSCRIPT_FILE="$transcript_dir/${VIDEO_ID}.jsonl"
        if [ ! -f "$TRANSCRIPT_FILE" ]; then
            NO_TRANSCRIPT=$((NO_TRANSCRIPT + 1))
            log_warning "[$INDEX/$TOTAL] 자막 없음 - 스킵: $VIDEO_ID"
            continue
        fi
        
        # 메타데이터 최신 줄 로드
        META_DATA=$(get_latest_jsonl_data "$META_FILE")
        TITLE=$(echo "$META_DATA" | "$JQ_EXE" -r '.title // ""' 2>/dev/null | head -c 100)
        META_RECOLLECT_ID=$(echo "$META_DATA" | "$JQ_EXE" -r '.recollect_id // 0' 2>/dev/null)
        YOUTUBE_LINK="https://www.youtube.com/watch?v=$VIDEO_ID"
        
        # 자막 최신 줄 로드
        TRANSCRIPT_DATA=$(get_latest_jsonl_data "$TRANSCRIPT_FILE")
        TRANSCRIPT_LANGUAGE=$(echo "$TRANSCRIPT_DATA" | "$JQ_EXE" -r '.language // "ko"' 2>/dev/null)
        TRANSCRIPT_RECOLLECT_ID=$(echo "$TRANSCRIPT_DATA" | "$JQ_EXE" -r '.recollect_id // 0' 2>/dev/null)
        
        # 자막을 [MM:SS] 형식으로 변환
        TRANSCRIPT=$(echo "$TRANSCRIPT_DATA" | "$JQ_EXE" -r '
            .transcript // [] | 
            map("[" + (if (.start | type) == "string" then .start else ((.start / 60 | floor | tostring | if length < 2 then "0" + . else . end)) + ":" + ((.start % 60 | floor | tostring | if length < 2 then "0" + . else . end)) end) + "] " + .text) | 
            join("\n")
        ' 2>/dev/null)
        
        if [ -z "$TRANSCRIPT" ] || [ "$TRANSCRIPT" = "null" ]; then
            NO_TRANSCRIPT=$((NO_TRANSCRIPT + 1))
            log_warning "[$INDEX/$TOTAL] 자막 파싱 실패 - 스킵: $VIDEO_ID"
            continue
        fi
        
        log_info "[$INDEX/$TOTAL] 처리중: $TITLE"
        
        # 프롬프트 생성 (사전 캐싱된 템플릿 사용)
        PROMPT_TEMPLATE="$PROMPT_TEMPLATE_CACHED"
        
        # 자막 추가 (30000자 제한)
        TRANSCRIPT_TRUNCATED=$(echo "$TRANSCRIPT" | head -c 30000)
        PROMPT="$PROMPT_TEMPLATE

<영상 정보>
영상 제목: $TITLE
유튜브 링크: $YOUTUBE_LINK
</영상 정보>

<참고: YouTube 자막>
아래는 해당 영상의 자막입니다. 음식점 이름, 위치 힌트, 메뉴 정보 등을 파악하는 데 참고하세요.
[자막 언어: $TRANSCRIPT_LANGUAGE]
※ 자막이 한국어가 아닐 수 있지만, 모든 결과(reasoning_basis, youtuber_review 등)는 반드시 한국어로 작성하세요.
---
$TRANSCRIPT_TRUNCATED
---
</참고: YouTube 자막>"
        
        # 임시 파일
        TEMP_PROMPT="$SCRIPT_DIR/../temp/prompt_${VIDEO_ID}.txt"
        TEMP_RESPONSE="$SCRIPT_DIR/../temp/response_${VIDEO_ID}.json"
        TEMP_STDERR="$SCRIPT_DIR/../temp/stderr_${VIDEO_ID}.log"
        echo "$PROMPT" > "$TEMP_PROMPT"
        
        # Gemini API 호출 (Node.js -> CLI Sticky Fallback)
        URL_START_TIME=$(date +%s)
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
                log_debug "Node.js API 호출 성공"
            else
                log_warning "Node.js API 호출 실패 (Code: $EXIT_CODE) - Sticky Fallback 활성화 (이후 CLI 사용)"
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
                if [ -f "$TEMP_STDERR" ] && [ -s "$TEMP_STDERR" ]; then
                    cat "$TEMP_STDERR"
                fi
                
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
        
        if [ "$GEMINI_SUCCESS" = true ]; then
            # 파서 실행 (최대 3회 시도)
            PARSE_SUCCESS=false
            for PARSE_ATTEMPT in 1 2 3; do
                if $PYTHON_CMD "$PARSER_SCRIPT" parse "$YOUTUBE_LINK" "$TEMP_RESPONSE" "$CRAWLING_FILE" "$META_RECOLLECT_ID" "$TRANSCRIPT_RECOLLECT_ID" "$channel"; then
                    SUCCESS=$((SUCCESS + 1))
                    PARSE_SUCCESS=true
                    
                    URL_END_TIME=$(date +%s)
                    URL_DURATION=$((URL_END_TIME - URL_START_TIME))
                    log_success "성공 ($SUCCESS/$TOTAL) - 총 ${URL_DURATION}s (Gemini: ${GEMINI_DURATION}s)"
                    break
                else
                    if [ $PARSE_ATTEMPT -lt 3 ]; then
                        log_warning "파싱 실패 (${PARSE_ATTEMPT}/3) - 재요청..."
                        sleep 10
                        gemini --model "$CURRENT_MODEL" --output-format json --yolo < "$TEMP_PROMPT" > "$TEMP_RESPONSE" 2>/dev/null
                    fi
                fi
            done
            
            if [ "$PARSE_SUCCESS" = false ]; then
                FAILED=$((FAILED + 1))
                log_error "파서 실패 (3회 시도 후) ($FAILED/$TOTAL)"
                echo "[$(date)] 파서 실패: $URL" >> "$error_log"
                # 에러 JSONL 저장 (recollect_version 포함)
                if [ ! -d "$errors_dir" ]; then mkdir -p "$errors_dir"; fi
                "$JQ_EXE" -n \
                    --arg yl "$YOUTUBE_LINK" \
                    --arg vid "$VIDEO_ID" \
                    --arg err "파싱 실패 (3회 시도 후)" \
                    --arg meta "$META_RECOLLECT_ID" \
                    --arg trans "$TRANSCRIPT_RECOLLECT_ID" \
                    '{youtube_link: $yl, video_id: $vid, error: $err, recollect_version: {meta: ($meta | tonumber), transcript: ($trans | tonumber)}}' > "$ERROR_FILE"
            fi
        else
            FAILED=$((FAILED + 1))
            log_error "API/CLI 호출 모두 실패 ($FAILED/$TOTAL)"
            echo "[$(date)] Gemini API/CLI 실패: $URL" >> "$error_log"
            # 에러 JSONL 저장 (recollect_version 포함)
            if [ ! -d "$errors_dir" ]; then mkdir -p "$errors_dir"; fi
            "$JQ_EXE" -n \
                --arg yl "$YOUTUBE_LINK" \
                --arg vid "$VIDEO_ID" \
                --arg err "Gemini API/CLI 호출 실패" \
                --arg meta "$META_RECOLLECT_ID" \
                --arg trans "$TRANSCRIPT_RECOLLECT_ID" \
                '{youtube_link: $yl, video_id: $vid, error: $err, recollect_version: {meta: ($meta | tonumber), transcript: ($trans | tonumber)}}' > "$ERROR_FILE"
            if [ -f "$TEMP_STDERR" ] && [ -s "$TEMP_STDERR" ]; then
                cat "$TEMP_STDERR" >> "$error_log"
            fi
        fi
        
        # 임시 파일 정리
        rm -f "$TEMP_RESPONSE" "$TEMP_PROMPT" "$TEMP_STDERR"
        
        # [PERF] Rate Limit 준수 (기본 12s = 5 RPM, 환경변수로 오버라이드 가능)
        if [ $INDEX -lt $TOTAL ]; then
            sleep "${GEMINI_RATE_LIMIT_DELAY:-12}"
        fi
    done
    
    log_info ""
    log_info "=========================================="
    log_success "채널 $channel 처리 완료"
    log_info "=========================================="
    log_info "처리 통계:"
    log_success "  성공: $SUCCESS"
    log_warning "  건너뜀 (이미 처리됨): $SKIPPED"
    log_warning "  건너뜀 (자막 없음): $NO_TRANSCRIPT"
    log_warning "  건너뜀 (메타 없음): $NO_META"
    log_error "  실패: $FAILED"
    log_info "  총 URL: $TOTAL"
    log_info ""
    log_info "Gemini CLI 통계:"
    log_info "  총 호출 수: $GEMINI_CALLS"
    log_info "  총 Gemini 시간: $(format_duration $TOTAL_GEMINI_TIME)"
    if [ $GEMINI_CALLS -gt 0 ]; then
        AVG_GEMINI=$((TOTAL_GEMINI_TIME / GEMINI_CALLS))
        log_info "  평균 Gemini 시간: $(format_duration $AVG_GEMINI)"
    fi

    # [Note] deleted_urls 필터링은 parse_result.py scan 단계에서 처리됨 (별도 임시 파일 불필요)
}

# ================================
# 메인 실행
# ================================
main() {
    log_info ""
    log_info "============================================================"
    log_info "  Gemini CLI 음식점 크롤링 시작"
    log_info "============================================================"
    
    START_TIME=$(date +%s)
    START_DATETIME=$(date "+%Y-%m-%d %H:%M:%S")
    
    # 필수 파일 확인
    if [ ! -f "$PROMPT_FILE" ]; then
        log_error "프롬프트 파일 없음: $PROMPT_FILE"
        exit 1
    fi
    
    if [ ! -f "$PARSER_SCRIPT" ]; then
        log_error "파서 스크립트 없음: $PARSER_SCRIPT"
        exit 1
    fi
    
    # Gemini CLI 확인 (Global)
    if ! command -v gemini &> /dev/null; then
        log_error "Gemini CLI 미설치. 'npm install -g @google/gemini-cli' 실행"
        exit 1
    fi
    
    log_success "Gemini CLI 확인 완료"
    
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
    
    log_info "시작 시간: $START_DATETIME"
    log_info "모드: $(if [ "$FORCE_CLI_FALLBACK" = true ]; then echo "Gemini CLI only"; else echo "Node.js API + Sticky Fallback"; fi)"
    log_info "Gemini 모델: $CURRENT_MODEL (fallback: $FALLBACK_MODEL)"
    
    # ================================
    # Gemini Health Check (Pre-flight)
    # ================================
    log_info "Gemini Health Check (1+1=?) 수행 중..."
    HEALTH_CHECK_PROMPT="$SCRIPT_DIR/../temp/health_check_prompt.txt"
    HEALTH_CHECK_RESPONSE="$SCRIPT_DIR/../temp/health_check_response.json"
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
    
    # 채널 목록
    local channels
    channels=$(get_channels)
    
    log_info "대상 채널: $channels"
    log_info ""
    
    # 각 채널 처리
    for channel in $channels; do
        process_channel "$channel"
    done
    
    # [PERF] temp 디렉토리 일괄 정리 (개별 rm 대신 한번에)
    rm -rf "$SCRIPT_DIR/../temp"/*.txt "$SCRIPT_DIR/../temp"/*.json "$SCRIPT_DIR/../temp"/*.log 2>/dev/null || true
    
    END_TIME=$(date +%s)
    END_DATETIME=$(date "+%Y-%m-%d %H:%M:%S")
    TOTAL_DURATION=$((END_TIME - START_TIME))
    
    log_info ""
    log_info "============================================================"
    log_success "전체 파이프라인 완료"
    log_info "============================================================"
    log_info "시작: $START_DATETIME"
    log_info "종료: $END_DATETIME"
    log_info "총 소요 시간: $(format_duration $TOTAL_DURATION)"
    log_info "============================================================"
}

main
