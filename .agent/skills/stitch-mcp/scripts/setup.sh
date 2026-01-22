#!/bin/bash
# Stitch MCP 전체 설정 스크립트 (최초 설정용)
# 위치: ~/.agent/skills/stitch-mcp/scripts/setup.sh
# 사용법: bash setup.sh [PROJECT_ID]

set -e

PROJECT_ID="${1:-gen-lang-client-0223191932}"
GCLOUD="$HOME/google-cloud-sdk/bin/gcloud"

echo "🚀 Stitch MCP 설정 시작..."
echo "   Project: $PROJECT_ID"
echo ""

# Step 1: gcloud 설치 확인
if [ ! -f "$GCLOUD" ]; then
    echo "📦 Google Cloud SDK 설치 중..."
    curl -sSL https://sdk.cloud.google.com > /tmp/install_gcloud.sh
    bash /tmp/install_gcloud.sh --disable-prompts --install-dir=$HOME
    source $HOME/google-cloud-sdk/path.bash.inc
    echo 'source $HOME/google-cloud-sdk/path.bash.inc' >> ~/.bashrc
    GCLOUD="$HOME/google-cloud-sdk/bin/gcloud"
fi

echo "✅ gcloud 설치 확인: $($GCLOUD --version | head -1)"

# Step 2: 인증 상태 확인
ACCOUNT=$($GCLOUD auth list --filter="status:ACTIVE" --format="value(account)" 2>/dev/null | head -1)
if [ -z "$ACCOUNT" ]; then
    echo ""
    echo "🔐 Google 인증이 필요합니다."
    echo "   다음 명령어를 수동으로 실행하세요:"
    echo ""
    echo "   $GCLOUD auth login"
    echo ""
    exit 1
fi

echo "✅ 인증된 계정: $ACCOUNT"

# Step 3: 프로젝트 설정
echo "📋 프로젝트 설정 중..."
$GCLOUD config set project "$PROJECT_ID"

# Step 4: API 활성화
echo "🔌 Stitch API 활성화 중..."
$GCLOUD services enable stitch.googleapis.com --project="$PROJECT_ID" 2>/dev/null || true

# Step 5: Beta 컴포넌트 설치
echo "📦 Beta 컴포넌트 설치 중..."
$GCLOUD components install beta --quiet 2>/dev/null || true

# Step 6: MCP 엔드포인트 활성화 (핵심!)
echo "🔗 MCP 엔드포인트 활성화 중..."
$GCLOUD beta services mcp enable stitch.googleapis.com --project="$PROJECT_ID"

# Step 7: IAM 권한 부여
echo "🔑 IAM 권한 부여 중..."
USER_EMAIL=$($GCLOUD config get-value account)
$GCLOUD projects add-iam-policy-binding "$PROJECT_ID" \
  --member="user:$USER_EMAIL" \
  --role="roles/serviceusage.serviceUsageConsumer" \
  --condition=None --quiet 2>/dev/null || true

echo ""
echo "✅ Stitch MCP 설정 완료!"
echo ""
echo "다음 단계:"
echo "  1. 토큰 갱신: bash scripts/refresh-token.sh $PROJECT_ID"
echo "  2. Antigravity 재시작"
echo ""
