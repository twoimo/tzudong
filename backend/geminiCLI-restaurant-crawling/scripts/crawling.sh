#!/bin/bash
# Gemini CLI 기반 음식점 크롤링 스크립트
# GitHub Actions 환경에서 실행 가능하도록 설계

set -e  # 에러 발생 시 즉시 종료

# Gemini 모델 설정 (gemini-2.5-pro 사용)
export GEMINI_MODEL="${GEMINI_MODEL:-gemini-2.5-pro}"

# 색상 코드
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 설정
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
UTILS_DIR="$(cd "$PROJECT_ROOT/../utils" && pwd)"
PROMPT_FILE="$PROJECT_ROOT/prompts/crawling_prompt.txt"
PARSER_SCRIPT="$SCRIPT_DIR/parse_result.py"
TRANSCRIPT_SCRIPT="$UTILS_DIR/get_transcript.py"
URL_FILE="${1:-$PROJECT_ROOT/tzuyang_youtubeVideo_urls.txt}"
OUTPUT_FILE="${2:-$PROJECT_ROOT/tzuyang_restaurant_results.jsonl}"
ERROR_LOG="${3:-$PROJECT_ROOT/tzuyang_restaurant_errors.log}"

# 디렉토리 생성
mkdir -p "$PROJECT_ROOT/temp"

# 인자 검증
if [ ! -f "$URL_FILE" ]; then
    echo -e "${RED}❌ URL 파일 없음: $URL_FILE${NC}" >&2
    exit 1
fi

if [ ! -f "$PROMPT_FILE" ]; then
    echo -e "${RED}❌ 프롬프트 파일 없음: $PROMPT_FILE${NC}" >&2
    exit 1
fi

if [ ! -f "$PARSER_SCRIPT" ]; then
    echo -e "${RED}❌ 파서 스크립트 없음: $PARSER_SCRIPT${NC}" >&2
    exit 1
fi

# Gemini CLI 설치 확인
if ! command -v gemini &> /dev/null; then
    echo -e "${RED}❌ Gemini CLI가 설치되지 않았습니다${NC}" >&2
    echo "설치 방법: npm install -g @google/generative-ai-cli" >&2
    exit 1
fi

# 통계 변수
TOTAL=0
SUCCESS=0
FAILED=0

# URL 목록 읽기 (macOS/zsh 호환)
URLS=()
while IFS= read -r line || [ -n "$line" ]; do
    [ -n "$line" ] && URLS+=("$line")
done < "$URL_FILE"
TOTAL=${#URLS[@]}

# 이미 처리된 URL 로드 (중복 처리 방지)
PROCESSED_URLS=""
SKIPPED=0
if [ -f "$OUTPUT_FILE" ]; then
    PROCESSED_URLS=$(jq -r '.youtube_link' "$OUTPUT_FILE" 2>/dev/null | sort -u)
    PROCESSED_COUNT=$(echo "$PROCESSED_URLS" | grep -c . || echo "0")
    echo -e "✅ 이미 처리된 URL: ${PROCESSED_COUNT}개"
fi

echo -e "${GREEN}🚀 Gemini CLI 크롤링 시작${NC}"
echo -e "📂 URL 파일: $URL_FILE"
echo -e "📂 출력 파일: $OUTPUT_FILE"
echo -e "📊 총 URL 수: $TOTAL"
echo ""

# 프롬프트 템플릿 읽기
PROMPT_TEMPLATE=$(cat "$PROMPT_FILE")

# 각 URL 처리
for i in "${!URLS[@]}"; do
    URL="${URLS[$i]}"
    INDEX=$((i + 1))
    
    # 빈 줄 건너뛰기
    if [ -z "$URL" ]; then
        continue
    fi
    
    # 이미 처리된 URL 스킵
    if echo "$PROCESSED_URLS" | grep -q "^$URL$"; then
        SKIPPED=$((SKIPPED + 1))
        if [ $((SKIPPED % 50)) -eq 1 ]; then
            echo -e "${YELLOW}⏭️  [$INDEX/$TOTAL] 이미 처리됨 (스킵 $SKIPPED개)${NC}"
        fi
        continue
    fi
    
    echo -e "${YELLOW}[$INDEX/$TOTAL] 처리중: $URL${NC}"
    
    # YouTube 자막 가져오기 (참고 정보로 제공)
    TRANSCRIPT=""
    if [ -f "$TRANSCRIPT_SCRIPT" ]; then
        TRANSCRIPT=$(python3 "$TRANSCRIPT_SCRIPT" "$URL" 50000 2>/dev/null || echo "")
        if [ -n "$TRANSCRIPT" ]; then
            echo -e "   📝 자막 로드 완료 (${#TRANSCRIPT}자)"
        else
            echo -e "   ⚠️  자막 없음 - 검색 기반으로 진행"
        fi
    fi
    
    # 프롬프트에 URL 삽입 (<유튜브 링크> 플레이스홀더 치환)
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
    if gemini -p "$(cat "$TEMP_PROMPT")" --output-format json --yolo > "$TEMP_RESPONSE" 2>"$TEMP_STDERR"; then
        # 파서 실행
        if python3 "$PARSER_SCRIPT" "$URL" "$TEMP_RESPONSE" "$OUTPUT_FILE"; then
            SUCCESS=$((SUCCESS + 1))
            echo -e "${GREEN}✅ 성공 ($SUCCESS/$TOTAL)${NC}"
        else
            FAILED=$((FAILED + 1))
            echo -e "${RED}❌ 파서 실패 ($FAILED/$TOTAL)${NC}" >&2
            echo "[$(date)] 파서 실패: $URL" >> "$ERROR_LOG"
        fi
    else
        FAILED=$((FAILED + 1))
        echo -e "${RED}❌ Gemini CLI 호출 실패 ($FAILED/$TOTAL)${NC}" >&2
        echo "[$(date)] Gemini CLI 실패: $URL" >> "$ERROR_LOG"
        cat "$TEMP_RESPONSE" >> "$ERROR_LOG"
    fi
    
    # 임시 파일 정리
    rm -f "$TEMP_RESPONSE"
    
    # Rate Limit 준수 (60 RPM = 1초 대기)
    if [ $INDEX -lt $TOTAL ]; then
        sleep 1
    fi
done

# 결과 출력
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}크롤링 완료${NC}"
echo -e "✅ 성공: $SUCCESS"
echo -e "⏭️  건너뜀: $SKIPPED"
echo -e "❌ 실패: $FAILED"
echo -e "📊 총 처리: $TOTAL"
echo -e "${GREEN}========================================${NC}"

# ========================================
# YouTube 메타데이터 추가
# ========================================
if [ $SUCCESS -gt 0 ]; then
    echo ""
    echo -e "${YELLOW}========================================${NC}"
    echo -e "${YELLOW}📹 YouTube 메타데이터 추가 중...${NC}"
    echo -e "${YELLOW}========================================${NC}"
    
    OUTPUT_WITH_META="${OUTPUT_FILE%.jsonl}_with_meta.jsonl"
    META_SCRIPT="$SCRIPT_DIR/api-youtube-meta.py"
    
    if [ -f "$META_SCRIPT" ]; then
        if python3 "$META_SCRIPT" "$OUTPUT_FILE" "$OUTPUT_WITH_META"; then
            echo -e "${GREEN}✅ YouTube 메타데이터 추가 완료${NC}"
            echo -e "📂 메타데이터 포함 파일: $OUTPUT_WITH_META"
        else
            echo -e "${RED}❌ YouTube 메타데이터 추가 실패${NC}" >&2
        fi
    else
        echo -e "${YELLOW}⚠️  메타데이터 스크립트 없음, 스킵${NC}"
    fi
fi

# 최종 결과
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}🎉 전체 파이프라인 완료${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "📂 크롤링 결과: $OUTPUT_FILE"
if [ -f "${OUTPUT_FILE%.jsonl}_with_meta.jsonl" ]; then
    echo -e "📂 메타 포함: ${OUTPUT_FILE%.jsonl}_with_meta.jsonl"
fi

# 실패가 있으면 종료 코드 1
if [ $FAILED -gt 0 ]; then
    exit 1
fi
