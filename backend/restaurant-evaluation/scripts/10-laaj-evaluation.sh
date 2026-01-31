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
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
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

# [Auth] Check for OAuth Credentials in Env
if [ -n "$GEMINI_CREDENTIALS_BASE64" ]; then
    OAUTH_CREDS_PATH="$HOME/.gemini/oauth_creds.json"
    if [ ! -f "$OAUTH_CREDS_PATH" ]; then
        echo "GEMINI_CREDENTIALS_BASE64 감지됨 - 인증 파일 생성 중..."
        mkdir -p "$HOME/.gemini"
        echo "$GEMINI_CREDENTIALS_BASE64" | base64 -d > "$OAUTH_CREDS_PATH"
    fi
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

# Evaluation 경로에서 읽기/쓰기
RULE_RESULTS_DIR="$FULL_EVALUATION_PATH/evaluation/rule_results"
LAAJ_RESULTS_DIR="$FULL_EVALUATION_PATH/evaluation/laaj_results"
ERRORS_DIR="$FULL_EVALUATION_PATH/evaluation/errors"

# Crawling 경로에서 읽기
TRANSCRIPT_DIR="$FULL_CRAWLING_PATH/transcript"
META_DIR="$FULL_CRAWLING_PATH/meta"

TEMP_DIR="$SCRIPT_DIR/../temp"

mkdir -p "$LAAJ_RESULTS_DIR" "$ERRORS_DIR" "$TEMP_DIR"

log_info "============================================================"
log_info "  Gemini CLI LAAJ 음식점 평가 시작"
log_info "============================================================"
log_info "채널: $CHANNEL"
log_info "크롤링 경로: $FULL_CRAWLING_PATH"
log_info "평가 경로: $FULL_EVALUATION_PATH"
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

# GEMINI_API_KEY 확인
# GEMINI_API_KEY 확인
if [ -z "$GEMINI_API_KEY" ]; then
    if [ -n "$GEMINI_API_KEY_BYEON" ]; then
        export GEMINI_API_KEY="$GEMINI_API_KEY_BYEON"
        log_success "GEMINI_API_KEY 설정 완료 (from GEMINI_API_KEY_BYEON)"
    else
        # [Add] OAuth Creds 체크
        if [ -f "$HOME/.gemini/oauth_creds.json" ]; then
            log_warning "GEMINI_API_KEY 없음, 하지만 oauth_creds.json 발견됨. OAuth 모드로 진행합니다."
            export USE_OAUTH=true
        else
            log_error "GEMINI_API_KEY 환경변수가 설정되지 않았습니다 (OAuth 파일도 없음)"
            exit 1
        fi
    fi
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
    
    # 이미 성공한 파일은 스킵
    if [ -f "$OUTPUT_FILE" ]; then
        SKIPPED_EXISTS=$((SKIPPED_EXISTS + 1))
        if [ $((SKIPPED_EXISTS % 50)) -eq 1 ]; then
            log_warning "[$INDEX/$TOTAL] 이미 처리됨 (스킵 ${SKIPPED_EXISTS}개)"
        fi
        continue
    fi
    
    # 에러 파일 있으면 재시도 대상 (에러 파일 삭제 후 진행)
    IS_RETRY=false
    if [ -f "$ERROR_FILE" ]; then
        IS_RETRY=true
        rm "$ERROR_FILE"
        log_info "[$INDEX/$TOTAL] 에러 파일 재시도: $VIDEO_ID"
    fi
    
    # rule_results 데이터 로드
    RULE_DATA=$(tail -n 1 "$RULE_FILE")
    YOUTUBE_LINK=$(echo "$RULE_DATA" | jq -r '.youtube_link')
    CHANNEL_NAME=$(echo "$RULE_DATA" | jq -r '.channel_name // ""')
    EVALUATION_TARGET=$(echo "$RULE_DATA" | jq -c '.evaluation_target // {}')
    RESTAURANTS=$(echo "$RULE_DATA" | jq -c '.restaurants // []')
    EVAL_RESULTS=$(echo "$RULE_DATA" | jq -c '.evaluation_results // {}')
    RECOLLECT_VERSION=$(echo "$RULE_DATA" | jq -c '.recollect_version // {}')
    TARGET_META_ID=$(echo "$RECOLLECT_VERSION" | jq -r '.meta // 0')
    
    # recollect_version.meta 기반으로 meta 파일에서 title 조회
    META_FILE="$META_DIR/${VIDEO_ID}.jsonl"
    VIDEO_TITLE=""
    if [ -f "$META_FILE" ]; then
        while IFS= read -r META_LINE; do
            META_RECOLLECT_ID=$(echo "$META_LINE" | jq -r '.recollect_id // 0')
            if [ "$META_RECOLLECT_ID" = "$TARGET_META_ID" ]; then
                VIDEO_TITLE=$(echo "$META_LINE" | jq -r '.title // ""' | head -c 100)
                break
            fi
        done < "$META_FILE"
        # 못 찾으면 마지막 줄 사용
        if [ -z "$VIDEO_TITLE" ]; then
            VIDEO_TITLE=$(tail -n 1 "$META_FILE" | jq -r '.title // ""' | head -c 100)
        fi
    fi
    
    # evaluation_target에 true 값이 있는 경우만 평가
    HAS_TRUE_TARGET=$(echo "$EVALUATION_TARGET" | jq 'to_entries | map(select(.value == true)) | length')
    if [ "$HAS_TRUE_TARGET" -eq 0 ]; then
        SKIPPED_NO_TARGET=$((SKIPPED_NO_TARGET + 1))
        continue
    fi
    
    # 평가 대상 음식점 추출 (evaluation_target[origin_name] == true인 것만)
    # naver_name이 있으면 name으로 사용, 없으면 origin_name 사용
    # name_source는 따로 저장해두고 파싱 시 활용
    
    # 원본 데이터 (name_source 포함) - 파싱용
    RESTAURANTS_WITH_SOURCE=$(echo "$RULE_DATA" | jq -c '
        .restaurants as $rests |
        .evaluation_target as $targets |
        .evaluation_results.location_match_TF as $loc_evals |
        $rests | map(
            select($targets[.origin_name] == true) |
            . as $r |
            ($loc_evals | map(select(.origin_name == $r.origin_name)) | first // null) as $loc |
            {
                origin_name: .origin_name,
                name: (if $loc and $loc.naver_name then $loc.naver_name else .origin_name end),
                name_source: (if $loc and $loc.naver_name then "naver_name" else "origin_name" end)
            }
        )
    ')
    
    # 프롬프트용 데이터 (name만, origin_name/name_source 제외)
    RESTAURANTS_TO_EVALUATE=$(echo "$RULE_DATA" | jq -c '
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

<영상 정보>
영상 제목: $VIDEO_TITLE
유튜브 링크: $YOUTUBE_LINK
</영상 정보>

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
    
    # Gemini API 호출 (1차: Node.js SDK -> 2차: CLI Fallback)
    GEMINI_START=$(date +%s)
    GEMINI_SUCCESS=false
    
    GEMINI_API_SCRIPT="$TEMP_DIR/gemini_api_request.mjs"
    
    # Node.js 스크립트 동적 생성 (Inline)
    cat << 'EOF' > "$GEMINI_API_SCRIPT"
import fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.error('Usage: node gemini_api_request.js <prompt_file> <output_file>');
        process.exit(1);
    }

    const promptFile = args[0];
    const outputFile = args[1];
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        console.error('Error: GEMINI_API_KEY environment variable not set.');
        process.exit(1);
    }

    try {
        const prompt = fs.readFileSync(promptFile, 'utf8');
        const genAI = new GoogleGenerativeAI(apiKey);
        const modelName = process.env.PRIMARY_MODEL || 'gemini-2.5-flash';
        const model = genAI.getGenerativeModel({ model: modelName });

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        fs.writeFileSync(outputFile, text);
        process.exit(0);

    } catch (error) {
        console.error(`Gemini API Error: ${error.message}`);
        process.exit(1);
    }
}

main();
EOF

    log_debug "Gemini API 호출 시도 (via gemini_api_request.js)"
    
    if [ "$USE_OAUTH" = "true" ]; then
        log_info "OAuth 모드: Node.js API 호출 건너뜀 (CLI 사용)"
    else
        if node "$GEMINI_API_SCRIPT" "$TEMP_PROMPT" "$TEMP_RESPONSE"; then
            GEMINI_SUCCESS=true
            log_debug "Gemini API 호출 성공"
        else
            log_warning "Gemini API 호출 실패 (CLI Fallback 시도)"
        fi
    fi
        
    # 2차 시도: Gemini CLI (Node.js 실패 시 또는 OAuth 모드 시 Exec)
    if [ "$GEMINI_SUCCESS" = false ]; then
        log_debug "Gemini CLI 모델: $CURRENT_MODEL"
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
    fi
    
    GEMINI_END=$(date +%s)
    GEMINI_DURATION=$((GEMINI_END - GEMINI_START))
    TOTAL_GEMINI_TIME=$((TOTAL_GEMINI_TIME + GEMINI_DURATION))
    GEMINI_CALLS=$((GEMINI_CALLS + 1))
    
    if [ "$GEMINI_SUCCESS" = true ]; then
        # 파서 실행 (최대 3회 시도)
        PARSE_SUCCESS=false
        for PARSE_ATTEMPT in 1 2 3; do
            if python3 "$PARSER_SCRIPT" \
                --channel "$CHANNEL" \
                --evaluation-path "$EVALUATION_PATH" \
                --video-id "$VIDEO_ID" \
                --response-file "$TEMP_RESPONSE" \
                --rule-file "$RULE_FILE"; then
                
                SUCCESS=$((SUCCESS + 1))
                PARSE_SUCCESS=true
                log_success "성공 [$INDEX/$TOTAL] - ${GEMINI_DURATION}s"
                break
            else
                if [ $PARSE_ATTEMPT -lt 3 ]; then
                    log_warning "파서 실패 (${PARSE_ATTEMPT}차 시도) - Gemini 재호출 중..."
                    sleep 12  # RPM 대기
                    # Gemini CLI 재호출
                    GEMINI_START=$(date +%s)
                    if gemini -p "$(cat "$TEMP_PROMPT")" --model "$CURRENT_MODEL" --output-format json --yolo < /dev/null > "$TEMP_RESPONSE" 2>"$TEMP_STDERR"; then
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
            
            # 에러 저장 (recollect_version 포함)
            jq -n \
                --arg yl "$YOUTUBE_LINK" \
                --arg vid "$VIDEO_ID" \
                --arg err "파싱 실패 (3회 시도 후)" \
                --argjson rv "$RECOLLECT_VERSION" \
                '{youtube_link: $yl, video_id: $vid, error: $err, recollect_version: $rv}' > "$ERROR_FILE"
            
            log_error "파서 실패 (3회 시도 후) [$INDEX/$TOTAL]"
        fi
    else
        FAILED=$((FAILED + 1))
        
        # 에러 저장 (recollect_version 포함)
        jq -n \
            --arg yl "$YOUTUBE_LINK" \
            --arg vid "$VIDEO_ID" \
            --arg err "Gemini CLI 호출 실패" \
            --argjson rv "$RECOLLECT_VERSION" \
            '{youtube_link: $yl, video_id: $vid, error: $err, recollect_version: $rv}' > "$ERROR_FILE"
        
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
