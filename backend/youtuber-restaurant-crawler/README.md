# 📺 유튜버 맛집 크롤러 (정육왕)

유튜버 채널에서 맛집 정보를 크롤링하여 데이터베이스에 저장하는 시스템입니다.

## 🎯 대상 유튜버

- **정육왕 MeatCreator**: https://www.youtube.com/@meatcreator

## 📋 기능

1. **영상 목록 수집**: YouTube Data API로 채널의 모든 영상 수집
2. **지도 URL 추출**: 영상 description에서 구글/네이버/카카오 지도 URL 추출
3. **자막 수집**: Puppeteer로 maestra.ai / tubetranscript.com에서 자막 수집
4. **Gemini AI 분석**: 영상 내용에서 맛집 정보 추출 (OAuth 인증 + 웹 검색)
5. **지오코딩**: 지도 URL 형태에 맞는 API로 좌표 변환
6. **DB 저장**: Supabase에 저장

### 🗺️ 지도 URL 형태별 좌표 추출

| 지도 형태       | 좌표 추출 방법                                |
| --------------- | --------------------------------------------- |
| **구글 지도**   | URL에서 `@lat,lng` 패턴 직접 추출             |
| **네이버 지도** | 카카오 키워드 검색 API (네이버 공개 API 없음) |
| **카카오 지도** | placeId로 카카오 API 조회                     |

좌표 추출 우선순위:
1. 지도 URL에서 직접 추출 (구글)
2. 카카오 주소 검색 API
3. 카카오 키워드 검색 API

## 🔧 환경 변수

`.env` 파일에 다음 환경 변수를 설정하세요:

```bash
# YouTube API
YOUTUBE_API_KEY=your_youtube_api_key

# 카카오 지오코딩
KAKAO_REST_API_KEY=your_kakao_rest_api_key

# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

> ⚠️ **참고**: Gemini CLI는 OAuth 인증을 사용하므로 `GEMINI_API_KEY`가 필요하지 않습니다.

## 📦 설치

```bash
cd backend/youtuber-restaurant-crawler
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

# 2. 주소 추출 및 Gemini 분석
npm run extract-addresses

# 3. 좌표 보완 (지오코딩)
npm run geocode

# 4. DB 저장
npm run insert-db
```

## 📁 디렉토리 구조

```
youtuber-restaurant-crawler/
├── .gemini/                              # Gemini CLI 설정
│   ├── oauth_creds.json                  # OAuth 토큰 (자동 갱신)
│   ├── settings.json                     # CLI 설정 (모델, previewFeatures)
│   ├── google_accounts.json              # 로그인된 Google 계정
│   ├── state.json                        # CLI 상태
│   └── installation_id                   # 설치 ID
├── data/
│   └── yy-mm-dd/
│       ├── meatcreator_videos.json       # 영상 목록
│       └── meatcreator_restaurants.jsonl # 추출된 맛집 데이터
├── prompts/
│   └── extract_restaurant.txt            # Gemini 프롬프트
├── scripts/
│   ├── crawl-channel.js                  # 채널 크롤링
│   ├── extract-addresses.js              # 주소 추출 + Gemini 분석
│   ├── enrich-coordinates.js             # 좌표 보완 (지오코딩)
│   ├── insert-to-supabase.js             # DB 저장
│   ├── gemini-oauth-manager.js           # OAuth 토큰 관리
│   └── pipeline.js                       # 전체 파이프라인
├── package.json
└── README.md
```

## 🔐 OAuth 인증

### 로컬 환경

1. Gemini CLI 설치:
   ```bash
   npm install -g @google/gemini-cli
   ```

2. 로그인:
   ```bash
   gemini
   # 브라우저에서 Google 계정 로그인
   ```

3. 설정 확인:
   - `~/.gemini/oauth_creds.json` 생성됨
   - `~/.gemini/settings.json`에서 `previewFeatures: true` 설정

### GitHub Actions

GitHub Actions에서는 자동으로 OAuth 토큰을 관리합니다:

1. **토큰 갱신**: 45분마다 자동 갱신 (`gemini-oauth-refresh.yml`)
2. **설정 복사**: `.gemini/` 폴더의 파일들을 `~/.gemini/`로 복사
3. **커밋**: 갱신된 `oauth_creds.json`을 자동 커밋

### 사용 모델

| 환경           | 모델             | 비고                       |
| -------------- | ---------------- | -------------------------- |
| 로컬 (Windows) | `gemini-3.0-pro` | ✅ 작동                     |
| GitHub Actions | `gemini-2.5-pro` | OAuth IP 제한으로 3.0 불가 |

> GitHub Actions에서 `gemini-3.0-pro`는 데이터센터 IP 차단으로 인해 사용 불가합니다.
> 자동 fallback으로 `gemini-2.5-pro`를 사용합니다.

## 🎬 자막 수집

Puppeteer를 사용하여 외부 서비스에서 자막을 수집합니다:

1. **1차**: [maestra.ai](https://maestra.ai) - YouTube 자막 추출
2. **2차**: [tubetranscript.com](https://tubetranscript.com) - Fallback

> `youtube-transcript` 패키지는 대부분의 영상에서 "Transcript is disabled" 오류가 발생하여 제거했습니다.

## 📊 데이터 흐름

```
YouTube Data API
    │
    ▼
[영상 목록 수집]
    │
    ▼
[Description에서 지도 URL 추출]
    │
    ▼
[Puppeteer로 자막 수집]
    │
    ▼
[Gemini AI 분석]
    │
    ├── 맛집 이름
    ├── 주소
    ├── 카테고리
    ├── 유튜버 리뷰
    └── 신뢰도
    │
    ▼
[카카오 API 지오코딩]
    │
    ├── 위도 (lat)
    └── 경도 (lng)
    │
    ▼
[Supabase 저장]
```

## 🔗 관련 워크플로우

- `youtube-restaurant-crawler.yml`: 메인 크롤링 파이프라인 (매주 일요일)
- `gemini-oauth-refresh.yml`: OAuth 토큰 자동 갱신 (45분마다)
