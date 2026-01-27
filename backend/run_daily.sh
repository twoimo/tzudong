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

# 0. 데이터 브랜치에서 최신 데이터 가져오기 (증분 수집을 위해 필수)
echo "[$(date)] [Step 0] 최신 데이터 동기화 (from data branch)..." >> "$LOG_FILE"
git fetch origin data >> "$LOG_FILE" 2>&1
if git checkout origin/data -- backend/restaurant-crawling/data/ >> "$LOG_FILE" 2>&1; then
    echo "[$(date)] ✅ 기존 데이터 로드 성공" >> "$LOG_FILE"
else
    echo "[$(date)] ⚠️ 기존 데이터 로드 실패 (첫 실행이거나 브랜치 없음) - 새로 수집 시작" >> "$LOG_FILE"
fi

# 1. URL 수집 (새로운 영상 탐색)
echo "[$(date)] [Step 1] URL 수집 중..." >> "$LOG_FILE"
$PYTHON_CMD backend/restaurant-crawling/scripts/01-collect-urls.py --channel tzuyang >> "$LOG_FILE" 2>&1

# 2. 메타데이터 수집 & 스케줄링 (관제탑 역할)
echo "[$(date)] [Step 2] 메타데이터 수집 및 스케줄링..." >> "$LOG_FILE"
$PYTHON_CMD backend/restaurant-crawling/scripts/02-collect-meta.py --channel tzuyang >> "$LOG_FILE" 2>&1

# 3. 자막 수집 (02번 단계의 트리거에 따름)
echo "[$(date)] [Step 3] 자막 수집 중..." >> "$LOG_FILE"
node backend/restaurant-crawling/scripts/03-collect-transcript.js --channel tzuyang >> "$LOG_FILE" 2>&1

# 3.1. 자막 컨텍스트 생성 (Gemini 분석용 전처리) [제외됨]
# echo "[$(date)] [Step 3.1] 자막 컨텍스트 생성 중..." >> "$LOG_FILE"
# $PYTHON_CMD backend/restaurant-crawling/scripts/03.1-generate-transcript-context.py --channel tzuyang >> "$LOG_FILE" 2>&1

# 4. 히트맵 및 프레임 수집 (02번 단계의 트리거에 따름)
echo "[$(date)] [Step 4] 히트맵 및 프레임 수집 중..." >> "$LOG_FILE"
node backend/restaurant-crawling/scripts/04-extract-frames-with-heatmap.js --channel tzuyang >> "$LOG_FILE" 2>&1

# 5. Gemini 분석 (자막 분석 및 리뷰 추출) [제외됨]
# echo "[$(date)] [Step 5] Gemini 분석 실행..." >> "$LOG_FILE"
# # 쉘 스크립트 실행 시 bash 명시
# bash backend/restaurant-crawling/scripts/07-gemini-crawling.sh --channel tzuyang >> "$LOG_FILE" 2>&1

# 6. Supabase 마이그레이션 (메타 데이터 동기화) [제외됨]
# echo "[$(date)] [Step 6] Supabase 마이그레이션..." >> "$LOG_FILE"
# $PYTHON_CMD backend/restaurant-crawling/scripts/08-migrate-to-supabase.py --channel tzuyang >> "$LOG_FILE" 2>&1

echo "============================================================" >> "$LOG_FILE"
echo "[$(date)] ✅ 일일 데이터 수집 파이프라인 완료" >> "$LOG_FILE"
echo "============================================================" >> "$LOG_FILE"

# 7. Data 브랜치에 변경 사항 푸시
echo "[$(date)] [Step 7] 'data' 브랜치에 데이터 저장..." >> "$LOG_FILE"

# 데이터 폴더 변경 감지
if git diff --quiet backend/restaurant-crawling/data/; then
    echo "[$(date)] ℹ️ 변경된 데이터가 없습니다." >> "$LOG_FILE"
else
    echo "[$(date)] 📦 변경된 데이터를 'data' 브랜치로 푸시합니다." >> "$LOG_FILE"
    
    # 1. 현재 변경된 데이터(Working Tree)를 임시 보관 (Staging)
    git add backend/restaurant-crawling/data/ >> "$LOG_FILE" 2>&1
    
    # 2. data 브랜치로 전환 (없으면 생성)
    # 현재체크아웃된 브랜치와 충돌 방지를 위해 stash 사용 권장되나, 
    # CI 환경에서는 checkout으로 깔끔하게 이동하거나 orphan 브랜치 활용
    
    # 여기서는 "현재 변경사항을 들고" data 브랜치로 이동하는 전략 사용
    # (이미 git checkout origin/data -- path 로 가져왔으므로 베이스는 data임)
    
    # 안전하게 커밋하기 위해 임시 작업용 orphan 브랜치 생성 또는 바로 푸시
    # GitHub Actions 환경 고려: HEAD 분리 상태일 수 있음.
    
    # 로직:
    # 1. 변경된 data 폴더를 임시 디렉토리로 백업? (너무 큼)
    # 2. git stash -> git checkout data -> git stash pop? (가장 깔끔)
    
    git stash push -m "temp_data_update" -- backend/restaurant-crawling/data/ >> "$LOG_FILE" 2>&1
    
    git fetch origin data >> "$LOG_FILE" 2>&1
    git checkout data || git checkout -b data origin/data || git checkout --orphan data >> "$LOG_FILE" 2>&1
    
    # Stash 적용 (충돌 시 -theirs 전략.. 은 stash apply에 없음. 그냥 pop 하고 덮어쓰기)
    # checkout으로 가져온 파일 위에 덮어쓰는 것이므로 충돌 거의 없음
    git stash pop >> "$LOG_FILE" 2>&1
    
    # 다시 Add & Commit
    git add backend/restaurant-crawling/data/ >> "$LOG_FILE" 2>&1
    
    COMMIT_MSG="chore(data): update crawling data ($DATE)"
    git commit -m "$COMMIT_MSG" >> "$LOG_FILE" 2>&1
    
    # Push
    git push origin data >> "$LOG_FILE" 2>&1
    
    if [ $? -eq 0 ]; then
        echo "[$(date)] ✅ data 브랜치 업데이트 완료" >> "$LOG_FILE"
    else
        echo "[$(date)] ❌ data 브랜치 푸시 실패" >> "$LOG_FILE"
    fi
     
    # 원래 브랜치(develop)로 복귀 (로컬 실행 시 편의 위해)
    git checkout develop >> "$LOG_FILE" 2>&1
fi

# 7. 코드 에디터 동기화 신호 (Antigravity 등)
# .sync_trigger 파일을 생성하여 에디터가 파일 변경을 감지하도록 함
SYNC_TRIGGER_FILE="$PROJECT_ROOT/backend/.sync_trigger"
echo "$(date)" > "$SYNC_TRIGGER_FILE"
echo "[$(date)] ✅ 코드 에디터 동기화용 트리거 파일 생성됨" >> "$LOG_FILE"

echo "============================================================" >> "$LOG_FILE"
echo "[$(date)] 🏁 모든 단계가 완료되었습니다!" >> "$LOG_FILE"
echo "============================================================" >> "$LOG_FILE"
