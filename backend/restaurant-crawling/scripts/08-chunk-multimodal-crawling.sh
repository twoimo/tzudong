#!/bin/bash
# 구간(Chunk) 분할 멀티모달 크롤링 스크립트
# 전체 영상을 시간 기반 청크로 분할하고, Gemini File API로 비디오 세그먼트를
# 직접 전송하여 맛집 정보를 추출합니다.
#
# 파이프라인:
#   1. chunk_planner.py            → 영상 길이 기반 적응형 청크 계획
#   2. rclone / yt-dlp             → 비디오 다운로드 (GDrive 캐시 우선)
#   3. split_video_chunks.mjs      → ffmpeg으로 mp4 세그먼트 분할
#   4. gemini_chunk_video_request.mjs → 청크별 Gemini API 호출
#   5. merge_chunk_results.py      → 결과 병합 및 중복 제거
#
# 사용법:
#   ./08-chunk-multimodal-crawling.sh --channel tzuyang
#   ./08-chunk-multimodal-crawling.sh --channel tzuyang --url "https://youtu.be/VIDEO_ID"
#   ./08-chunk-multimodal-crawling.sh  # 전체 채널

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
export PRIMARY_MODEL="${PRIMARY_MODEL:-gemini-3-flash-preview}"
export FALLBACK_MODEL="${FALLBACK_MODEL:-gemini-3-flash-preview}"
export CURRENT_MODEL="$PRIMARY_MODEL"
export TZ="Asia/Seoul"
# [Cross-Platform] Deno 런타임 PATH 자동 탐색 (yt-dlp n challenge 해결용)
# Git Bash(MINGW): /c/Users/<user>/.deno/bin
# WSL:            /mnt/c/Users/<user>/.deno/bin
# Linux(CI):      $HOME/.deno/bin
if ! command -v deno &> /dev/null; then
    DENO_SEARCH_PATHS=()
    case "${OS_NAME:-$(uname -s)}" in
        Windows|CYGWIN*|MINGW*|MSYS*)
            # Git Bash: 현재 사용자의 .deno/bin
            [ -n "$USERPROFILE" ] && DENO_SEARCH_PATHS+=("$(cygpath -u "$USERPROFILE" 2>/dev/null)/.deno/bin")
            [ -n "$HOME" ] && DENO_SEARCH_PATHS+=("$HOME/.deno/bin")
            ;;
        *)
            # Linux/macOS/WSL
            DENO_SEARCH_PATHS+=("$HOME/.deno/bin")
            # WSL에서 Windows Deno 사용 폴백
            if grep -qi microsoft /proc/version 2>/dev/null; then
                WIN_USER=$(cmd.exe /C "echo %USERPROFILE%" 2>/dev/null | tr -d '\r')
                [ -n "$WIN_USER" ] && DENO_SEARCH_PATHS+=("$(wslpath -u "$WIN_USER" 2>/dev/null)/.deno/bin")
            fi
            ;;
    esac
    for deno_path in "${DENO_SEARCH_PATHS[@]}"; do
        if [ -d "$deno_path" ]; then
            export PATH="$deno_path:$PATH"
            break
        fi
    done
fi
PYTHON_CMD="${PYTHON_CMD:-python}"

# 터미널 색상 (비터미널 환경에선 비활성)
if [ -t 1 ]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
    BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; BLUE=''; CYAN=''; NC=''
fi

# OS 감지 및 경로 정규화
OS_TYPE="$(uname -s)"
case "${OS_TYPE}" in
    Linux*)                  OS_NAME=Linux;;
    Darwin*)                 OS_NAME=Mac;;
    CYGWIN*|MINGW*|MSYS*)   OS_NAME=Windows;;
    *)                       OS_NAME="UNKNOWN:${OS_TYPE}";;
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
else echo "[ERROR] jq를 찾을 수 없습니다"; exit 1; fi

if command -v node &> /dev/null; then NODE_EXE="node"
elif [ -f "/c/Program Files/nodejs/node.exe" ]; then NODE_EXE="/c/Program Files/nodejs/node.exe"
else NODE_EXE=""; fi

if command -v python &> /dev/null; then PYTHON_CMD="python"
elif command -v python3 &> /dev/null; then PYTHON_CMD="python3"
else echo "[ERROR] python을 찾을 수 없습니다"; exit 1; fi

# ffmpeg 감지: 시스템 PATH → node_modules/ffmpeg-static 폴백
# yt-dlp 비디오+오디오 병합에 ffmpeg이 필요
if ! command -v ffmpeg &> /dev/null && [ -n "$NODE_EXE" ]; then
    FFMPEG_STATIC_PATH=$("$NODE_EXE" -e "try{console.log(require('ffmpeg-static'))}catch(e){}" 2>/dev/null)
    if [ -n "$FFMPEG_STATIC_PATH" ] && [ -f "$FFMPEG_STATIC_PATH" ]; then
        export PATH="$(dirname "$FFMPEG_STATIC_PATH"):$PATH"
        echo "[$(date '+%H:%M:%S')] [INFO] ffmpeg-static → PATH 추가: $FFMPEG_STATIC_PATH" >&2
    fi
fi

# Windows jq.exe는 WSL 경로를 직접 읽지 못하므로 반드시 stdin으로 전달
jq_wrapper() { "$JQ_EXE" "$@" | tr -d '\r'; }

TEMP_BASE="$(cd "$SCRIPT_DIR/.." && pwd)/temp"
mkdir -p "$TEMP_BASE"

# ================================
# 로그 함수 (모두 stderr 출력 — stdout은 함수 반환값 전용)
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
        --url|-u)     SINGLE_URL="$2"; shift 2;;
        --force|-f)   FORCE_MODE=true; shift;;
        *)            echo "알 수 없는 옵션: $1"; exit 1;;
    esac
done

# ================================
# 채널 유틸리티
# ================================
get_channels() {
    if [ -n "$CHANNEL_FILTER" ]; then
        echo "$CHANNEL_FILTER"
    else
        grep -E "^  [a-z]+:" "$CONFIG_FILE" | sed 's/://g' | awk '{print $1}'
    fi
}

get_channel_data_path() {
    local channel=$1
    grep -A 5 "^  $channel:" "$CONFIG_FILE" | grep "  data_path:" | awk '{print $2}' | tr -d '"\r'
}

get_channel_name() {
    local channel=$1
    grep -A 5 "^  $channel:" "$CONFIG_FILE" | grep "name:" | sed 's/.*name: *//' | tr -d '"\r'
}

get_latest_jsonl_data() {
    local file=$1
    if [ -f "$file" ]; then tail -n 1 "$file"; else echo ""; fi
}

extract_video_id() {
    echo "$1" | sed -n 's/.*v=\([^&]*\).*/\1/p'
}

# ================================
# 비디오 다운로드 (GDrive 캐시 → yt-dlp 폴백)
# ================================
download_video() {
    local video_id=$1 output_dir=$2

    # 로컬 캐시 탐색
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

    # GDrive rclone 다운로드 시도
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
        log_debug "GDrive에 비디오 없음 → yt-dlp 전환"
    fi

    # yt-dlp 다운로드
    local yt_dlp_cmd=""
    if command -v yt-dlp &> /dev/null; then yt_dlp_cmd="yt-dlp"
    elif command -v yt-dlp.exe &> /dev/null; then yt_dlp_cmd="yt-dlp.exe"
    elif command -v python3 &> /dev/null && python3 -m yt_dlp --version &> /dev/null; then yt_dlp_cmd="python3 -m yt_dlp"
    elif command -v python &> /dev/null && python -m yt_dlp --version &> /dev/null; then yt_dlp_cmd="python -m yt_dlp"
    else log_error "yt-dlp를 찾을 수 없습니다"; return 1; fi

    local output_template="$output_dir/${video_id}.%(ext)s"
    local cookie_file="$PROJECT_ROOT/restaurant-crawling/data/cookies.txt"
    local cookie_arg=""

    if [[ "$yt_dlp_cmd" == *".exe"* ]] && command -v wslpath &> /dev/null; then
        output_template="$(wslpath -w "$output_dir")\\${video_id}.%(ext)s"
        [ -f "$cookie_file" ] && cookie_arg="--cookies $(wslpath -w "$cookie_file")"
    else
        [ -f "$cookie_file" ] && cookie_arg="--cookies $cookie_file"
    fi

    log_info "yt-dlp 다운로드: $video_id (최대 360p 우선, cmd=$yt_dlp_cmd)"
    $yt_dlp_cmd --js-runtimes "deno" --js-runtimes "node" $cookie_arg \
        --impersonate Chrome \
        -f "bestvideo[height<=360]+bestaudio/best[height<=360]/best" \
        -o "$output_template" \
        "https://www.youtube.com/watch?v=$video_id" >&2

    # 정확한 파일명 또는 형식 코드 포함 파일명(*.f396.mp4 등) 모두 탐색
    for ext in mp4 webm mkv; do
        local downloaded="$output_dir/${video_id}.${ext}"
        if [ -f "$downloaded" ]; then
            if [ -n "$GDRIVE_REMOTE_PATH" ] && command -v rclone &> /dev/null; then
                log_info "GDrive 캐시에 로컬 비디오 업로드 중..."
                rclone copy "$downloaded" "$GDRIVE_REMOTE_PATH" --progress >&2 2>/dev/null || true
            fi
            echo "$downloaded"
            return 0
        fi
    done
    # ffmpeg 미설치 시 yt-dlp가 형식 코드 포함 파일명으로 저장하는 경우 대응
    local fallback
    fallback=$(find "$output_dir" -maxdepth 1 -name "${video_id}.*" -type f \( -name "*.mp4" -o -name "*.webm" -o -name "*.mkv" \) 2>/dev/null | head -1)
    if [ -n "$fallback" ] && [ -f "$fallback" ]; then
        log_warning "형식 코드 포함 파일 발견: $(basename "$fallback")"
        if [ -n "$GDRIVE_REMOTE_PATH" ] && command -v rclone &> /dev/null; then
            log_info "GDrive 캐시에 로컬 비디오 확장 업로드 중..."
            rclone copy "$fallback" "$GDRIVE_REMOTE_PATH" --progress >&2 2>/dev/null || true
        fi
        echo "$fallback"
        return 0
    fi

    log_error "비디오 다운로드 실패: $video_id"
    return 1
}

# ================================
# 단일 영상 청크 분석
# ================================
process_video_chunks() {
    local channel=$1 channel_name=$2 video_id=$3 youtube_link=$4
    local full_data_path=$5 meta_file=$6 transcript_file=$7
    local crawling_dir="$full_data_path/crawling" errors_dir="$full_data_path/crawling_errors"
    local temp_dir="$TEMP_BASE/chunk_${video_id}"

    mkdir -p "$temp_dir" "$crawling_dir"

    # 메타데이터: 단일 jq 호출로 duration + recollect_id 동시 추출
    local meta_data
    meta_data=$(get_latest_jsonl_data "$meta_file")
    local title
    title=$(jq_wrapper -r '.title // ""' <<< "$meta_data" 2>/dev/null)
    title="${title:0:100}"
    local meta_nums
    meta_nums=$(jq_wrapper -r '[(.duration // 0 | tostring), (.recollect_id // 0 | tostring)] | join("\t")' <<< "$meta_data" 2>/dev/null)
    local duration meta_recollect_id
    IFS=$'\t' read -r duration meta_recollect_id <<< "$meta_nums"

    # 자막 데이터: 단일 jq 호출로 language + recollect_id 동시 추출
    local transcript_data
    transcript_data=$(get_latest_jsonl_data "$transcript_file")
    local transcript_parsed
    transcript_parsed=$(jq_wrapper -r '[(.language // "ko"), (.recollect_id // 0 | tostring)] | join("\t")' <<< "$transcript_data" 2>/dev/null)
    local transcript_language transcript_recollect_id
    IFS=$'\t' read -r transcript_language transcript_recollect_id <<< "$transcript_parsed"

    if [ "$duration" = "0" ] || [ -z "$duration" ]; then
        log_warning "영상 길이 정보 없음: $video_id"
        return 1
    fi

    log_info "처리 시작: $title (${duration}s)"

    # [1/5] 청크 계획 생성 (if로 직접 종료 코드 검사 — set -e 안전)
    log_info "[1/5] 청크 계획 생성..."
    local chunks_json="$temp_dir/chunks.json"
    if ! $PYTHON_CMD "$CHUNK_PLANNER" \
            --video-id="$video_id" \
            --duration "$duration" \
            --transcript-file "$transcript_file" \
            --output "$chunks_json" || [ ! -s "$chunks_json" ]; then
        log_error "청크 계획 생성 실패"
        rm -rf "$temp_dir"
        return 1
    fi

    # cat 프로세스 제거 — stdin 리다이렉트로 jq에 전달
    local total_chunks
    total_chunks=$(jq_wrapper 'length' < "$chunks_json")
    log_success "청크 계획: ${total_chunks}개 청크"

    # 루프 내 반복 파일 읽기 제거: 한 번만 읽어 변수에 캐시
    local chunks_content
    chunks_content=$(<"$chunks_json")

    # [2/5] 비디오 다운로드
    log_info "[2/5] 비디오 다운로드..."
    local video_path
    video_path=$(download_video "$video_id" "$temp_dir")

    if [ -z "$video_path" ] || [ ! -f "$video_path" ]; then
        log_error "비디오 다운로드 실패: $video_id"
        rm -rf "$temp_dir"
        return 1
    fi
    log_success "비디오 준비 완료: $(basename "$video_path")"

    # [3/5] mp4 세그먼트 분할 (청크가 1개면 생략)
    local segments_dir="$temp_dir/segments"
    mkdir -p "$segments_dir"
    
    if [ "$total_chunks" -eq 1 ]; then
        log_info "청크가 1개이므로 비디오 분할을 생략하고 원본을 사용합니다."
    else
        log_info "[3/5] mp4 세그먼트 분할..."
        local win_split=$(normalize_path "$SPLIT_VIDEO")
        local win_video=$(normalize_path "$video_path")
        local win_chunks=$(normalize_path "$chunks_json")
        local win_segments=$(normalize_path "$segments_dir")

        if ! "$NODE_EXE" "$win_split" "$win_video" "$win_chunks" "$win_segments"; then
            log_error "비디오 분할 실패"
            rm -rf "$temp_dir"
            return 1
        fi
        log_success "세그먼트 분할 완료"
    fi

    # [4/5] 청크별 Gemini API 호출
    log_info "[4/5] Gemini API 호출 (${total_chunks} 청크)..."
    local responses_dir="$temp_dir/responses"
    mkdir -p "$responses_dir"

    # cat+sed 제거 — 파일 직접 읽기 + 순수 bash 문자열 치환
    local prompt_raw
    prompt_raw=$(<"$PROMPT_FILE")
    local prompt_template="${prompt_raw//{YOUTUBER_NAME}/$channel_name}"

    # 불변 경로는 루프 밖에서 한 번만 정규화
    local win_gemini=$(normalize_path "$GEMINI_CHUNK_API")

    local chunk_success=0 chunk_failed=0
    local max_jobs=3

    # seq 서브프로세스 제거 — C 스타일 for 루프 사용
    for ((i = 0; i < total_chunks; i++)); do
        # 캐시된 JSON에서 단일 jq 호출로 start_sec + end_sec 동시 추출
        local chunk_se
        chunk_se=$(jq_wrapper -r ".[$i] | \"\(.start_sec)\t\(.end_sec)\"" <<< "$chunks_content")
        local chunk_start="${chunk_se%%$'\t'*}" chunk_end="${chunk_se##*$'\t'}"
        local chunk_transcript
        chunk_transcript=$(jq_wrapper -r ".[$i].transcript_text" <<< "$chunks_content")

        # printf -v로 서브셸 제거 ($(printf ...) 대신 변수에 직접 할당)
        local start_int=${chunk_start%.*} end_int=${chunk_end%.*}
        local start_mm end_mm
        printf -v start_mm "%02d:%02d" $((start_int / 60)) $((start_int % 60))
        printf -v end_mm "%02d:%02d" $((end_int / 60)) $((end_int % 60))

        # 4회 echo|sed 호출 제거 — 순수 bash 문자열 치환
        local chunk_prompt="${prompt_template//{CHUNK_INDEX}/$((i + 1))}"
        chunk_prompt="${chunk_prompt//{TOTAL_CHUNKS}/${total_chunks}}"
        chunk_prompt="${chunk_prompt//{START_TIME}/${start_mm}}"
        chunk_prompt="${chunk_prompt//{END_TIME}/${end_mm}}"

        local prompt_file="$temp_dir/prompt_chunk_${i}.txt"
        local response_file="$responses_dir/chunk_response_${i}.json"
        
        local segment_file
        if [ "$total_chunks" -eq 1 ]; then
            segment_file="$video_path"
        else
            segment_file="$segments_dir/chunk_${i}.mp4"
        fi

        cat > "$prompt_file" <<PROMPT_EOF
$chunk_prompt

<영상 정보>
영상 제목: $title
유튜브 링크: $youtube_link
분석 구간: ${start_mm} ~ ${end_mm}
</영상 정보>

<참고: YouTube 자막>
아래는 이 구간(${start_mm} ~ ${end_mm})의 자막입니다.
[자막 언어: $transcript_language]
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

        log_info "  청크 $((i + 1))/${total_chunks}: ${start_mm}~${end_mm}"

        # 반복 변하는 경로만 루프 내에서 정규화
        local win_prompt=$(normalize_path "$prompt_file")
        local win_response=$(normalize_path "$response_file")
        local win_segment=$(normalize_path "$segment_file")

        (
            set +e
            "$NODE_EXE" "$win_gemini" "$win_prompt" "$win_response" "$win_segment" 2>"$temp_dir/stderr_${i}.log"
            local exit_code=$?
            set -e

            if [ $exit_code -eq 0 ] && [ -s "$response_file" ]; then
                log_success "  청크 $((i + 1)) 성공"
            elif [ $exit_code -eq 42 ]; then
                log_error "  [QUOTA_ERROR] 할당량 초과. 파이프라인 중지 플래그 생성."
                touch "$TEMP_BASE/quota_exceeded.flag"
            else
                log_error "  청크 $((i + 1)) 실패 (exit: $exit_code)"
                [ -f "$temp_dir/stderr_${i}.log" ] && cat "$temp_dir/stderr_${i}.log" >&2

                # 폴백 모델로 재시도
                if [ "$CURRENT_MODEL" = "$PRIMARY_MODEL" ]; then
                    log_warning "  청크 $((i + 1)) 폴백 모델($FALLBACK_MODEL)로 재시도..."
                    CURRENT_MODEL="$FALLBACK_MODEL"
                    export CURRENT_MODEL
                    sleep 5

                    set +e
                    "$NODE_EXE" "$win_gemini" "$win_prompt" "$win_response" "$win_segment" 2>>"$temp_dir/stderr_${i}.log"
                    local fb_exit=$?
                    set -e

                    if [ $fb_exit -eq 0 ] && [ -s "$response_file" ]; then
                        log_success "  청크 $((i + 1)) 폴백 성공"
                    elif [ $fb_exit -eq 42 ]; then
                        log_error "  [QUOTA_ERROR] 할당량 초과. 파이프라인 중지 플래그 생성."
                        touch "$TEMP_BASE/quota_exceeded.flag"
                    fi
                fi
            fi
        ) &

        # 일정 개수(max_jobs)만큼 실행 후 대기 (병렬 실행 제어)
        if (( (i + 1) % max_jobs == 0 )) || (( i == total_chunks - 1 )); then
            wait
            sleep 2
        fi
        
        # 쿼타 초과 플래그 감지
        if [ -f "$TEMP_BASE/quota_exceeded.flag" ]; then
            log_error "할당량 초과(Quota Error)가 감지되어 해당 채널/영상의 남은 청크 처리를 즉시 중단합니다."
            return 42
        fi
    done

    # 병렬 실행 후 결과 수합
    for ((i = 0; i < total_chunks; i++)); do
        local response_file="$responses_dir/chunk_response_${i}.json"
        if [ -s "$response_file" ]; then
            chunk_success=$((chunk_success + 1))
        else
            chunk_failed=$((chunk_failed + 1))
        fi
    done

    log_info "  청크 결과: 성공 ${chunk_success}/${total_chunks}, 실패 ${chunk_failed}"

    if [ $chunk_success -eq 0 ]; then
        log_error "모든 청크 실패: $video_id"
        rm -rf "$temp_dir"
        return 1
    fi

    # [5/5] 결과 병합 (if로 직접 종료 코드 검사 — set -e 안전)
    log_info "[5/5] 결과 병합..."
    local raw_merged_response="$temp_dir/raw_merged_response.json"

    if ! $PYTHON_CMD "$MERGE_RESULTS" --dir "$responses_dir" > "$raw_merged_response" || [ ! -s "$raw_merged_response" ]; then
        log_error "결과 병합 실패"
        rm -rf "$temp_dir"
        return 1
    fi

    # [6/5] LLM 기반 최종 정리 및 환각 필터링 (새로운 단계)
    local final_merged_response="$temp_dir/merged_response.json"

    if [ "$total_chunks" -eq 1 ]; then
        log_info "청크가 1개이므로 LLM 최종 정리(Step 6/5)를 생략하고 즉시 저장합니다."
        cp "$raw_merged_response" "$final_merged_response"
    else
        log_info "[6/5] LLM 기반 최종 결과 정리..."
        local win_final_merge=$(normalize_path "$SCRIPT_DIR/final_merge_chunk.mjs")
        local win_final_prompt=$(normalize_path "$SCRIPT_DIR/../prompts/final_merge_prompt.txt")
        local win_raw_merged=$(normalize_path "$raw_merged_response")
        local win_transcript=$(normalize_path "$transcript_file")
        local win_final_out=$(normalize_path "$final_merged_response")

        if ! "$NODE_EXE" "$win_final_merge" "$win_final_prompt" "$win_final_out" "$win_raw_merged" "$win_transcript"; then
            log_warning "LLM 최종 정리 실패, Raw 병합본으로 대체합니다."
            cp "$raw_merged_response" "$final_merged_response"
        fi
    fi

    # parse_result.py로 최종 저장
    local crawling_file="$crawling_dir/${video_id}.jsonl"

    if $PYTHON_CMD "$PARSER_SCRIPT" parse "$youtube_link" "$final_merged_response" "$crawling_file" "$meta_recollect_id" "$transcript_recollect_id" "$channel"; then
        log_success "최종 저장 완료: $crawling_file"
    else
        log_error "파서 실패: $video_id"
        mkdir -p "$errors_dir"
        "$JQ_EXE" -n \
            --arg yl "$youtube_link" --arg vid "$video_id" \
            --arg err "chunk merge/parse failure" \
            --arg meta "$meta_recollect_id" --arg trans "$transcript_recollect_id" \
            '{youtube_link: $yl, video_id: $vid, error: $err, recollect_version: {meta: ($meta | tonumber), transcript: ($trans | tonumber)}}' \
            > "$errors_dir/${video_id}.jsonl"
    fi

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
    local urls=()
    if [ -n "$SINGLE_URL" ]; then
        urls=("$SINGLE_URL")
    else
        if [ ! -f "$urls_file" ]; then
            log_warning "urls.txt 없음: $urls_file"
            return 0
        fi
        mapfile -t urls < <($PYTHON_CMD "$PARSER_SCRIPT" scan --channel "$channel" | tr -d '\r')
    fi

    local total=${#urls[@]}
    if [ $total -eq 0 ]; then
        log_success "처리할 대상 없음"
        return 0
    fi

    log_info "처리 대상: ${total}개"

    local success_count=0 failed_count=0 skipped_count=0 total_time=0

    for i in "${!urls[@]}"; do
        local url="${urls[$i]}"
        local index=$((i + 1))

        [ -z "$url" ] && continue

        local video_id
        video_id=$(extract_video_id "$url")
        [ -z "$video_id" ] && continue

        local crawling_file="$crawling_dir/${video_id}.jsonl"
        local map_file="$full_data_path/map_url_crawling/${video_id}.jsonl"

        # 이미 처리 완료 시 건너뜀 (--force 제외)
        if [ "$FORCE_MODE" = false ] && { [ -f "$crawling_file" ] || [ -f "$map_file" ]; }; then
            skipped_count=$((skipped_count + 1))
            continue
        fi

        local meta_file="$meta_dir/${video_id}.jsonl"
        local transcript_file="$transcript_dir/${video_id}.jsonl"

        if [ ! -f "$meta_file" ]; then
            log_warning "[$index/$total] 메타 없음: $video_id"
            continue
        fi

        if [ ! -f "$transcript_file" ]; then
            log_warning "[$index/$total] 자막 없음: $video_id"
            continue
        fi

        log_info "[$index/$total] 청크 분석 시작: $video_id"
        local video_start
        video_start=$(date +%s)

        set +e
        process_video_chunks "$channel" "$channel_name" "$video_id" "$url" "$full_data_path" "$meta_file" "$transcript_file"
        local proc_exit=$?
        set -e
        
        if [ $proc_exit -eq 0 ]; then
            success_count=$((success_count + 1))
            local video_end
            video_end=$(date +%s)
            local video_elapsed=$((video_end - video_start))
            total_time=$((total_time + video_elapsed))
            log_success "[$index/$total] 완료 (${video_elapsed}s)"
        elif [ $proc_exit -eq 42 ]; then
            log_error "할당량 초과(Quota Error) 감지. 채널 처리를 완전히 중단합니다. 다음 날 이어서 진행됩니다."
            exit 42
        else
            failed_count=$((failed_count + 1))
            log_error "[$index/$total] 실패: $video_id"
        fi
    done

    log_info ""
    log_info "=========================================="
    log_success "채널 $channel 처리 완료"
    log_info "=========================================="
    log_success "  성공: $success_count"
    log_warning "  스킵: $skipped_count"
    log_error "  실패: $failed_count"
    log_info "  총 소요: $(format_duration $total_time)"
}

# ================================
# 메인 실행
# ================================
main() {
    log_info ""
    log_info "============================================================"
    log_info "  청크 멀티모달 크롤링 시작 (Gemini Video API)"
    log_info "============================================================"

    local start_time
    start_time=$(date +%s)

    # 필수 파일 존재 확인
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

    # API 키 설정
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

    # 헬스 체크 (임시 파일은 $TEMP_BASE 경로 통일)
    log_info "Health Check..."
    local hc_response="$TEMP_BASE/hc_response.json"
    local hc_stderr="$TEMP_BASE/hc_stderr.log"

    set +e
    (cd "$PROJECT_ROOT" && "$NODE_EXE" --input-type=module -e "
import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const r = await ai.models.generateContent({
    model: process.env.CURRENT_MODEL || 'gemini-3-flash-preview',
    contents: '1+1=?'
});
console.log(r.text);
" > "$hc_response" 2>"$hc_stderr")
    local hc_exit=$?
    set -e

    if [ $hc_exit -eq 0 ]; then
        log_success "Health Check 성공"
    else
        log_error "Health Check 실패 (exit: $hc_exit)"
        [ -f "$hc_stderr" ] && log_error "Stderr: $(<"$hc_stderr")"
        rm -f "$hc_response" "$hc_stderr"
        exit 1
    fi
    rm -f "$hc_response" "$hc_stderr"

    # 채널 처리
    local channels
    channels=$(get_channels)
    log_info "대상 채널: $channels"

    for channel in $channels; do
        process_channel "$channel"
    done

    # 임시 파일 정리 ($TEMP_BASE 경로 통일)
    rm -rf "$TEMP_BASE"/chunk_* "$TEMP_BASE"/*.txt "$TEMP_BASE"/*.json "$TEMP_BASE"/*.log 2>/dev/null || true

    local end_time
    end_time=$(date +%s)
    local total_duration=$((end_time - start_time))

    log_info ""
    log_info "============================================================"
    log_success "전체 파이프라인 완료: $(format_duration $total_duration)"
    log_info "============================================================"
}

main
