#!/usr/bin/env bash
# ============================================================
# 로컬 대용량 크롤링 스크립트
# ============================================================
#
# GitHub Actions는 경량 모드(메타/자막/enrichment/publication)만 처리하고,
# 프레임 추출(Step 4)과 Chunk Multimodal(Step 08) + 평가(Step 09-13)는
# 이 스크립트로 로컬 머신에서 실행한다.
#
# 사용법:
#   bash backend/run_local_heavy.sh
#   bash backend/run_local_heavy.sh --skip-frames   # Step 08만 실행
#   bash backend/run_local_heavy.sh --skip-chunk     # Step 4만 실행
#
# 전제 조건:
#   - backend/.env에 필요한 환경변수 설정
#   - cd backend && npm ci (Node 패키지)
#   - pip install -r backend/restaurant-crawling/scripts/requirements.txt
#
# 데이터는 data 브랜치에 직접 커밋/푸시된다.
# GitHub Actions의 경량 크롤러와 동일한 data 브랜치를 공유한다.
# ============================================================

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# 인자 파싱
SKIP_FRAMES=false
SKIP_CHUNK=false
for arg in "$@"; do
    case "$arg" in
        --skip-frames) SKIP_FRAMES=true ;;
        --skip-chunk)  SKIP_CHUNK=true ;;
        --help|-h)
            echo "Usage: bash backend/run_local_heavy.sh [--skip-frames] [--skip-chunk]"
            echo ""
            echo "  --skip-frames  Step 4 (프레임 추출) 건너뛰기"
            echo "  --skip-chunk   Step 08 (Chunk Multimodal) 건너뛰기"
            exit 0
            ;;
        *)
            echo "[ERROR] Unknown argument: $arg"
            exit 1
            ;;
    esac
done

# run_daily.sh를 대용량 모드(기본)로 호출
# SKIP_HEAVY_COMPUTE=false → 모든 단계 실행
export RUN_DAILY_SKIP_HEAVY_COMPUTE=false
export RUN_DAILY_TARGET_BRANCH=data
export RUN_DAILY_POLICY_MODE=end_to_end

# 개별 단계 건너뛰기는 환경변수로 전달
if [ "$SKIP_FRAMES" = "true" ]; then
    export RUN_DAILY_SKIP_FRAMES=true
fi
if [ "$SKIP_CHUNK" = "true" ]; then
    export RUN_DAILY_SKIP_CHUNK=true
fi

echo "============================================================"
echo " 쯔동여지도 로컬 대용량 크롤링"
echo "============================================================"
echo " 프레임 추출(Step 4):      $([ "$SKIP_FRAMES" = "true" ] && echo "건너뜀" || echo "실행")"
echo " Chunk Multimodal(Step 08): $([ "$SKIP_CHUNK" = "true" ] && echo "건너뜀" || echo "실행")"
echo " 데이터 브랜치:             $RUN_DAILY_TARGET_BRANCH"
echo "============================================================"
echo ""

exec bash backend/run_daily.sh
