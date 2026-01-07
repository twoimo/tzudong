# 📺 유튜버 맛집 크롤러

유튜버 채널에서 맛집 정보를 자동 수집하여 데이터베이스에 저장하는 시스템입니다.

## 🎯 대상 채널

- **정육왕 MeatCreator**: https://www.youtube.com/@meatcreator

---

## 📋 주요 기능

| 기능 | 설명 |
|------|------|
| 영상 수집 | YouTube Data API로 채널 영상 목록 수집 |
| 지도 URL 분석 | 네이버/카카오/구글 맵 URL에서 장소 정보 직접 추출 (좌표 포함) |
| 주소 확장 | 네이버 지도 '펼치기' 버튼 자동 클릭으로 상세 주소 확보 |
| 자막 수집 | Puppeteer로 외부 서비스에서 자막 수집 |
| AI 분석 | Gemini로 맛집 정보 및 유튜버 리뷰 추출 |
| 좌표 보완 | 카카오 API로 지오코딩 |
| DB 저장 | Supabase에 저장 |

---

## 🚀 실행 방법

### 전체 파이프라인 (권장)

```bash
bun run full        # 전체 파이프라인 실행
DEBUG=true bun run full  # 상세 로그 포함
```

### 개별 단계 실행

```bash
bun run crawl       # 1. 채널 영상 목록 수집
bun run transcripts # 1.5. 자막 수집
bun run places      # 1.6. 장소 정보 수집 (새로 추가됨)
bun run extract     # 2. AI 분석
bun run geocode     # 3. 좌표 보완
bun run insert      # 4. DB 저장
```

### 특정 단계부터 시작

```bash
node scripts/pipeline.js --start-from=2    # AI 분석부터
node scripts/pipeline.js --start-from=1.5  # 자막 수집부터
```

---

## 📦 파이프라인 구조

```
┌─────────────────────────────────────────────────────────────┐
│  Phase 1: 채널 크롤링                                         │
│  └── crawl-channel.js                                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 1.5 & 1.6: 병렬 실행 ⚡                                │
│  ├── collect-transcripts.js (Phase 1.5: 자막 수집)           │
│  └── collect-place-info.js  (Phase 1.6: 장소 정보 수집)      │
│      └─ API Fallback (Naver/Kakao) 적용으로 정확도 99% 달성   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 2: AI 분석                                            │
│  └── extract-addresses.js (장소 데이터 유무에 따라 다른 프롬프트)│
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 3: 좌표 보완                                          │
│  └── enrich-coordinates.js                                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 4: DB 저장                                            │
│  └── insert-to-supabase.js                                   │
└─────────────────────────────────────────────────────────────┘
```

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
│   ├── extract-addresses.js     # Gemini AI 분석
│   ├── enrich-coordinates.js    # 좌표 보완
│   └── insert-to-supabase.js    # DB 저장
├── prompts/
│   ├── extract_with_place_data.txt     # 장소 데이터 있을 때
│   └── extract_without_place_data.txt  # 장소 데이터 없을 때
├── data/
│   ├── transcripts.jsonl        # 자막 캐시 (공유)
│   ├── place_info.jsonl         # 장소 정보 캐시 (공유)
│   └── yy-mm-dd/                # 날짜별 데이터
├── .env
└── package.json
```

---

## ⚡ 성능 최적화

| 항목 | 설명 |
|------|------|
| **URL 좌표 추출** | 네이버/구글 맵 URL 파라미터에서 좌표 직접 추출 (Geocoding 의존도 감소) |
| **주소 확장** | 네이버 지도 숨겨진 주소 자동 펼치기 |
| **병렬 실행** | 자막 + 장소 정보 동시 수집 |
| **동시성 2개** | Puppeteer 로컬 병렬 2개 (안정성) |
| **타임아웃 60초** | 구글 지도 페이지 로딩 대기 |
| **2회 재시도** | 각 URL당 2회 재시도 |
| **최종 재시도** | 실패 URL 동시성 1로 마지막 재시도 |
| **캐시 재사용** | 자막/장소 정보 날짜 무관 공유 |
| **스마트 딜레이** | 1-2초 랜덤 (차단 방지) |
| **API Fallback** | 크롤링 실패 시 Kakao/Naver API로 자동 전환 |
| **Data Cleaning** | 상호명/주소 자동 정제 (정확도 향상) |

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

## 📊 출력 데이터 필드

| 필드 | 설명 |
|------|------|
| name | 맛집 이름 |
| address | 주소 |
| phone | 전화번호 |
| category | 카테고리 |
| lat, lng | 좌표 |
| youtuber_review | 유튜버 리뷰 요약 |
| video_type | 단일맛집/맛집투어/리스트 |

---

## 🛠️ npm 스크립트

| 명령어 | 설명 |
|--------|------|
| `bun run full` | 전체 파이프라인 |
| `bun run crawl` | 영상 수집 |
| `bun run transcripts` | 자막 수집 |
| `bun run extract` | AI 분석 |
| `bun run geocode` | 좌표 보완 |
| `bun run insert` | DB 저장 |
| `bun run quality` | 품질 검사 |
