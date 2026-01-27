#!/usr/bin/env bash

# 파이프라인 에러 감지를 위해 pipefail 설정 (tee 사용 시 필수)
set -o pipefail

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

# 로그 출력 함수 (화면 + 파일 동시 출력)
log() {
    echo "$@" | tee -a "$LOG_FILE"
}

log "============================================================"
log "[$(date)] 🚀 일일 데이터 수집 파이프라인 시작"
log "============================================================"

# 0. 데이터 브랜치에서 최신 데이터 가져오기 (증분 수집을 위해 필수)
log "[$(date)] [Step 0] 최신 데이터 동기화 (from data branch)..."
git fetch origin data 2>&1 | tee -a "$LOG_FILE"
if git checkout origin/data -- backend/restaurant-crawling/data/ 2>&1 | tee -a "$LOG_FILE"; then
    log "[$(date)] ✅ 기존 데이터 로드 성공"
else
    log "[$(date)] ⚠️ 기존 데이터 로드 실패 (첫 실행이거나 브랜치 없음) - 새로 수집 시작"
fi

# 1. URL 수집 (새로운 영상 탐색)
log "[$(date)] [Step 1] URL 수집 중..."
$PYTHON_CMD backend/restaurant-crawling/scripts/01-collect-urls.py --channel tzuyang 2>&1 | tee -a "$LOG_FILE"

# 2. 메타데이터 수집 & 스케줄링 (관제탑 역할)
log "[$(date)] [Step 2] 메타데이터 수집 및 스케줄링..."
$PYTHON_CMD backend/restaurant-crawling/scripts/02-collect-meta.py --channel tzuyang 2>&1 | tee -a "$LOG_FILE"

# 3. 자막 수집 (02번 단계의 트리거에 따름)
log "[$(date)] [Step 3] 자막 수집 중..."
node backend/restaurant-crawling/scripts/03-collect-transcript.js --channel tzuyang 2>&1 | tee -a "$LOG_FILE"

# 4. 히트맵 및 프레임 수집 (02번 단계의 트리거에 따름)
log "[$(date)] [Step 4] 히트맵 및 프레임 수집 중..."
node backend/restaurant-crawling/scripts/04-extract-frames-with-heatmap.js --channel tzuyang 2>&1 | tee -a "$LOG_FILE"

log "============================================================"
log "[$(date)] ✅ 일일 데이터 수집 파이프라인 완료"
log "============================================================"

# 7. Data 브랜치에 변경 사항 푸시
log "[$(date)] [Step 7] 'data' 브랜치에 데이터 저장..."

# 데이터 폴더 변경 감지
if git diff --quiet backend/restaurant-crawling/data/; then
    log "[$(date)] ℹ️ 변경된 데이터가 없습니다."
else
    log "[$(date)] 📦 변경된 데이터를 'data' 브랜치로 푸시합니다."
    
    # 1. 현재 변경된 데이터(Working Tree)를 임시 보관 (Staging)
    git add backend/restaurant-crawling/data/ 2>&1 | tee -a "$LOG_FILE"
    
    # 2. data 브랜치로 전환 (없으면 생성)
    # Stash를 사용하여 변경사항을 들고 이동
    git stash push -m "temp_data_update" -- backend/restaurant-crawling/data/ 2>&1 | tee -a "$LOG_FILE"
    
    git fetch origin data 2>&1 | tee -a "$LOG_FILE"
    git checkout data || git checkout -b data origin/data || git checkout --orphan data 2>&1 | tee -a "$LOG_FILE"
    
    # Stash 적용
    git stash pop 2>&1 | tee -a "$LOG_FILE"
    
    # 다시 Add & Commit
    git add backend/restaurant-crawling/data/ 2>&1 | tee -a "$LOG_FILE"
    
    COMMIT_MSG="chore(data): update crawling data ($DATE)"
    git commit -m "$COMMIT_MSG" 2>&1 | tee -a "$LOG_FILE"
    
    # Push
    git push origin data 2>&1 | tee -a "$LOG_FILE"
    
    if [ $? -eq 0 ]; then
        log "[$(date)] ✅ data 브랜치 업데이트 완료"
    else
        log "[$(date)] ❌ data 브랜치 푸시 실패"
    fi
     
    # 원래 브랜치(develop)로 복귀 (로컬 실행 시 편의 위해 - CI에서는 굳이 안 해도 됨)
    git checkout develop 2>&1 | tee -a "$LOG_FILE"
fi

# 7. 코드 에디터 동기화 신호 (Antigravity 등)
SYNC_TRIGGER_FILE="$PROJECT_ROOT/backend/.sync_trigger"
echo "$(date)" > "$SYNC_TRIGGER_FILE"
log "[$(date)] ✅ 코드 에디터 동기화용 트리거 파일 생성됨"

log "============================================================"
log "[$(date)] 🏁 모든 단계가 완료되었습니다!"
log "============================================================"
