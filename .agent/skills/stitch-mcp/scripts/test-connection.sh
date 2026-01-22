#!/bin/bash
# Stitch API 연결 테스트 스크립트
# 위치: ~/.agent/skills/stitch-mcp/scripts/test-connection.sh
# 사용법: bash test-connection.sh [PROJECT_ID]

set -e

PROJECT_ID="${1:-gen-lang-client-0223191932}"
GCLOUD="$HOME/google-cloud-sdk/bin/gcloud"

echo "🧪 Stitch MCP 연결 테스트..."
echo "   Project: $PROJECT_ID"
echo ""

# 토큰 생성
TOKEN=$($GCLOUD auth print-access-token)

if [ -z "$TOKEN" ]; then
    echo "❌ 토큰 생성 실패. gcloud auth login 필요."
    exit 1
fi

echo "✅ 토큰 생성 완료"

# API 연결 테스트
echo "🔗 API 연결 테스트 중..."
RESPONSE=$(curl -s -X POST "https://stitch.googleapis.com/mcp" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Goog-User-Project: $PROJECT_ID" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}},"id":1}')

# 응답 확인
if echo "$RESPONSE" | grep -q '"result"'; then
    echo "✅ Stitch MCP 연결 성공!"
    echo ""
    echo "응답:"
    echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"
elif echo "$RESPONSE" | grep -q 'Forbidden'; then
    echo "❌ Forbidden 에러!"
    echo ""
    echo "해결 방법:"
    echo "  gcloud beta services mcp enable stitch.googleapis.com --project=$PROJECT_ID"
elif echo "$RESPONSE" | grep -q 'Unauthorized'; then
    echo "❌ Unauthorized 에러!"
    echo ""
    echo "해결 방법:"
    echo "  1. gcloud auth login"
    echo "  2. 토큰 재생성"
else
    echo "❌ 알 수 없는 에러"
    echo ""
    echo "응답:"
    echo "$RESPONSE"
fi
