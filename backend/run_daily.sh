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

# 7. Git 커밋, 푸시, PR 생성 및 병합 (자동화)
echo "[$(date)] [Step 7] 변경 사항 커밋, 푸시 및 PR 병합..." >> "$LOG_FILE"

# 다시 프로젝트 루트 확인
cd "$PROJECT_ROOT" || exit 1

# develop 브랜치로 전환 및 최신화
git checkout develop >> "$LOG_FILE" 2>&1
git pull origin develop >> "$LOG_FILE" 2>&1

# 변경된 데이터 파일 스테이징
git add backend/restaurant-crawling/data/ >> "$LOG_FILE" 2>&1

# 변경 사항 확인
if git diff --cached --quiet; then
    echo "[$(date)] 커밋할 변경 사항이 없습니다." >> "$LOG_FILE"
else
    # 커밋 메시지 생성
    COMMIT_MSG="chore(data): 일일 크롤링 데이터 업데이트 ($DATE)"
    git commit -m "$COMMIT_MSG" >> "$LOG_FILE" 2>&1
    
    # develop 브랜치로 푸시
    git push origin develop >> "$LOG_FILE" 2>&1
    
    if [ $? -eq 0 ]; then
        echo "[$(date)] ✅ develop 브랜치로 Git 푸시 성공" >> "$LOG_FILE"
        
        # PR 생성 및 병합 (GitHub CLI 필요)
        if command -v gh >/dev/null 2>&1; then
            PR_TITLE="chore(data): 일일 크롤링 데이터 업데이트 ($DATE)"
            PR_BODY="자동 스크립트에 의한 일일 데이터 업데이트 ($DATE)"
            
            # PR 생성
            gh pr create --base main --head develop --title "$PR_TITLE" --body "$PR_BODY" >> "$LOG_FILE" 2>&1
            
            # PR 자동 병합 (create 실패 시(이미 있는 경우 등)를 대비해 별도 실행보다는 create 성공 시 바로 merge 시도 추천하지만, 여기선 순차 실행)
            # --auto --merge: 검사 통과 시 자동 병합 (admin 권한 필요할 수 있음. 즉시 병합은 --merge)
            # 여기서는 즉시 병합 시도 (--admin 옵션은 필요시 추가)
            gh pr merge develop --merge --delete-branch=false >> "$LOG_FILE" 2>&1
            
            echo "[$(date)] ✅ PR 생성 및 병합 시도 완료" >> "$LOG_FILE"
        else
            echo "[$(date)] ⚠️ GitHub CLI (gh)가 설치되지 않아 PR 자동화를 건너뜁니다." >> "$LOG_FILE"
        fi
        
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
