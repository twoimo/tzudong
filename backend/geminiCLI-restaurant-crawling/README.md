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

Gemini CLI는 YouTube 영상을 직접 시청할 수 없어서, **YouTube 자막(Transcript)**을 자동으로 가져와 프롬프트에 함께 제공합니다:

- `youtube-transcript-api`를 사용하여 자막 추출
- 타임스탬프 형식: `[MM:SS] 자막 텍스트`
- 최대 50,000자 (약 12,500 토큰)
- 자동 생성 자막도 지원 (별도 표시)

```
예시:
[00:41] (군산시 산북동)
[01:20] 여기다 '산북동달구지'
[03:52] 역대급으로 곱이 가득 차 있어요
[06:18] 당일 도축한 소만 취급해요
```

---

## 📁 디렉토리 구조

```
geminiCLI-restaurant-crawling/
├── README.md                                    # 이 파일
├── .env                                         # 환경변수
├── tzuyang_youtubeVideo_urls.txt                # 입력 URL 목록 (1줄에 1개)
├── tzuyang_restaurant_results.jsonl             # 크롤링 결과
├── tzuyang_restaurant_results_with_meta.jsonl   # 메타데이터 포함 결과
├── prompts/
│   └── crawling_prompt.txt                      # Gemini CLI 크롤링 프롬프트
├── scripts/
│   ├── crawling.sh                              # 🔥 메인 크롤링 스크립트 (자막 포함)
│   ├── crawling-pipeline.py                     # Python 파이프라인 래퍼
│   ├── parse_result.py                          # Gemini 응답 파서
│   ├── api-youtube-urls.py                      # YouTube URL 수집
│   └── api-youtube-meta.py                      # YouTube 메타데이터 추가
└── temp/                                        # 임시 파일 (자동 생성/삭제)
```

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

### 출력 데이터 (`tzuyang_restaurant_results_with_meta.jsonl`)

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
| `crawling.sh` | 메인 크롤링 스크립트 (자막 추출 + Gemini CLI 호출 + 메타데이터 추가) |
| `parse_result.py` | Gemini CLI 응답에서 JSON 추출 및 JSONL 저장 |
| `api-youtube-urls.py` | 쯔양 채널의 모든 동영상 URL 수집 |
| `api-youtube-meta.py` | YouTube API로 메타데이터 추가 (제목, 광고 정보 등) |
| `crawling-pipeline.py` | Python에서 전체 크롤링 파이프라인 실행 |

### 자막 추출 유틸리티

자막 추출은 `backend/utils/get_transcript.py`를 사용합니다:

```bash
# 단독 실행
python3 ../utils/get_transcript.py "https://www.youtube.com/watch?v=QuwlZxZHHq0" 50000
```

출력 예시:
```
[자동 생성된 자막입니다]
[00:00] (소곱창 1.5kg)
[00:41] (군산시 산북동)
[01:20] 여기다 '산북동달구지'
...
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
