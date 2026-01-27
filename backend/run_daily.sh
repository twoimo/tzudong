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

# 6. Gemini 기반 데이터 분석
log "[$(date)] [Step 6] Gemini 데이터 분석 중..."
bash backend/restaurant-crawling/scripts/07-gemini-crawling.sh --channel tzuyang 2>&1 | tee -a "$LOG_FILE"

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

# GitHub Actions Summary 생성
SUMMARY_MD="$PROJECT_ROOT/summary.md"
echo "## 🚀 Daily Crawling Report ($DATE)" > "$SUMMARY_MD"
echo "" >> "$SUMMARY_MD"

# 2. 상세 처리 통계
echo "### 📊 Process Statistics" >> "$SUMMARY_MD"
echo "| Step | Count | Status |" >> "$SUMMARY_MD"
echo "|------|-------|--------|" >> "$SUMMARY_MD"

# ANSI 색상 코드 제거 함수
strip_ansi() {
    sed 's/\x1b\[[0-9;]*m//g'
}

# 2. 상세 처리 통계
echo "### 📊 Process Statistics" >> "$SUMMARY_MD"
echo "| Step | Count | Status |" >> "$SUMMARY_MD"
echo "|------|-------|--------|" >> "$SUMMARY_MD"

# URL
if grep -q "URL 수집 중" "$LOG_FILE"; then
    URL_LINE=$(grep "tzuyang: 신규" "$LOG_FILE" | tail -n 1 | strip_ansi)
    URL_CNT=$(echo "$URL_LINE" | sed 's/.*tzuyang: //')
    echo "| 🔗 URLs | $URL_CNT | ✅ Collected |" >> "$SUMMARY_MD"
else
    echo "| 🔗 URLs | - | ❌ Error |" >> "$SUMMARY_MD"
    URL_LINE=""
fi

# Metadata
if grep -q "메타데이터 수집" "$LOG_FILE"; then
    META_LINE=$(grep "업데이트 [0-9]*개" "$LOG_FILE" | tail -n 1 | strip_ansi)
    META_CNT=$(echo "$META_LINE" | sed 's/.*완료: //')
    echo "| 📝 Metadata | $META_CNT | ✅ Updated |" >> "$SUMMARY_MD"
else
    echo "| 📝 Metadata | - | ⚠️ Skipped/Fail |" >> "$SUMMARY_MD"
    META_LINE=""
fi

# Transcript
TRANSCRIPT_CNT=$(grep "성공 [0-9]*개" "$LOG_FILE" | grep "자막 수집 완료" -A 1 | tail -n 1 | strip_ansi | sed 's/.*성공 //;s/개.*//')
if [ -n "$TRANSCRIPT_CNT" ]; then
    echo "| 💬 Transcripts | $TRANSCRIPT_CNT | ✅ Saved |" >> "$SUMMARY_MD"
else
    echo "| 💬 Transcripts | 0 | ➖ Skipped |" >> "$SUMMARY_MD"
    TRANSCRIPT_CNT="0"
fi

# Heatmap
HEATMAP_CNT=$(grep -c "\[Heatmap Saved\]" "$LOG_FILE")
if [ "$HEATMAP_CNT" -gt 0 ]; then
    echo "| 🔥 Heatmaps | $HEATMAP_CNT | ✅ Saved |" >> "$SUMMARY_MD"
else
    echo "| 🔥 Heatmaps | 0 | ➖ Skipped |" >> "$SUMMARY_MD"
fi

# Frames
FRAME_CNT=$(grep "\[Done\] 추출 완료" "$LOG_FILE" | awk '{sum+=$NF} END {print sum}' | strip_ansi | sed 's/장//')
if [ -z "$FRAME_CNT" ]; then FRAME_CNT=0; fi
echo "| 🖼️ Frames | $FRAME_CNT | ✅ Extracted |" >> "$SUMMARY_MD"

# GDrive & YouTube
GDRIVE_CNT=$(grep -c "\[GDrive\] 영상 발견.*다운로드 시도" "$LOG_FILE")
YOUTUBE_CNT=$(grep -c "\[Cache\] 비디오 캐시 저장 완료" "$LOG_FILE")

echo "| ☁️ GDrive Cache | $GDRIVE_CNT | ✅ Hits |" >> "$SUMMARY_MD"
if [ "$YOUTUBE_CNT" -gt 0 ]; then
    echo "| 📺 YouTube DL | **$YOUTUBE_CNT** | 🎉 Success |" >> "$SUMMARY_MD"
else
    echo "| 📺 YouTube DL | 0 | ➖ (Blocked) |" >> "$SUMMARY_MD"
fi

# Gemini
GEMINI_SUCCESS_LINE=""
if grep -q "Gemini CLI 통계" "$LOG_FILE"; then
    GEMINI_CALLS=$(grep "총 호출 수:" "$LOG_FILE" | tail -n 1 | strip_ansi | sed 's/.*: //')
    GEMINI_SUCCESS=$(grep "성공:" "$LOG_FILE" | tail -n 1 | strip_ansi | sed 's/.*: //')
    GEMINI_SUCCESS_LINE="Calls: $GEMINI_CALLS / Success: $GEMINI_SUCCESS"
    echo "| 🧠 Gemini Analysis | $GEMINI_SUCCESS | (Calls: $GEMINI_CALLS) |" >> "$SUMMARY_MD"
fi

echo "" >> "$SUMMARY_MD"

echo "### 📜 Details" >> "$SUMMARY_MD"
echo "<details><summary>Click to expand execution details</summary>" >> "$SUMMARY_MD"
echo "" >> "$SUMMARY_MD"

# 1. New URLs List
if [ "$URL_CNT" != "0" ] && [ "$URL_CNT" != "-" ]; then
    echo "**🔗 New URLs ($URL_CNT)**" >> "$SUMMARY_MD"
    grep "\[New URL\]" "$LOG_FILE" | strip_ansi | sed 's/.*\[New URL\] /- /' >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
fi

# 2. Metadata Updates
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

# 3. Transcripts
if [ "$TRANSCRIPT_CNT" != "0" ]; then
    echo "**💬 Transcripts Saved**" >> "$SUMMARY_MD"
    grep "\[Transcript Saved\]" "$LOG_FILE" | strip_ansi | sed 's/.*\[Transcript Saved\] /- /' >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
fi

# 4. Heatmaps
if [ "$HEATMAP_CNT" -gt 0 ]; then
    echo "**🔥 Heatmaps Processed**" >> "$SUMMARY_MD"
    grep "\[Heatmap Saved\]" "$LOG_FILE" | strip_ansi | sed 's/.*\[Heatmap Saved\] /- /' >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
fi

# 5. Frames
# Use [Frames Extracted] marker
FRAME_VIDEO_CNT=$(grep -c "\[Frames Extracted\]" "$LOG_FILE")
if [ "$FRAME_VIDEO_CNT" -gt 0 ]; then
    echo "**🖼️ Frames Extracted (Videos: $FRAME_VIDEO_CNT)**" >> "$SUMMARY_MD"
    grep "\[Frames Extracted\]" "$LOG_FILE" | strip_ansi | sed 's/.*\[Frames Extracted\] /- /' >> "$SUMMARY_MD"
    echo "" >> "$SUMMARY_MD"
fi

# 6. Gemini
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


