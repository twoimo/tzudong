#!/bin/bash

# 환경 변수 로드 (Node, Python 경로 등)
source $HOME/.bashrc

# 프로젝트 루트로 이동 (backend/run_daily.sh 위치 기준 상위 폴더)
# 혹은 절대 경로 사용
PROJECT_ROOT="/home/ubuntu/tzudong"
cd "$PROJECT_ROOT" || { echo "Failed to cd to $PROJECT_ROOT"; exit 1; }

# 로그 디렉토리 생성
LOG_DIR="$PROJECT_ROOT/backend/log/cron"
mkdir -p "$LOG_DIR"

DATE=$(date +%Y-%m-%d)
LOG_FILE="$LOG_DIR/daily_$DATE.log"

echo "============================================================" >> "$LOG_FILE"
echo "[$(date)] 🚀 Daily Collection Pipeline Started" >> "$LOG_FILE"
echo "============================================================" >> "$LOG_FILE"

# 1. URL 수집 (새로운 영상 탐색)
echo "[$(date)] [Step 1] Collecting URLs..." >> "$LOG_FILE"
python3 backend/restaurant-crawling/scripts/01-collect-urls.py --channel tzuyang >> "$LOG_FILE" 2>&1

# 2. 메타데이터 수집 & 스케줄링 (관제탑)
echo "[$(date)] [Step 2] Collecting Meta & Scheduling..." >> "$LOG_FILE"
python3 backend/restaurant-crawling/scripts/02-collect-meta.py --channel tzuyang >> "$LOG_FILE" 2>&1

# 3. 자막 수집 (02번의 트리거에 따름)
echo "[$(date)] [Step 3] Collecting Transcripts..." >> "$LOG_FILE"
node backend/restaurant-crawling/scripts/03-collect-transcript.js --channel tzuyang >> "$LOG_FILE" 2>&1

# 3.1. 자막 컨텍스트 생성 (Gemini 분석용 전처리)
echo "[$(date)] [Step 3.1] Generating Transcript Context..." >> "$LOG_FILE"
python3 backend/restaurant-crawling/scripts/03.1-generate-transcript-context.py --channel tzuyang >> "$LOG_FILE" 2>&1

# 4. 히트맵 수집 (02번의 트리거에 따름)
echo "[$(date)] [Step 4] Collecting Heatmaps..." >> "$LOG_FILE"
node backend/restaurant-crawling/scripts/04-collect-heatmap.js --channel tzuyang >> "$LOG_FILE" 2>&1

# 5. Gemini 분석 (자막 분석 및 리뷰 추출)
echo "[$(date)] [Step 5] Analyzing with Gemini..." >> "$LOG_FILE"
bash backend/restaurant-crawling/scripts/06-gemini-crawling.sh --channel tzuyang >> "$LOG_FILE" 2>&1

echo "============================================================" >> "$LOG_FILE"
echo "[$(date)] ✅ Daily Collection Pipeline Completed" >> "$LOG_FILE"
echo "============================================================" >> "$LOG_FILE"
