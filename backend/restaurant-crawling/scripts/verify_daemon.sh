#!/bin/bash
# 07-gemini-crawling.sh의 로직을 부분적으로 테스트

VIDEO_ID="-1OU4tkFJns"
TRANSCRIPT_FILE="../data/tzuyang/transcript/${VIDEO_ID}.jsonl"

echo "1. Transcript 파싱 테스트"
TRANSCRIPT_DATA=$(tail -n 1 "$TRANSCRIPT_FILE" | tr -d '\r')

# jq가 없으면 도커에서 실행
if ! command -v jq &> /dev/null; then
    JQC="docker run --rm -i gemini-cli jq"
else
    JQC="jq"
fi

TRANSCRIPT=$(echo "$TRANSCRIPT_DATA" | $JQC -r '
    .transcript // [] | 
    map("[" + (if (.start | type) == "string" then .start else ((.start / 60 | floor | tostring | if length < 2 then "0" + . else . end)) + ":" + ((.start % 60 | floor | tostring | if length < 2 then "0" + . else . end)) end) + "] " + .text) | 
    join("\n")
')

if [ -z "$TRANSCRIPT" ] || [ "$TRANSCRIPT" = "null" ]; then
    echo "❌ 자막 파싱 실패"
    exit 1
else
    echo "✅ 자막 파싱 성공 (첫 3줄):"
    echo "$TRANSCRIPT" | head -n 3
fi

echo ""
echo "2. call_gemini_cli 테스트 (데몬 가동)"
# 07-gemini-crawling.sh의 call_gemini_cli 함수를 소싱하거나 복사하여 테스트
# 여기서는 직접 테스트

source ./07-gemini-crawling.sh > /dev/null 2>&1 || true

TEMP_PROMPT="../temp/verify_prompt.txt"
TEMP_RESPONSE="../temp/verify_response.json"
TEMP_STDERR="../temp/verify_stderr.log"

echo "테스트 프롬프트" > "$TEMP_PROMPT"

if call_gemini_cli "$TEMP_PROMPT" "gemini-3-flash-preview" "$TEMP_RESPONSE" "$TEMP_STDERR"; then
    echo "✅ Gemini CLI (데몬) 호출 성공"
    docker ps --filter "name=gemini-daemon"
else
    echo "❌ Gemini CLI 호출 실패"
    cat "$TEMP_STDERR"
fi
