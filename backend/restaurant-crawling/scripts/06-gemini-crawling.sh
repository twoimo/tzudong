#!/bin/bash
# Gemini CLI 기반 음식점 크롤링 스크립트
# 채널별 처리: data/{channel}/meta + transcript → crawling 결과 저장
# 
# 사용법:
#   ./06-gemini-crawling.sh --channel tzuyang
#   ./06-gemini-crawling.sh --channel meatcreator
#   ./06-gemini-crawling.sh  # 모든 채널

set -e  # 에러 발생 시 즉시 종료

# ================================
# 환경 설정
# ================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG_FILE="$PROJECT_ROOT/config/channels.yaml"

echo "[$(date '+%H:%M:%S')] 📂 SCRIPT_DIR: $SCRIPT_DIR"
echo "[$(date '+%H:%M:%S')] 📂 PROJECT_ROOT: $PROJECT_ROOT"

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
        echo "[$(date '+%H:%M:%S')] ✅ .env 파일 로드: $env_file"
        break
    fi
done

if [ "$ENV_LOADED" = false ]; then
    echo "[$(date '+%H:%M:%S')] ⚠️ .env 파일을 찾지 못했습니다"
fi

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
NC='\033[0m' # No Color

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
    # YAML에서 data_path 추출
    grep -A 5 "^  $channel:" "$CONFIG_FILE" | grep "data_path:" | awk '{print $2}'
}

# ================================
# 프롬프트 로드
# ================================
PROMPT_FILE="$PROJECT_ROOT/restaurant-crawling/prompts/crawling_with_transcript.yaml"

load_prompt() {
    if [ ! -f "$PROMPT_FILE" ]; then
        echo "[$(date '+%H:%M:%S')] ❌ 프롬프트 파일 없음: $PROMPT_FILE"
        exit 1
    fi
    
    # YAML에서 prompt_template 추출 (간단한 sed 사용)
    sed -n '/^prompt_template:/,/^output_schema:/p' "$PROMPT_FILE" | \
        sed '1d;$d' | \
        sed 's/^  //'
}

# ================================
# Gemini CLI 호출
# ================================
RATE_LIMIT_DELAY=12  # 12초 (5 RPM)
LAST_CALL_TIME=0

call_gemini() {
    local prompt="$1"
    local video_id="$2"
    local max_retries=3
    local retry_count=0
    
    # Rate limit 적용
    local current_time=$(date +%s)
    local elapsed=$((current_time - LAST_CALL_TIME))
    if [ $elapsed -lt $RATE_LIMIT_DELAY ]; then
        local wait_time=$((RATE_LIMIT_DELAY - elapsed))
        echo "[$(date '+%H:%M:%S')] ⏳ Rate limit 대기: ${wait_time}초"
        sleep $wait_time
    fi
    
    while [ $retry_count -lt $max_retries ]; do
        echo "[$(date '+%H:%M:%S')] 🤖 Gemini CLI 호출 (모델: $CURRENT_MODEL)"
        
        local result
        result=$(echo "$prompt" | gemini -m "$CURRENT_MODEL" 2>&1) || true
        
        LAST_CALL_TIME=$(date +%s)
        
        # 성공 여부 확인
        if echo "$result" | grep -q '"restaurants"'; then
            echo "$result"
            return 0
        fi
        
        # Rate limit 에러 확인
        if echo "$result" | grep -qi "quota\|rate\|limit\|429"; then
            echo "[$(date '+%H:%M:%S')] ⚠️ Rate limit 감지, fallback 모델로 전환"
            CURRENT_MODEL="$FALLBACK_MODEL"
            retry_count=$((retry_count + 1))
            sleep 5
            continue
        fi
        
        # 기타 에러
        retry_count=$((retry_count + 1))
        echo "[$(date '+%H:%M:%S')] ⚠️ 재시도 $retry_count/$max_retries"
        sleep 3
    done
    
    echo "[$(date '+%H:%M:%S')] ❌ Gemini 호출 실패: $video_id"
    return 1
}

# ================================
# 단일 영상 처리
# ================================
process_video() {
    local channel=$1
    local video_id=$2
    local meta_file=$3
    local transcript_file=$4
    local output_dir=$5
    
    # 이미 처리된 경우 스킵
    local output_file="$output_dir/${video_id}.jsonl"
    if [ -f "$output_file" ]; then
        echo "[$(date '+%H:%M:%S')] ⏭️ 이미 처리됨: $video_id"
        return 0
    fi
    
    # 메타데이터 로드
    if [ ! -f "$meta_file" ]; then
        echo "[$(date '+%H:%M:%S')] ⚠️ 메타 파일 없음: $meta_file"
        return 1
    fi
    
    local title=$(jq -r '.title // ""' "$meta_file" 2>/dev/null | head -c 100)
    local youtube_link="https://www.youtube.com/watch?v=$video_id"
    
    # 자막 로드
    local transcript=""
    local transcript_language="ko"
    if [ -f "$transcript_file" ]; then
        transcript=$(jq -r '.transcript // ""' "$transcript_file" 2>/dev/null)
        transcript_language=$(jq -r '.language // "ko"' "$transcript_file" 2>/dev/null)
    fi
    
    # 프롬프트 생성
    local prompt_template
    prompt_template=$(load_prompt)
    
    local prompt
    prompt=$(echo "$prompt_template" | \
        sed "s|{{youtube_link}}|$youtube_link|g" | \
        sed "s|{{transcript_language}}|$transcript_language|g")
    
    # 자막 추가 (너무 길면 자르기)
    local transcript_truncated
    transcript_truncated=$(echo "$transcript" | head -c 30000)
    prompt="$prompt

$transcript_truncated"
    
    echo "[$(date '+%H:%M:%S')] 🎬 처리 중: $title"
    
    # Gemini 호출
    local result
    result=$(call_gemini "$prompt" "$video_id") || {
        # 에러 저장
        echo "{\"video_id\":\"$video_id\",\"error\":true,\"timestamp\":\"$(date -Iseconds)\"}" > "$output_file"
        return 1
    }
    
    # JSON 추출 (마크다운 태그 제거)
    local json_result
    json_result=$(echo "$result" | sed -n '/^{/,/^}$/p' | head -n 1)
    
    if [ -z "$json_result" ]; then
        # 코드 블록 내부 추출 시도
        json_result=$(echo "$result" | sed -n '/```json/,/```/p' | sed '1d;$d')
    fi
    
    if [ -n "$json_result" ]; then
        # video_id 추가
        echo "$json_result" | jq --arg vid "$video_id" '. + {video_id: $vid}' > "$output_file"
        echo "[$(date '+%H:%M:%S')] ✅ 저장 완료: $output_file"
        return 0
    else
        echo "[$(date '+%H:%M:%S')] ⚠️ JSON 파싱 실패: $video_id"
        echo "{\"video_id\":\"$video_id\",\"error\":true,\"raw\":\"$(echo "$result" | head -c 500 | tr '\n' ' ')\"}" > "$output_file"
        return 1
    fi
}

# ================================
# 채널 처리
# ================================
process_channel() {
    local channel=$1
    local data_path
    data_path=$(get_channel_data_path "$channel")
    
    if [ -z "$data_path" ]; then
        echo "[$(date '+%H:%M:%S')] ❌ 채널 설정 없음: $channel"
        return 1
    fi
    
    local full_data_path="$PROJECT_ROOT/$data_path"
    local meta_dir="$full_data_path/meta"
    local transcript_dir="$full_data_path/transcript"
    local crawling_dir="$full_data_path/crawling"
    
    # 폴더 생성
    mkdir -p "$crawling_dir"
    
    echo ""
    echo "[$(date '+%H:%M:%S')] =========================================="
    echo "[$(date '+%H:%M:%S')] 채널 처리: $channel"
    echo "[$(date '+%H:%M:%S')] 데이터 경로: $full_data_path"
    echo "[$(date '+%H:%M:%S')] =========================================="
    
    # 메타 파일 목록
    if [ ! -d "$meta_dir" ]; then
        echo "[$(date '+%H:%M:%S')] ⚠️ 메타 폴더 없음: $meta_dir"
        return 0
    fi
    
    local meta_files=("$meta_dir"/*.jsonl)
    local total=${#meta_files[@]}
    local processed=0
    local success=0
    local failed=0
    
    echo "[$(date '+%H:%M:%S')] 📊 총 영상: $total 개"
    
    for meta_file in "${meta_files[@]}"; do
        if [ ! -f "$meta_file" ]; then
            continue
        fi
        
        local video_id=$(basename "$meta_file" .jsonl)
        local transcript_file="$transcript_dir/${video_id}.jsonl"
        
        processed=$((processed + 1))
        echo "[$(date '+%H:%M:%S')] [$processed/$total] $video_id"
        
        if process_video "$channel" "$video_id" "$meta_file" "$transcript_file" "$crawling_dir"; then
            success=$((success + 1))
        else
            failed=$((failed + 1))
        fi
    done
    
    echo ""
    echo "[$(date '+%H:%M:%S')] 📊 채널 $channel 처리 완료"
    echo "[$(date '+%H:%M:%S')]    성공: $success / 실패: $failed / 스킵: $((total - processed))"
}

# ================================
# 메인 실행
# ================================
main() {
    echo ""
    echo "[$(date '+%H:%M:%S')] ============================================================"
    echo "[$(date '+%H:%M:%S')]   Gemini CLI 음식점 크롤링 시작"
    echo "[$(date '+%H:%M:%S')] ============================================================"
    
    local start_time=$(date +%s)
    
    # Gemini CLI 확인
    if ! command -v gemini &> /dev/null; then
        echo "[$(date '+%H:%M:%S')] ❌ Gemini CLI 미설치. 'npm install -g @anthropic/gemini-cli' 실행"
        exit 1
    fi
    
    # 채널 목록
    local channels
    channels=$(get_channels)
    
    echo "[$(date '+%H:%M:%S')] 대상 채널: $channels"
    echo "[$(date '+%H:%M:%S')] 모델: $CURRENT_MODEL (fallback: $FALLBACK_MODEL)"
    echo "[$(date '+%H:%M:%S')] Rate limit: ${RATE_LIMIT_DELAY}초"
    
    # 각 채널 처리
    for channel in $channels; do
        process_channel "$channel"
    done
    
    local end_time=$(date +%s)
    local elapsed=$((end_time - start_time))
    
    echo ""
    echo "[$(date '+%H:%M:%S')] ============================================================"
    echo "[$(date '+%H:%M:%S')]   크롤링 완료!"
    echo "[$(date '+%H:%M:%S')]   소요 시간: ${elapsed}초"
    echo "[$(date '+%H:%M:%S')] ============================================================"
}

main
