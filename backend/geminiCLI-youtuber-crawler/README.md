# 📺 유튜버 맛집 크롤러

유튜버 채널에서 맛집 정보를 자동 수집하여 Supabase에 저장하는 파이프라인입니다.

## 🎯 대상 채널

- **정육왕 MeatCreator**: https://www.youtube.com/@meatcreator

---

## 🚀 빠른 시작

```bash
# 전체 파이프라인 실행
bun run full

# 상세 로그 포함
DEBUG=true bun run full

# 특정 단계부터 시작
node scripts/pipeline.js --start-from=2    # AI 분석부터
node scripts/pipeline.js --start-from=1.5  # 자막 수집부터
```

---

## 📦 파이프라인 구조

```
Phase 1: 채널 크롤링
└── crawl-channel.js (YouTube API로 영상 목록 수집)
        │
        ▼
Phase 1.5 & 1.6: 병렬 실행 ⚡
├── collect-transcripts.js (자막 수집)
└── collect-place-info.js  (네이버/카카오/구글 맵 URL에서 장소 정보 수집)
        │
        ▼
Phase 2: AI 분석
└── extract-addresses.js (Gemini CLI로 맛집 정보 추출)
    ├── 장소 데이터 있음 → extract_with_place_data.txt
    └── 장소 데이터 없음 → extract_without_place_data.txt (자막/설명에서 직접 추출)
        │
        ▼
Phase 3: 좌표 보완
└── enrich-coordinates.js (Kakao API 지오코딩)
        │
        ▼
Phase 4: DB 저장
└── insert-to-supabase.js
```

---

## 📋 주요 기능

| 기능 | 설명 |
|------|------|
| 영상 수집 | YouTube Data API로 채널 영상 목록 수집 (캐시 4시간) |
| 자막 수집 | Puppeteer로 외부 서비스에서 자막 수집 |
| 장소 정보 수집 | 네이버/카카오/구글 맵 URL에서 상세 정보 직접 추출 |
| AI 분석 | Gemini CLI (OAuth)로 맛집 정보 및 리뷰 추출 |
| 좌표 보완 | 카카오 API로 지오코딩 |
| DB 저장 | Supabase Upsert |

---

## 🔧 환경 변수

`.env` 파일에 설정:

```bash
# YouTube
YOUTUBE_API_KEY=your_key

# 카카오 (지오코딩 + 장소 검색)
KAKAO_REST_API_KEY=your_key

# 네이버 (장소 검색, 선택)
NAVER_CLIENT_ID=your_id
NAVER_CLIENT_SECRET=your_secret

# Supabase
SUPABASE_URL=your_url
SUPABASE_SERVICE_ROLE_KEY=your_key
```

> ⚠️ Gemini CLI는 OAuth 인증 사용 (`GEMINI_API_KEY` 불필요)

---

## 📁 디렉토리 구조

```
geminiCLI-youtuber-crawler/
├── scripts/
│   ├── pipeline.js              # 전체 파이프라인 오케스트레이터
│   ├── crawl-channel.js         # 채널 영상 수집
│   ├── collect-transcripts.js   # 자막 수집 (Puppeteer)
│   ├── collect-place-info.js    # 맵 URL에서 장소 정보 수집
│   ├── url-extractor.js         # URL 파싱 및 API 검색 유틸
│   ├── extract-addresses.js     # Gemini AI 분석
│   ├── enrich-coordinates.js    # 좌표 보완
│   ├── insert-to-supabase.js    # DB 저장
│   ├── gemini-oauth-manager.js  # OAuth 토큰 관리
│   └── check-quality.js         # 품질 검사
├── prompts/
│   ├── extract_with_place_data.txt     # 장소 데이터 있을 때 프롬프트
│   └── extract_without_place_data.txt  # 장소 데이터 없을 때 프롬프트
├── data/
│   ├── transcripts.jsonl        # 자막 캐시 (공유)
│   ├── place_info.jsonl         # 장소 정보 캐시 (공유)
│   └── yy-mm-dd/                # 날짜별 데이터
├── sql/
│   └── create_tables.sql        # DB 스키마
├── .env
└── package.json
```

---

## ⚡ 성능 최적화

| 항목 | 설명 |
|------|------|
| 병렬 실행 | 자막 + 장소 정보 동시 수집 (Phase 1.5 & 1.6) |
| 캐시 재사용 | 자막/장소 정보 날짜 무관 공유 |
| 스킵 로직 | 이미 수집된 영상은 자동 스킵 |
| URL 좌표 추출 | 맵 URL 파라미터에서 좌표 직접 추출 |
| Apollo Fallback | 네이버 지도 DOM 추출 실패 시 내부 상태 직접 조회 |
| API Fallback | 크롤링 실패 시 Kakao/Naver API로 자동 전환 |
| 404 페이지 감지 | 삭제된 네이버 맵 URL 자동 스킵 |
| 재시도 로직 | 실패 URL 동시성 1로 마지막 재시도 |
| Gemini 재시도 | 모델당 3회 재시도 + 전체 완료 후 실패 영상 재시도 (동시성 1) |

---

## 🔐 Gemini OAuth 설정

```bash
# 1. CLI 설치
npm install -g @google/gemini-cli

# 2. 로그인
gemini
# 브라우저에서 Google 계정 로그인

# 3. 확인
cat ~/.gemini/oauth_creds.json
```

---

## 🛠️ npm 스크립트

| 명령어 | 설명 |
|--------|------|
| `bun run full` | 전체 파이프라인 |
| `bun run crawl` | 영상 수집 |
| `bun run transcripts` | 자막 수집 |
| `bun run places` | 장소 정보 수집 |
| `bun run extract` | AI 분석 |
| `bun run geocode` | 좌표 보완 |
| `bun run insert` | DB 저장 |
| `bun run quality` | 품질 검사 |

---

## 📊 출력 데이터 필드

| 필드 | 설명 |
|------|------|
| name | 맛집 이름 |
| address | 도로명 주소 |
| address_jibun | 지번 주소 |
| phone | 전화번호 |
| category | 카테고리 (고기, 한식, 양식 등) |
| lat, lng | 좌표 |
| youtuber_review | 유튜버 리뷰 요약 |
| signature_menu | 대표 메뉴 |
| price_range | 가격대 |
| video_type | 맛집탐방/먹방/리뷰/기타 |

---

## 🐛 트러블슈팅

### 장소 정보 수집 매번 반복될 때
- 이전 버전에서는 `hasPlaceInfo: false` 영상이 저장되지 않아 매번 재처리됨
- 현재 버전에서는 모든 결과가 저장되어 스킵됨

### Gemini CLI 타임아웃
- 기본 타임아웃 90초 설정
- 타임아웃 시 다른 모델로 자동 전환 (Flash → Pro)

### 네이버 404 페이지
- "요청하신 페이지를 찾을 수 없습니다" 자동 감지
- 스킵 처리 후 Gemini가 자막/설명에서 직접 추출
