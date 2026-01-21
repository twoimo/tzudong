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

# 6. Git 커밋 및 푸시 (데이터 백업)
echo "[$(date)] [Step 6] Committing and pushing changes..." >> "$LOG_FILE"

cd "$PROJECT_ROOT" || exit 1

# 변경된 데이터 파일 스테이징
git add backend/restaurant-crawling/data/ >> "$LOG_FILE" 2>&1

# 변경 사항 확인
if git diff --cached --quiet; then
    echo "[$(date)] No changes to commit." >> "$LOG_FILE"
else
    # 커밋 메시지 생성
    COMMIT_MSG="chore(data): 일일 크롤링 데이터 업데이트 ($DATE)"
    git commit -m "$COMMIT_MSG" >> "$LOG_FILE" 2>&1
    
    # 현재 브랜치로 푸시
    CURRENT_BRANCH=$(git branch --show-current)
    git push origin "$CURRENT_BRANCH" >> "$LOG_FILE" 2>&1
    
    if [ $? -eq 0 ]; then
        echo "[$(date)] ✅ Git push successful to $CURRENT_BRANCH" >> "$LOG_FILE"
    else
        echo "[$(date)] ⚠️ Git push failed" >> "$LOG_FILE"
    fi
fi

# 7. 코드 에디터 동기화 신호 (Antigravity 등)
# .sync_trigger 파일을 생성하여 에디터가 파일 변경을 감지하도록 함
SYNC_TRIGGER_FILE="$PROJECT_ROOT/.sync_trigger"
echo "$(date)" > "$SYNC_TRIGGER_FILE"
echo "[$(date)] ✅ Sync trigger file created for code editor" >> "$LOG_FILE"

echo "============================================================" >> "$LOG_FILE"
echo "[$(date)] 🏁 All steps completed!" >> "$LOG_FILE"
echo "============================================================" >> "$LOG_FILE"
