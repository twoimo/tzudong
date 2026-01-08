# 🍜 Tzudong Pipeline v2.0

**YouTube 맛집 데이터 자동화 파이프라인 - 통합 리팩토링 버전**

기존 중복되고 비효율적인 파이프라인을 브랜치 기반 병렬 처리 구조로 전면 개편한 시스템입니다.

---

## 📚 목차

- [시스템 개요](#-시스템-개요)
- [아키텍처 개선사항](#-아키텍처-개선사항)
- [전체 파이프라인 흐름](#-전체-파이프라인-흐름)
- [브랜치별 상세 설명](#-브랜치별-상세-설명)
- [데이터 스키마](#-데이터-스키마)
- [디렉토리 구조](#-디렉토리-구조)
- [설치 및 설정](#-설치-및-설정)
- [실행 방법](#-실행-방법)
- [API 명세](#-api-명세)
- [GitHub Actions 워크플로우](#-github-actions-워크플로우)
- [마이그레이션 가이드](#-마이그레이션-가이드)

---

## 🎯 시스템 개요

### 목적

유튜버(쯔양) 채널의 영상에서 방문한 맛집 정보를 자동으로 수집, 검증, 평가하여 데이터베이스에 저장하는 통합 파이프라인입니다.

### v2.0 주요 특징

| 항목        | v1.0 (backup) | v2.0 (신규)                    |
| ----------- | ------------- | ------------------------------ |
| 구조        | 순차 처리     | 브랜치 기반 병렬 처리          |
| 실행 환경   | 로컬 중심     | GitHub Actions + Oracle Cloud  |
| 데이터 수집 | 일회성        | 주기적 수집 (메타/자막/히트맵) |
| 중복 처리   | 파일별 분산   | 통합 trace_id 기반             |
| 저장소      | Supabase 단일 | Oracle DB + Supabase 연동      |
| 인증        | API Key 기반  | OAuth 2.0                      |
| 식별자      | unique_id     | trace_id                       |

### 핵심 개선 사항

- ✅ **브랜치 병렬 처리**: 메타데이터, 자막, 히트맵 동시 수집
- ✅ **주기적 수집 체계**: video_id 별 최신 데이터 자동 갱신
- ✅ **UI 실시간 반영**: 수집된 최신 데이터가 프론트엔드에 즉시 반영
- ✅ **코드 중복 제거**: 분산된 유틸리티 통합
- ✅ **전화번호 필드 삭제**: 개인정보 보호
- ✅ **OAuth 인증**: 보안 강화

---

## 🏗️ 아키텍처 개선사항

### 기존 구조 (v1.0) 문제점

```
❌ 순차 실행으로 인한 병목
❌ 각 모듈별 중복 코드 (geminiCLI-crawling, geminiCLI-evaluation 등)
❌ 날짜별 폴더 관리의 복잡성
❌ 단일 실행 환경 의존
❌ 중복 검사 로직 분산
```

### 신규 구조 (v2.0) 개선점

```
✅ 브랜치 병렬 처리로 처리 시간 단축
✅ 통합 스크립트로 코드 중복 제거
✅ trace_id 기반 통합 추적
✅ GitHub Actions + Oracle Cloud 분산 실행
✅ 중앙화된 중복 처리 시스템
```

---

## 🔄 전체 파이프라인 흐름

```
                          ┌─────────────────────────────────────┐
                          │         YouTube Channel             │
                          │           (채널 ID)                 │
                          └─────────────────┬───────────────────┘
                                            │
                          ┌─────────────────▼───────────────────┐
                          │         🔀 BRANCH 1                 │
                          │       (GitHub Actions)              │
                          ├─────────────────────────────────────┤
                          │  • youtube_link 수집 (채널 ID)      │
                          │  • 메타데이터 수집                  │
                          │    - 조회수, 좋아요, 댓글수         │
                          │    - OpenAI API 광고 분석           │
                          │  • 주기적 갱신 지원                 │
                          └─────────────────┬───────────────────┘
                                            │
                                     ┌──────┴──────┐
                                     │   MERGE     │
                                     └──────┬──────┘
                                            │
              ┌─────────────────────────────┼─────────────────────────────┐
              │                             │                             │
              ▼                             ▼                             ▼
┌─────────────────────────┐   ┌─────────────────────────┐   ┌─────────────────────────┐
│     🔀 BRANCH 2         │   │     🔀 BRANCH 3         │   │     🔀 BRANCH 4         │
│      (Oracle)           │   │      (Oracle)           │   │      (Oracle)           │
├─────────────────────────┤   ├─────────────────────────┤   ├─────────────────────────┤
│  • Description URL 추출 │   │  • 자막 수집            │   │  • 히트맵 마커 수집     │
│  • Puppeteer 네이버지도 │   │  • youtube-transcript   │   │  • Most Replayed        │
│  • 맛집 위치 정보 확보  │   │  • 주기적 갱신          │   │  • 주기적 갱신          │
└───────────┬─────────────┘   └───────────┬─────────────┘   └───────────┬─────────────┘
            │                             │                             │
            └─────────────────────────────┼─────────────────────────────┘
                                          │
                                   ┌──────┴──────┐
                                   │   MERGE     │
                                   └──────┬──────┘
                                          │
                          ┌───────────────▼───────────────┐
                          │     📝 BRANCH 3-1             │
                          │   (GitHub Actions / Oracle)   │
                          ├───────────────────────────────┤
                          │  • 자막 교정                  │
                          │  • (BRANCH 3 merge 시 트리거) │
                          └───────────────┬───────────────┘
                                          │
                                   ┌──────┴──────┐
                                   │   MERGE     │
                                   └──────┬──────┘
                                          │
                          ┌───────────────▼───────────────┐
                          │     🤖 AI Processing          │
                          │   (GitHub Actions / Oracle)   │
                          ├───────────────────────────────┤
                          │  Step 1: geminiCLI 크롤링     │
                          │    - 채널 ID + 프롬프트       │
                          │    - description 유무 분기    │
                          │                               │
                          │  Step 2: geminiCLI 평가       │
                          │    - 채널 ID + 프롬프트       │
                          │    - 평가 모델 개선           │
                          │                               │
                          │  Step 3: Transform            │
                          │    - trace_id 생성            │
                          │    - 데이터 정규화            │
                          └───────────────┬───────────────┘
                                          │
                          ┌───────────────▼───────────────┐
                          │     💾 Database Insert        │
                          │         (Oracle DB)           │
                          ├───────────────────────────────┤
                          │  • Oracle DB 저장             │
                          │  • trace_id 중복 체크         │
                          │  • UI 최신 데이터 반영        │
                          └───────────────────────────────┘
```

---

## 📦 브랜치별 상세 설명

### 🔀 Branch 1: 메타데이터 수집 (GitHub Actions)

```mermaid
graph LR
    A[채널 ID] --> B[YouTube Data API]
    B --> C[video_id 목록]
    C --> D[메타데이터 추출]
    D --> E[OpenAI 광고 분석]
    E --> F[Oracle DB 저장]
```

**담당 작업:**
- YouTube 채널에서 모든 영상 URL 수집
- 영상별 메타데이터 추출 (title, publishedAt, duration, viewCount 등)
- OpenAI API를 통한 광고 영상 자동 판별
- 주기적 갱신으로 최신 조회수/좋아요 반영

**입력:**
- `channel_id`: YouTube 채널 ID (예: UCfpaSruWW3S4zzK8lwj1dRQ)

**출력:**
```json
{
  "video_id": "abc123",
  "youtube_link": "https://www.youtube.com/watch?v=abc123",
  "title": "쯔양의 맛집 투어",
  "published_at": "2025-01-08T10:00:00Z",
  "duration": 1200,
  "view_count": 1500000,
  "like_count": 85000,
  "comment_count": 3200,
  "is_shorts": false,
  "is_ads": false,
  "what_ads": null,
  "collected_at": "2025-01-08T15:30:00Z"
}
```

---

### 🔀 Branch 2: 네이버지도 크롤링 (Oracle)

```mermaid
graph LR
    A[Description URL] --> B[Puppeteer]
    B --> C[네이버지도 접속]
    C --> D[맛집 정보 추출]
    D --> E[좌표/주소 파싱]
    E --> F[Oracle DB 저장]
```

**담당 작업:**
- 영상 description에서 네이버지도 URL 추출
- Puppeteer를 통한 네이버지도 페이지 크롤링
- 맛집 이름, 주소, 좌표 정보 확보

**입력:**
- `video_id`: 영상 ID
- `description`: 영상 설명 텍스트

**출력:**
```json
{
  "video_id": "abc123",
  "naver_map_urls": ["https://naver.me/xxx"],
  "restaurants": [
    {
      "name": "산북동달구지",
      "address": "전라북도 군산시 산북동 123-45",
      "road_address": "전라북도 군산시 산북로 123",
      "lat": 35.9876,
      "lng": 126.7654,
      "category": "한식"
    }
  ]
}
```

---

### 🔀 Branch 3: 자막 수집 (Oracle)

```mermaid
graph LR
    A[video_id] --> B[youtube-transcript-api]
    B --> C[자막 추출]
    C --> D[타임스탬프 파싱]
    D --> E[Oracle DB 저장]
```

**담당 작업:**
- YouTube 영상의 자막 수집 (자동 생성 포함)
- 타임스탬프와 함께 텍스트 저장
- 주기적 갱신으로 자막 업데이트 감지

**입력:**
- `video_id`: 영상 ID

**출력:**
```json
{
  "video_id": "abc123",
  "language": "ko",
  "is_generated": false,
  "transcript": [
    {"start": 41.0, "duration": 3.5, "text": "(군산시 산북동)"},
    {"start": 80.0, "duration": 2.1, "text": "여기다 '산북동달구지'"},
    {"start": 232.0, "duration": 4.2, "text": "역대급으로 곱이 가득 차 있어요"}
  ],
  "full_text": "[00:41] (군산시 산북동)\n[01:20] 여기다 '산북동달구지'...",
  "collected_at": "2025-01-08T15:30:00Z"
}
```

---

### 🔀 Branch 3-1: 자막 교정 (GitHub Actions / Oracle)

**담당 작업:**
- Branch 3 merge 완료 시 트리거
- OCR 오류 및 자동 생성 자막 교정
- 맛집명, 주소 등 핵심 정보 정확도 향상

**교정 대상:**
- 음식점명 오탈자 (예: "산북동달구치" → "산북동달구지")
- 주소 표기 오류 (예: "군샨시" → "군산시")
- 특수문자 및 공백 정규화

---

### 🔀 Branch 4: 히트맵 수집 (Oracle)

```mermaid
graph LR
    A[video_id] --> B[YouTube API/Puppeteer]
    B --> C[Most Replayed 데이터]
    C --> D[히트맵 마커 추출]
    D --> E[Oracle DB 저장]
```

**담당 작업:**
- YouTube "Most Replayed" (가장 많이 다시 본 구간) 데이터 수집
- 히트맵 마커 타임스탬프 추출
- 인기 구간과 맛집 언급 구간 매핑

**출력:**
```json
{
  "video_id": "abc123",
  "heatmap_markers": [
    {"start_time": 45.0, "end_time": 60.0, "intensity": 0.95},
    {"start_time": 180.0, "end_time": 210.0, "intensity": 0.87}
  ],
  "collected_at": "2025-01-08T15:30:00Z"
}
```

---

### 🤖 AI Processing: GeminiCLI 크롤링 & 평가

#### Step 1: 크롤링

**프롬프트 분기:**
- Description에 맛집 정보가 있는 경우: 간략 추출 프롬프트
- Description에 맛집 정보가 없는 경우: 자막 기반 상세 추출 프롬프트

**입력:**
- `channel_id`: 채널 ID
- `video_id`: 영상 ID
- `transcript`: 교정된 자막
- `description`: 영상 설명
- `heatmap`: 히트맵 마커

**출력:**
```json
{
  "video_id": "abc123",
  "restaurants": [
    {
      "name": "산북동달구지",
      "address": "전라북도 군산시 산북동 123-45",
      "lat": null,
      "lng": null,
      "category": "한식",
      "tzuyang_review": "곱창이 진짜 푸짐하고 맛있어요",
      "reasoning_basis": "01:20 자막에서 '산북동달구지' 언급, 03:52 음식 리뷰"
    }
  ]
}
```

#### Step 2: 평가

**평가 항목:**
- `visit_authenticity`: 방문 진위 (1-5)
- `rb_inference_score`: 추론 근거 점수
- `rb_grounding_TF`: 근거 확인 여부
- `review_faithfulness_score`: 리뷰 신뢰도 (0-1)
- `category_TF`: 카테고리 정확도

#### Step 3: Transform

- `trace_id` 생성 (SHA-256 해시)
- 데이터 정규화 및 필터링
- 중복 제거 (trace_id 기준)

---

## 📊 데이터 스키마

### 주요 변경사항

| 필드           | v1.0 | v2.0           | 변경 사유        |
| -------------- | ---- | -------------- | ---------------- |
| `unique_id`    | ✅    | ❌ → `trace_id` | 명명 개선        |
| `phone`        | ✅    | ❌ 삭제         | 개인정보 보호    |
| `source_type`  | 필수 | 필수           | 유지             |
| `collected_at` | ❌    | ✅ 추가         | 주기적 수집 추적 |

### 최종 데이터 스키마 (restaurants)

```typescript
interface Restaurant {
  // 식별자
  trace_id: string;           // SHA-256 해시 (video_id + name + address)
  video_id: string;           // YouTube 영상 ID
  youtube_link: string;       // 전체 YouTube URL
  
  // 맛집 기본 정보
  name: string;               // 음식점명
  category: string | null;    // 카테고리 (한식, 중식 등)
  
  // 주소 정보
  address: string | null;     // 원본 주소
  road_address: string | null;  // 도로명 주소
  jibun_address: string | null; // 지번 주소
  lat: number | null;         // 위도
  lng: number | null;         // 경도
  
  // 리뷰 정보
  tzuyang_review: string | null;   // 쯔양 리뷰 요약
  reasoning_basis: string | null;  // 추론 근거 (타임스탬프)
  
  // YouTube 메타데이터
  youtube_meta: {
    title: string;
    published_at: string;
    duration: number;
    view_count: number;
    like_count: number;
    is_shorts: boolean;
    is_ads: boolean;
    what_ads: string[] | null;
  };
  
  // 평가 결과
  evaluation_results: {
    visit_authenticity: { values: number[]; missing: string[] };
    rb_inference_score: { values: number[] };
    rb_grounding_TF: { values: boolean[] };
    review_faithfulness_score: { values: number[] };
    category_TF: { values: boolean[] };
  } | null;
  
  // 상태 관리
  status: 'pending' | 'approved' | 'rejected';
  is_ads: boolean;
  is_missing: boolean;
  
  // 메타
  source_type: 'geminiCLI';
  created_at: string;
  updated_at: string;
  collected_at: string;       // 수집 시점 (주기적 갱신용)
}
```

---

## 📁 디렉토리 구조

```
tzudong_pipeline/
├── README.md                           # 📘 이 파일
├── .env.example                        # 환경 변수 템플릿
├── requirements.txt                    # Python 의존성
├── package.json                        # Node.js 의존성
│
├── scripts/                            # 🔧 실행 스크립트
│   ├── pipeline.py                     # 통합 파이프라인 실행기
│   │
│   ├── branch1/                        # Branch 1: 메타데이터
│   │   ├── collect_youtube_links.py    # YouTube URL 수집
│   │   ├── collect_metadata.py         # 메타데이터 수집
│   │   └── analyze_ads.py              # 광고 분석 (OpenAI)
│   │
│   ├── branch2/                        # Branch 2: 네이버지도
│   │   ├── extract_description_urls.py # Description URL 추출
│   │   └── crawl_naver_map.ts          # Puppeteer 크롤링
│   │
│   ├── branch3/                        # Branch 3: 자막
│   │   ├── collect_transcripts.py      # 자막 수집
│   │   └── correct_transcripts.py      # 자막 교정 (Branch 3-1)
│   │
│   ├── branch4/                        # Branch 4: 히트맵
│   │   └── collect_heatmap.py          # 히트맵 마커 수집
│   │
│   ├── ai_processing/                  # AI 처리
│   │   ├── gemini_crawling.py          # GeminiCLI 크롤링
│   │   ├── gemini_evaluation.py        # GeminiCLI 평가
│   │   └── transform.py                # 데이터 변환
│   │
│   └── database/                       # DB 작업
│       ├── insert_oracle.py            # Oracle DB 삽입
│       ├── sync_supabase.py            # Supabase 동기화
│       └── search_api.py               # 검색 API
│
├── prompts/                            # 📝 AI 프롬프트
│   ├── crawling_with_description.txt   # Description 있는 경우
│   ├── crawling_without_description.txt # Description 없는 경우
│   └── evaluation_prompt.txt           # 평가 프롬프트
│
├── data/                               # 💾 데이터 저장
│   ├── raw/                            # 원본 데이터
│   │   ├── metadata/                   # 메타데이터
│   │   ├── transcripts/                # 자막
│   │   └── heatmaps/                   # 히트맵
│   │
│   ├── processed/                      # 처리된 데이터
│   │   ├── crawling_results/           # 크롤링 결과
│   │   ├── evaluation_results/         # 평가 결과
│   │   └── transforms/                 # 변환 결과
│   │
│   └── logs/                           # 실행 로그
│       └── YYYY-MM-DD/                 # 날짜별 로그
│
├── utils/                              # 🛠️ 공통 유틸리티
│   ├── trace_id.py                     # trace_id 생성
│   ├── duplicate_checker.py            # 중복 검사
│   ├── oracle_client.py                # Oracle DB 클라이언트
│   ├── supabase_client.py              # Supabase 클라이언트
│   └── logger.py                       # 로깅 유틸리티
│
└── .github/                            # GitHub Actions
    └── workflows/
        ├── branch1_metadata.yml        # Branch 1 워크플로우
        ├── branch3_transcript_fix.yml  # 자막 교정 워크플로우
        └── ai_processing.yml           # AI 처리 워크플로우
```

---

## ⚙️ 설치 및 설정

### 1. 사전 요구사항

```bash
# Node.js 20+
node --version  # v20.x.x

# Python 3.9+
python --version  # 3.9.x

# Gemini CLI
npm install -g @google/gemini-cli
gemini --version
```

### 2. 의존성 설치

```bash
cd backend/tzudong_pipeline

# Python 의존성
pip install -r requirements.txt

# Node.js 의존성
npm install
```

### 3. 환경 변수 설정

```bash
cp .env.example .env
# .env 파일 편집
```

**.env 파일:**
```env
# ===== YouTube =====
YOUTUBE_API_KEY=your_youtube_api_key

# ===== OpenAI (광고 분석) =====
OPENAI_API_KEY=your_openai_api_key

# ===== Kakao (지오코딩) =====
KAKAO_REST_API_KEY=your_kakao_rest_api_key

# ===== Naver =====
NAVER_CLIENT_ID=your_naver_client_id
NAVER_CLIENT_SECRET=your_naver_client_secret

# ===== NCP Geocoding =====
NCP_CLIENT_ID=your_ncp_client_id
NCP_CLIENT_SECRET=your_ncp_client_secret

# ===== Oracle DB =====
ORACLE_USER=your_oracle_user
ORACLE_PASSWORD=your_oracle_password
ORACLE_DSN=your_oracle_dsn

# ===== Supabase =====
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key

# ===== OAuth 2.0 =====
OAUTH_CLIENT_ID=your_oauth_client_id
OAUTH_CLIENT_SECRET=your_oauth_client_secret
OAUTH_REDIRECT_URI=your_redirect_uri
```

### 4. Gemini CLI 인증

```bash
# 첫 실행 시 브라우저 인증
gemini
```

### 5. Oracle DB 설정

```bash
# Oracle Instant Client 설치 (필요시)
# https://www.oracle.com/database/technologies/instant-client.html
```

---

## 🚀 실행 방법

### 전체 파이프라인 실행

```bash
cd backend/tzudong_pipeline

# 전체 파이프라인
python scripts/pipeline.py

# 특정 채널만 실행
python scripts/pipeline.py --channel-id UCfpaSruWW3S4zzK8lwj1dRQ

# 특정 브랜치만 실행
python scripts/pipeline.py --branch 1    # 메타데이터만
python scripts/pipeline.py --branch 2    # 네이버지도만
python scripts/pipeline.py --branch 3    # 자막만
python scripts/pipeline.py --branch 4    # 히트맵만

# AI 처리만 실행
python scripts/pipeline.py --ai-only

# 특정 날짜 데이터 재처리
python scripts/pipeline.py --date 2025-01-08
```

### 개별 스크립트 실행

```bash
# Branch 1: 메타데이터
python scripts/branch1/collect_youtube_links.py --channel-id UCfpaSruWW3S4zzK8lwj1dRQ
python scripts/branch1/collect_metadata.py
python scripts/branch1/analyze_ads.py

# Branch 2: 네이버지도
python scripts/branch2/extract_description_urls.py
npx tsx scripts/branch2/crawl_naver_map.ts

# Branch 3: 자막
python scripts/branch3/collect_transcripts.py
python scripts/branch3/correct_transcripts.py

# Branch 4: 히트맵
python scripts/branch4/collect_heatmap.py

# AI Processing
python scripts/ai_processing/gemini_crawling.py
python scripts/ai_processing/gemini_evaluation.py
python scripts/ai_processing/transform.py

# Database
python scripts/database/insert_oracle.py
python scripts/database/sync_supabase.py
```

---

## 🔍 API 명세

### 검색 API

맛집 검색 시 다단계 검색 전략을 사용합니다:

```python
# 검색 우선순위
1. name + address    → 정확도 높음
2. name + 시군구     → 중간 정확도
3. name only         → 광범위 검색
```

**API 엔드포인트:**

```
GET /api/restaurants/search
```

**Query Parameters:**
- `name`: 맛집 이름 (필수)
- `address`: 전체 주소 (선택)
- `district`: 시군구 (선택)

**Response:**
```json
{
  "results": [
    {
      "trace_id": "abc123...",
      "name": "산북동달구지",
      "address": "전라북도 군산시 산북동 123-45",
      "match_type": "name_address",
      "confidence": 0.95
    }
  ],
  "total": 1,
  "search_strategy": "name + address"
}
```

---

## 🤖 GitHub Actions 워크플로우

### Branch 1: 메타데이터 수집

```yaml
# .github/workflows/branch1_metadata.yml
name: Branch 1 - Metadata Collection

on:
  schedule:
    - cron: '0 0 * * *'  # 매일 00:00 UTC
  workflow_dispatch:
    inputs:
      channel_id:
        description: 'YouTube Channel ID'
        required: true
        default: 'UCfpaSruWW3S4zzK8lwj1dRQ'

jobs:
  collect-metadata:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install -r backend/tzudong_pipeline/requirements.txt
      - run: |
          cd backend/tzudong_pipeline
          python scripts/branch1/collect_youtube_links.py
          python scripts/branch1/collect_metadata.py
          python scripts/branch1/analyze_ads.py
        env:
          YOUTUBE_API_KEY: ${{ secrets.YOUTUBE_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

### 자막 교정 (Branch 3 merge 시 트리거)

```yaml
# .github/workflows/branch3_transcript_fix.yml
name: Branch 3-1 - Transcript Correction

on:
  workflow_run:
    workflows: ["Branch 3 - Transcript Collection"]
    types:
      - completed

jobs:
  correct-transcripts:
    runs-on: ubuntu-latest
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    steps:
      - uses: actions/checkout@v4
      - run: |
          cd backend/tzudong_pipeline
          python scripts/branch3/correct_transcripts.py
```

---

## 🔄 마이그레이션 가이드

### v1.0 → v2.0 마이그레이션

#### 1. 데이터 변환

```python
# unique_id → trace_id 변환
def migrate_unique_id_to_trace_id(data):
    data['trace_id'] = data.pop('unique_id')
    return data

# phone 필드 삭제
def remove_phone_field(data):
    data.pop('phone', None)
    return data
```

#### 2. 파일 매핑

| v1.0 파일                                     | v2.0 파일                            |
| --------------------------------------------- | ------------------------------------ |
| `tzuyang_restaurant_results.jsonl`            | `data/processed/crawling_results/`   |
| `tzuyang_restaurant_evaluation_results.jsonl` | `data/processed/evaluation_results/` |
| `tzuyang_restaurant_transforms.jsonl`         | `data/processed/transforms/`         |

#### 3. 스크립트 매핑

| v1.0 스크립트                      | v2.0 스크립트                                |
| ---------------------------------- | -------------------------------------------- |
| `geminiCLI-restaurant-pipeline.py` | `scripts/pipeline.py`                        |
| `api-youtube-urls.py`              | `scripts/branch1/collect_youtube_links.py`   |
| `api-youtube-meta.py`              | `scripts/branch1/collect_metadata.py`        |
| `crawling.sh`                      | `scripts/ai_processing/gemini_crawling.py`   |
| `evaluation.sh`                    | `scripts/ai_processing/gemini_evaluation.py` |
| `transform_evaluation_results.py`  | `scripts/ai_processing/transform.py`         |
| `insert_to_supabase.ts`            | `scripts/database/insert_oracle.py`          |

---

## 📊 Rate Limit 정리

| 서비스             | 제한              | 대응           |
| ------------------ | ----------------- | -------------- |
| Gemini CLI         | 60 RPM, 1000 RPD  | 1초 대기       |
| YouTube Data API   | 10,000 units/day  | quota 모니터링 |
| Kakao 지오코딩     | 300,000 calls/day | 0.2초 대기     |
| Naver Local Search | 25,000 calls/day  | 0.1초 대기     |
| NCP Geocoding      | 100,000 calls/day | -              |
| OpenAI             | 티어별 상이       | 배치 처리      |

---

## 📞 문의

프로젝트 관련 문의는 GitHub Issues를 이용해 주세요.

---

**마지막 업데이트:** 2026-01-08
