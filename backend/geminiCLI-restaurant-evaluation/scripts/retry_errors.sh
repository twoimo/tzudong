#!/usr/bin/env zsh
# Gemini CLI 기반 에러 레코드 재평가 스크립트
# evaluation_errors.jsonl에서 에러를 읽어 재평가 수행

# set -e 제거 - jq 파싱 실패 등에서 스크립트가 멈추지 않도록

# 색상 코드
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 설정
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
UTILS_DIR="$(cd "$PROJECT_ROOT/../utils" && pwd)"
PROMPT_FILE="$PROJECT_ROOT/prompts/evaluation_prompt.txt"
PARSER_SCRIPT="$SCRIPT_DIR/parse_laaj_evaluation.py"
TRANSCRIPT_SCRIPT="$UTILS_DIR/get_transcript.py"
ERROR_FILE="$PROJECT_ROOT/tzuyang_restaurant_evaluation_errors.jsonl"
RESULTS_FILE="$PROJECT_ROOT/tzuyang_restaurant_evaluation_results.jsonl"
RULE_RESULTS_FILE="$PROJECT_ROOT/tzuyang_restaurant_evaluation_rule_results.jsonl"
ERROR_LOG="$PROJECT_ROOT/tzuyang_restaurant_retry_errors.log"

# 디렉토리 생성
mkdir -p "$PROJECT_ROOT/temp"

# 인자 검증
if [ ! -f "$ERROR_FILE" ]; then
    echo -e "${YELLOW}⚠️  에러 파일이 없습니다: $ERROR_FILE${NC}"
    echo -e "${GREEN}✅ 재평가할 에러가 없습니다!${NC}"
    exit 0
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

# 에러 파일에서 레코드 수 계산
TOTAL=$(wc -l < "$ERROR_FILE" | tr -d ' ')

if [ "$TOTAL" -eq 0 ]; then
    echo -e "${GREEN}✅ 재평가할 에러가 없습니다!${NC}"
    exit 0
fi

echo -e "${BLUE}🔄 Gemini CLI 에러 재평가 시작${NC}"
echo -e "📂 에러 파일: $ERROR_FILE"
echo -e "📂 결과 파일: $RESULTS_FILE"
echo -e "📊 총 에러 레코드 수: $TOTAL"
echo ""

# 이미 성공한 youtube_link 로드 (중복 처리 방지)
ALREADY_SUCCESS=""
ALREADY_COUNT=0
if [ -f "$RESULTS_FILE" ]; then
    ALREADY_SUCCESS=$(jq -r '.youtube_link' "$RESULTS_FILE" 2>/dev/null | sort -u)
    ALREADY_COUNT=$(echo "$ALREADY_SUCCESS" | grep -c . || echo "0")
    echo -e "✅ 이미 성공한 레코드: ${ALREADY_COUNT}개"
fi

# 시작 전에 이미 성공한 레코드를 에러 파일에서 제거 (Perplexity 방식)
if [ "$ALREADY_COUNT" -gt 0 ]; then
    echo -e "${BLUE}🗑️  이미 성공한 레코드를 에러 파일에서 제거 중...${NC}"
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
        echo -e "✅ ${REMOVED_COUNT}개 제거됨 (남은 에러: ${TOTAL}개)"
    else
        rm -f "$TEMP_ERROR_FILE"
    fi
    
    if [ "$TOTAL" -eq 0 ]; then
        echo -e "${GREEN}🎉 모든 에러가 이미 처리되었습니다!${NC}"
        exit 0
    fi
fi
echo ""

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
        echo -e "${YELLOW}⏭️  [$LINE_NUM/$TOTAL] 이미 성공 - 스킵: $YOUTUBE_LINK${NC}"
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
        echo -e "${YELLOW}⏭️  [$LINE_NUM/$TOTAL] 건너뜀 - 평가 대상 없음${NC}"
        continue
    fi
    
    echo -e "${YELLOW}[$LINE_NUM/$TOTAL] 재평가중: $YOUTUBE_LINK${NC}"
    echo -e "   🍽️  평가 대상 음식점: $RESTAURANT_COUNT개"
    
    # YouTube 자막 가져오기
    echo -e "   📝 자막 가져오는 중..."
    TRANSCRIPT=$(python3 "$TRANSCRIPT_SCRIPT" "$YOUTUBE_LINK" 2>/dev/null || echo "")
    
    if [ -n "$TRANSCRIPT" ]; then
        TRANSCRIPT_LENGTH=${#TRANSCRIPT}
        echo -e "   📝 자막 ${TRANSCRIPT_LENGTH}자 추출 완료"
    else
        echo -e "   ${YELLOW}⚠️  자막 없음 - 음식점 데이터만으로 평가${NC}"
        TRANSCRIPT=""
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
    if gemini -p "$(cat "$TEMP_PROMPT")" --output-format json --yolo > "$TEMP_RESPONSE" 2>"$TEMP_STDERR"; then
        # 파서 실행
        if python3 "$PARSER_SCRIPT" \
            --youtube-link "$YOUTUBE_LINK" \
            --response-file "$TEMP_RESPONSE" \
            --output-file "$RESULTS_FILE" \
            --rule-results-file "$RULE_RESULTS_FILE" \
            --evaluation-target "$EVALUATION_TARGET" \
            --restaurants "$RESTAURANTS" \
            --youtube-meta-file "$TEMP_META"; then
            
            SUCCESS=$((SUCCESS + 1))
            echo -e "${GREEN}✅ 성공 ($SUCCESS/$TOTAL)${NC}"
            
            # 성공한 youtube_link 기록
            echo "$YOUTUBE_LINK" >> "$SUCCESS_LINKS_FILE"
        else
            FAILED=$((FAILED + 1))
            echo -e "${RED}❌ 파서 실패 ($FAILED/$TOTAL)${NC}" >&2
            echo "[$(date)] 파서 실패: $YOUTUBE_LINK" >> "$ERROR_LOG"
        fi
    else
        FAILED=$((FAILED + 1))
        echo -e "${RED}❌ Gemini CLI 호출 실패 ($FAILED/$TOTAL)${NC}" >&2
        echo "[$(date)] Gemini CLI 실패: $YOUTUBE_LINK" >> "$ERROR_LOG"
        cat "$TEMP_RESPONSE" >> "$ERROR_LOG"
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
    echo ""
    echo -e "${BLUE}🗑️  성공한 레코드를 에러 파일에서 제거 중...${NC}"
    
    # 성공하지 않은 레코드만 남기기
    TEMP_ERROR_FILE="$PROJECT_ROOT/temp/temp_errors.jsonl"
    > "$TEMP_ERROR_FILE"
    
    while IFS= read -r line; do
        YOUTUBE_LINK=$(echo "$line" | jq -r '.youtube_link')
        if ! grep -q "^$YOUTUBE_LINK$" "$SUCCESS_LINKS_FILE"; then
            echo "$line" >> "$TEMP_ERROR_FILE"
        fi
    done < "$ERROR_FILE"
    
    mv "$TEMP_ERROR_FILE" "$ERROR_FILE"
    REMAINING=$(wc -l < "$ERROR_FILE" | tr -d ' ')
    echo -e "${GREEN}✅ 에러 파일 업데이트 완료 (남은 에러: $REMAINING개)${NC}"
fi

# 임시 파일 정리
rm -f "$SUCCESS_LINKS_FILE"

# 결과 출력
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}재평가 완료${NC}"
echo -e "✅ 성공: $SUCCESS"
echo -e "❌ 실패: $FAILED"
echo -e "📊 총 처리: $TOTAL"
echo -e "${GREEN}========================================${NC}"

# 모든 에러가 처리되었는지 확인
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 모든 에러가 성공적으로 처리되었습니다!${NC}"
else
    echo -e "${YELLOW}⚠️  아직 $FAILED개의 에러가 남아있습니다.${NC}"
    echo -e "   다시 실행하려면: $0"
fi
