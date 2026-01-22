#!/bin/bash
# Stitch MCP 토큰 갱신 스크립트
# 위치: ~/.agent/skills/stitch-mcp/scripts/refresh-token.sh
# 사용법: bash refresh-token.sh [PROJECT_ID]

set -e

# 기본 프로젝트 ID (변경 가능)
PROJECT_ID="${1:-gen-lang-client-0223191932}"
CONFIG_FILE="$HOME/.gemini/antigravity/mcp_config.json"
GCLOUD="$HOME/google-cloud-sdk/bin/gcloud"

echo "🔄 Stitch MCP 토큰 갱신 중..."
echo "   Project: $PROJECT_ID"

# gcloud 존재 확인
if [ ! -f "$GCLOUD" ]; then
    echo "❌ gcloud를 찾을 수 없습니다."
    echo "   설치: curl https://sdk.cloud.google.com | bash"
    exit 1
fi

# 인증 상태 확인
if ! $GCLOUD auth list --filter="status:ACTIVE" --format="value(account)" | head -1 > /dev/null 2>&1; then
    echo "❌ gcloud 인증이 필요합니다."
    echo "   실행: $GCLOUD auth login"
    exit 1
fi

# 새 토큰 생성
NEW_TOKEN=$($GCLOUD auth print-access-token)

if [ -z "$NEW_TOKEN" ]; then
    echo "❌ 토큰 생성 실패"
    exit 1
fi

echo "✅ 새 토큰 생성 완료"

# 기존 설정 백업
if [ -f "$CONFIG_FILE" ]; then
    cp "$CONFIG_FILE" "${CONFIG_FILE}.bak"
    echo "📁 기존 설정 백업: ${CONFIG_FILE}.bak"
fi

# mcp_config.json 업데이트
cat > "$CONFIG_FILE" << EOF
{
  "mcpServers": {
    "sequential-thinking": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"],
      "env": {}
    },
    "stitch": {
      "serverUrl": "https://stitch.googleapis.com/mcp",
      "headers": {
        "Authorization": "Bearer $NEW_TOKEN",
        "X-Goog-User-Project": "$PROJECT_ID"
      }
    }
  }
}
EOF

echo "✅ 설정 파일 업데이트 완료: $CONFIG_FILE"
echo ""
echo "⚠️  중요: Antigravity를 재시작해야 새 토큰이 적용됩니다!"
echo ""
echo "토큰 유효 시간: 약 1시간"
echo "만료 시 이 스크립트를 다시 실행하세요."
