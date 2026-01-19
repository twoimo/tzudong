#!/bin/bash

# ============================================================
# 쯔동 데이터 수집 파이프라인 - 일일 작업 (Daily Job)
# ============================================================
# 사용법: ./run_daily.sh
# 설명:
# 1. URL 업데이트 (01)
# 2. 메타 수집 (02) -> 히트맵 (04) -> 자막 (03)
# 3. 지도 정보 수집 (05 - 정육왕 전용)
# 4. Gemini 분석 (06)
# ============================================================

PROJECT_ROOT="/home/ubuntu/tzudong/backend"
LOG_DIR="$PROJECT_ROOT/log/cron"
DATE=$(date +%Y-%m-%d)
LOG_FILE="$LOG_DIR/daily_$DATE.log"

# Cron 환경을 위한 환경변수 로드
source $HOME/.bashrc
if [ -f "$HOME/.profile" ]; then
    source $HOME/.profile
fi
export PATH="/usr/bin:/usr/local/bin:$PATH"

mkdir -p "$LOG_DIR"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

run_script() {
    local script=$1
    local channel=$2
    local cmd="node $script --channel $channel"
    
    if [[ "$script" == *.py ]]; then
        cmd="python3 $script --channel $channel"
    elif [[ "$script" == *.sh ]]; then
        cmd="bash $script --channel $channel"
    fi

    log "🚀 시작: $script ($channel)..."
    
    # 명령어 실행
    $cmd >> "$LOG_FILE" 2>&1
    local exit_code=$?

    if [ $exit_code -ne 0 ]; then
        log "❌ 실패: $script ($channel) (Exit: $exit_code)"
        # 심각도에 따라 중단할 수도 있지만, 여기서는 다음 단계로 계속 진행합니다.
    else
        log "✅ 완료: $script ($channel)"
    fi
}

log "============================================================"
log "🏁 일일 데이터 수집 파이프라인 시작"
log "============================================================"

# 처리할 채널 목록
CHANNELS=("tzuyang" "meatcreator")

cd "$PROJECT_ROOT" || exit 1

for channel in "${CHANNELS[@]}"; do
    log ">>> 채널 처리 중: $channel"

    # 1. URL 수집 (신규 영상 확보)
    run_script "restaurant-crawling/scripts/01-collect-urls.py" "$channel"

    # 2. 메타데이터 수집 (변경 감지 트리거)
    run_script "restaurant-crawling/scripts/02-collect-meta.py" "$channel"

    # 3. 히트맵 수집 (메타데이터 의존)
    run_script "restaurant-crawling/scripts/04-collect-heatmap.js" "$channel"

    # 4. 자막 수집 (메타데이터 의존)
    run_script "restaurant-crawling/scripts/03-collect-transcript.js" "$channel"

    # 5. 지도 정보 수집 (채널 전용)
    if [ "$channel" == "meatcreator" ]; then
        run_script "restaurant-crawling/scripts/05-map-url-crawling.js" "$channel"
    fi

    # 6. Gemini 분석
    run_script "restaurant-crawling/scripts/06-gemini-crawling.sh" "$channel"
    
    log "------------------------------------------------------------"
done

log "🏁 모든 작업 완료"
log "============================================================"
