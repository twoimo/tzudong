# 환경변수 설정 가이드

## Next.js 환경변수

`.env.local` 파일에 다음 환경변수를 추가하세요:

```env
# Google Maps
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here

# YouTube Data API
NEXT_PUBLIC_YOUTUBE_API_KEY=your_youtube_api_key_here

# Naver Maps
NEXT_PUBLIC_NAVER_MAP_CLIENT_ID=your_naver_client_id_here
NEXT_PUBLIC_NAVER_MAP_CLIENT_SECRET=your_naver_client_secret_here

# Naver Geocoding
NEXT_PUBLIC_NAVER_CLIENT_ID=your_naver_client_id_here
NEXT_PUBLIC_NAVER_CLIENT_SECRET=your_naver_client_secret_here

# Supabase (이미 설정되어 있을 수 있음)
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

## 주의사항

- `NEXT_PUBLIC_` 접두사가 붙은 환경변수만 클라이언트 사이드에서 접근 가능합니다
- 민감한 정보는 서버 사이드에서만 사용하세요
- `.env.local` 파일은 `.gitignore`에 추가되어 있어야 합니다
