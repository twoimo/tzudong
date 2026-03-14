#!/bin/bash
# 구간(Chunk) 분할 멀티모달 크롤링 스크립트
# 전체 영상을 시간 기반 청크로 분할하고, Gemini File API로 비디오 세그먼트를
# 직접 전송하여 맛집 정보를 추출합니다.
#
# 파이프라인:
#   1. chunk_planner.py   → 영상 길이 기반 적응형 청크 계획
#   2. rclone/yt-dlp      → 비디오 다운로드 (GDrive 캐시 우선)
#   3. split_video_chunks.mjs → ffmpeg으로 mp4 세그먼트 분할
#   4. gemini_chunk_video_request.mjs → 청크별 Gemini API 호출
#   5. merge_chunk_results.py → 결과 병합 및 중복 제거
#
# 사용법:
#   ./08-chunk-multimodal-crawling.sh --channel tzuyang
#   ./08-chunk-multimodal-crawling.sh --channel tzuyang --url "https://www.youtube.com/watch?v=VIDEO_ID"
#   ./08-chunk-multimodal-crawling.sh  # 모든 채널

# ================================
# 환경 설정
# ================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG_NAME="${CHANNELS_CONFIG:-channels.yaml}"
CONFIG_FILE="$PROJECT_ROOT/config/$CONFIG_NAME"
PROMPT_FILE="$SCRIPT_DIR/../prompts/chunk_crawling_prompt.txt"
PARSER_SCRIPT="$SCRIPT_DIR/parse_result.py"
CHUNK_PLANNER="$SCRIPT_DIR/chunk_planner.py"
SPLIT_VIDEO="$SCRIPT_DIR/split_video_chunks.mjs"
GEMINI_CHUNK_API="$SCRIPT_DIR/gemini_chunk_video_request.mjs"
MERGE_RESULTS="$SCRIPT_DIR/merge_chunk_results.py"

echo "[$(date '+%H:%M:%S')] [INFO] SCRIPT_DIR: $SCRIPT_DIR"
echo "[$(date '+%H:%M:%S')] [INFO] PROJECT_ROOT: $PROJECT_ROOT"

# .env 파일 로드
for env_file in "$PROJECT_ROOT/.env" "$PROJECT_ROOT/../.env"; do
    if [ -f "$env_file" ]; then
        set -a; source "$env_file"; set +a
        echo "[$(date '+%H:%M:%S')] [OK] .env 로드: $env_file"
        break
    fi
done

# Gemini 모델 설정
export PRIMARY_MODEL="${PRIMARY_MODEL:-gemini-3.1-flash-lite-preview}"
export FALLBACK_MODEL="${FALLBACK_MODEL:-gemini-3.1-flash-preview}"
export CURRENT_MODEL="$PRIMARY_MODEL"
export TZ="Asia/Seoul"
PYTHON_CMD="${PYTHON_CMD:-python}"

# 색상 코드
if [ -t 1 ]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
    BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; BLUE=''; CYAN=''; NC=''
fi

# OS 감지
OS_TYPE="$(uname -s)"
case "${OS_TYPE}" in
    Linux*)     OS_NAME=Linux;;
    Darwin*)    OS_NAME=Mac;;
    CYGWIN*|MINGW*|MSYS*) OS_NAME=Windows;;
    *)          OS_NAME="UNKNOWN:${OS_TYPE}";;
esac

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
if command -v jq &> /dev/null; then JQ_EXE="jq"
elif [ -f "$PROJECT_ROOT/bin/jq.exe" ]; then JQ_EXE="$PROJECT_ROOT/bin/jq.exe"
elif [ -f "/usr/bin/jq" ]; then JQ_EXE="/usr/bin/jq"
else echo "[ERROR] jq not found"; exit 1; fi

if command -v node &> /dev/null; then NODE_EXE="node"
elif [ -f "/c/Program Files/nodejs/node.exe" ]; then NODE_EXE="/c/Program Files/nodejs/node.exe"
else NODE_EXE=""; fi

if command -v python &> /dev/null; then PYTHON_CMD="python"
elif command -v python3 &> /dev/null; then PYTHON_CMD="python3"
else echo "python not found"; exit 1; fi

jq_wrapper() { "$JQ_EXE" "$@" | tr -d '\r'; }

TEMP_BASE="$(cd "$SCRIPT_DIR/.." && pwd)/temp"
mkdir -p "$TEMP_BASE"

# ================================
# 로그 함수
# ================================
log_info()    { echo -e "${BLUE}[$(date '+%H:%M:%S')] [INFO] $1${NC}" >&2; }
log_success() { echo -e "${GREEN}[$(date '+%H:%M:%S')] [OK] $1${NC}" >&2; }
log_warning() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] [WARN] $1${NC}" >&2; }
log_error()   { echo -e "${RED}[$(date '+%H:%M:%S')] [ERROR] $1${NC}" >&2; }
log_debug()   { echo -e "${CYAN}[$(date '+%H:%M:%S')] [DEBUG] $1${NC}" >&2; }

format_duration() {
    local seconds=$1
    local hours=$((seconds / 3600))
    local minutes=$(((seconds % 3600) / 60))
    local secs=$((seconds % 60))
    if [ $hours -gt 0 ]; then echo "${hours}h ${minutes}m ${secs}s"
    elif [ $minutes -gt 0 ]; then echo "${minutes}m ${secs}s"
    else echo "${secs}s"; fi
}

# ================================
# 인자 파싱
# ================================
CHANNEL_FILTER=""
SINGLE_URL=""
FORCE_MODE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --channel|-c) CHANNEL_FILTER="$2"; shift 2;;
        --url|-u) SINGLE_URL="$2"; shift 2;;
        --force|-f) FORCE_MODE=true; shift;;
        *) echo "Unknown option: $1"; exit 1;;
    esac
done

# ================================
# 채널 유틸리티
# ================================
get_channels() {
    if [ -n "$CHANNEL_FILTER" ]; then echo "$CHANNEL_FILTER"
    else grep -E "^  [a-z]+:" "$CONFIG_FILE" | sed 's/://g' | awk '{print $1}'; fi
}

get_channel_data_path() {
    local channel=$1
    grep -A 5 "^  $channel:" "$CONFIG_FILE" | grep "  data_path:" | awk '{print $2}' | tr -d '"' | tr -d '\r'
}

get_channel_name() {
    local channel=$1
    grep -A 5 "^  $channel:" "$CONFIG_FILE" | grep "name:" | sed 's/.*name: *//' | tr -d '"' | tr -d '\r'
}

get_latest_jsonl_data() {
    local file=$1
    if [ -f "$file" ]; then tail -n 1 "$file"; else echo ""; fi
}

extract_video_id() {
    local url=$1
    echo "$url" | sed -n 's/.*v=\([^&]*\).*/\1/p'
}

# ================================
# 비디오 다운로드 (GDrive > yt-dlp)
# ================================
download_video() {
    local video_id=$1
    local output_dir=$2

    # 1. 로컬 캐시 확인
    local cache_dirs=("$output_dir")
    if [ -n "$VIDEO_CACHE_DIR" ] && [ -d "$VIDEO_CACHE_DIR" ]; then
        cache_dirs=("$VIDEO_CACHE_DIR" "${cache_dirs[@]}")
    fi

    for cache_dir in "${cache_dirs[@]}"; do
        for ext in mp4 webm mkv; do
            local cached="$cache_dir/${video_id}.${ext}"
            if [ -f "$cached" ]; then
                log_debug "캐시 발견: $cached"
                echo "$cached"
                return 0
            fi
        done
    done

    # 2. GDrive에서 rclone으로 다운로드
    if [ -n "$GDRIVE_REMOTE_PATH" ] && command -v rclone &> /dev/null; then
        log_info "GDrive에서 비디오 검색: $video_id"
        local gdrive_file
        gdrive_file=$(rclone lsf "$GDRIVE_REMOTE_PATH" --files-only --include "*${video_id}*" --format "p" 2>/dev/null | head -1 | tr -d '\r\n')

        if [ -n "$gdrive_file" ]; then
            log_info "GDrive 다운로드: $gdrive_file"
            rclone copy "$GDRIVE_REMOTE_PATH/$gdrive_file" "$output_dir" --progress >&2 2>/dev/null
            local downloaded="$output_dir/$gdrive_file"
            if [ -f "$downloaded" ]; then
                echo "$downloaded"
                return 0
            fi
        fi
        log_debug "GDrive에 비디오 없음 -> yt-dlp 전환"
    fi

    # 3. yt-dlp 다운로드
    local yt_dlp_cmd=""
    if command -v yt-dlp &> /dev/null; then yt_dlp_cmd="yt-dlp"
    elif command -v yt-dlp.exe &> /dev/null; then yt_dlp_cmd="yt-dlp.exe"
    elif command -v python3 &> /dev/null && python3 -m yt_dlp --version &> /dev/null; then yt_dlp_cmd="python3 -m yt_dlp"
    elif command -v python &> /dev/null && python -m yt_dlp --version &> /dev/null; then yt_dlp_cmd="python -m yt_dlp"
    else log_error "yt-dlp not found"; return 1; fi

    local output_template="$output_dir/${video_id}.%(ext)s"
    local cookie_file="$PROJECT_ROOT/restaurant-crawling/data/cookies.txt"
    local cookie_arg=""

    if [[ "$yt_dlp_cmd" == *".exe"* ]] && command -v wslpath &> /dev/null; then
        output_template="$(wslpath -w "$output_dir")\\${video_id}.%(ext)s"
        if [ -f "$cookie_file" ]; then
            cookie_arg="--cookies $(wslpath -w "$cookie_file")"
        fi
    else
        if [ -f "$cookie_file" ]; then
            cookie_arg="--cookies $cookie_file"
        fi
    fi

    log_info "yt-dlp 다운로드: $video_id (360p, cmd=$yt_dlp_cmd)"
    $yt_dlp_cmd --js-runtimes node $cookie_arg \
        -f "bestvideo[height<=360]+bestaudio/best[height<=360]/best" \
        -o "$output_template" \
        "https://www.youtube.com/watch?v=$video_id" >&2

    for ext in mp4 webm mkv; do
        local downloaded="$output_dir/${video_id}.${ext}"
        if [ -f "$downloaded" ]; then
            echo "$downloaded"
            return 0
        fi
    done

    log_error "비디오 다운로드 실패: $video_id"
    return 1
}

# ================================
# 단일 영상 청크 분석
# ================================
process_video_chunks() {
    local channel=$1
    local channel_name=$2
    local video_id=$3
    local youtube_link=$4
    local full_data_path=$5
    local meta_file=$6
    local transcript_file=$7

    local crawling_dir="$full_data_path/crawling"
    local errors_dir="$full_data_path/crawling_errors"
    local temp_dir="$TEMP_BASE/chunk_${video_id}"

    mkdir -p "$temp_dir" "$crawling_dir"

    # 메타데이터 로드
    local META_DATA
    META_DATA=$(get_latest_jsonl_data "$meta_file")
    local TITLE
    TITLE=$(echo "$META_DATA" | jq_wrapper -r '.title // ""' 2>/dev/null | head -c 100)
    local DURATION
    DURATION=$(echo "$META_DATA" | jq_wrapper -r '.duration // 0' 2>/dev/null)
    local META_RECOLLECT_ID
    META_RECOLLECT_ID=$(echo "$META_DATA" | jq_wrapper -r '.recollect_id // 0' 2>/dev/null)

    local TRANSCRIPT_DATA
    TRANSCRIPT_DATA=$(get_latest_jsonl_data "$transcript_file")
    local TRANSCRIPT_LANGUAGE
    TRANSCRIPT_LANGUAGE=$(echo "$TRANSCRIPT_DATA" | jq_wrapper -r '.language // "ko"' 2>/dev/null)
    local TRANSCRIPT_RECOLLECT_ID
    TRANSCRIPT_RECOLLECT_ID=$(echo "$TRANSCRIPT_DATA" | jq_wrapper -r '.recollect_id // 0' 2>/dev/null)

    if [ "$DURATION" = "0" ] || [ -z "$DURATION" ]; then
        log_warning "영상 길이 정보 없음: $video_id"
        return 1
    fi

    log_info "처리 시작: $TITLE (${DURATION}s)"

    # Step 1: 청크 계획 생성
    log_info "[1/5] 청크 계획 생성..."
    local chunks_json="$temp_dir/chunks.json"
    $PYTHON_CMD "$CHUNK_PLANNER" \
        --video-id "$video_id" \
        --duration "$DURATION" \
        --transcript-file "$transcript_file" \
        --output "$chunks_json"
    local PLANNER_EXIT=$?

    if [ $PLANNER_EXIT -ne 0 ] || [ ! -s "$chunks_json" ]; then
        log_error "청크 계획 생성 실패 (exit=$PLANNER_EXIT)"
        rm -rf "$temp_dir"
        return 1
    fi

    local TOTAL_CHUNKS
    TOTAL_CHUNKS=$(cat "$chunks_json" | jq_wrapper 'length')
    log_success "청크 계획: ${TOTAL_CHUNKS}개 청크"

    # Step 2: 비디오 다운로드
    log_info "[2/5] 비디오 다운로드..."
    local video_path
    video_path=$(download_video "$video_id" "$temp_dir")

    if [ -z "$video_path" ] || [ ! -f "$video_path" ]; then
        log_error "비디오 다운로드 실패: $video_id"
        rm -rf "$temp_dir"
        return 1
    fi
    log_success "비디오 준비 완료: $(basename "$video_path")"

    # Step 3: mp4 세그먼트 분할
    log_info "[3/5] mp4 세그먼트 분할..."
    local segments_dir="$temp_dir/segments"

    local WIN_SPLIT=$(normalize_path "$SPLIT_VIDEO")
    local WIN_VIDEO=$(normalize_path "$video_path")
    local WIN_CHUNKS=$(normalize_path "$chunks_json")
    local WIN_SEGMENTS=$(normalize_path "$segments_dir")

    "$NODE_EXE" "$WIN_SPLIT" "$WIN_VIDEO" "$WIN_CHUNKS" "$WIN_SEGMENTS"
    if [ $? -ne 0 ]; then
        log_error "비디오 분할 실패"
        rm -rf "$temp_dir"
        return 1
    fi
    log_success "세그먼트 분할 완료"

    # Step 4: 청크별 Gemini API 호출
    log_info "[4/5] Gemini API 호출 (${TOTAL_CHUNKS} 청크)..."
    local responses_dir="$temp_dir/responses"
    mkdir -p "$responses_dir"

    local PROMPT_TEMPLATE
    PROMPT_TEMPLATE=$(cat "$PROMPT_FILE" | sed "s/{YOUTUBER_NAME}/$channel_name/g")

    local chunk_success=0
    local chunk_failed=0

    for i in $(seq 0 $((TOTAL_CHUNKS - 1))); do
        local chunk_start chunk_end chunk_transcript
        chunk_start=$(cat "$chunks_json" | jq_wrapper -r ".[$i].start_sec")
        chunk_end=$(cat "$chunks_json" | jq_wrapper -r ".[$i].end_sec")
        chunk_transcript=$(cat "$chunks_json" | jq_wrapper -r ".[$i].transcript_text")

        local start_mm=$(printf "%02d:%02d" $((${chunk_start%.*} / 60)) $((${chunk_start%.*} % 60)))
        local end_mm=$(printf "%02d:%02d" $((${chunk_end%.*} / 60)) $((${chunk_end%.*} % 60)))

        local chunk_prompt="$PROMPT_TEMPLATE"
        chunk_prompt=$(echo "$chunk_prompt" | sed "s|{CHUNK_INDEX}|$((i + 1))|g")
        chunk_prompt=$(echo "$chunk_prompt" | sed "s|{TOTAL_CHUNKS}|${TOTAL_CHUNKS}|g")
        chunk_prompt=$(echo "$chunk_prompt" | sed "s|{START_TIME}|${start_mm}|g")
        chunk_prompt=$(echo "$chunk_prompt" | sed "s|{END_TIME}|${end_mm}|g")

        local prompt_file="$temp_dir/prompt_chunk_${i}.txt"
        local response_file="$responses_dir/chunk_response_${i}.json"
        local segment_file="$segments_dir/chunk_${i}.mp4"

        cat > "$prompt_file" <<PROMPT_EOF
$chunk_prompt

<영상 정보>
영상 제목: $TITLE
유튜브 링크: $youtube_link
분석 구간: ${start_mm} ~ ${end_mm}
</영상 정보>

<참고: YouTube 자막>
아래는 이 구간(${start_mm} ~ ${end_mm})의 자막입니다.
[자막 언어: $TRANSCRIPT_LANGUAGE]
※ 자막이 한국어가 아닐 수 있지만, 모든 결과는 반드시 한국어로 작성하세요.
---
$chunk_transcript
---
</참고: YouTube 자막>
PROMPT_EOF

        if [ ! -f "$segment_file" ]; then
            log_warning "세그먼트 없음: chunk_${i}.mp4 - 건너뜀"
            chunk_failed=$((chunk_failed + 1))
            continue
        fi

        log_info "  청크 $((i + 1))/${TOTAL_CHUNKS}: ${start_mm}~${end_mm}"

        local WIN_GEMINI=$(normalize_path "$GEMINI_CHUNK_API")
        local WIN_PROMPT=$(normalize_path "$prompt_file")
        local WIN_RESPONSE=$(normalize_path "$response_file")
        local WIN_SEGMENT=$(normalize_path "$segment_file")

        set +e
        "$NODE_EXE" "$WIN_GEMINI" "$WIN_PROMPT" "$WIN_RESPONSE" "$WIN_SEGMENT" 2>"$temp_dir/stderr_${i}.log"
        local exit_code=$?
        set -e

        if [ $exit_code -eq 0 ] && [ -s "$response_file" ]; then
            chunk_success=$((chunk_success + 1))
            log_success "  청크 $((i + 1)) 성공"
        else
            chunk_failed=$((chunk_failed + 1))
            log_error "  청크 $((i + 1)) 실패 (exit: $exit_code)"
            if [ -f "$temp_dir/stderr_${i}.log" ]; then
                cat "$temp_dir/stderr_${i}.log" >&2
            fi

            # Fallback 모델 재시도
            if [ "$CURRENT_MODEL" = "$PRIMARY_MODEL" ]; then
                log_warning "  Fallback 모델($FALLBACK_MODEL)로 재시도..."
                CURRENT_MODEL="$FALLBACK_MODEL"
                export CURRENT_MODEL
                sleep 5

                set +e
                "$NODE_EXE" "$WIN_GEMINI" "$WIN_PROMPT" "$WIN_RESPONSE" "$WIN_SEGMENT" 2>>"$temp_dir/stderr_${i}.log"
                local fb_exit=$?
                set -e

                if [ $fb_exit -eq 0 ] && [ -s "$response_file" ]; then
                    chunk_failed=$((chunk_failed - 1))
                    chunk_success=$((chunk_success + 1))
                    log_success "  Fallback 성공"
                fi
                CURRENT_MODEL="$PRIMARY_MODEL"
                export CURRENT_MODEL
            fi
        fi

        # Rate limit 대기 (마지막 청크 제외)
        if [ $i -lt $((TOTAL_CHUNKS - 1)) ]; then
            sleep "${GEMINI_RATE_LIMIT_DELAY:-12}"
        fi
    done

    log_info "  청크 결과: 성공 ${chunk_success}/${TOTAL_CHUNKS}, 실패 ${chunk_failed}"

    if [ $chunk_success -eq 0 ]; then
        log_error "모든 청크 실패: $video_id"
        rm -rf "$temp_dir"
        return 1
    fi

    # Step 5: 결과 병합
    log_info "[5/5] 결과 병합..."
    local merged_response="$temp_dir/merged_response.json"

    $PYTHON_CMD "$MERGE_RESULTS" --dir "$responses_dir" > "$merged_response"

    if [ $? -ne 0 ] || [ ! -s "$merged_response" ]; then
        log_error "결과 병합 실패"
        rm -rf "$temp_dir"
        return 1
    fi

    # parse_result.py로 최종 저장
    local crawling_file="$crawling_dir/${video_id}.jsonl"

    if $PYTHON_CMD "$PARSER_SCRIPT" parse "$youtube_link" "$merged_response" "$crawling_file" "$META_RECOLLECT_ID" "$TRANSCRIPT_RECOLLECT_ID" "$channel"; then
        log_success "최종 저장 완료: $crawling_file"
    else
        log_error "파서 실패: $video_id"
        if [ ! -d "$errors_dir" ]; then mkdir -p "$errors_dir"; fi
        "$JQ_EXE" -n \
            --arg yl "$youtube_link" --arg vid "$video_id" \
            --arg err "chunk merge/parse failure" \
            --arg meta "$META_RECOLLECT_ID" --arg trans "$TRANSCRIPT_RECOLLECT_ID" \
            '{youtube_link: $yl, video_id: $vid, error: $err, recollect_version: {meta: ($meta | tonumber), transcript: ($trans | tonumber)}}' \
            > "$errors_dir/${video_id}.jsonl"
    fi

    # 임시 파일 정리
    rm -rf "$temp_dir"
    return 0
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

    mkdir -p "$crawling_dir"

    log_info ""
    log_info "=========================================="
    log_info "채널: $channel ($channel_name) - 청크 멀티모달"
    log_info "=========================================="

    # 대상 URL 결정
    local URLS=()
    if [ -n "$SINGLE_URL" ]; then
        URLS=("$SINGLE_URL")
    else
        if [ ! -f "$urls_file" ]; then
            log_warning "urls.txt 없음: $urls_file"
            return 0
        fi
        mapfile -t URLS < <($PYTHON_CMD "$PARSER_SCRIPT" scan --channel "$channel" | tr -d '\r')
    fi

    local TOTAL=${#URLS[@]}
    if [ $TOTAL -eq 0 ]; then
        log_success "처리할 대상 없음"
        return 0
    fi

    log_info "처리 대상: ${TOTAL}개"

    local SUCCESS=0 FAILED=0 SKIPPED=0
    local TOTAL_TIME=0

    for i in "${!URLS[@]}"; do
        local URL="${URLS[$i]}"
        local INDEX=$((i + 1))

        [ -z "$URL" ] && continue

        local VIDEO_ID
        VIDEO_ID=$(extract_video_id "$URL")
        [ -z "$VIDEO_ID" ] && continue

        local CRAWLING_FILE="$crawling_dir/${VIDEO_ID}.jsonl"
        local MAP_FILE="$full_data_path/map_url_crawling/${VIDEO_ID}.jsonl"

        # 이미 처리된 경우 스킵 (--force가 아닌 경우)
        if [ "$FORCE_MODE" = false ]; then
            if [ -f "$CRAWLING_FILE" ] || [ -f "$MAP_FILE" ]; then
                SKIPPED=$((SKIPPED + 1))
                continue
            fi
        fi

        local META_FILE="$meta_dir/${VIDEO_ID}.jsonl"
        local TRANSCRIPT_FILE="$transcript_dir/${VIDEO_ID}.jsonl"

        if [ ! -f "$META_FILE" ]; then
            log_warning "[$INDEX/$TOTAL] 메타 없음: $VIDEO_ID"
            continue
        fi

        if [ ! -f "$TRANSCRIPT_FILE" ]; then
            log_warning "[$INDEX/$TOTAL] 자막 없음: $VIDEO_ID"
            continue
        fi

        log_info "[$INDEX/$TOTAL] 청크 분석 시작: $VIDEO_ID"
        local VIDEO_START
        VIDEO_START=$(date +%s)

        if process_video_chunks "$channel" "$channel_name" "$VIDEO_ID" "$URL" "$full_data_path" "$META_FILE" "$TRANSCRIPT_FILE"; then
            SUCCESS=$((SUCCESS + 1))
            local VIDEO_END
            VIDEO_END=$(date +%s)
            local VIDEO_DURATION=$((VIDEO_END - VIDEO_START))
            TOTAL_TIME=$((TOTAL_TIME + VIDEO_DURATION))
            log_success "[$INDEX/$TOTAL] 완료 (${VIDEO_DURATION}s)"
        else
            FAILED=$((FAILED + 1))
            log_error "[$INDEX/$TOTAL] 실패: $VIDEO_ID"
        fi
    done

    log_info ""
    log_info "=========================================="
    log_success "채널 $channel 처리 완료"
    log_info "=========================================="
    log_success "  성공: $SUCCESS"
    log_warning "  스킵: $SKIPPED"
    log_error "  실패: $FAILED"
    log_info "  총 소요: $(format_duration $TOTAL_TIME)"
}

# ================================
# 메인 실행
# ================================
main() {
    log_info ""
    log_info "============================================================"
    log_info "  청크 멀티모달 크롤링 시작 (Gemini Video API)"
    log_info "============================================================"

    local START_TIME
    START_TIME=$(date +%s)

    for req_file in "$PROMPT_FILE" "$PARSER_SCRIPT" "$CHUNK_PLANNER" "$SPLIT_VIDEO" "$GEMINI_CHUNK_API" "$MERGE_RESULTS"; do
        if [ ! -f "$req_file" ]; then
            log_error "필수 파일 없음: $req_file"
            exit 1
        fi
    done

    if [ -z "$NODE_EXE" ]; then
        log_error "Node.js 미설치"
        exit 1
    fi

    # API Key
    if [ -n "$GEMINI_API_KEY" ]; then
        GEMINI_API_KEY=$(echo "$GEMINI_API_KEY" | tr -d '\r')
        export GEMINI_API_KEY
    elif [ -n "$GEMINI_API_KEY_BYEON" ]; then
        export GEMINI_API_KEY="$GEMINI_API_KEY_BYEON"
    else
        log_error "GEMINI_API_KEY 없음"
        exit 1
    fi

    log_info "모델: $CURRENT_MODEL (fallback: $FALLBACK_MODEL)"
    log_info "모드: 청크 비디오 멀티모달 (thinkingLevel: HIGH)"

    # Health Check
    log_info "Health Check..."
    local HC_PROMPT="$SCRIPT_DIR/../temp/hc_prompt.txt"
    local HC_RESPONSE="$SCRIPT_DIR/../temp/hc_response.json"
    echo "1+1=? Answer with just the number." > "$HC_PROMPT"

    # 간단한 텍스트 헬스체크 (비디오 없이, backend/에서 실행하여 node_modules 해결)
    set +e
    (cd "$PROJECT_ROOT" && "$NODE_EXE" --input-type=module -e "
import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const r = await ai.models.generateContent({
    model: process.env.CURRENT_MODEL || 'gemini-3.1-flash-lite-preview',
    contents: '1+1=?'
});
console.log(r.text);
" > "$HC_RESPONSE" 2>"$SCRIPT_DIR/../temp/hc_stderr.log")
    local HC_EXIT=$?
    set -e

    rm -f "$HC_PROMPT"

    if [ $HC_EXIT -eq 0 ]; then
        log_success "Health Check 성공"
    else
        log_error "Health Check 실패 (exit: $HC_EXIT)"
        if [ -f "$SCRIPT_DIR/../temp/hc_stderr.log" ]; then
            log_error "Stderr: $(cat "$SCRIPT_DIR/../temp/hc_stderr.log")"
        fi
        rm -f "$HC_RESPONSE" "$SCRIPT_DIR/../temp/hc_stderr.log"
        exit 1
    fi
    rm -f "$HC_RESPONSE"

    # 채널 처리
    local channels
    channels=$(get_channels)
    log_info "대상 채널: $channels"

    for channel in $channels; do
        process_channel "$channel"
    done

    # 임시 파일 정리
    rm -rf "$SCRIPT_DIR/../temp"/chunk_* "$SCRIPT_DIR/../temp"/*.txt "$SCRIPT_DIR/../temp"/*.json "$SCRIPT_DIR/../temp"/*.log 2>/dev/null || true

    local END_TIME
    END_TIME=$(date +%s)
    local TOTAL_DURATION=$((END_TIME - START_TIME))

    log_info ""
    log_info "============================================================"
    log_success "전체 파이프라인 완료: $(format_duration $TOTAL_DURATION)"
    log_info "============================================================"
}

main
