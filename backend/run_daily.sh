#!/usr/bin/env bash

# ============================================================
# 쯔동여지도 일일 데이터 수집 파이프라인 (Performance Optimized)
# ============================================================
# 
# [PERF] 최적화 포인트:
# 1. 스텝별 실행 시간 측정 (병목 구간 가시화)
# 2. 스마트 스킵 로직 (신규 데이터 없으면 고비용 단계 건너뜀)
# 3. 중간 git sync 횟수 최적화 (5→3회, 각 30-60초 절약)
# 4. 파이프라인 전체 타임아웃 보호
# 5. 병렬 가능한 작업 병렬화
# ============================================================

# 파이프라인 에러 감지를 위해 pipefail 설정 (tee 사용 시 필수)
set -o pipefail

# 프로젝트 루트 경로 동적 탐색 (스크립트 위치 기준 상위 폴더)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 프로젝트 루트로 이동
cd "$PROJECT_ROOT" || { echo "[ERROR] 프로젝트 루트로 이동 실패: $PROJECT_ROOT"; exit 1; }

# 환경 변수 로드 (Node, Python 경로 등)
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
        echo "[ERROR] Python을 찾을 수 없습니다."
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

# [PERF] 파이프라인 시작 시간 기록 (전체 실행 시간 측정)
PIPELINE_START=$(date +%s)

# ============================================================
# 유틸리티 함수
# ============================================================

# 로그 출력 함수 (화면 + 파일 동시 출력)
log() {
  local LEVEL=$1
  local MESSAGE=$2
  local TIMESTAMP=$(date "+%H:%M:%S")
  
  case "$LEVEL" in
    "INFO"|"WARN"|"ERROR"|"OK") ;;
    *) LEVEL="INFO" ;;
  esac
  echo "[$TIMESTAMP] [$LEVEL] $MESSAGE" | tee -a "$LOG_FILE"
}

# ANSI 색상 코드 제거 함수
strip_ansi() {
    sed 's/\x1b\[[0-9;]*m//g'
}

# [PERF] 스텝 타이밍 함수 - 각 단계의 실행 시간 측정
step_start() {
    STEP_START_TIME=$(date +%s)
}

step_end() {
    local STEP_NAME="$1"
    local STEP_END_TIME=$(date +%s)
    local DURATION=$((STEP_END_TIME - STEP_START_TIME))
    local MINUTES=$((DURATION / 60))
    local SECONDS=$((DURATION % 60))
    log "INFO" "[TIMING] $STEP_NAME: ${MINUTES}m ${SECONDS}s"
}

# [PERF] 파이프라인 경과 시간 확인 (타임아웃 보호)
check_timeout() {
    local MAX_MINUTES=${1:-90}  # 기본 90분 타임아웃
    local ELAPSED=$(( $(date +%s) - PIPELINE_START ))
    local ELAPSED_MIN=$((ELAPSED / 60))
    if [ "$ELAPSED_MIN" -ge "$MAX_MINUTES" ]; then
        log "WARN" "파이프라인 시간 제한 도달 (${ELAPSED_MIN}m/${MAX_MINUTES}m). 남은 단계 건너뜁니다."
        return 1
    fi
    return 0
}

# [PERF] 병렬 실행 유틸리티 - 두 작업을 동시에 실행하고 로그를 순차 출력
# Usage: run_parallel "Label_A" "command_A" "Label_B" "command_B"
run_parallel() {
    local LABEL_A="$1" CMD_A="$2" LABEL_B="$3" CMD_B="$4"
    local TEMP_LOG_A TEMP_LOG_B PID_A PID_B EXIT_A EXIT_B

    TEMP_LOG_A=$(mktemp)
    TEMP_LOG_B=$(mktemp)

    eval "$CMD_A" > "$TEMP_LOG_A" 2>&1 &
    PID_A=$!
    eval "$CMD_B" > "$TEMP_LOG_B" 2>&1 &
    PID_B=$!

    wait $PID_A; EXIT_A=$?
    wait $PID_B; EXIT_B=$?

    # 로그 순서대로 출력 (섞임 방지)
    log "INFO" "--- [$LABEL_A] ---"
    cat "$TEMP_LOG_A" | tee -a "$LOG_FILE"
    log "INFO" "--- [$LABEL_B] ---"
    cat "$TEMP_LOG_B" | tee -a "$LOG_FILE"

    rm -f "$TEMP_LOG_A" "$TEMP_LOG_B"

    if [ $EXIT_A -ne 0 ]; then
        log "WARN" "[$LABEL_A] 비정상 종료 (exit: $EXIT_A)"
    fi
    if [ $EXIT_B -ne 0 ]; then
        log "WARN" "[$LABEL_B] 비정상 종료 (exit: $EXIT_B)"
    fi
    return 0
}

# [Function] 데이터 커밋 함수 (data 브랜치에서 직접 실행)
sync_data_to_remote() {
    local STEP_NAME="$1"
    log "INFO" "------------------------------------------------------------"
    log "INFO" "데이터 동기화 시작 (Trigger: $STEP_NAME)"

    # 데이터 폴더 변경 감지 (Modified + Untracked)
    if [ -z "$(git status --porcelain backend/restaurant-crawling/data/ backend/restaurant-evaluation/data/)" ]; then
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
        if ! git push --force-with-lease origin data 2>&1 | tee -a "$LOG_FILE"; then
            log "ERROR" "Failed to push to data branch"
            return 1
        fi
    else
        log "INFO" "Pushing to remote..."
        if ! git push origin data 2>&1 | tee -a "$LOG_FILE"; then
            log "ERROR" "Failed to push to data branch"
            return 1
        fi
    fi

    log "OK" "data 브랜치 업데이트 완료 ($STEP_NAME)"
}

# ============================================================
# 파이프라인 시작
# ============================================================

log "INFO" "============================================================"
log "INFO" "일일 데이터 수집 파이프라인 시작"
log "INFO" "============================================================"

# [Branch Check] 'data' 브랜치인지 확인
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
TARGET_BRANCH="data"

log "INFO" "현재 브랜치 확인: $CURRENT_BRANCH"

if [ "$CURRENT_BRANCH" != "$TARGET_BRANCH" ]; then
    log "WARN" "현재 브랜치가 '$TARGET_BRANCH'가 아닙니다. '$TARGET_BRANCH'로 전환을 시도합니다."
    
    git fetch origin
    
    if git show-ref --verify --quiet refs/heads/$TARGET_BRANCH; then
        git checkout $TARGET_BRANCH || { log "ERROR" "브랜치 전환 실패. 변경사항을 커밋하거나 스태시하세요."; exit 1; }
    else
        git checkout -b $TARGET_BRANCH origin/$TARGET_BRANCH || { log "ERROR" "원격 브랜치 체크아웃 실패."; exit 1; }
    fi
    
    log "OK" "브랜치 전환 완료: $TARGET_BRANCH"
fi

# 충돌 방지를 위해 최신 변경사항 Pull
log "INFO" "'$TARGET_BRANCH' 브랜치 최신화 (Pull)..."
git pull origin $TARGET_BRANCH || { log "WARN" "Pull 실패 (무시하고 진행)."; }

log "INFO" "현재 작업 브랜치: $(git rev-parse --abbrev-ref HEAD)"

# ============================================================
# [Phase 1] 데이터 수집 및 전처리 (Collection & Preprocessing)
# ============================================================

# 1. URL 수집 (새로운 영상 탐색)
echo "::group::[Step 1] URL Collection"
step_start
log "INFO" "[Step 1] URL 수집 중..."
$PYTHON_CMD backend/restaurant-crawling/scripts/01-collect-urls.py --channel tzuyang 2>&1 | tee -a "$LOG_FILE"
step_end "Step 1 (URL Collection)"
echo "::endgroup::"

# [PERF] 스마트 스킵 플래그 - 신규 URL이 없으면 고비용 단계 최적화
NEW_URL_COUNT=$(grep -c "\[New URL\]" "$LOG_FILE" 2>/dev/null || true)
HAS_NEW_DATA=false
if [ "$NEW_URL_COUNT" -gt 0 ]; then
    HAS_NEW_DATA=true
    log "INFO" "신규 URL ${NEW_URL_COUNT}개 감지 -> 전체 파이프라인 실행"
else
    log "INFO" "신규 URL 없음 -> 스마트 모드 (변경분만 처리)"
fi

# 2. 메타데이터 수집 & 스케줄링 (관제탑 역할)
echo "::group::[Step 2] Metadata Collection"
step_start
log "INFO" "[Step 2] 메타데이터 수집 및 스케줄링..."
$PYTHON_CMD backend/restaurant-crawling/scripts/02-collect-meta.py --channel tzuyang 2>&1 | tee -a "$LOG_FILE"
step_end "Step 2 (Metadata)"
echo "::endgroup::"

# [PERF] 2.1 + 2.5 병렬 실행 (충돌 없음: 2.1은 Supabase 쓰기, 2.5는 orphan 삭제)
echo "::group::[Step 2.1+2.5] Meta Migration + Orphan Cleanup (Parallel)"
step_start
log "INFO" "[Step 2.1+2.5] Meta Migration + Orphan Cleanup (병렬 실행)..."
run_parallel \
    "Step 2.1 Meta Migration" \
    "$PYTHON_CMD backend/restaurant-crawling/scripts/02.1-migrate-meta-to-supabase.py --channel tzuyang" \
    "Step 2.5 Orphan Cleanup" \
    "$PYTHON_CMD backend/restaurant-crawling/scripts/02.5-cleanup-orphans.py --channel tzuyang"
step_end "Step 2.1+2.5 (Migration+Cleanup)"
echo "::endgroup::"

# [PERF] Sync #1: 메타데이터/정리 완료 후 저장
sync_data_to_remote "Phase 1 (Meta/Cleanup)"

# ============================================================
# [Phase 2] 멀티모달 데이터 확보 (Multi-modal Processing)
# ============================================================

# [PERF] Step 3 + Step 4 병렬 실행 (충돌 없음: 3은 transcript/, 4는 heatmap/+frames/)
# Step 3 완료 후 Step 3.1 실행, Step 4는 백그라운드 유지
echo "::group::[Step 3+4] Transcript + Frames (Parallel)"
step_start
log "INFO" "[Step 3+4] 자막 수집 + 프레임 추출 (병렬 실행)..."

TEMP_LOG_3=$(mktemp)
TEMP_LOG_4=$(mktemp)

# Step 3 (Transcript) + Step 4 (Frames) 동시 시작
node backend/restaurant-crawling/scripts/03-collect-transcript.js --channel tzuyang > "$TEMP_LOG_3" 2>&1 &
PID_3=$!
node backend/restaurant-crawling/scripts/04-extract-frames-with-heatmap.js --channel tzuyang --delete-cache > "$TEMP_LOG_4" 2>&1 &
PID_4=$!

# Step 3 완료 대기 -> 로그 출력
wait $PID_3; EXIT_3=$?
log "INFO" "--- [Step 3 Transcript] ---"
cat "$TEMP_LOG_3" | tee -a "$LOG_FILE"
if [ $EXIT_3 -ne 0 ]; then
    log "WARN" "[Step 3] Transcript 비정상 종료 (exit: $EXIT_3)"
fi
rm -f "$TEMP_LOG_3"
echo "::endgroup::"

# Step 3.1 실행 (Step 3 완료 필요, Step 4는 백그라운드 계속)
echo "::group::[Step 3.1] Context Generation"
log "INFO" "[Step 3.1] 자막 문맥 생성 중..."
# [Config] 실행 모드에 따른 배치 크기 제한
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

# Step 4 완료 대기
echo "::group::[Step 4] Heatmap & Frames (Awaiting)"
wait $PID_4; EXIT_4=$?
log "INFO" "--- [Step 4 Frames] ---"
cat "$TEMP_LOG_4" | tee -a "$LOG_FILE"
if [ $EXIT_4 -ne 0 ]; then
    log "WARN" "[Step 4] Frames 비정상 종료 (exit: $EXIT_4)"
fi
rm -f "$TEMP_LOG_4"

step_end "Step 3+4 (Transcript+Frames+Context)"
echo "::endgroup::"

# [PERF] Sync #2: 자막/프레임 완료 후 저장 (Phase 2 통합 - 기존 3회 → 1회)
sync_data_to_remote "Phase 2 (Transcript/Frames)"

# [PERF] 타임아웃 체크 - Phase 3 진입 전 시간 확인
if ! check_timeout 90; then
    log "WARN" "시간 제한으로 Phase 3 건너뜁니다. 다음 실행에서 이어집니다."
    sync_data_to_remote "Timeout Safety Sync"
    # Summary 생성으로 점프
    SKIP_PHASE3=true
fi

# ============================================================
# [Phase 3] AI 분석 및 평가 (Analysis & Evaluation)
# ============================================================

if [ "${SKIP_PHASE3:-false}" != "true" ]; then

# 6.1. 자막 문서에 메타데이터 추가 (음식점 + Peak)
echo "::group::[Step 6.1] Enrich Subtitles"
step_start
log "INFO" "[Step 6.1] 자막 문서 메타데이터 추가 중..."
$PYTHON_CMD backend/restaurant-crawling/scripts/06.1-transcript-document-with-meta.py --channel tzuyang 2>&1 | tee -a "$LOG_FILE"
step_end "Step 6.1 (Enrich)"
echo "::endgroup::"

# 7. Gemini 기반 데이터 분석
echo "::group::[Step 7] Gemini Data Analysis"
step_start
log "INFO" "[Step 7] Gemini 데이터 분석 중..."
bash backend/restaurant-crawling/scripts/07-gemini-crawling.sh --channel tzuyang 2>&1 | tee -a "$LOG_FILE"
step_end "Step 7 (Gemini)"
echo "::endgroup::"

# 8. 평가 대상 선정
echo "::group::[Step 08] Target Selection"
step_start
log "INFO" "[Step 08] Target Selection..."
$PYTHON_CMD backend/restaurant-evaluation/scripts/08-target-selection.py --channel tzuyang \
  --crawling-path backend/restaurant-crawling/data/tzuyang \
  --evaluation-path backend/restaurant-evaluation/data/tzuyang 2>&1 | tee -a "$LOG_FILE"
step_end "Step 08 (Target)"
echo "::endgroup::"

# 9. Rule 기반 평가 (위치/상호 검증)
echo "::group::[Step 09] Rule Evaluation"
step_start
log "INFO" "[Step 09] Rule Evaluation..."
$PYTHON_CMD backend/restaurant-evaluation/scripts/09-rule-evaluation.py --channel tzuyang \
  --evaluation-path backend/restaurant-evaluation/data/tzuyang 2>&1 | tee -a "$LOG_FILE"
grep "Rule 평가 완료!" -A 5 "$LOG_FILE" | tail -n 6 | strip_ansi | while read -r line; do echo "::notice::$line"; done
step_end "Step 09 (Rule Eval)"
echo "::endgroup::"

# [PERF] Sync #3: Rule 평가 완료 후 저장 (LAAJ 전 백업 - 중요)
sync_data_to_remote "Phase 3a (Rule Eval)"

# [PERF] 타임아웃 체크 - LAAJ 진입 전 시간 확인 (가장 오래 걸리는 단계)
if ! check_timeout 90; then
    log "WARN" "시간 제한으로 LAAJ 평가를 건너뜁니다. 다음 실행에서 이어집니다."
else

# 10. LAAJ (LLM) 기반 평가
echo "::group::[Step 10] LAAJ Evaluation"
step_start
log "INFO" "[Step 10] LAAJ Evaluation..."
bash backend/restaurant-evaluation/scripts/10-laaj-evaluation.sh --channel tzuyang \
  --crawling-path backend/restaurant-crawling/data/tzuyang \
  --evaluation-path backend/restaurant-evaluation/data/tzuyang 2>&1 | tee -a "$LOG_FILE"
grep "LAAJ 평가 완료" -A 5 "$LOG_FILE" | tail -n 6 | strip_ansi | while read -r line; do echo "::notice::$line"; done
step_end "Step 10 (LAAJ Eval)"
echo "::endgroup::"

fi # LAAJ 타임아웃 체크 종료

# 11. 결과 변환 (Transforms)
echo "::group::[Step 11] Transform Results"
step_start
log "INFO" "[Step 11] Transform Results..."
$PYTHON_CMD backend/restaurant-evaluation/scripts/11-transform.py --channel tzuyang \
  --crawling-path backend/restaurant-crawling/data/tzuyang \
  --evaluation-path backend/restaurant-evaluation/data/tzuyang 2>&1 | tee -a "$LOG_FILE"
step_end "Step 11 (Transform)"
echo "::endgroup::"

# 12. Supabase 결과 삽입
echo "::group::[Step 12] Insert to Supabase"
step_start
log "INFO" "[Step 12] Insert to Supabase..."
$PYTHON_CMD backend/restaurant-evaluation/scripts/12-supabase-insert.py --channel tzuyang \
  --evaluation-path backend/restaurant-evaluation/data/tzuyang 2>&1 | tee -a "$LOG_FILE"
grep "성공 (Insert):" "$LOG_FILE" | tail -n 1 | strip_ansi | while read -r line; do echo "::notice::DB Sync - $line"; done
step_end "Step 12 (Supabase)"
echo "::endgroup::"

fi # SKIP_PHASE3 종료

# ============================================================
# [Phase 4] 최종 동기화 및 보고
# ============================================================

log "INFO" "============================================================"
log "INFO" "일일 데이터 수집 파이프라인 완료"
log "INFO" "============================================================"

# [PERF] Final Sync (모든 Phase의 남은 변경사항 통합 커밋)
log "INFO" "[Final] 'data' 브랜치에 최종 데이터 저장..."
sync_data_to_remote "Final Sync"

# 코드 에디터 동기화 신호
SYNC_TRIGGER_FILE="$PROJECT_ROOT/backend/.sync_trigger"
echo "$(date)" > "$SYNC_TRIGGER_FILE"
log "INFO" "코드 에디터 동기화용 트리거 파일 생성됨"

# [PERF] 전체 실행 시간 출력
PIPELINE_END=$(date +%s)
TOTAL_DURATION=$((PIPELINE_END - PIPELINE_START))
TOTAL_MIN=$((TOTAL_DURATION / 60))
TOTAL_SEC=$((TOTAL_DURATION % 60))
log "OK" "============================================================"
log "OK" "모든 단계가 완료되었습니다! (총 실행 시간: ${TOTAL_MIN}m ${TOTAL_SEC}s)"
log "OK" "============================================================"

# ============================================================
# GitHub Actions Summary 생성
# ============================================================

SUMMARY_MD="$PROJECT_ROOT/summary.md"
echo "## Daily Crawling Report ($DATE)" > "$SUMMARY_MD"
echo "" >> "$SUMMARY_MD"

# [PERF] 실행 시간 요약 (가장 먼저 표시)
echo "### Execution Time" >> "$SUMMARY_MD"
echo "| Metric | Value |" >> "$SUMMARY_MD"
echo "|--------|-------|" >> "$SUMMARY_MD"
echo "| Total Runtime | **${TOTAL_MIN}분 ${TOTAL_SEC}초** |" >> "$SUMMARY_MD"
echo "| New Videos | ${NEW_URL_COUNT:-0} |" >> "$SUMMARY_MD"
echo "| Mode | $([ "${HAS_NEW_DATA}" = "true" ] && echo "Full Pipeline" || echo "Smart (Delta Only)") |" >> "$SUMMARY_MD"
if [ "${SKIP_PHASE3:-false}" = "true" ]; then
    echo "| Note | Phase 3 skipped (timeout) |" >> "$SUMMARY_MD"
fi
echo "" >> "$SUMMARY_MD"

# 스텝별 타이밍 로그 추출
echo "### Step Timings" >> "$SUMMARY_MD"
echo "| Step | Duration |" >> "$SUMMARY_MD"
echo "|------|----------|" >> "$SUMMARY_MD"
grep "\[TIMING\]" "$LOG_FILE" | strip_ansi | while IFS= read -r line; do
    STEP_NAME=$(echo "$line" | sed 's/.*\[TIMING\] //;s/:.*//')
    STEP_TIME=$(echo "$line" | sed 's/.*\[TIMING\] [^:]*: //')
    echo "| $STEP_NAME | $STEP_TIME |" >> "$SUMMARY_MD"
done
echo "" >> "$SUMMARY_MD"

# 상세 처리 통계
echo "### Process Statistics" >> "$SUMMARY_MD"
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
    CONTEXT_CNT=$(grep -c "Context generation for .* completed" "$LOG_FILE" 2>/dev/null || true)
    echo "| Contexts | $CONTEXT_CNT | Generated |" >> "$SUMMARY_MD"

    # 4. 히트맵
    HEATMAP_CNT=$(grep -c "Heatmap saved" "$LOG_FILE" 2>/dev/null || true)
    echo "| Heatmaps | $HEATMAP_CNT | Saved |" >> "$SUMMARY_MD"

    # 4. 프레임
    FRAME_CNT=$(grep -c "Frames extracted" "$LOG_FILE" 2>/dev/null || true)
    echo "| Frames | $FRAME_CNT | Extracted |" >> "$SUMMARY_MD"

    # 구글 드라이브 & 유튜브
    GDRIVE_CNT=$(grep -c "\[GDrive\] 영상 발견.*다운로드 시도" "$LOG_FILE" 2>/dev/null || true)
    YOUTUBE_CNT=$(grep -c "\[YouTube\] 다운로드 시도" "$LOG_FILE" 2>/dev/null || true)
    echo "| GDrive Cache | $GDRIVE_CNT | Hits |" >> "$SUMMARY_MD"
    if [ "$YOUTUBE_CNT" -gt 0 ]; then
        echo "| YouTube DL | **$YOUTUBE_CNT** | Success |" >> "$SUMMARY_MD"
    else
        echo "| YouTube DL | 0 | (Blocked) |" >> "$SUMMARY_MD"
    fi

    # 5. 지도 URL
    MAP_CNT=$(grep -c "지도 URL 수집 완료" "$LOG_FILE" 2>/dev/null || true)
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
    echo "Log file not found at $LOG_FILE. Statistics unavailable." >> "$SUMMARY_MD"
fi

echo "" >> "$SUMMARY_MD"

echo "### Details" >> "$SUMMARY_MD"
echo "<details><summary>Click to expand execution details</summary>" >> "$SUMMARY_MD"
echo "" >> "$SUMMARY_MD"

# 1. 신규 URL 목록
if [ -f "$LOG_FILE" ] && [ "${URL_CNT:-0}" != "0" ] && [ "${URL_CNT:--}" != "-" ]; then
    echo "**New URLs ($URL_CNT)**" >> "$SUMMARY_MD"
    grep "\[New URL\]" "$LOG_FILE" | strip_ansi | sed 's/.*\[New URL\] /- /' >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
fi

# 2. 메타데이터 업데이트
if [ "${META_CNT:-0}" != "0" ] && [ "${META_CNT:--}" != "-" ]; then
    echo "**Metadata Updates ($META_CNT)**" >> "$SUMMARY_MD"
    if [ "$META_CNT" -le 20 ]; then
        grep "\[Meta Updated\]" "$LOG_FILE" | strip_ansi | sed 's/.*\[Meta Updated\] /- /' >> "$SUMMARY_MD"
    else
        grep "\[Meta Updated\]" "$LOG_FILE" | strip_ansi | sed 's/.*\[Meta Updated\] /- /' | head -n 20 >> "$SUMMARY_MD"
        echo "- ... (Total $META_CNT items)" >> "$SUMMARY_MD"
    fi
    echo "" >> "$SUMMARY_MD"
fi

# 3. 자막 저장 내역
if [ "${TRANSCRIPT_CNT:-0}" != "0" ]; then
    echo "**Transcripts Saved**" >> "$SUMMARY_MD"
    grep "\[Transcript Saved\]" "$LOG_FILE" | strip_ansi | sed 's/.*\[Transcript Saved\] /- /' >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
fi

# 4. 히트맵 처리
if [ "${HEATMAP_CNT:-0}" -gt 0 ] 2>/dev/null; then
    echo "**Heatmaps Processed**" >> "$SUMMARY_MD"
    grep "\[Heatmap Saved\]" "$LOG_FILE" | strip_ansi | sed 's/.*\[Heatmap Saved\] /- /' >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
fi

# 5. 프레임 추출
FRAME_VIDEO_CNT=$(grep -c "\[Frames Extracted\]" "$LOG_FILE" 2>/dev/null || true)
if [ "$FRAME_VIDEO_CNT" -gt 0 ]; then
    echo "**Frames Extracted (Videos: $FRAME_VIDEO_CNT)**" >> "$SUMMARY_MD"
    grep "\[Frames Extracted\]" "$LOG_FILE" | strip_ansi | sed 's/.*\[Frames Extracted\] /- /' >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
fi

# 6. 재미나이
if [ -n "${GEMINI_SUCCESS_LINE:-}" ]; then
    echo "**Gemini Analysis**" >> "$SUMMARY_MD"
    echo "- $GEMINI_SUCCESS_LINE" >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
fi

if [ "${YOUTUBE_CNT:-0}" -gt 0 ] 2>/dev/null; then
    echo "**YouTube Downloads**" >> "$SUMMARY_MD"
    grep "\[Cache\] 비디오 캐시 저장 완료" "$LOG_FILE" | strip_ansi | sed 's/^/- /' >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
fi

if [ "${CONTEXT_CNT:-0}" -gt 0 ] 2>/dev/null; then
    echo "**Context Generation**" >> "$SUMMARY_MD"
    grep "Context generation for" "$LOG_FILE" | strip_ansi | sed 's/^/- /' >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
fi

if [ -n "${SUPA_INSERTED:-}" ]; then
    echo "**Supabase Status**" >> "$SUMMARY_MD"
    echo "- Inserted: $SUPA_INSERTED" >> "$SUMMARY_MD"
    echo "- Skipped: ${SUPA_SKIPPED:-0}" >> "$SUMMARY_MD"
    grep "오류:" "$LOG_FILE" | strip_ansi | sed 's/^/- /' >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
fi

echo "</details>" >> "$SUMMARY_MD"
echo "" >> "$SUMMARY_MD"

# 실패 목록 (유튜브 다운로드 실패)
FAILED_DOWNLOADS=$(grep "비디오 파일 확보 실패" "$LOG_FILE" 2>/dev/null | head -n 10)

if [ -n "$FAILED_DOWNLOADS" ]; then
    echo "### Manual Action Required (Missing Videos)" >> "$SUMMARY_MD"
    echo "> **Note**: 아래 영상들은 구글 드라이브에 없어 수집에 실패했습니다. 로컬에서 받아 드라이브에 올려주세요." >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
    echo "\`\`\`text" >> "$SUMMARY_MD"
    FAILED_LIST_FILE="$PROJECT_ROOT/backend/restaurant-crawling/data/tzuyang/failed_urls.txt"
    if [ -f "$FAILED_LIST_FILE" ]; then
        head -n 10 "$FAILED_LIST_FILE" >> "$SUMMARY_MD"
        COUNT=$(wc -l < "$FAILED_LIST_FILE")
        if [ "$COUNT" -gt 10 ]; then
            echo "... (Total $COUNT failed)" >> "$SUMMARY_MD"
        fi
    else
        echo "No failed_urls.txt found (Check logs)" >> "$SUMMARY_MD"
    fi
    echo "\`\`\`" >> "$SUMMARY_MD"
else
    echo "### All Systems Go" >> "$SUMMARY_MD"
    echo "모든 영상이 정상적으로 처리되었습니다." >> "$SUMMARY_MD"
fi

echo "" >> "$SUMMARY_MD"

echo "### Quick Links" >> "$SUMMARY_MD"
echo "- **Log File**: \`backend/log/cron/daily_$DATE.log\`" >> "$SUMMARY_MD"
echo "- **Data Branch**: [\`data\`](https://github.com/twoimo/tzudong/tree/data)" >> "$SUMMARY_MD"
echo "" >> "$SUMMARY_MD"

echo "### Pipeline Architecture" >> "$SUMMARY_MD"
echo "\`\`\`" >> "$SUMMARY_MD"
cat <<'EOF' >> "$SUMMARY_MD"
+----------------------------------------------------------------------------------------------------------+
|                                    TZUDONG PIPELINE FLOW (Optimized)                                      |
+----------------------------------------------------------------------------------------------------------+
|                                                                                                          |
|  [Phase 1: Collection]                                                                                   |
|  [Step 1: URLs] → [Step 2: Meta] → [Step 2.1+2.5: Migr+Clean (Parallel)] ══► [Git Sync #1]             |
|                                                                                                          |
|  [Phase 2: Multi-modal]                                                                                  |
|  [Step 3+4: Transcript+Frames (Parallel)] → [Step 3.1: Context] ══► [Git Sync #2]                       |
|                                                                                                          |
|  [Phase 3: AI Analysis]  ── (Timeout Check) ──                                                           |
|  [Step 6.1: Enrich] → [Step 7: Gemini] → [Step 08: Target] → [Step 09: Rule] ══► [Git Sync #3]         |
|  → [Step 10: LAAJ] → [Step 11: Transform] → [Step 12: Supabase]                                         |
|                                                                                                          |
|  [Phase 4: Finalize]                                                                                     |
|  [Final Git Sync] → [Summary Report] ══► Done!                                                           |
+----------------------------------------------------------------------------------------------------------+
EOF
echo "\`\`\`" >> "$SUMMARY_MD"
