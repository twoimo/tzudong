# 🚀 GeminiCLI 음식점 파이프라인

Google Gemini CLI 기반의 YouTube 영상 음식점 크롤링 및 평가 시스템입니다.

---

## 📋 목차

- [시스템 개요](#시스템-개요)
- [전체 아키텍처](#전체-아키텍처)
- [빠른 시작](#빠른-시작)
- [상세 파이프라인](#상세-파이프라인)
- [디렉토리 구조](#디렉토리-구조)
- [환경 변수](#환경-변수)
- [GitHub Actions](#github-actions)

---

## 🎯 시스템 개요

### 목적
- 유튜버(쯔양) 방문 음식점 정보 자동 추출
- AI 기반 정보 검증 및 품질 평가
- Supabase 데이터베이스 자동 등록

### 주요 특징
- **Gemini CLI**: Google 공식 CLI 도구로 합법적 AI 호출
- **YouTube 자막 활용**: youtube-transcript-api로 자막 추출 후 AI에 제공
- **RULE + LAAJ**: 규칙 기반 + AI 기반 하이브리드 평가
- **자동화**: GitHub Actions 지원
- **중복 제거**: 기존 데이터와 중복 체크

### Perplexity vs GeminiCLI

| 항목 | Perplexity | GeminiCLI |
|------|------------|-----------|
| 호출 방식 | Puppeteer 브라우저 자동화 | 공식 CLI 도구 |
| 법적 안전성 | ⚠️ 웹 스크래핑 | ✅ 공식 API |
| 설정 복잡도 | 높음 (세션 관리) | 낮음 (gemini login) |
| 무료 티어 | 제한적 | 60RPM, 1000RPD |
| 안정성 | 웹 변경에 민감 | 안정적 |

---

## 🏗️ 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                    📹 Phase 1: 크롤링 (자막 기반)                │
├─────────────────────────────────────────────────────────────────┤
│  tzuyang_youtubeVideo_urls.txt                                  │
│        ↓ youtube-transcript-api (자막 추출)                     │
│        ↓ Gemini CLI (자막 + 프롬프트로 음식점 추출)             │
│        ↓ tzuyang_restaurant_results.jsonl                       │
│        ↓ YouTube API (메타데이터 추가)                          │
│        → tzuyang_restaurant_results_with_meta.jsonl             │
└─────────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                    📊 Phase 2: 평가 (자막 기반)                  │
├─────────────────────────────────────────────────────────────────┤
│  Step 1: 평가 대상 선별 → tzuyang_restaurant_evaluation_selection.jsonl  │
│  Step 2: RULE 평가 → tzuyang_restaurant_evaluation_rule_results.jsonl │
│  Step 3: LAAJ 평가 (자막 + Gemini CLI) → tzuyang_restaurant_evaluation_results.jsonl │
│  Step 4: 결과 변환 → tzuyang_restaurant_transforms.jsonl              │
└─────────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                    🔄 Phase 3: 에러 재시도                       │
├─────────────────────────────────────────────────────────────────┤
│  tzuyang_restaurant_evaluation_errors.jsonl → Gemini CLI → 재평가  │
└─────────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                    🗄️ Phase 4: 데이터베이스                      │
├─────────────────────────────────────────────────────────────────┤
│  tzuyang_restaurant_transforms.jsonl → Supabase (restaurants 테이블) │
└─────────────────────────────────────────────────────────────────┘
```

### YouTube 자막 활용

Gemini CLI는 YouTube 영상을 직접 시청할 수 없어서, `youtube-transcript-api`로 자막을 추출하여 프롬프트에 함께 제공합니다:

```
예시 자막:
[00:41] (군산시 산북동)
[01:20] 여기다 '산북동달구지'
[03:52] 역대급으로 곱이 가득 차 있어요
```

- 타임스탬프 형식: `[MM:SS] 자막 텍스트`
- 최대 50,000자 (약 12,500 토큰)
- 자동 생성 자막도 지원

---

## ⚡ 빠른 시작

### 1. 사전 요구사항

- **Node.js 20 이상** 필수
- macOS, Linux, 또는 Windows

```bash
# Node.js 버전 확인 (v20 이상 필요)
node --version

# 버전이 낮다면 업그레이드
nvm install 20
nvm use 20

# Gemini CLI 설치
npm install -g @google/gemini-cli

# 또는 Homebrew (macOS/Linux)
brew install gemini-cli

# 설치 확인
gemini --version

# Google 계정 인증 (처음 실행 시 브라우저 인증)
gemini

# Python 패키지 (자막 추출 포함)
pip install google-api-python-client openai requests python-dotenv youtube-transcript-api

# Node.js 패키지 (평가 시스템)
cd backend/geminiCLI-restaurant-evaluation
npm install

# jq 설치 (JSON 처리)
brew install jq  # macOS
```

### 2. 환경 변수 설정

```bash
# backend/.env 파일 생성
cp backend/.env.example backend/.env
# 각 API 키 입력
```

### 3. 전체 파이프라인 실행

```bash
cd backend
python3 geminiCLI-restaurant-pipeline.py
```

---

## 📈 상세 파이프라인

### Phase 1: 크롤링

```bash
cd backend/geminiCLI-restaurant-crawling/scripts

# 전체 크롤링
bash crawling.sh

# 또는 Python 래퍼
python3 crawling-pipeline.py
```

**입력**: `tzuyang_youtubeVideo_urls.txt` (YouTube URL 목록)
**출력**: `tzuyang_restaurant_results_with_meta.jsonl`

### Phase 2: 평가

```bash
cd backend/geminiCLI-restaurant-evaluation/scripts

# 전체 평가 파이프라인
python3 evaluation-pipeline.py

# 또는 개별 단계
python3 evaluation-target-selection.py  # Step 1
python3 evaluation-rule.py              # Step 2
bash evaluation.sh                      # Step 3
python3 transform_evaluation_results.py # Step 4
```

**입력**: `../geminiCLI-restaurant-crawling/tzuyang_restaurant_results_with_meta.jsonl`
**출력**: `tzuyang_restaurant_transforms.jsonl`

### Phase 3: 에러 재시도

```bash
bash retry_errors.sh
```

### Phase 4: DB 삽입

```bash
npx tsx insert_to_supabase.ts
```

---

## 📁 디렉토리 구조

```
backend/
├── geminiCLI-restaurant-pipeline.py          # 🔥 전체 파이프라인 스크립트
├── README-geminiCLI.md                       # 이 파일
│
├── geminiCLI-restaurant-crawling/
│   ├── README.md
│   ├── .env
│   ├── tzuyang_youtubeVideo_urls.txt          # 입력 URL 목록
│   ├── tzuyang_restaurant_results.jsonl       # 크롤링 결과
│   ├── tzuyang_restaurant_results_with_meta.jsonl  # 메타데이터 포함 결과
│   ├── prompts/
│   │   └── crawling_prompt.txt
│   └── scripts/
│       ├── crawling.sh                        # 메인 크롤링
│       ├── crawling-pipeline.py
│       ├── parse_result.py
│       ├── api-youtube-urls.py
│       └── api-youtube-meta.py
│
├── geminiCLI-restaurant-evaluation/
│   ├── README.md
│   ├── .env
│   ├── package.json
│   ├── tsconfig.json
│   ├── tzuyang_restaurant_evaluation_selection.jsonl     # 평가 대상 선별 결과
│   ├── tzuyang_restaurant_evaluation_rule_results.jsonl  # RULE 평가 결과
│   ├── tzuyang_restaurant_evaluation_results.jsonl       # LAAJ 평가 결과
│   ├── tzuyang_restaurant_evaluation_errors.jsonl        # 에러 로그
│   ├── tzuyang_restaurant_transforms.jsonl               # DB 변환 결과
│   ├── prompts/
│   │   └── evaluation_prompt.txt
│   └── scripts/
│       ├── evaluation-pipeline.py             # 메인 평가 파이프라인
│       ├── evaluation-target-selection.py
│       ├── evaluation-rule.py
│       ├── evaluation.sh
│       ├── parse_laaj_evaluation.py
│       ├── transform_evaluation_results.py
│       ├── insert_to_supabase.ts
│       └── retry_errors.sh
│
└── utils/
    └── duplicate_checker.py                   # 중복 체크 유틸리티
```

---

## 🔐 환경 변수

### 전체 파이프라인용 (`backend/.env`)

```bash
# ===== 크롤링 =====
# YouTube Data API
YOUTUBE_API_KEY_BYEON=your_youtube_api_key

# OpenAI (광고 분석)
OPENAI_API_KEY_BYEON=your_openai_api_key

# ===== 평가 =====
# Naver Local Search API
NAVER_CLIENT_ID=your_naver_client_id
NAVER_CLIENT_SECRET=your_naver_client_secret

# NCP Geocoding API
NCP_CLIENT_ID=your_ncp_client_id
NCP_CLIENT_SECRET=your_ncp_client_secret

# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
```

### API 키 발급 가이드

| API | 발급 URL |
|-----|----------|
| YouTube Data API | [Google Cloud Console](https://console.cloud.google.com/) |
| OpenAI | [OpenAI Platform](https://platform.openai.com/) |
| Naver Local Search | [Naver Developers](https://developers.naver.com/) |
| NCP Geocoding | [Naver Cloud Platform](https://www.ncloud.com/) |
| Supabase | [Supabase Dashboard](https://supabase.com/) |

---

## 🤖 GitHub Actions

### 워크플로우 파일

`.github/workflows/gemini-pipeline.yml`

### 수동 실행

GitHub → Actions → "GeminiCLI Restaurant Pipeline" → "Run workflow"

### 필요한 Secrets

| Secret 이름 | 설명 |
|-------------|------|
| `GEMINI_API_TOKEN` | Gemini CLI 인증 토큰 |
| `YOUTUBE_API_KEY` | YouTube Data API 키 |
| `OPENAI_API_KEY` | OpenAI API 키 |
| `NAVER_CLIENT_ID` | Naver API Client ID |
| `NAVER_CLIENT_SECRET` | Naver API Client Secret |
| `NCP_CLIENT_ID` | NCP Geocoding Client ID |
| `NCP_CLIENT_SECRET` | NCP Geocoding Client Secret |
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_KEY` | Supabase 서비스 키 |

### 자동 실행 설정 (선택)

```yaml
on:
  schedule:
    - cron: '0 0 * * 0'  # 매주 일요일 00:00 UTC
```

---

## ⚠️ Rate Limit 정리

| 서비스 | 제한 | 대응 |
|--------|------|------|
| Gemini CLI | 60 RPM, 1000 RPD | 1초 대기 |
| YouTube Data API | 10,000 units/day | - |
| Naver Local Search | 25,000 calls/day | 0.1초 대기 |
| NCP Geocoding | 100,000 calls/day | - |
| OpenAI | 티어별 상이 | - |

---

## 📊 출력 데이터 예시

### 최종 DB 저장 형식

```json
{
  "youtube_link": "https://www.youtube.com/watch?v=abc123",
  "name": "빈해원",
  "phone": "02-123-4567",
  "address": "서울특별시 관악구 봉천동 123-45",
  "lat": 37.1234,
  "lng": 127.5678,
  "category": "중식",
  "tzuyang_review": "짬뽕이 시원하고 해물이 푸짐해요",
  "reasoning_basis": "00:01:55 간판 명시",
  "source_type": "geminiCLI",
  "youtube_title": "군산 최고 맛집 투어",
  "youtube_published_at": "2024-11-20",
  "is_ads": true,
  "what_ads": ["군산시청"],
  "evaluation_status": "verified"
}
```

---

## 🔗 관련 문서

- [크롤링 시스템 상세](./geminiCLI-restaurant-crawling/README.md)
- [평가 시스템 상세](./geminiCLI-restaurant-evaluation/README.md)
- [Perplexity 버전](./perplexity-restaurant-crawling/README.md)
- [Gemini CLI 공식 문서](https://github.com/google/generative-ai-cli)

---

## 📞 문의

프로젝트 관련 문의는 GitHub Issues를 이용해 주세요.
