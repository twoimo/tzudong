#!/usr/bin/env zsh
# Gemini CLI 기반 LAAJ 음식점 평가 스크립트
# RULE 평가 결과를 입력으로 받아 5개 LAAJ 평가 항목을 평가합니다.
# GitHub Actions 환경에서 실행 가능하도록 설계
# Note: zsh 사용 (macOS 기본 bash는 3.x로 연관 배열 미지원)

set -e  # 에러 발생 시 즉시 종료

# Gemini 모델 설정 (gemini-2.5-pro 사용)
export GEMINI_MODEL="${GEMINI_MODEL:-gemini-2.5-pro}"

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
INPUT_FILE="$PROJECT_ROOT/tzuyang_restaurant_evaluation_rule_results.jsonl"
OUTPUT_FILE="$PROJECT_ROOT/tzuyang_restaurant_evaluation_results.jsonl"
ERROR_FILE="$PROJECT_ROOT/tzuyang_restaurant_evaluation_errors.jsonl"
ERROR_LOG="$PROJECT_ROOT/tzuyang_restaurant_evaluation_errors.log"

# 디렉토리 생성
mkdir -p "$PROJECT_ROOT/temp"

# 인자 검증
if [ ! -f "$INPUT_FILE" ]; then
    echo -e "${RED}❌ 입력 파일 없음: $INPUT_FILE${NC}" >&2
    echo -e "${YELLOW}💡 먼저 evaluation-rule.py를 실행하세요${NC}" >&2
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

# 이미 처리된 youtube_link 로드
echo -e "${BLUE}🔍 기존 처리 내역 확인 중...${NC}"
PROCESSED_LINKS=""
if [ -f "$OUTPUT_FILE" ]; then
    PROCESSED_LINKS=$(jq -r '.youtube_link' "$OUTPUT_FILE" 2>/dev/null | sort -u)
    PROCESSED_COUNT=$(echo "$PROCESSED_LINKS" | grep -c . || echo "0")
    echo -e "✅ 이미 처리된 레코드: ${PROCESSED_COUNT}개"
fi
if [ -f "$ERROR_FILE" ]; then
    ERROR_LINKS=$(jq -r '.youtube_link' "$ERROR_FILE" 2>/dev/null | sort -u)
    ERROR_COUNT=$(echo "$ERROR_LINKS" | grep -c . || echo "0")
    echo -e "❌ 에러 레코드: ${ERROR_COUNT}개"
    PROCESSED_LINKS="$PROCESSED_LINKS"$'\n'"$ERROR_LINKS"
fi

# youtube_meta 로드 (크롤링 결과 파일에서)
META_FILE="$PROJECT_ROOT/../geminiCLI-restaurant-crawling/tzuyang_restaurant_results_with_meta.jsonl"
declare -A META_MAP
if [ -f "$META_FILE" ]; then
    echo -e "${BLUE}📂 youtube_meta 데이터 로드 중...${NC}"
    while IFS= read -r meta_line || [ -n "$meta_line" ]; do
        meta_link=$(echo "$meta_line" | jq -r '.youtube_link' 2>/dev/null)
        meta_data=$(echo "$meta_line" | jq -c '.youtube_meta // {}' 2>/dev/null)
        if [ -n "$meta_link" ] && [ "$meta_link" != "null" ]; then
            META_MAP["$meta_link"]="$meta_data"
        fi
    done < "$META_FILE"
    echo -e "✅ youtube_meta 로드 완료: ${#META_MAP[@]}개"
else
    echo -e "${YELLOW}⚠️  youtube_meta 파일 없음 - youtube_meta 없이 진행합니다.${NC}"
fi
echo ""

# 통계 변수
TOTAL=0
SUCCESS=0
FAILED=0
SKIPPED=0

# 입력 파일에서 레코드 수 계산
TOTAL=$(wc -l < "$INPUT_FILE" | tr -d ' ')

echo -e "${GREEN}🚀 Gemini CLI LAAJ 평가 시작${NC}"
echo -e "📂 입력 파일: $INPUT_FILE"
echo -e "📂 출력 파일: $OUTPUT_FILE"
echo -e "📂 에러 파일: $ERROR_FILE"
echo -e "📊 총 레코드 수: $TOTAL"
echo ""

# 프롬프트 템플릿 읽기
PROMPT_TEMPLATE=$(cat "$PROMPT_FILE")

# 각 레코드 처리
LINE_NUM=0
while IFS= read -r line; do
    LINE_NUM=$((LINE_NUM + 1))
    
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
            echo -e "${YELLOW}⏭️  [$LINE_NUM/$TOTAL] 건너뜀 (이미 처리됨)${NC}"
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
        echo -e "${YELLOW}⏭️  [$LINE_NUM/$TOTAL] 건너뜀 - 평가 대상 없음${NC}"
        SKIPPED=$((SKIPPED + 1))
        continue
    fi
    
    echo -e "${YELLOW}[$LINE_NUM/$TOTAL] 평가중: $YOUTUBE_LINK${NC}"
    echo -e "   🍽️  평가 대상 음식점: ${RESTAURANT_COUNT}개"
    
    # YouTube 자막 가져오기 (참고 정보로 제공)
    TRANSCRIPT=""
    if [ -f "$TRANSCRIPT_SCRIPT" ]; then
        TRANSCRIPT=$(python3 "$TRANSCRIPT_SCRIPT" "$YOUTUBE_LINK" 50000 2>/dev/null || echo "")
        if [ -n "$TRANSCRIPT" ]; then
            echo -e "   📝 자막 로드 완료 (${#TRANSCRIPT}자)"
        else
            echo -e "   ⚠️  자막 없음"
        fi
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
    if gemini -p "$(cat "$TEMP_PROMPT")" --output-format json --yolo > "$TEMP_RESPONSE" 2>"$TEMP_STDERR"; then
        # 파서 실행
        if python3 "$PARSER_SCRIPT" \
            --youtube-link "$YOUTUBE_LINK" \
            --response-file "$TEMP_RESPONSE" \
            --output-file "$OUTPUT_FILE" \
            --evaluation-target "$EVALUATION_TARGET" \
            --restaurants "$RESTAURANTS" \
            --youtube-meta-file "$TEMP_META" \
            --rule-results-file "$INPUT_FILE"; then
            
            SUCCESS=$((SUCCESS + 1))
            echo -e "${GREEN}✅ 성공 ($SUCCESS/$TOTAL)${NC}"
        else
            FAILED=$((FAILED + 1))
            echo -e "${RED}❌ 파서 실패 ($FAILED/$TOTAL)${NC}" >&2
            echo "[$(date)] 파서 실패: $YOUTUBE_LINK" >> "$ERROR_LOG"
            
            # 에러 레코드 저장 (youtube_meta 포함) - 파일에서 읽기
            ERROR_RECORD=$(echo "$line" | jq -c --slurpfile meta "$TEMP_META" '. + {youtube_meta: $meta[0]}')
            echo "$ERROR_RECORD" >> "$ERROR_FILE"
        fi
    else
        FAILED=$((FAILED + 1))
        echo -e "${RED}❌ Gemini CLI 호출 실패 ($FAILED/$TOTAL)${NC}" >&2
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

# 결과 출력
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}LAAJ 평가 완료${NC}"
echo -e "✅ 성공: $SUCCESS"
echo -e "⏭️  건너뜀: $SKIPPED"
echo -e "❌ 실패: $FAILED"
echo -e "📊 총 처리: $TOTAL"
echo -e "${GREEN}========================================${NC}"

if [ $FAILED -gt 0 ]; then
    echo -e "${YELLOW}⚠️  실패한 레코드는 $ERROR_FILE에 저장되었습니다.${NC}"
    echo -e "${YELLOW}   재실행: $SCRIPT_DIR/retry_errors.sh${NC}"
fi
