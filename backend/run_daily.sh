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

# [Local Config] Anaconda Python 우선 사용 (패키지 설치 환경)
if [ -f "/c/Users/twoimo/anaconda3/python.exe" ]; then
    PYTHON_CMD="/c/Users/twoimo/anaconda3/python.exe"
    export PATH="/c/Users/twoimo/anaconda3:/c/Users/twoimo/anaconda3/Scripts:$PATH"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON_CMD="python3"
else
    if command -v python >/dev/null 2>&1; then
        PYTHON_CMD="python"
    else
        echo "❌ Python을 찾을 수 없습니다."
        exit 1
    fi
fi
export PYTHONUNBUFFERED=1

# [Local Config] RClone 경로 추가 (사용자 환경)
export PYTHON_CMD
export PATH="$PATH:/c/Users/twoimo/Documents/rclone-v1.72.1-windows-amd64"

# 로그 디렉토리 생성
LOG_DIR="$PROJECT_ROOT/backend/log/cron"
mkdir -p "$LOG_DIR"

DATE=$(date +%Y-%m-%d)
LOG_FILE="$LOG_DIR/daily_$DATE.log"

# 로그 출력 함수 (화면 + 파일 동시 출력)
log() {
  local LEVEL=$1
  local MESSAGE=$2
  local TIMESTAMP=$(date "+%H:%M:%S")
  
  case "$LEVEL" in
    "INFO") ;;
    "WARN") ;;
    "ERROR") ;;
    "SUCCESS") ;;
    *) LEVEL="INFO" ;;
  esac
  echo "[$TIMESTAMP] [$LEVEL] $MESSAGE" | tee -a "$LOG_FILE"
}

# ANSI 색상 코드 제거 함수
strip_ansi() {
    sed 's/\x1b\[[0-9;]*m//g'
}

# [Function] 데이터 커밋 함수 (data 브랜치에서 직접 실행)
sync_data_to_remote() {
    local STEP_NAME="$1"
    log "INFO" "------------------------------------------------------------"
    log "INFO" "데이터 동기화 시작 (Trigger: $STEP_NAME)"

    # 데이터 폴더 변경 감지 (Modified + Untracked)
    if [ -z "$(git status --porcelain backend/restaurant-crawling/data/)" ] && [ -z "$(git status --porcelain backend/restaurant-evaluation/data/)" ]; then
        log "INFO" "변경 된 데이터가 없습니다. (Skip)"
        return 0
    fi

    log "INFO" "변경 된 데이터를 커밋합니다."

    # 데이터 파일 추가
    git add backend/restaurant-crawling/data/ 2>&1 | tee -a "$LOG_FILE"
    git add backend/restaurant-evaluation/data/ 2>&1 | tee -a "$LOG_FILE"

    # 대용량 폴더는 추적에서 제외
    git rm -r --cached backend/restaurant-crawling/data/*/frames 2>/dev/null || true
    git rm -r --cached backend/restaurant-crawling/data/*/video_cache 2>/dev/null || true
    git rm -r --cached backend/restaurant-crawling/data/*/temp_video 2>/dev/null || true
    git rm -r --cached backend/restaurant-crawling/data/*/thumbnails 2>/dev/null || true

    # [Fix] CI 환경 등에서 생성된 루트 frames 폴더 추적 제외
    git rm -r --cached backend/restaurant-crawling/data/frames 2>/dev/null || true
    # [Security] 민감 정보 추적 제외
    git rm --cached backend/restaurant-crawling/data/credentials.json 2>/dev/null || true
    git rm --cached backend/restaurant-crawling/data/cookies.txt 2>/dev/null || true

    COMMIT_MSG="chore(data): update crawling data ($DATE) - $STEP_NAME"

    if git diff --staged --quiet; then
        log "INFO" "No changes to commit."
        return 0
    fi

    log "INFO" "Committing changes..."
    if ! git commit -q -m "$COMMIT_MSG" 2>&1 | tee -a "$LOG_FILE"; then
        log "ERROR" "Commit failed"
        return 1
    fi

    # 원격 변경사항 동기화 (충돌 방지)
    log "INFO" "원격 변경사항 확인 및 Rebase..."
    if ! git pull --rebase origin data 2>&1 | tee -a "$LOG_FILE"; then
        log "WARN" "Rebase 실패 - 강제 푸시 시도"
        # Rebase 실패 시 강제 푸시 (로컬 데이터 우선)
        if ! git push --force-with-lease origin data 2>&1 | tee -a "$LOG_FILE"; then
            log "ERROR" "Failed to push to data branch"
            return 1
        fi
    else
        # Push
        log "INFO" "Pushing to remote..."
        if ! git push origin data 2>&1 | tee -a "$LOG_FILE"; then
            log "ERROR" "Failed to push to data branch"
            return 1
        fi
    fi

    log "SUCCESS" "data 브랜치 업데이트 완료 ($STEP_NAME)"
}

log "INFO" "============================================================"
log "INFO" "일일 데이터 수집 파이프라인 시작"
log "INFO" "============================================================"
# [Branch Check] 'data' 브랜치인지 확인
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
TARGET_BRANCH="data"

log "INFO" "현재 브랜치 확인: $CURRENT_BRANCH"

if [ "$CURRENT_BRANCH" != "$TARGET_BRANCH" ]; then
    log "WARN" "현재 브랜치가 '$TARGET_BRANCH'가 아닙니다. '$TARGET_BRANCH'로 전환을 시도합니다."
    
    # 최신 상태 가져오기
    git fetch origin
    
    # 로컬에 타겟 브랜치가 존재하는지 확인
    if git show-ref --verify --quiet refs/heads/$TARGET_BRANCH; then
        git checkout $TARGET_BRANCH || { log "ERROR" "브랜치 전환 실패. 변경사항을 커밋하거나 스태시하세요."; exit 1; }
    else
        # 로컬에 없으면 원격에서 가져와서 추적
        git checkout -b $TARGET_BRANCH origin/$TARGET_BRANCH || { log "ERROR" "원격 브랜치 체크아웃 실패."; exit 1; }
    fi
    
    log "SUCCESS" "브랜치 전환 완료: $TARGET_BRANCH"
fi

# 충돌 방지를 위해 최신 변경사항 Pull
log "INFO" "'$TARGET_BRANCH' 브랜치 최신화 (Pull)..."
git pull origin $TARGET_BRANCH || { log "WARN" "Pull 실패 (무시하고 진행)."; }

log "INFO" "현재 작업 브랜치: $(git rev-parse --abbrev-ref HEAD)"

# 1. URL 수집 (새로운 영상 탐색)
echo "::group::[Step 1] URL Collection"
log "INFO" "[Step 1] URL 수집 중..."
$PYTHON_CMD backend/restaurant-crawling/scripts/01-collect-urls.py --channel tzuyang 2>&1 | tee -a "$LOG_FILE"
echo "::endgroup::"

# 2. 메타데이터 수집 & 스케줄링 (관제탑 역할)
echo "::group::[Step 2] Metadata Collection"
log "INFO" "[Step 2] 메타데이터 수집 및 스케줄링..."
$PYTHON_CMD backend/restaurant-crawling/scripts/02-collect-meta.py --channel tzuyang 2>&1 | tee -a "$LOG_FILE"
echo "::endgroup::"

# 2.1. 메타데이터 마이그레이션 (Supabase용)
echo "::group::[Step 2.2] Meta Migration"
log "INFO" "[Step 2.2] Meta Migrating to Supabase..."
$PYTHON_CMD backend/restaurant-crawling/scripts/02.1-migrate-meta-to-supabase.py --channel tzuyang 2>&1 | tee -a "$LOG_FILE"
echo "::endgroup::"

# 2.5. 메타데이터 누락 파일 사전 정리 (Auto-Healing Pre-check)
echo "::group::[Step 2.5] Orphan Cleanup"
log "INFO" "[Step 2.5] 메타데이터 누락 파일 사전 정리..."
$PYTHON_CMD backend/restaurant-crawling/scripts/99-cleanup-orphans.py --channel tzuyang 2>&1 | tee -a "$LOG_FILE"
echo "::endgroup::"

# [Intermediate Sync] 메타데이터/정리 완료 후 저장
sync_data_to_remote "Step 2.5 (Meta/Cleanup)"

# 3. 자막 수집 (02번 단계의 트리거에 따름)
echo "::group::[Step 3] Transcript Collection"
log "INFO" "[Step 3] 자막 수집 중..."
node backend/restaurant-crawling/scripts/03-collect-transcript.js --channel tzuyang 2>&1 | tee -a "$LOG_FILE"
echo "::endgroup::"

# 3.1. 자막 문맥 생성 (Ollama 활용)
echo "::group::[Step 3.1] Context Generation"
log "INFO" "[Step 3.1] 자막 문맥 생성 중..."
# [Config] 실행 모드에 따른 배치 크기 제한 (Env: MAX_CONTEXT_VIDEOS -> Default: 0)
# 로컬 실행(CI 아님)인 경우 -1(Skip)으로 설정
if [ -z "$CI" ]; then
    MAX_VIDEOS=-1
else
    MAX_VIDEOS=${MAX_CONTEXT_VIDEOS:-0}
fi

if [[ "$MAX_VIDEOS" -eq -1 ]]; then
    log "INFO" "Context Generation Skipped (Configured as -1)"
else
    if [[ "$MAX_VIDEOS" -gt 0 ]]; then
        log "INFO" "Context Generation Limit: $MAX_VIDEOS videos (Configured)"
    else
        log "INFO" "Context Generation Limit: Unlimited"
    fi
    $PYTHON_CMD backend/restaurant-crawling/scripts/03.1-generate-transcript-context.py --max-videos "$MAX_VIDEOS" 2>&1 | tee -a "$LOG_FILE"
fi
echo "::endgroup::"

# [Intermediate Sync] 자막/문맥 생성 완료 후 저장 (가장 중요)
sync_data_to_remote "Step 3.1 (Context)"

# 4. 히트맵 및 프레임 수집 (02번 단계의 트리거에 따름)
echo "::group::[Step 4] Heatmap & Frames"
log "INFO" "[Step 4] 히트맵 및 프레임 수집 중..."
node backend/restaurant-crawling/scripts/04-extract-frames-with-heatmap.js --channel tzuyang --delete-cache 2>&1 | tee -a "$LOG_FILE"
echo "::endgroup::"

# [Intermediate Sync] 프레임 메타데이터 저장
sync_data_to_remote "Step 4 (Frames)"

# 6.1. 자막 문서에 메타데이터 추가 (음식점 + Peak)
echo "::group::[Step 6.1] Enrich Subtitles"
log "INFO" "[Step 6.1] 자막 문서 메타데이터 추가 중..."
# Supabase 연결 실패 시 스킵됨 (스크립트 내 처리)
$PYTHON_CMD backend/restaurant-crawling/scripts/06.1-transcript-document-with-meta.py --channel tzuyang 2>&1 | tee -a "$LOG_FILE"
echo "::endgroup::"

# 7. Gemini 기반 데이터 분석
echo "::group::[Step 6] Gemini Data Analysis"
log "INFO" "[Step 6] Gemini 데이터 분석 중..."
bash backend/restaurant-crawling/scripts/07-gemini-crawling.sh --channel tzuyang 2>&1 | tee -a "$LOG_FILE"
echo "::endgroup::"

# 8. 평가 대상 선정
echo "::group::[Step 08] Target Selection"
log "INFO" "[Step 08] Target Selection..."
$PYTHON_CMD backend/restaurant-evaluation/scripts/08-target-selection.py --channel tzuyang \
  --crawling-path backend/restaurant-crawling/data/tzuyang \
  --evaluation-path backend/restaurant-evaluation/data/tzuyang 2>&1 | tee -a "$LOG_FILE"
echo "::endgroup::"

# 9. Rule 기반 평가 (위치/상호 검증)
echo "::group::[Step 09] Rule Evaluation"
log "INFO" "[Step 09] Rule Evaluation..."
$PYTHON_CMD backend/restaurant-evaluation/scripts/09-rule-evaluation.py --channel tzuyang \
  --evaluation-path backend/restaurant-evaluation/data/tzuyang 2>&1 | tee -a "$LOG_FILE"
# GH Action Notice 추가
grep "✅ Rule 평가 완료!" -A 5 "$LOG_FILE" | tail -n 6 | strip_ansi | while read -r line; do echo "::notice::$line"; done
echo "::endgroup::"

# [Intermediate Sync] Rule 평가 완료 후 저장 (LAAJ 전 중간 저장)
sync_data_to_remote "Step 9 (Rule Eval)"

# 10. LAAJ (LLM) 기반 평가
echo "::group::[Step 10] LAAJ Evaluation"
log "INFO" "[Step 10] LAAJ Evaluation..."
# 주의: --crawling-path는 채널명까지 포함된 상세 경로여야 함
bash backend/restaurant-evaluation/scripts/10-laaj-evaluation.sh --channel tzuyang \
  --crawling-path backend/restaurant-crawling/data/tzuyang \
  --evaluation-path backend/restaurant-evaluation/data/tzuyang 2>&1 | tee -a "$LOG_FILE"
# GH Action Notice 추가
grep "🎉 LAAJ 평가 완료" -A 5 "$LOG_FILE" | tail -n 6 | strip_ansi | while read -r line; do echo "::notice::$line"; done
echo "::endgroup::"

# [Intermediate Sync] LAAJ 평가 완료 후 저장 (중요)
sync_data_to_remote "Step 10 (LAAJ Eval)"


# 11. 결과 변환 (Transforms)
echo "::group::[Step 11] Transform Results"
log "INFO" "[Step 11] Transform Results..."
$PYTHON_CMD backend/restaurant-evaluation/scripts/11-transform.py --channel tzuyang \
  --crawling-path backend/restaurant-crawling/data/tzuyang \
  --evaluation-path backend/restaurant-evaluation/data/tzuyang 2>&1 | tee -a "$LOG_FILE"
echo "::endgroup::"

# [Intermediate Sync] 변환 완료 후 저장 (Supabase 입력 전 백업)
sync_data_to_remote "Step 11 (Transform)"

# 12. Supabase 결과 삽입
echo "::group::[Step 12] Insert to Supabase"
log "INFO" "[Step 12] Insert to Supabase..."
$PYTHON_CMD backend/restaurant-evaluation/scripts/12-supabase-insert.py --channel tzuyang \
  --evaluation-path backend/restaurant-evaluation/data/tzuyang 2>&1 | tee -a "$LOG_FILE"
# GH Action Notice 추가
grep "성공 (Insert):" "$LOG_FILE" | tail -n 1 | strip_ansi | while read -r line; do echo "::notice::DB Sync - $line"; done
echo "::endgroup::"

log "INFO" "============================================================"
log "INFO" "일일 데이터 수집 파이프라인 완료"
log "INFO" "============================================================"

# 7. Data 브랜치에 변경 사항 푸시 (Final Sync)
log "INFO" "[Step 7] 'data' 브랜치에 최종 데이터 저장..."
sync_data_to_remote "Step 7 (Final)"

# 8. 코드 에디터 동기화 신호 (Antigravity 등)
SYNC_TRIGGER_FILE="$PROJECT_ROOT/backend/.sync_trigger"
echo "$(date)" > "$SYNC_TRIGGER_FILE"
log "INFO" "코드 에디터 동기화용 트리거 파일 생성됨"

log "INFO" "============================================================"
log "INFO" "모든 단계가 완료되었습니다!"
log "INFO" "============================================================"

# GitHub Actions Summary 생성
SUMMARY_MD="$PROJECT_ROOT/summary.md"
echo "## Daily Crawling Report ($DATE)" > "$SUMMARY_MD"
echo "" >> "$SUMMARY_MD"

# 9. 상세 처리 통계
echo "### Process Statistics" >> "$SUMMARY_MD"
echo "| Step | Count | Status |" >> "$SUMMARY_MD"
echo "|------|-------|--------|" >> "$SUMMARY_MD"

echo "| Step | Count | Status |" >> "$SUMMARY_MD"
echo "|------|-------|--------|" >> "$SUMMARY_MD"

if [ -f "$LOG_FILE" ]; then
    # 1. URL 수집 현황
    if grep -q "URL 수집 중" "$LOG_FILE"; then
        URL_LINE=$(grep "tzuyang: 신규" "$LOG_FILE" | tail -n 1 | strip_ansi)
        URL_CNT=$(echo "$URL_LINE" | sed 's/.*tzuyang: //')
        echo "| URLs | $URL_CNT | Collected |" >> "$SUMMARY_MD"
    else
        echo "| URLs | - | Error |" >> "$SUMMARY_MD"
        URL_LINE=""
    fi

    # 2. 메타데이터
    if grep -q "메타데이터 수집" "$LOG_FILE"; then
        META_LINE=$(grep "업데이트 [0-9]*개" "$LOG_FILE" | tail -n 1 | strip_ansi)
        META_CNT=$(echo "$META_LINE" | sed 's/.*완료: //' | tr -cd '0-9')
        if [ -z "$META_CNT" ]; then META_CNT="0"; fi
        echo "| Metadata | $META_CNT | Updated |" >> "$SUMMARY_MD"
    else
        echo "| Metadata | - | Skipped/Fail |" >> "$SUMMARY_MD"
        META_CNT="0"
    fi

    # 3. 자막
    TRANSCRIPT_CNT=$(grep "성공 [0-9]*개" "$LOG_FILE" | grep "자막 수집 완료" -A 1 | tail -n 1 | strip_ansi | sed 's/.*성공 //;s/개.*//')
    if [ -n "$TRANSCRIPT_CNT" ]; then
        echo "| Transcripts | $TRANSCRIPT_CNT | Saved |" >> "$SUMMARY_MD"
    else
        echo "| Transcripts | 0 | Skipped |" >> "$SUMMARY_MD"
        TRANSCRIPT_CNT="0"
    fi

    # 3.1 문맥 생성
    CONTEXT_CNT=$(grep -c "Context generation for .* completed" "$LOG_FILE")
    if [ "$CONTEXT_CNT" -gt 0 ]; then
        echo "| Contexts | $CONTEXT_CNT | Generated |" >> "$SUMMARY_MD"
    else
        echo "| Contexts | 0 | Skipped |" >> "$SUMMARY_MD"
    fi

    # 4. 히트맵
    HEATMAP_CNT=$(grep -c "Heatmap saved" "$LOG_FILE")
    if [ "$HEATMAP_CNT" -gt 0 ]; then
        echo "| Heatmaps | $HEATMAP_CNT | Saved |" >> "$SUMMARY_MD"
    else
        echo "| Heatmaps | 0 | Skipped |" >> "$SUMMARY_MD"
    fi

    # 4. 프레임
    FRAME_CNT=$(grep -c "Frames extracted" "$LOG_FILE")
    if [ -z "$FRAME_CNT" ]; then FRAME_CNT=0; fi
    echo "| Frames | $FRAME_CNT | Extracted |" >> "$SUMMARY_MD"

    # 구글 드라이브 & 유튜브
    GDRIVE_CNT=$(grep -c "\[GDrive\] 영상 발견.*다운로드 시도" "$LOG_FILE")
    YOUTUBE_CNT=$(grep -c "\[YouTube\] 다운로드 시도" "$LOG_FILE")

    echo "| GDrive Cache | $GDRIVE_CNT | Hits |" >> "$SUMMARY_MD"
    if [ "$YOUTUBE_CNT" -gt 0 ]; then
        echo "| YouTube DL | **$YOUTUBE_CNT** | Success |" >> "$SUMMARY_MD"
    else
        echo "| YouTube DL | 0 | (Blocked) |" >> "$SUMMARY_MD"
    fi

    # 5. 지도 URL
    MAP_CNT=$(grep -c "✅ 지도 URL 수집 완료" "$LOG_FILE")
    if [ "$MAP_CNT" -gt 0 ]; then
        echo "| Map Crawling | $MAP_CNT | Collected |" >> "$SUMMARY_MD"
    fi

    # 6. 재미나이
    if grep -q "Gemini 분석 완료" "$LOG_FILE"; then
        GEMINI_CALLS=$(grep "총 호출 수:" "$LOG_FILE" | tail -n 1 | strip_ansi | sed 's/.*: //')
        GEMINI_SUCCESS=$(grep "성공:" "$LOG_FILE" | tail -n 1 | strip_ansi | sed 's/.*: //')
        GEMINI_SUCCESS_LINE="Calls: $GEMINI_CALLS / Success: $GEMINI_SUCCESS"
        echo "| Gemini Analysis | $GEMINI_SUCCESS | (Calls: $GEMINI_CALLS) |" >> "$SUMMARY_MD"
    else
        echo "| Gemini Analysis | - | Skipped |" >> "$SUMMARY_MD"
    fi

    # 08. 평가 대상 선정
    if grep -q "대상 비디오:" "$LOG_FILE"; then
        TARGET_CNT=$(grep "대상 비디오:" "$LOG_FILE" | tail -n 1 | strip_ansi | sed 's/.*비디오: //;s/개.*//')
        echo "| Target Selection | $TARGET_CNT | Selected |" >> "$SUMMARY_MD"
    fi

    # 09. 규칙 기반 평가
    if grep -q "Rule 평가 완료!" "$LOG_FILE"; then
        RULE_SUCCESS=$(grep "성공:" "$LOG_FILE" | grep -v "LAAJ" | tail -n 1 | strip_ansi | sed 's/.*: //')
        echo "| Rule Eval | $RULE_SUCCESS | Verified |" >> "$SUMMARY_MD"
    fi

    # 10. LAAJ 평가
    if grep -q "LAAJ 평가 완료" "$LOG_FILE"; then
        LAAJ_SUCCESS=$(grep "성공:" "$LOG_FILE" | grep "LAAJ" -A 5 | tail -n 5 | grep "성공:" | strip_ansi | sed 's/.*: //')
        echo "| LAAJ Eval | $LAAJ_SUCCESS | Verified |" >> "$SUMMARY_MD"
    fi

    # 11. 결과 변환
    if grep -q "변환 완료:" "$LOG_FILE"; then
        TRANS_CNT=$(grep "변환 완료:" "$LOG_FILE" | tail -n 1 | strip_ansi | sed 's/.* 완료: //;s/개.*//')
        echo "| Transform | $TRANS_CNT | Processed |" >> "$SUMMARY_MD"
    fi

    # 12. Supabase 저장
    SUPA_INSERTED=$(grep "성공 (Insert):" "$LOG_FILE" | tail -n 1 | strip_ansi | sed 's/.*Insert): //' | tr -cd '0-9')
    if [ -n "$SUPA_INSERTED" ]; then
        SUPA_SKIPPED=$(grep "건너뜀 (중복):" "$LOG_FILE" | tail -n 1 | strip_ansi | sed 's/.*중복): //' | tr -cd '0-9')
        echo "| DB Insert | $SUPA_INSERTED | (Skip: $SUPA_SKIPPED) |" >> "$SUMMARY_MD"
    else
        echo "| DB Insert | - | Skipped |" >> "$SUMMARY_MD"
    fi
else
    echo "⚠️ Log file not found at $LOG_FILE. Statistics unavailable." >> "$SUMMARY_MD"
fi

echo "" >> "$SUMMARY_MD"

echo "### Details" >> "$SUMMARY_MD"
echo "<details><summary>Click to expand execution details</summary>" >> "$SUMMARY_MD"
echo "" >> "$SUMMARY_MD"

# 1. 신규 URL 목록
if [ -f "$LOG_FILE" ] && [ "$URL_CNT" != "0" ] && [ "$URL_CNT" != "-" ]; then
    echo "**New URLs ($URL_CNT)**" >> "$SUMMARY_MD"
    grep "\[New URL\]" "$LOG_FILE" | strip_ansi | sed 's/.*\[New URL\] /- /' >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
fi

# 2. 메타데이터 업데이트
if [ "$META_CNT" != "0" ] && [ "$META_CNT" != "-" ]; then
    echo "**📝 Metadata Updates ($META_CNT)**" >> "$SUMMARY_MD"
    if [ "$META_CNT" -le 20 ]; then
        grep "\[Meta Updated\]" "$LOG_FILE" | strip_ansi | sed 's/.*\[Meta Updated\] /- /' >> "$SUMMARY_MD"
    else
        grep "\[Meta Updated\]" "$LOG_FILE" | strip_ansi | sed 's/.*\[Meta Updated\] /- /' | head -n 20 >> "$SUMMARY_MD"
        echo "- ... (Total $META_CNT items)" >> "$SUMMARY_MD"
    fi
    echo "" >> "$SUMMARY_MD"
fi

# 3. 자막 저장 내역
if [ "$TRANSCRIPT_CNT" != "0" ]; then
    echo "**💬 Transcripts Saved**" >> "$SUMMARY_MD"
    grep "\[Transcript Saved\]" "$LOG_FILE" | strip_ansi | sed 's/.*\[Transcript Saved\] /- /' >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
fi

# 4. 히트맵 처리
if [ "$HEATMAP_CNT" -gt 0 ]; then
    echo "**🔥 Heatmaps Processed**" >> "$SUMMARY_MD"
    grep "\[Heatmap Saved\]" "$LOG_FILE" | strip_ansi | sed 's/.*\[Heatmap Saved\] /- /' >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
fi

# 5. 프레임 추출
# 로그 마커 [Frames Extracted] 사용
FRAME_VIDEO_CNT=$(grep -c "\[Frames Extracted\]" "$LOG_FILE")
if [ "$FRAME_VIDEO_CNT" -gt 0 ]; then
    echo "**🖼️ Frames Extracted (Videos: $FRAME_VIDEO_CNT)**" >> "$SUMMARY_MD"
    grep "\[Frames Extracted    \]" "$LOG_FILE" | strip_ansi | sed 's/.*\[Frames Extracted\] /- /' >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
fi

# 6. 재미나이
if [ -n "$GEMINI_SUCCESS_LINE" ]; then
    echo "**🧠 Gemini Analysis**" >> "$SUMMARY_MD"
    echo "- $GEMINI_SUCCESS_LINE" >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
fi

if [ "$YOUTUBE_CNT" -gt 0 ]; then
    echo "**📺 YouTube Downloads**" >> "$SUMMARY_MD"
    grep "\[Cache\] 비디오 캐시 저장 완료" "$LOG_FILE" | strip_ansi | sed 's/^/- /' >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
fi

if [ "$CONTEXT_CNT" -gt 0 ]; then
    echo "**🧠 Context Generation**" >> "$SUMMARY_MD"
    grep "Context generation for" "$LOG_FILE" | strip_ansi | sed 's/^/- /' >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
fi

if [ -n "$SUPA_INSERTED" ]; then
    echo "**🗄️ Supabase Status**" >> "$SUMMARY_MD"
    echo "- Inserted: $SUPA_INSERTED" >> "$SUMMARY_MD"
    echo "- Skipped: $SUPA_SKIPPED" >> "$SUMMARY_MD"
    grep "오류:" "$LOG_FILE" | strip_ansi | sed 's/^/- /' >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
fi

echo "</details>" >> "$SUMMARY_MD"
echo "" >> "$SUMMARY_MD"

# 실패 목록 (유튜브 다운로드 실패)
FAILED_DOWNLOADS=$(grep "비디오 파일 확보 실패" "$LOG_FILE" | head -n 10)

if [ -n "$FAILED_DOWNLOADS" ]; then
    echo "### ⚠️ Manual Action Required (Missing Videos)" >> "$SUMMARY_MD" 
    echo "> **Note**: 아래 영상들은 구글 드라이브에 없어 수집에 실패했습니다. 로컬에서 받아 드라이브에 올려주세요." >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
    echo "\`\`\`text" >> "$SUMMARY_MD"
    # 로그에서 비디오 ID만 추출하려고 시도하거나 그대로 출력
    # 로그 포맷: [Video] 비디오 파일 확보 실패 (360p). 건너뜁니다. -> ID 포함 안될수도 있음. 
    # 04 스크립트 로그를 보면 "다운로드 실패 ... : -D43ezc57z8" 이런식이 아님.
    # "영상 다운로드 시작... ID" 로그 밑에 실패가 뜨므로 매칭이 어려움.
    # 대신 failed_url.txt를 활용하거나 로그를 grep
    
    # 04 스크립트의 logFailedUrl 함수가 'failed_urls.txt'를 남김.
    FAILED_LIST_FILE="$PROJECT_ROOT/backend/restaurant-crawling/data/tzuyang/failed_urls.txt"
    if [ -f "$FAILED_LIST_FILE" ]; then
        cat "$FAILED_LIST_FILE" | head -n 10 >> "$SUMMARY_MD"
        COUNT=$(wc -l < "$FAILED_LIST_FILE")
        if [ "$COUNT" -gt 10 ]; then
            echo "... (Total $COUNT failed)" >> "$SUMMARY_MD"
        fi
    else
        echo "No failed_urls.txt found (Check logs)" >> "$SUMMARY_MD"
    fi
    echo "\`\`\`" >> "$SUMMARY_MD"
else
    echo "### ✅ All Systems Go!" >> "$SUMMARY_MD"
    echo "모든 영상이 정상적으로 처리되었습니다." >> "$SUMMARY_MD"
fi

echo "" >> "$SUMMARY_MD"
echo "### 🔍 Quick Links"
echo "- **Log File**: \`backend/log/cron/daily_$DATE.log\`"
echo "- **Data Branch**: [\`data\`](https://github.com/twoimo/tzudong/tree/data)"
echo "" >> "$SUMMARY_MD"

echo "### 🏗️ Pipeline Architecture" >> "$SUMMARY_MD"
echo "\`\`\`wmgraph" >> "$SUMMARY_MD"
cat <<EOF >> "$SUMMARY_MD"
+----------------------------------------------------------------------------------------------------------+
|                                    🚀 TZUDONG DETAILED PIPELINE FLOW                                     |
+----------------------------------------------------------------------------------------------------------+
|                                                                                                          |
|  [Daily Start]                                                                                           |
|        |                                                                                                 |
|        v                                                                                                 |
|  [Step 1: URLs] --> [Step 2: Meta] --> [Step 2.1: Migr] --> [Step 2.5: Clean] ==(Save)==> [Git Commit]   |
|                                                                                                          |
|        v                                                                                                 |
|  [Step 3: Transcript] --> [Step 3.1: Context (Ollama)] ==(Save)==> [Git Commit]                          |
|                                                                                                          |
|        v                                                                                                 |
|  [Step 4: Frames/Heatmap] ==(Save)==> [Git Commit]                                                       |
|                                                                                                          |
|        v                                                                                                 |
|  [Step 6.1: Meta Enrich] --> [Step 6: Gemini Analysis]                                                   |
|                                                                                                          |
|        v                                                                                                 |
|  [Step 08: Target Select] --> [Step 09: Rule Eval] --> [Step 10: LAAJ Eval] ==(Save)==> [Git Commit]     |
|                                                                                                          |
|        v                                                                                                 |
|  [Step 11: Transform] --> [Step 12: Supabase Insert] --> [Step 7: Final Sync] ==(Push)==> [Remote]       |
|                                                                                                          |
+----------------------------------------------------------------------------------------------------------+
EOF
echo "\`\`\`" >> "$SUMMARY_MD"
echo "" >> "$SUMMARY_MD"

echo "### 📘 파이프라인 스크립트별 5W1H 정밀 분석" >> "$SUMMARY_MD"
echo "각 단계가 **왜(Why)** 필요하고, **어떻게(How)** 작동하며, **무엇(What)** 을 남기는지 육하원칙에 따라 기술합니다." >> "$SUMMARY_MD"
echo "" >> "$SUMMARY_MD"

echo "#### 1. 수집 및 전처리 (Data Collection)" >> "$SUMMARY_MD"
echo "**Step 1: URL 수집 (\`01-collect-urls.py\`)**" >> "$SUMMARY_MD"
echo "- **Why (목적)**: 채널의 최신 영상 상태를 정확히 동기화하기 위함입니다." >> "$SUMMARY_MD"
echo "- **How (작동)**: YouTube Data API로 전체 목록을 조회한 뒤, 로컬 \`urls.txt\`와 **Diff 연산**을 수행하여 '신규 추가'와 '삭제된 영상'을 구분합니다." >> "$SUMMARY_MD"
echo "- **What (결과)**: 최신화된 URL 목록 및 삭제 이력(History)." >> "$SUMMARY_MD"
echo "" >> "$SUMMARY_MD"

echo "**Step 2: 메타데이터 (\`02-collect-meta.py\`)**" >> "$SUMMARY_MD"
echo "- **Why (목적)**: API 쿼터를 절약하면서도 시계열 데이터(조회수 추이 등)를 확보합니다." >> "$SUMMARY_MD"
echo "- **When (시기)**: **Smart Scheduling** 알고리즘(게시일 기준 D+5~14일은 매일, 그 외엔 월 1회)에 따라 선별적으로 실행됩니다." >> "$SUMMARY_MD"
echo "- **How (작동)**: 썸네일 파일의 **MD5 Hash**를 비교하여 실제 이미지가 변경된 경우에만 다운로드를 수행하는 최적화 로직이 포함됩니다." >> "$SUMMARY_MD"
echo "" >> "$SUMMARY_MD"

echo "#### 2. 멀티모달 데이터 확보 (Multi-modal Processing)" >> "$SUMMARY_MD"
echo "**Step 3: 자막 확보 (\`03-collect-transcript.js\`)**" >> "$SUMMARY_MD"
echo "- **Why (목적)**: 영상의 내용을 텍스트로 분석하기 위한 기초 데이터입니다." >> "$SUMMARY_MD"
echo "- **How (작동)**: \`youtube-transcript-api\`를 사용하여 타임스탬프가 포함된 전체 자막을 JSONL 포맷으로 구조화하여 저장합니다." >> "$SUMMARY_MD"
echo "" >> "$SUMMARY_MD"

echo "**Step 3.1: 문맥 생성 (\`03.1-generate-transcript-context.py\`)**" >> "$SUMMARY_MD"
echo "- **Who (주체)**: **Local AI (Ollama)**." >> "$SUMMARY_MD"
echo "- **How (작동)**: 긴 자막을 **Chunking**하고 요약(Summarization)하여, 후속 단계의 AI가 영상을 '먹방', '여행' 등으로 이해할 수 있도록 문맥(Context)을 생성합니다." >> "$SUMMARY_MD"
echo "" >> "$SUMMARY_MD"

echo "**Step 4: 고화질 프레임 (\`04-extract-frames-with-heatmap.js\`)**" >> "$SUMMARY_MD"
echo "- **Why (목적)**: 사용자가 가장 관심 있어 하는 '음식 근접샷'을 자동으로 포착하기 위함입니다." >> "$SUMMARY_MD"
echo "- **How (작동)**: YouTube Player 내부의 **Heatmap Peak** 데이터를 파싱하여 시청 지속 시간이 가장 높은 초(sec)를 찾고, FFmpeg로 해당 순간을 고화질 캡처합니다." >> "$SUMMARY_MD"
echo "" >> "$SUMMARY_MD"

echo "#### 3. AI 분석 및 검증 (Analysis & Verification)" >> "$SUMMARY_MD"
echo "**Step 6: Gemini 비전 분석 (\`06-gemini-vision.sh\`)**" >> "$SUMMARY_MD"
echo "- **What (기능)**: 비구조화된 영상 데이터를 구조화된 식당 정보(이름, 메뉴, 위치)로 변환합니다." >> "$SUMMARY_MD"
echo "- **How (작동)**: **Vision-Text Multi-modal** 모델을 사용합니다. Node.js API 호출 실패 시 자동으로 CLI 모드로 전환하는 **Sticky Fallback** 로직으로 안정성을 보장합니다." >> "$SUMMARY_MD"
echo "" >> "$SUMMARY_MD"

echo "**Step 9: 위치 검증 (\`09-rule-evaluation.py\`)**" >> "$SUMMARY_MD"
echo "- **Why (목적)**: AI가 잘못 인식한 정보(Hallucination)를 걸러내고 실존 여부를 확인합니다." >> "$SUMMARY_MD"
echo "- **How (작동)**: 추출된 상호명으로 네이버 지도를 검색하고, 반환된 좌표와 영상 내 지명 정보를 **Geocoding**하여 **반경 20m 이내** 일치 여부를 수학적으로 검증합니다." >> "$SUMMARY_MD"
echo "" >> "$SUMMARY_MD"

echo "**Step 10: 리뷰 평가 (\`10-laaj-evaluation.sh\`)**" >> "$SUMMARY_MD"
echo "- **Who (주체)**: LAAJ (LLM as a Judge) 페르소나." >> "$SUMMARY_MD"
echo "- **How (작동)**: 리뷰 텍스트의 감성 및 패턴을 분석하여 단순 긍/부정이 아닌 '진정성'과 '광고성' 여부를 심사합니다." >> "$SUMMARY_MD"
echo "" >> "$SUMMARY_MD"

echo "#### 4. 배포 (Deployment)" >> "$SUMMARY_MD"
echo "**Step 12: DB 동기화 (\`12-supabase-insert.py\`)**" >> "$SUMMARY_MD"
echo "- **How (작동)**: 데이터 무결성을 위해 \`Trace ID = Hash(Link + Name + Review)\`를 생성하여 중복을 방지합니다. **Selective Upsert** 전략을 통해, 사람이 수동으로 검수한 필드는 덮어쓰지 않고 보존합니다." >> "$SUMMARY_MD"
echo "" >> "$SUMMARY_MD"
