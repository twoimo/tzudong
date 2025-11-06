#!/bin/bash

# Supabase Edge Function 배포 스크립트
# naver-geocode 함수를 배포합니다

echo "🚀 Supabase Edge Function 배포 시작..."

# 1. Supabase 로그인 확인
if ! supabase projects list &> /dev/null; then
    echo "❌ Supabase에 로그인되어 있지 않습니다."
    echo "다음 명령어로 로그인해주세요:"
    echo "  supabase login"
    exit 1
fi

echo "✅ Supabase 로그인 확인 완료"

# 2. 환경 변수 설정
echo "🔑 환경 변수 설정 중..."

# .env 파일에서 API 키 읽기
if [ -f .env ]; then
    source .env
    
    if [ -n "$VITE_NCP_MAPS_KEY_ID" ] && [ -n "$VITE_NCP_MAPS_KEY" ]; then
        supabase secrets set NAVER_NCP_MAPS_KEY_ID="$VITE_NCP_MAPS_KEY_ID"
        supabase secrets set NAVER_NCP_MAPS_KEY="$VITE_NCP_MAPS_KEY"
        echo "✅ 환경 변수 설정 완료"
    else
        echo "⚠️  .env 파일에 VITE_NCP_MAPS_KEY_ID 또는 VITE_NCP_MAPS_KEY가 없습니다."
        echo "수동으로 설정하려면 다음 명령어를 실행하세요:"
        echo "  supabase secrets set NAVER_NCP_MAPS_KEY_ID=<YOUR_KEY_ID>"
        echo "  supabase secrets set NAVER_NCP_MAPS_KEY=<YOUR_KEY>"
    fi
else
    echo "⚠️  .env 파일을 찾을 수 없습니다."
    echo "수동으로 환경 변수를 설정하려면 다음 명령어를 실행하세요:"
    echo "  supabase secrets set NAVER_NCP_MAPS_KEY_ID=<YOUR_KEY_ID>"
    echo "  supabase secrets set NAVER_NCP_MAPS_KEY=<YOUR_KEY>"
fi

# 3. Edge Function 배포
echo "📦 naver-geocode 함수 배포 중..."
supabase functions deploy naver-geocode

if [ $? -eq 0 ]; then
    echo "✅ 배포 성공!"
    echo ""
    echo "🎉 Edge Function이 성공적으로 배포되었습니다."
    echo "이제 관리자 페이지에서 재지오코딩 기능을 사용할 수 있습니다."
else
    echo "❌ 배포 실패"
    echo "문제가 발생했습니다. 로그를 확인해주세요."
    exit 1
fi
