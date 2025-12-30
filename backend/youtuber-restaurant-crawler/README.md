# 📺 YouTube Restaurant Crawler

유튜버 채널에서 맛집 정보를 크롤링하여 데이터베이스에 저장하는 시스템입니다.

## 🎯 대상 유튜버

- **정육왕 MeatCreator**: https://www.youtube.com/@meatcreator

## 📋 기능

1. **영상 목록 수집**: YouTube Data API로 채널의 모든 영상 수집
2. **주소 추출**: 영상 description에서 구글/네이버/카카오 지도 URL 추출
3. **자막 검증**: 자막과 교차 검사하여 정확도 향상
4. **Gemini AI 분석**: 영상 내용에서 맛집 정보 추출
5. **지오코딩**: 주소를 좌표로 변환
6. **DB 저장**: Supabase에 저장

## 🔧 환경 변수

`.env` 파일에 다음 환경 변수를 설정하세요:

```bash
# YouTube API
YOUTUBE_API_KEY=your_youtube_api_key

# Gemini CLI (API Key 방식)
GEMINI_API_KEY=your_gemini_api_key

# 카카오 지오코딩
KAKAO_REST_API_KEY=your_kakao_rest_api_key

# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# 네이버 지도 API
NAVER_CLIENT_ID=your_naver_client_id
NAVER_CLIENT_SECRET=your_naver_client_secret
```

## 📦 설치

```bash
cd backend/youtube-restaurant-crawler
npm install
```

## 🚀 실행

### 전체 파이프라인
```bash
npm run pipeline
```

### 개별 단계
```bash
# 1. 채널 영상 목록 수집
npm run crawl

# 2. 주소 추출 및 검증
npm run extract-addresses

# 3. DB 저장
npm run insert-db
```

## 📁 디렉토리 구조

```
youtube-restaurant-crawler/
├── data/
│   └── yy-mm-dd/
│       ├── meatcreator_videos.json       # 영상 목록
│       ├── meatcreator_addresses.jsonl   # 추출된 주소
│       └── meatcreator_restaurants.jsonl # 최종 맛집 데이터
├── prompts/
│   └── extract_restaurant.txt            # Gemini 프롬프트
├── scripts/
│   ├── crawl-channel.js                  # 채널 크롤링
│   ├── extract-addresses.js              # 주소 추출
│   ├── validate-with-transcript.js       # 자막 검증
│   ├── insert-to-supabase.js             # DB 저장
│   ├── gemini-oauth-manager.js           # OAuth 토큰 관리
│   └── pipeline.js                       # 전체 파이프라인
├── package.json
└── README.md
```

## 🔐 OAuth 인증 (GitHub Actions)

GitHub Actions에서 실행 시 `oauth_creds.json` 파일을 사용합니다:

1. 로컬에서 `gemini` 명령어로 로그인
2. `~/.gemini/oauth_creds.json` 파일을 `backend/oauth_creds.json`에 복사
3. GitHub Actions에서 자동으로 토큰 갱신 및 커밋
