#!/usr/bin/env bash

# backend/fetch_latest_data.sh
# 'data' 브랜치에서 최신 크롤링 데이터를 로컬로 가져오는 스크립트 (테스트용)

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "📂 프로젝트 루트: $PROJECT_ROOT"
cd "$PROJECT_ROOT" || exit 1

echo "🔄 'data' 브랜치에서 최신 데이터 가져오는 중..."

# 원격 정보 갱신
git fetch origin data

# 데이터 폴더 경로
DATA_PATH="backend/restaurant-crawling/data"

# data 브랜치의 특정 폴더 내용을 현재 작업 디렉토리로 Checkout (덮어쓰기)
if git checkout origin/data -- "$DATA_PATH"; then
    echo "✅ 데이터 가져오기 완료!"
    echo "   경로: $PROJECT_ROOT/$DATA_PATH"
else
    echo "❌ 데이터 가져오기 실패 (data 브랜치가 없거나 경로가 잘못되었을 수 있습니다)"
    echo "   최초 실행이라면 data 브랜치가 아직 없을 수 있습니다."
fi
