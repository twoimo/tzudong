#!/usr/bin/env bash

# 프로젝트 루트 경로 동적 탐색 (스크립트 위치 기준 상위 폴더)
# 이 스크립트가 backend/run_daily.sh 에 위치한다고 가정
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 프로젝트 루트로 이동
cd "$PROJECT_ROOT" || { echo "❌ 프로젝트 루트로 이동 실패: $PROJECT_ROOT"; exit 1; }

# 환경 변수 로드 (Node, Python 경로 등)
# .bashrc가 존재하는 경우에만 로드 (Git Bash 호환성)
if [ -f "$HOME/.bashrc" ]; then
    source "$HOME/.bashrc"
fi

# Python 명령어 감지 (python3 우선, 없으면 python 사용)
if command -v python3 >/dev/null 2>&1; then
    PYTHON_CMD="python3"
else
    if command -v python >/dev/null 2>&1; then
        PYTHON_CMD="python"
    else
        echo "❌ Python을 찾을 수 없습니다."
        exit 1
    fi
fi

# 로그 디렉토리 생성
LOG_DIR="$PROJECT_ROOT/backend/log/cron"
mkdir -p "$LOG_DIR"

DATE=$(date +%Y-%m-%d)
LOG_FILE="$LOG_DIR/daily_$DATE.log"

echo "============================================================" >> "$LOG_FILE"
echo "[$(date)] 🚀 일일 데이터 수집 파이프라인 시작" >> "$LOG_FILE"
echo "============================================================" >> "$LOG_FILE"

# 1. URL 수집 (새로운 영상 탐색)
echo "[$(date)] [Step 1] URL 수집 중..." >> "$LOG_FILE"
$PYTHON_CMD backend/restaurant-crawling/scripts/01-collect-urls.py --channel tzuyang >> "$LOG_FILE" 2>&1

# 2. 메타데이터 수집 & 스케줄링 (관제탑 역할)
echo "[$(date)] [Step 2] 메타데이터 수집 및 스케줄링..." >> "$LOG_FILE"
$PYTHON_CMD backend/restaurant-crawling/scripts/02-collect-meta.py --channel tzuyang >> "$LOG_FILE" 2>&1

# 3. 자막 수집 (02번 단계의 트리거에 따름)
echo "[$(date)] [Step 3] 자막 수집 중..." >> "$LOG_FILE"
node backend/restaurant-crawling/scripts/03-collect-transcript.js --channel tzuyang >> "$LOG_FILE" 2>&1

# 3.1. 자막 컨텍스트 생성 (Gemini 분석용 전처리)
echo "[$(date)] [Step 3.1] 자막 컨텍스트 생성 중..." >> "$LOG_FILE"
$PYTHON_CMD backend/restaurant-crawling/scripts/03.1-generate-transcript-context.py --channel tzuyang >> "$LOG_FILE" 2>&1

# 4. 히트맵 수집 (02번 단계의 트리거에 따름)
echo "[$(date)] [Step 4] 히트맵 수집 중..." >> "$LOG_FILE"
node backend/restaurant-crawling/scripts/04-collect-heatmap.js --channel tzuyang >> "$LOG_FILE" 2>&1

# 5. Gemini 분석 (자막 분석 및 리뷰 추출)
echo "[$(date)] [Step 5] Gemini 분석 실행..." >> "$LOG_FILE"
# 쉘 스크립트 실행 시 bash 명시
bash backend/restaurant-crawling/scripts/06-gemini-crawling.sh --channel tzuyang >> "$LOG_FILE" 2>&1

# 6. Supabase 마이그레이션 (메타 데이터 동기화)
echo "[$(date)] [Step 6] Supabase 마이그레이션..." >> "$LOG_FILE"
$PYTHON_CMD backend/restaurant-crawling/scripts/08-migrate-to-supabase.py --channel tzuyang >> "$LOG_FILE" 2>&1

echo "============================================================" >> "$LOG_FILE"
echo "[$(date)] ✅ 일일 데이터 수집 파이프라인 완료" >> "$LOG_FILE"
echo "============================================================" >> "$LOG_FILE"

# 7. Git 커밋 및 푸시 (데이터 백업)
echo "[$(date)] [Step 7] 변경 사항 커밋 및 푸시..." >> "$LOG_FILE"

# 다시 프로젝트 루트 확인 (혹시 모를 경로 변경 대비)
cd "$PROJECT_ROOT" || exit 1

# 변경된 데이터 파일 스테이징
git add backend/restaurant-crawling/data/ >> "$LOG_FILE" 2>&1

# 변경 사항 확인
if git diff --cached --quiet; then
    echo "[$(date)] 커밋할 변경 사항이 없습니다." >> "$LOG_FILE"
else
    # 커밋 메시지 생성
    COMMIT_MSG="chore(data): 일일 크롤링 데이터 업데이트 ($DATE)"
    git commit -m "$COMMIT_MSG" >> "$LOG_FILE" 2>&1
    
    # 현재 브랜치로 푸시
    CURRENT_BRANCH=$(git branch --show-current)
    git push origin "$CURRENT_BRANCH" >> "$LOG_FILE" 2>&1
    
    if [ $? -eq 0 ]; then
        echo "[$(date)] ✅ $CURRENT_BRANCH 브랜치로 Git 푸시 성공" >> "$LOG_FILE"
    else
        echo "[$(date)] ⚠️ Git 푸시 실패" >> "$LOG_FILE"
    fi
fi

# 7. 코드 에디터 동기화 신호 (Antigravity 등)
# .sync_trigger 파일을 생성하여 에디터가 파일 변경을 감지하도록 함
SYNC_TRIGGER_FILE="$PROJECT_ROOT/backend/.sync_trigger"
echo "$(date)" > "$SYNC_TRIGGER_FILE"
echo "[$(date)] ✅ 코드 에디터 동기화용 트리거 파일 생성됨" >> "$LOG_FILE"

echo "============================================================" >> "$LOG_FILE"
echo "[$(date)] 🏁 모든 단계가 완료되었습니다!" >> "$LOG_FILE"
echo "============================================================" >> "$LOG_FILE"
