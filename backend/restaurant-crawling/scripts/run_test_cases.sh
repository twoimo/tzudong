#!/bin/bash
# 테스트 케이스 실행 스크립트 (run_test_cases.sh)
# 목적: 05-extract-frames.py 스크립트의 다양한 옵션 조합 테스트

# 공통 설정
URL="https://www.youtube.com/watch?v=-1OU4tkFJns"
SCRIPT="05-extract-frames.py"

echo "============================================================"
echo "🚀 프레임 추출 및 히트맵 저장 테스트 시작"
echo "대상 영상: $URL"
echo "============================================================"

# Case 1: 1 FPS, 버퍼 0 (피크만), 480p -> high_res_frames/<VIDEO_ID>/0/480p_1.0fps
echo ""
echo "▶️ [Case 1] FPS: 1, 버퍼: 0초, 화질: 480p"
/c/Users/twoimo/anaconda3/python.exe $SCRIPT --url "$URL" --fps 1 --buffer 0 --quality 480p

# Case 2: 2 FPS, 버퍼 0 (피크만), 480p -> high_res_frames/<VIDEO_ID>/0/480p_2.0fps
echo ""
echo "▶️ [Case 2] FPS: 2, 버퍼: 0초, 화질: 480p"
/c/Users/twoimo/anaconda3/python.exe $SCRIPT --url "$URL" --fps 2 --buffer 0 --quality 480p

# Case 3: 1 FPS, 버퍼 0 (피크만), 720p -> high_res_frames/<VIDEO_ID>/0/720p_1.0fps
echo ""
echo "▶️ [Case 3] FPS: 1, 버퍼: 0초, 화질: 720p"
/c/Users/twoimo/anaconda3/python.exe $SCRIPT --url "$URL" --fps 1 --buffer 0 --quality 720p

# Case 4: 2 FPS, 버퍼 0 (피크만), 720p -> high_res_frames/<VIDEO_ID>/0/720p_2.0fps
echo ""
echo "▶️ [Case 4] FPS: 2, 버퍼: 0초, 화질: 720p"
/c/Users/twoimo/anaconda3/python.exe $SCRIPT --url "$URL" --fps 2 --buffer 0 --quality 720p

echo ""
echo "============================================================"
echo "✅ 모든 테스트 케이스 실행 완료"
echo "결과 확인 경로:"
echo "  1. 프레임: backend/restaurant-crawling/data/manual/high_res_frames/<VIDEO_ID>"
echo "  2. 히트맵: backend/restaurant-crawling/data/manual/heatmap/<VIDEO_ID>.jsonl"
echo "============================================================"
