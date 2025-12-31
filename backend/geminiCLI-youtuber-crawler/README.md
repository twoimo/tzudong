# 📺 유튜버 맛집 크롤러 (정육왕)

유튜버 채널에서 맛집 정보를 크롤링하여 데이터베이스에 저장하는 시스템입니다.

## 🎯 대상 유튜버

- **정육왕 MeatCreator**: https://www.youtube.com/@meatcreator

## 📋 기능

1. **영상 목록 수집**: YouTube Data API로 채널의 모든 영상 수집
2. **지도 URL 추출**: 영상 description에서 구글/네이버/카카오 지도 URL 추출
3. **자막 수집 (Phase 1)**: Puppeteer 병렬 3개로 maestra.ai / tubetranscript.com에서 자막 수집
4. **Gemini AI 분석 (Phase 2)**: 수집된 자막으로 맛집 정보 추출 (병렬 10개)
   - **지도 URL이 없어도** 자막/제목/설명에서 맛집 추출
   - 웹 검색으로 정확한 상호명/주소 확인
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
cd backend/geminiCLI-youtuber-crawler
npm install
```

## 🚀 실행

### 전체 파이프라인 (권장)
```bash
bun run full
```

### 개별 단계 (2-Phase 구조)
```bash
# 1. 채널 영상 목록 수집
bun run crawl

# 2. Phase 1: 자막 수집 (Puppeteer 병렬 3개)
bun run transcripts

# 3. Phase 2: Gemini 분석 (병렬 10개)
bun run extract

# 4. 좌표 보완 (지오코딩)
bun run geocode

# 5. DB 저장
bun run insert
```

## 📁 디렉토리 구조

```
geminiCLI-youtuber-crawler/
├── .gemini/                              # Gemini CLI 설정
│   ├── oauth_creds.json                  # OAuth 토큰 (자동 갱신)
│   ├── settings.json                     # CLI 설정 (모델, previewFeatures)
│   ├── google_accounts.json              # 로그인된 Google 계정
│   ├── state.json                        # CLI 상태
│   └── installation_id                   # 설치 ID
├── data/
│   └── yy-mm-dd/
│       ├── meatcreator_videos.json       # 영상 목록
│       ├── transcripts.jsonl             # 수집된 자막 (Phase 1)
│       └── meatcreator_restaurants.jsonl # 추출된 맛집 데이터 (Phase 2)
├── prompts/
│   └── extract_restaurant.txt            # Gemini 프롬프트
├── scripts/
│   ├── crawl-channel.js                  # 채널 크롤링
│   ├── collect-transcripts.js            # Phase 1: 자막 수집 (Puppeteer)
│   ├── extract-addresses.js              # Phase 2: Gemini 분석 (자막 로드)
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

1. **자동 토큰 갱신**: Gemini CLI가 access_token 만료 시 자동으로 refresh_token으로 갱신
2. **설정 복사**: `.gemini/` 폴더의 파일들을 `~/.gemini/`로 복사
3. **커밋**: 갱신된 `oauth_creds.json`을 자동 커밋

#### 토큰 수명

| 토큰 종류 | 수명 | 비고 |
| ---- | ---- | ---- |
| `access_token` | 1시간 | CLI가 자동 갱신 |
| `refresh_token` | 6개월 미사용 시 | 매일 실행으로 유지 |

> ⚠️ **주의**: OAuth consent screen이 "Testing" 상태면 refresh_token이 7일 만료됩니다. 프로덕션으로 게시하세요.

### 사용 모델

| 환경 | 모델 | 비고 |
| ---- | ---- | ---- |
| GitHub Actions | `gemini-3-pro-preview` | 안정성 우선 |
| 로컬 | `gemini-3-pro-preview` → `gemini-3-flash-preview` | Fallback 지원 |

> 쿼타 소진 시 자동으로 다음 모델로 전환. 사용 가능한 모델만 미리 필터링.

### Gemini CLI 도구

| 도구 | 용도 |
| ---- | ---- |
| `web_fetch` | 지도 URL에서 직접 상호명/주소 추출 |
| `google_web_search` | 웹 검색으로 정보 보완 |

## ⚡ Rate Limiting & 병렬 처리

### Google AI Pro 구독자 기준

| 항목 | 제한 | 안전 마진 적용 |
| ---- | ---- | -------------- |
| RPM  | 120  | 60             |
| RPD  | 1500 | 1000           |

### 병렬 처리 (2-Phase 분리)

| Phase | 환경 | 동시 처리 수 | 비고 |
| ----- | ---- | ------------ | ---- |
| Phase 1 (자막) | 로컬 | 3개 | Puppeteer 브라우저 재사용 |
| Phase 1 (자막) | GitHub Actions | 1개 | 리소스 제한 |
| Phase 2 (Gemini) | 공통 | 10개 | 자막 수집 분리 후 증가 |

- **RPM 자동 조절**: 분당 60개 초과 시 대기
- **RPD 초과 시**: 자동 종료 + 데이터 저장

### 쿼타 리셋 대기
- **30분 이하**: 즉시 대기 후 재시도
- **1시간 이내**: 모든 모델 소진 시 대기
- **1시간 초과**: 프로세스 종료

## 🚀 성능 최적화

| 영역 | 최적화 내용 | 효과 |
| ---- | ----------- | ---- |
| File I/O | 50개마다 저장 | **90% 감소** |
| Rate Stats | 10개마다 저장 | **90% 감소** |
| Puppeteer | 모듈 1회 캐싱 | 오버헤드 제거 |
| 중복 방지 | Map 기반 저장 | 데이터 무결성 |
| 로그 출력 | 중복 필터링 + debug 숨김 | 가독성 향상 |

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
[영상 목록 수집] ─────────────────────┐
    │                                 │
    ▼                                 │
[Description에서 지도 URL 추출]       │
    │                                 │
    ▼                                 │
┌─────────────────────────────────────┘
│   Phase 1: 자막 수집 (Puppeteer 병렬 3개)
│   └── transcripts.jsonl 저장
│
└─► Phase 2: Gemini AI 분석 (병렬 10개)
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

## 🔗 GitHub Actions 워크플로우

### 파일 구조

```
.github/workflows/
└── daily-extract.yml    # 매일 KST 오전 6시 자동 실행
```

### 필요한 GitHub Secrets

| Secret | 설명 |
| ------ | ---- |
| `KAKAO_REST_API_KEY` | 카카오 지도 API |
| `SUPABASE_URL` | Supabase URL |
| `SUPABASE_ANON_KEY` | Supabase 키 |

### 최초 설정

1. 로컬에서 `gemini` 명령어로 로그인
2. `.gemini/oauth_creds.json` 커밋
3. 이후 GitHub Actions가 자동으로 토큰 갱신 및 커밋

## ⚡ 실행 모드

| 모드  | 설명             | 중간 커밋 | 권장 상황   |
| ----- | ---------------- | --------- | ----------- |
| **1** | 영상 목록 수집만 | ✅         | 테스트용    |
| **2** | 맛집 추출만      | ✅         | 이어서 처리 |
| **3** | 좌표 보완만      | ✅         | 좌표만 필요 |
| **4** | DB 저장만        | ❌         | 최종 단계만 |
| **5** | 전체 한번에      | ❌         | ⭐ 시간 절약 |

> **💡 349분 제한 상황**: Mode 5 권장 (중간 커밋 없어서 가장 빠름)

## 🍞 Bun 런타임

npm/Node.js 대신 **Bun**을 사용하여 3~5배 빠른 실행:

```bash
# 패키지 설치
bun install

# 전체 파이프라인
bun run full

# 개별 실행
bun run crawl    # 영상 수집
bun run extract  # 맛집 추출
bun run geocode  # 좌표 보완
bun run insert   # DB 저장
```

## 🔄 이어서 처리 기능

### 중간 저장 및 커밋

GitHub Actions에서 각 Phase 완료 후 자동 커밋되어 **중단 시 이어서 처리** 가능:

| Phase | 설명           | 커밋 파일                       |
| ----- | -------------- | ------------------------------- |
| 1     | 영상 목록 수집 | `meatcreator_videos.json`       |
| 2     | 맛집 정보 추출 | `meatcreator_restaurants.jsonl` |
| 3     | 좌표 보완      | `meatcreator_restaurants.jsonl` |
| 4     | DB 저장        | 없음 (Supabase에 직접 저장)     |

### 이미 처리된 영상 스킵

`extract-addresses.js`에서 **이미 처리된 영상 자동 스킵**:

```
📊 기존 처리된 영상: 150개 (이어서 처리)
[151/457] 처리 중: ...
```

### Description 변경 감지

영상의 description이 변경된 경우 **자동 재처리**:

```
[100/457] 📝 description 변경 감지 - 재처리: ...
```

변경 감지 기준:
- Description 앞 100자
- Description 길이
- 지도 URL 포함 여부

### 수동 재처리

특정 단계부터 다시 시작하려면:

```bash
# GitHub Actions에서
- start_from: "2"  # 추출부터 시작 (영상 목록 유지)
- start_from: "3"  # 좌표 보완부터 시작
- start_from: "4"  # DB 저장만 실행
```

## 🌐 웹 검색 (YOLO Mode)

Gemini CLI의 `--yolo` 옵션을 통해 **웹 검색 자동 활성화**:

1. Gemini가 맛집 정보 분석 시 Google 웹 검색 수행
2. 정확한 상호명/주소/전화번호 확인
3. 지도 URL 정보(좌표, placeId 등)를 활용한 검색

### YOLO Mode 설정

- `settings.json`: `"tools": { "autoApprove": true }`
- CLI 호출: `gemini ... --yolo`
