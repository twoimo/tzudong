#!/bin/bash
# LAAJ 평가 실패 재시도 스크립트
# errors 폴더의 파일들을 재처리합니다.
#
# 사용법:
#   ./08.5-retry-errors.sh --channel tzuyang --data-path data/tzuyang

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# 색상 코드
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[$(date '+%H:%M:%S')] ℹ️  $1${NC}"; }
log_success() { echo -e "${GREEN}[$(date '+%H:%M:%S')] ✅ $1${NC}"; }
log_warning() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠️  $1${NC}"; }
log_error() { echo -e "${RED}[$(date '+%H:%M:%S')] ❌ $1${NC}" >&2; }

# 인자 파싱
CHANNEL=""
DATA_PATH=""
while [[ $# -gt 0 ]]; do
    case $1 in
        --channel|-c) CHANNEL="$2"; shift 2 ;;
        --data-path) DATA_PATH="$2"; shift 2 ;;
        *) echo "알 수 없는 옵션: $1"; exit 1 ;;
    esac
done

if [ -z "$CHANNEL" ] || [ -z "$DATA_PATH" ]; then
    echo "사용법: $0 --channel <채널명> --data-path <데이터경로>"
    exit 1
fi

FULL_DATA_PATH="$PROJECT_ROOT/$DATA_PATH"
ERRORS_DIR="$FULL_DATA_PATH/evaluation/errors"
LAAJ_RESULTS_DIR="$FULL_DATA_PATH/evaluation/laaj_results"

if [ ! -d "$ERRORS_DIR" ]; then
    log_info "에러 폴더 없음: $ERRORS_DIR"
    exit 0
fi

ERROR_COUNT=$(ls -1 "$ERRORS_DIR"/*.jsonl 2>/dev/null | wc -l | tr -d ' ')

if [ "$ERROR_COUNT" -eq 0 ]; then
    log_info "재시도할 에러 파일 없음"
    exit 0
fi

log_info "============================================================"
log_info "  LAAJ 평가 재시도: $CHANNEL"
log_info "============================================================"
log_info "에러 파일 수: $ERROR_COUNT 개"

# 에러 파일 이동 (재처리를 위해)
RETRY_COUNT=0
for error_file in "$ERRORS_DIR"/*.jsonl; do
    if [ -f "$error_file" ]; then
        VIDEO_ID=$(basename "$error_file" .jsonl)
        
        # 성공 파일이 없으면 에러 파일 삭제 (재처리 대상)
        if [ ! -f "$LAAJ_RESULTS_DIR/${VIDEO_ID}.jsonl" ]; then
            rm "$error_file"
            RETRY_COUNT=$((RETRY_COUNT + 1))
            log_info "재시도 대상: $VIDEO_ID"
        fi
    fi
done

log_info "재시도 대상: $RETRY_COUNT 개"

if [ "$RETRY_COUNT" -eq 0 ]; then
    log_success "모든 에러가 이미 성공으로 처리됨"
    exit 0
fi

# 평가 스크립트 실행
log_info "LAAJ 평가 재시작..."
"$SCRIPT_DIR/08-gemini-evaluation.sh" --channel "$CHANNEL" --data-path "$DATA_PATH"

log_success "재시도 완료"
