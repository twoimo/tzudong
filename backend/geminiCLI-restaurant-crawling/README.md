# 🍜 GeminiCLI 음식점 크롤링 시스템

Google Gemini CLI를 사용한 YouTube 영상 기반 음식점 정보 크롤링 시스템입니다.

## 📋 목차

- [시스템 개요](#시스템-개요)
- [디렉토리 구조](#디렉토리-구조)
- [설치 및 설정](#설치-및-설정)
- [사용 방법](#사용-방법)
- [데이터 구조](#데이터-구조)

---

## 🎯 시스템 개요

### 주요 기능
- YouTube 영상 URL을 입력받아 유튜버가 방문한 음식점 정보 추출
- **YouTube 자막(Transcript)**을 활용한 정확한 정보 추출
- Gemini CLI를 통한 AI 기반 정보 추출
- YouTube Data API로 메타데이터 자동 추가 (제목, 게시일, 광고 정보)
- OpenAI GPT-4o-mini로 광고 주체 분석
- JSONL 형식으로 결과 저장
- GitHub Actions 자동화 지원

### 파이프라인 흐름

```
YouTube URL 목록          자막 추출           Gemini CLI            YouTube API
     │                        │                   │                      │
     ▼                        ▼                   ▼                      ▼
┌──────────┐           ┌──────────┐        ┌──────────┐           ┌──────────┐
│ youtube_ │ ────────▶ │ youtube- │ ─────▶ │ crawling │ ────────▶ │ crawling │
│ urls.txt │   각 URL  │transcript│ 프롬프트│ _results │  메타추가  │ _results │
└──────────┘   자막추출 │ -api     │ 에 삽입 │  .jsonl  │           │ _with_   │
                        └──────────┘        └──────────┘           │ meta.jsonl│
                                                                   └──────────┘
```

### YouTube 자막 활용

Gemini CLI는 YouTube 영상을 직접 시청할 수 없어서, **YouTube 자막(Transcript)**을 자동으로 가져와 프롬프트에 함께 제공합니다.

#### 자막 수집 방식 (Puppeteer)

**Puppeteer 기반** 웹 스크래핑으로 자막을 수집합니다:

1. **1차: maestra.ai** (Primary)
   - `https://maestra.ai/tools/youtube-transcript-generator?url={VIDEO_URL}`
   - Caption 모드로 전환하여 정확한 타임스탬프 추출
   - `data-start` 속성에서 시작 시간(초) 파싱

2. **2차: tubetranscript.com** (Fallback)
   - `https://www.tubetranscript.com/ko/transcript/{VIDEO_ID}`
   - maestra.ai 실패 시 자동 폴백

#### 자막 데이터 형식

```json
{
  "youtube_link": "https://www.youtube.com/watch?v=xxx",
  "language": "ko",
  "collected_at": "2025-12-04T01:30:00+09:00",
  "transcript": [
    {"start": 0.0, "text": "안녕하세요"},
    {"start": 2.5, "text": "오늘은 군산 맛집 투어입니다"}
  ]
}
```

- 타임스탬프: 초 단위 (float)
- 자동 커밋: 30개마다 GitHub에 자동 커밋
- 중복 검사: 모든 날짜 폴더의 기존 데이터와 비교

---

## 📁 디렉토리 구조

```
geminiCLI-restaurant-crawling/
├── README.md                                    # 이 파일
├── .env                                         # 환경변수
├── data/
│   └── yy-mm-dd/                                # 날짜별 폴더 (예: 25-12-04)
│       ├── tzuyang_youtubeVideo_urls.txt                # YouTube URL 목록
│       ├── tzuyang_restaurant_transcripts.json          # 🆕 Puppeteer 수집 자막
│       ├── tzuyang_restaurant_results.jsonl             # 크롤링 결과
│       ├── tzuyang_restaurant_results_with_meta.jsonl   # 메타데이터 포함 결과
│       ├── tzuyang_transcript_errors.json               # 자막 수집 에러
│       └── tzuyang_crawling_errors.jsonl                # 크롤링 에러 URL
├── prompts/
│   └── crawling_prompt.txt                      # Gemini CLI 크롤링 프롬프트
├── scripts/
│   ├── transcript-puppeteer.ts                  # 🆕 Puppeteer 자막 수집 스크립트
│   ├── crawling.sh                              # 메인 크롤링 스크립트
│   ├── retry_crawling_errors.sh                 # 에러 URL 재처리
│   ├── crawling-pipeline.py                     # Python 파이프라인 래퍼
│   ├── parse_result.py                          # Gemini 응답 파서
│   ├── api-youtube-urls.py                      # YouTube URL 수집
│   ├── api-youtube-meta.py                      # YouTube 메타데이터 추가
│   ├── package.json                             # Node.js 의존성 (Puppeteer)
│   └── tsconfig.json                            # TypeScript 설정
└── temp/                                        # 임시 파일 (자동 생성/삭제)
```

### 날짜 폴더 구조

모든 데이터는 실행 날짜 기준 `yy-mm-dd` 형식 폴더에 저장됩니다:

```
data/
├── 25-12-03/
│   ├── tzuyang_youtubeVideo_urls.txt              # URL 목록
│   ├── tzuyang_restaurant_transcripts.json        # 자막 (Puppeteer 수집)
│   ├── tzuyang_restaurant_results.jsonl           # 크롤링 결과
│   ├── tzuyang_restaurant_results_with_meta.jsonl # 메타데이터 포함
│   └── tzuyang_transcript_errors.json             # 자막 에러 로그
├── 25-12-04/
│   └── ...
```

- `PIPELINE_DATE` 환경변수 설정 시 해당 날짜 폴더 사용
- 미설정 시 오늘 날짜 기준 폴더 자동 생성 (KST 기준)

---

## 🚀 설치 및 설정

### 0. 사전 요구사항

- **Node.js 20 이상** 필수
- macOS, Linux, 또는 Windows

```bash
# Node.js 버전 확인
node --version  # v20.0.0 이상이어야 함

# 버전이 낮다면 nvm으로 업그레이드
nvm install 20
nvm use 20
```

### 1. Gemini CLI 설치

```bash
# npm을 통한 설치
npm install -g @google/gemini-cli

# 또는 Homebrew (macOS/Linux)
brew install gemini-cli

# 설치 확인
gemini --version

# Google 계정 인증 (처음 실행 시 브라우저 인증)
gemini
```

### 2. Python 패키지 설치

```bash
pip install google-api-python-client openai python-dotenv youtube-transcript-api
```

### 3. 환경 변수 설정

`.env` 파일 생성 (`.env.example` 참고):

```bash
# YouTube Data API (영상 메타데이터)
YOUTUBE_API_KEY_BYEON=your_youtube_api_key_here

# OpenAI API (광고 분석용 GPT-4o-mini)
OPENAI_API_KEY_BYEON=your_openai_api_key_here
```

### 4. jq 설치 (필수)

```bash
# macOS
brew install jq

# Ubuntu/Debian
sudo apt-get install -y jq
```

---

## 💻 사용 방법

### 기본 실행

```bash
cd scripts

# 크롤링 실행 (자막 추출 + 메타데이터 추가 포함)
bash crawling.sh
```

### 커스텀 경로 지정

```bash
bash crawling.sh ../my_urls.txt ../my_results.jsonl
```

### Python 파이프라인 사용

```bash
python3 crawling-pipeline.py
```

### 개별 스크립트 실행

```bash
# 1. YouTube URL 수집 (선택)
python3 api-youtube-urls.py

# 2. 크롤링만 실행 (자막 자동 추출)
bash crawling.sh

# 3. 메타데이터만 추가
python3 api-youtube-meta.py ../tzuyang_restaurant_results.jsonl ../tzuyang_restaurant_results_with_meta.jsonl
```

---

## 📊 데이터 구조

### 출력 데이터 (`data/yy-mm-dd/tzuyang_restaurant_results_with_meta.jsonl`)

```json
{
  "youtube_link": "https://www.youtube.com/watch?v=abc123",
  "restaurants": [
    {
      "name": "산북동달구지",
      "phone": "063-468-3534",
      "address": "전북 군산시 칠성6길 144",
      "lat": 35.9684667,
      "lng": 126.678557,
      "category": "고기",
      "reasoning_basis": "[00:41] 군산시 산북동 방문, [01:20] '산북동달구지' 상호 자막 노출",
      "tzuyang_review": "당일 도축한 소만 취급하여 잡내가 없고 신선합니다..."
    }
  ],
  "youtube_meta": {
    "title": "군산 최고 맛집 투어",
    "publishedAt": "2024-11-20T12:00:00Z",
    "is_shorts": false,
    "duration": 1034,
    "ads_info": {
      "is_ads": true,
      "what_ads": ["군산시청", "○○식품"]
    }
  }
}
```

### 카테고리 목록 (15개)

```
치킨, 중식, 돈까스·회, 피자, 패스트푸드, 찜·탕,
족발·보쌈, 분식, 카페·디저트, 한식, 고기, 양식,
아시안, 야식, 도시락
```

---

## 🔧 스크립트 설명

| 스크립트 | 용도 |
|----------|------|
| `transcript-puppeteer.ts` | 🆕 Puppeteer 기반 자막 수집 (maestra.ai + tubetranscript.com) |
| `crawling.sh` | 메인 크롤링 스크립트 (Gemini CLI 호출 + 메타데이터 추가) |
| `retry_crawling_errors.sh` | 에러 URL 재처리 (최대 5번 재시도) |
| `parse_result.py` | Gemini CLI 응답에서 JSON 추출 및 JSONL 저장 |
| `api-youtube-urls.py` | 쯔양 채널의 모든 동영상 URL 수집 |
| `api-youtube-meta.py` | YouTube API로 메타데이터 추가 (제목, 광고 정보 등) |
| `crawling-pipeline.py` | Python에서 전체 크롤링 파이프라인 실행 |

### Puppeteer 자막 수집

```bash
cd scripts

# 기본 실행 (오늘 날짜 폴더)
npx ts-node transcript-puppeteer.ts

# 특정 날짜
npx ts-node transcript-puppeteer.ts --date 25-12-03

# 최대 URL 수 지정
npx ts-node transcript-puppeteer.ts --max 50
```

**수집 흐름**:
1. `tzuyang_youtubeVideo_urls.txt`에서 URL 읽기
2. 기존 transcript와 중복 검사
3. maestra.ai에서 자막 수집 시도
4. 실패 시 tubetranscript.com으로 폴백
5. 30개마다 GitHub 자동 커밋

**에러 처리**:
- 수집 실패한 URL은 `tzuyang_transcript_errors.json`에 저장
- 에러 유형: `maestra_fallback_failed`, `no_transcript` 등

### 에러 재처리

크롤링 중 에러가 발생하면 `tzuyang_crawling_errors.jsonl`에 에러 URL이 저장됩니다:

```json
{"url": "https://www.youtube.com/watch?v=xxx", "error_type": "gemini", "timestamp": "2025-12-04T10:30:00"}
```

에러 재처리:
```bash
bash retry_crawling_errors.sh 25-12-04
```

---

## ⚠️ Rate Limit

### Gemini CLI 무료 티어
- 60 RPM (분당 요청 수)
- 1,000 RPD (일일 요청 수)
- 스크립트에서 자동으로 1초 대기 적용

### YouTube Data API
- 10,000 units/day
- 채널 동영상 목록: 1 unit/요청
- 동영상 정보: 1 unit/요청

---

## 🔗 관련 문서

- [평가 시스템 README](../geminiCLI-restaurant-evaluation/README.md)
- [전체 파이프라인 README](../README-geminiCLI.md)
- [Gemini CLI 공식 문서](https://github.com/google/generative-ai-cli)
