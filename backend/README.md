# 🍜 쯔둥 (Tzudong) - Backend System

쯔양 유튜브 채널에서 방문한 맛집 데이터를 자동으로 수집, 평가, 검증하여 데이터베이스에 저장하는 통합 시스템입니다.

## 📚 목차

- [시스템 개요](#-시스템-개요)
- [전체 아키텍처](#-전체-아키텍처)
- [데이터 파이프라인](#-데이터-파이프라인)
- [중복 처리 시스템](#-중복-처리-시스템)
- [폴더 구조](#-폴더-구조)
- [설치 및 설정](#-설치-및-설정)
- [실행 방법](#-실행-방법)
- [트러블슈팅](#-트러블슈팅)

---

## 🎯 시스템 개요

이 시스템은 **쯔양**의 유튜브 영상에서 방문한 음식점 정보를 자동으로 수집하고, AI와 규칙 기반으로 평가하여 신뢰할 수 있는 맛집 데이터베이스를 구축합니다.

### 주요 기능

- ✅ **YouTube 데이터 수집**: 채널의 모든 영상 URL 자동 수집
- 🤖 **AI 기반 크롤링**:
  - **Perplexity AI**: 웹 검색 기반의 실시간 정보 추출
  - **Gemini CLI**: YouTube 자막(Transcript) 기반의 정밀 정보 추출
- 📊 **메타데이터 보강**: YouTube API로 조회수, 좋아요, 광고 정보 등 추가
- 🔍 **다단계 평가**: Rule 기반(위치/카테고리) + AI(LAAJ) 평가로 데이터 검증
- 🔄 **자동 중복 제거**: 전 과정에서 중복 데이터 자동 필터링
- 💾 **데이터베이스 저장**: Supabase에 최종 검증된 데이터 저장

---

## 🏗️ 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                    🍜 쯔양 레스토랑 데이터 시스템                   │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────┐
│  YouTube Channel │
│    (쯔양 채널)    │
└────────┬─────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Phase 1: 데이터 크롤링                       │
├─────────────────────────────────────────────────────────────────┤
│  1. YouTube URL 수집 (YouTube Data API)                         │
│     → tzuyang_youtubeVideo_urls.txt                             │
│                                                                 │
│  [Option A: Perplexity]                                         │
│  2. Perplexity 레스토랑 크롤링 (Puppeteer + Perplexity AI)       │
│     → tzuyang_restaurant_results.jsonl                          │
│                                                                 │
│  [Option B: Gemini CLI]                                         │
│  2. YouTube 자막 추출 + Gemini CLI 정보 추출                      │
│     → tzuyang_restaurant_results.jsonl                          │
│                                                                 │
│  3. YouTube 메타데이터 추가 (YouTube Data API + OpenAI)          │
│     → tzuyang_restaurant_results_with_meta.jsonl                │
└────────┬────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Phase 2: 데이터 평가                        │
├─────────────────────────────────────────────────────────────────┤
│  1. 평가 대상 선정 (주소 유효성 체크)                             │
│     → selection.jsonl / notSelection.jsonl                      │
│                                                                 │
│  2. Rule 기반 평가 (Naver Geocoding API)                        │
│     → rule_results.jsonl                                        │
│                                                                 │
│  3. LAAJ 평가 (Perplexity AI 또는 Gemini CLI)                    │
│     → evaluation_results.jsonl                                  │
│     → evaluation_errors.jsonl                                   │
└────────┬────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Phase 3: 에러 재평가                           │
├─────────────────────────────────────────────────────────────────┤
│  • evaluation_errors.jsonl → 재평가 → results.jsonl 추가        │
│  • 성공한 항목은 errors.jsonl에서 자동 삭제                       │
└────────┬────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Phase 4: 데이터 변환                          │
├─────────────────────────────────────────────────────────────────┤
│  • unique_id 생성 (SHA-256 해시)                                │
│  • 데이터 정규화 및 필터링                                        │
│     → tzuyang_restaurant_transforms.jsonl                       │
└────────┬────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Phase 5: 데이터베이스 삽입                       │
├─────────────────────────────────────────────────────────────────┤
│  • Supabase (PostgreSQL)                                        │
│  • unique_id 중복 체크 후 삽입                                   │
│  • restaurants, youtube_videos, creators 테이블                 │
└─────────────────────────────────────────────────────────────────┘

| 단계 | 스크립트 | 입력 | 출력 | 설명 |
|------|---------|------|------|------|
| 2.1 | `evaluation-target-selection.py` | `results_with_meta.jsonl` | `selection.jsonl` / `notSelection.jsonl` | 주소 유효성 체크로 평가 대상 선정 |
| 2.2 | `evaluation-rule.py` | `selection.jsonl` | `rule_results.jsonl` | Naver API로 좌표 검증 + 카테고리 매칭 |
| 2.3 | `index.ts` (LAAJ) | `rule_results.jsonl` | `evaluation_results.jsonl` + `evaluation_errors.jsonl` | AI 기반 5개 항목 평가 |

**통합 실행:**
```bash
cd perplexity-restaurant-evaluation/src
python evaluation-pipeline.py
```

---

### Phase 3: 에러 재평가

| 스크립트 | 입력 | 출력 | 설명 |
|---------|------|------|------|
| `index_retry_for_errors.ts` | `evaluation_errors.jsonl` | `evaluation_results.jsonl` (append) | 실패한 평가 재시도, 성공 시 errors에서 삭제 |

**실행:**
```bash
cd perplexity-restaurant-evaluation
node dist/index_retry_for_errors.js
```

---

### Phase 4: 데이터 변환

| 스크립트 | 입력 | 출력 | 설명 |
|---------|------|------|------|
| `transform_evaluation_results.py` | `evaluation_results.jsonl` + `notSelection.jsonl` | `tzuyang_restaurant_transforms.jsonl` | unique_id 생성, 데이터 평탄화 |

**실행:**
```bash
cd perplexity-restaurant-evaluation/src
python transform_evaluation_results.py
```

---

### Phase 5: 데이터베이스 삽입

| 스크립트 | 입력 | 출력 | 설명 |
|---------|------|------|------|
| `insert_to_supabase.ts` | `tzuyang_restaurant_transforms.jsonl` | Supabase DB | PostgreSQL에 최종 데이터 삽입 |

**실행:**
```bash
cd perplexity-restaurant-evaluation
node dist/insert_to_supabase.js
```

---

## 🔐 중복 처리 시스템

전체 파이프라인에서 **중복 데이터를 자동으로 감지하고 제거**하여 효율성과 데이터 무결성을 보장합니다.

### 중복 검사 전략

| 단계 | 파일 | 중복 기준 | 방식 | 저장 방식 |
|------|------|----------|------|----------|
| URL 수집 | `api-tzuyang-youtubeVideo-urls.py` | `youtube_link` (URL) | 기존 파일 비교 | **append** 모드 |
| Perplexity 크롤링 | `process-remaining.ts` | `youtube_link` | inline 함수 (Set) | **append** 모드 |
| 메타데이터 추가 | `api-youtube-meta.py` | `youtube_link` | 유틸리티 함수 | **append** 모드 |
| 평가 대상 선정 | `evaluation-target-selection.py` | `youtube_link` | 2개 파일 통합 체크 | **append** 모드 |
| Rule 평가 | `evaluation-rule.py` | `youtube_link` | 유틸리티 함수 | **append** 모드 |
| LAAJ 평가 | `index.ts` | `youtube_link` | inline 함수 (results + errors) | **append** 모드 |
| LAAJ 재평가 | `index_retry_for_errors.ts` | `youtube_link` | inline 함수, 성공 시 삭제 | **append** + 삭제 |
| Transform | `transform_evaluation_results.py` | `unique_id` (SHA-256) | 기존 파일 로드 | **append** 모드 |
| DB 삽입 | `insert_to_supabase.ts` | `unique_id` | DB 한 번에 조회 | 중복 시 스킵 |

### 공통 유틸리티 함수

#### Python (`backend/utils/duplicate_checker.py`)

```python
from duplicate_checker import load_processed_urls, append_to_jsonl

# 기존 처리된 URL 로드
processed_urls = load_processed_urls("output.jsonl")

# 중복 필터링
new_items = [item for item in all_items if item['youtube_link'] not in processed_urls]

# 안전하게 추가
for item in new_items:
    append_to_jsonl("output.jsonl", item)
```

**제공 함수:**
- `load_processed_urls(file_path)` - youtube_link 추출
- `load_processed_restaurants(file_path, key='name')` - 음식점명 추출
- `load_processed_unique_ids(file_path)` - unique_id 추출
- `append_to_jsonl(file_path, data)` - 안전한 append
- `load_multiple_processed_urls(*paths)` - 여러 파일 통합

#### TypeScript (`backend/utils/duplicate-checker.ts`)

```typescript
// inline 구현 (rootDir 제약으로 인해 각 파일에 복사)
function loadMultipleProcessedUrls(...filePaths: string[]): Set<string> {
  const allUrls = new Set<string>();
  // ... 구현
  return allUrls;
}
```

### 중복 처리 최적화

1. **메모리 기반 Set 사용** - O(1) 조회 속도
2. **DB 조회 최소화** - `insert_to_supabase.ts`에서 한 번만 조회
3. **Append 모드** - 기존 데이터 손실 방지
4. **즉시 저장** - 처리 후 바로 append로 중단 시에도 안전

---

## 📁 폴더 구조

```
backend/
├── README.md                          # 📘 이 파일
├── restaurant-pipeline.py             # 🚀 통합 실행 스크립트
│
├── utils/                             # 🛠️ 공통 유틸리티
│   ├── duplicate_checker.py           # Python 중복 검사 함수
│   ├── duplicate-checker.ts           # TypeScript 중복 검사 함수
│   └── README.md                      # 유틸리티 문서
│
├── perplexity-restaurant-crawling/    # 📥 데이터 크롤링 (Perplexity)
│   ├── README.md                      # 크롤링 시스템 문서
│   ├── ...
│
├── geminiCLI-restaurant-crawling/     # 📥 데이터 크롤링 (Gemini CLI)
│   ├── README.md                      # 크롤링 시스템 문서
│   ├── scripts/                       # 실행 스크립트
│   │   ├── crawling.sh                # 메인 크롤링 스크립트
│   │   └── ...
│   └── ...
│
├── perplexity-restaurant-evaluation/  # 🔍 데이터 평가 (Perplexity)
│   ├── README.md                      # 평가 시스템 문서
│   ├── ...
│
└── geminiCLI-restaurant-evaluation/   # 🔍 데이터 평가 (Gemini CLI)
    ├── README.md                      # 평가 시스템 문서
    ├── scripts/                       # 실행 스크립트
    │   ├── evaluation-pipeline.py     # 평가 파이프라인
    │   └── ...
    └── ...
```

---

## 🔧 설치 및 설정

### 1. 필수 요구사항

- **Python 3.8+**
- **Node.js 16+**
- **npm** 또는 **yarn**

### 2. 사전 준비 (중요!)

**⚠️ 통합 파이프라인 실행 전 반드시 각 하위 시스템의 의존성을 설치해야 합니다.**

#### 2.1 Python 환경 설정 (선택사항)

```bash
# Conda 환경 생성 (권장)
conda create -n tzudong python=3.9
conda activate tzudong

# 또는 venv 사용
python -m venv venv
source venv/bin/activate  # Mac/Linux
venv\Scripts\activate     # Windows
```

#### 2.2 크롤링 시스템 의존성 설치

```bash
cd perplexity-restaurant-crawling

# Python 패키지
pip install google-api-python-client openai python-dotenv

# Node.js 패키지
npm install
npm run build

cd ..
```

#### 2.3 평가 시스템 의존성 설치

```bash
cd perplexity-restaurant-evaluation

# Python 패키지
pip install requests python-dotenv

# Node.js 패키지
npm install
npm run build

cd ..
```

### 3. Python 패키지 설치 (통합)

**또는 루트에서 한 번에 설치:**

```bash
pip install -r requirements.txt
```

주요 패키지:
- `google-api-python-client` - YouTube Data API
- `openai` - OpenAI API (광고 분석)
- `python-dotenv` - 환경 변수 관리
- `requests` - HTTP 요청

### 4. Node.js 패키지 설치 (통합)

```bash
# 크롤링 시스템
cd perplexity-restaurant-crawling
npm install
npm run build

# 평가 시스템
cd ../perplexity-restaurant-evaluation
npm install
npm run build
```

### 5. 환경 변수 설정

각 폴더에 `.env` 파일 생성:

**`perplexity-restaurant-crawling/.env`**
```env
YOUTUBE_API_KEY_BYEON=your_youtube_api_key
OPENAI_API_KEY_BYEON=your_openai_api_key
PERPLEXITY_EMAIL=your_perplexity_email
PERPLEXITY_PASSWORD=your_perplexity_password
```

**`perplexity-restaurant-evaluation/.env`**
```env
PERPLEXITY_EMAIL=your_perplexity_email
PERPLEXITY_PASSWORD=your_perplexity_password
NAVER_CLIENT_ID=your_naver_client_id
NAVER_CLIENT_SECRET=your_naver_client_secret
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_supabase_service_key
```

**세션 파일 공유 (선택사항)**
- 수집과 평가 시스템은 동일한 Chrome 프로필 디렉토리 사용 (`~/.puppeteer-chrome-profile-perplexity`)
- 한쪽에서 로그인하면 다른 쪽에서도 세션 자동 공유
- 세션 파일 (`perplexity-session.json`)은 자동 생성되며 로그인 정보 저장
- Google 로그인 차단 시 세션 파일 복사로 해결 가능

### 6. 설치 확인

```bash
# Python 버전 확인
python --version  # 3.8 이상

# Node.js 버전 확인
node --version    # 16 이상

# TypeScript 빌드 확인
ls perplexity-restaurant-crawling/dist/
ls perplexity-restaurant-evaluation/dist/
```

---

## 🚀 실행 방법

### ⚡ Quick Start (통합 파이프라인)

**모든 의존성 설치 후:**

```bash
cd backend

# 일반 모드 (브라우저 표시)
python restaurant-pipeline.py

# 헤드리스 모드 (백그라운드 - 서버 환경)
python headless-restaurant-pipeline.py
```

자동으로 다음 순서로 실행됩니다:
1. ✅ 데이터 크롤링 (Phase 1)
2. ✅ 데이터 평가 (Phase 2)
3. ✅ 에러 재평가 (Phase 3)
4. ✅ 데이터 변환 (Phase 4)
5. ✅ DB 삽입 (Phase 5)

**모드 선택 가이드:**
- **일반 모드**: 로컬 개발 환경, 실시간 확인 필요 시
- **헤드리스 모드**: 서버 환경, 자동화, 백그라운드 실행

---

### 방법 1: 통합 파이프라인 (권장)

**전체 프로세스를 한 번에 실행:**

```bash
cd backend
python restaurant-pipeline.py
```

자동으로 다음 순서로 실행됩니다:
1. 데이터 크롤링 (Phase 1)
2. 데이터 평가 (Phase 2)
3. 에러 재평가 (Phase 3)
4. 데이터 변환 (Phase 4)
5. DB 삽입 (Phase 5)

---

### 방법 2: 단계별 실행

#### Phase 1: 크롤링

```bash
cd perplexity-restaurant-crawling/src
python crawling-pipeline.py
```

또는 개별 실행:
```bash
# 1. YouTube URL 수집
python api-tzuyang-youtubeVideo-urls.py

# 2. Perplexity 크롤링 (일반 모드 - 브라우저 표시)
cd ..
npm run start
# 또는
node dist/index.js

# 2-1. Perplexity 크롤링 (헤드리스 모드 - 백그라운드)
npm run headless
# 또는
node dist/headless-index.js

# 2-2. Perplexity 크롤링 (Python 파이프라인 - 헤드리스)
cd ../backend
python headless-restaurant-pipeline.py

# 3. 메타데이터 추가
cd perplexity-restaurant-crawling/src
python api-youtube-meta.py
```

**크롤링 모드 선택**:
- **일반 모드**: 브라우저 창 표시, 실시간 확인 가능
  - 단일 모드: 1개 브라우저 (안정적)
  - 병렬 모드: 3개 브라우저 (빠름)
  - 고속 모드: 5개 브라우저 (가장 빠름)
- **헤드리스 모드**: 백그라운드 실행, 서버 환경에 적합

#### Phase 2: 평가

```bash
cd perplexity-restaurant-evaluation/src
python evaluation-pipeline.py
```

또는 개별 실행:
```bash
# 1. 평가 대상 선정
python evaluation-target-selection.py

# 2. Rule 평가
python evaluation-rule.py

# 3. LAAJ 평가 (일반 모드 - 브라우저 표시)
cd ..
npm run eval
# 또는
node dist/index.js

# 3-1. LAAJ 평가 (헤드리스 모드 - 백그라운드)
npm run eval:headless
# 또는
node dist/headless_index.js

# 3-2. LAAJ 평가 (Python 파이프라인 - 헤드리스)
cd ../backend
python headless-evaluation-pipeline.py
```

**평가 모드 선택**:
- **일반 모드**: 브라우저 창 표시, 실시간 확인 가능
- **헤드리스 모드**: 백그라운드 실행, 서버 환경에 적합

#### Phase 3: 에러 재평가

```bash
cd perplexity-restaurant-evaluation
node dist/index_retry_for_errors.js
```

#### Phase 4: 데이터 변환

```bash
cd perplexity-restaurant-evaluation/src
python transform_evaluation_results.py
```

#### Phase 5: DB 삽입

```bash
cd perplexity-restaurant-evaluation
node dist/insert_to_supabase.js
```

---

## 🔍 트러블슈팅

### 1. TypeScript 빌드 오류

**증상:**
```
error TS6059: File is not under 'rootDir'
```

**해결:**
- `duplicate-checker.ts` import 대신 inline 함수 사용
- 또는 `tsconfig.json`에서 `rootDir` 조정

---

### 2. Perplexity 로그인 실패

**증상:**
```
❌ Perplexity 로그인 실패
```

**해결:**
1. `.env` 파일의 이메일/비밀번호 확인
2. Perplexity 계정이 활성 상태인지 확인
3. `perplexity-session.json` 삭제 후 재시도

---

### 2-1. Google 로그인 차단

**증상:**
```
Couldn't sign you in - This browser or app may not be secure
```

**해결:**
1. 세션 파일 및 프로필 삭제
```bash
rm -f perplexity-session.json
rm -rf ~/.puppeteer-chrome-profile-perplexity
```

2. 평가 시스템의 세션 복사 (이미 로그인된 경우)
```bash
# 수집 시스템에서
cp ../perplexity-restaurant-evaluation/perplexity-session.json .
# 또는 평가 시스템에서
cp ../perplexity-restaurant-crawling/perplexity-session.json .
```

3. 재실행 후 수동 로그인

---

### 2-2. Cloudflare CAPTCHA

**증상:**
```
Please unblock challenges.cloudflare.com
Verify you are human
```

**해결:**
- 평가 시스템과 동일한 Chrome 설정 자동 사용됨
- 고정 프로필 디렉토리로 세션 유지
- Stealth 플러그인으로 봇 탐지 우회
- 문제 지속 시 세션 파일 재생성 (수동 로그인)

---

### 3. YouTube API Quota 초과

**증상:**
```
Error 403: quotaExceeded
```

**해결:**
- YouTube Data API는 일일 할당량 10,000 units
- 다음 날까지 대기하거나 다른 API 키 사용

---

### 4. 중복 데이터 계속 처리

**증상:**
- 같은 URL이 반복해서 처리됨

**해결:**
1. 출력 파일이 올바른 위치에 있는지 확인
2. 중복 검사 로직이 활성화되어 있는지 확인
3. 파일 권한 문제 확인 (읽기/쓰기)

---

### 5. DB 삽입 실패

**증상:**
```
❌ Supabase 삽입 실패: unique constraint violation
```

**해결:**
- `unique_id` 중복: 정상 동작 (중복은 자동 스킵)
- 다른 에러: Supabase 연결 설정 확인

---

## 📊 데이터 스키마

### `tzuyang_restaurant_transforms.jsonl`

DB 삽입용 최종 포맷 (평가 완료 및 미대상 음식점 통합)

```json
{
  "youtube_link": "https://www.youtube.com/watch?v=zGtW8tdjqNE",
  "unique_id": "c5bd7a15740c36a4f24103e706f4fc7db7a11d52e7d3081583ad9af44b9d22f0",
  "status": "pending",
  "youtube_meta": {
    "title": "먹방유튜버가 배달가면 생기는일.. 구독자분 놀라심 ㅋㅋ Korean mukbang eating show",
    "publishedAt": "2019-12-01T09:01:09Z",
    "is_shorts": false,
    "duration": 644,
    "ads_info": {
      "is_ads": true,
      "what_ads": ["한솥도시락", "핑크퐁", "키즈캐슬", "이든레코즈"]
    }
  },
  "name": "한솥도시락",
  "phone": null,
  "category": "도시락",
  "reasoning_basis": "본 영상은 한솥도시락의 유료 광고 영상으로, 영상 설명에 해당 내용이 명시되어 있습니다...",
  "tzuyang_review": "쯔양은 한솥도시락의 '메가 치킨마요', '스팸 직화구이 덮밥', '칠리치킨마요'를 직접 만들어...",
  "origin_address": {
    "address": null,
    "lat": null,
    "lng": null
  },
  "roadAddress": null,
  "jibunAddress": null,
  "englishAddress": null,
  "addressElements": null,
  "geocoding_success": false,
  "geocoding_false_stage": 0,
  "is_missing": false,
  "is_notSelected": true,
  "evaluation_results": null,
  "source_type": "perplexity"
}
```

**평가 대상 음식점 예시 (evaluation_results 있음):**

```json
{
  "youtube_link": "https://www.youtube.com/watch?v=Mm76nsEkOIM",
  "unique_id": "a1b2c3d4e5f67890...",
  "status": "approved",
  "youtube_meta": {
    "title": "대구 만두 투어",
    "publishedAt": "2024-01-15T10:00:00Z",
    "is_shorts": false,
    "duration": 1200,
    "ads_info": {
      "is_ads": false,
      "what_ads": null
    }
  },
  "name": "영생덕",
  "phone": "053-255-5777",
  "category": "중식",
  "reasoning_basis": "유튜버 쯔양이 영상에서 '영생덕'이라는 상호를 언급하고...",
  "tzuyang_review": "60년 전통의 중식 만두 전문점으로, 꾼만두, 물만두, 찐교스를 주문함...",
  "origin_address": {
    "address": "대구 중구 종로 39",
    "lat": 35.8693928,
    "lng": 128.5913992
  },
  "roadAddress": "대구광역시 중구 종로 39",
  "jibunAddress": "대구광역시 중구 공평동 23",
  "englishAddress": "39 Jongno, Jung-gu, Daegu",
  "addressElements": [...],
  "geocoding_success": true,
  "geocoding_false_stage": null,
  "is_missing": false,
  "is_notSelected": false,
  "evaluation_results": {
    "visit_authenticity": {
      "values": [3],
      "missing": []
    },
    "rb_inference_score": {"values": [2]},
    "rb_grounding_TF": {"values": [true]},
    "review_faithfulness_score": {"values": [0.9]},
    "category_TF": {"values": [true]}
  },
  "source_type": "perplexity"
}
```

---

## 🤖 Headless 모드 실행 가이드

### Headless 모드란?

GitHub Actions 및 서버 환경에서 브라우저 UI 없이 자동으로 전체 파이프라인을 실행하는 모드입니다.

### 실행 방법

#### 1. 전체 파이프라인 실행 (수집 → 평가)
```bash
| 세션 파일 | `perplexity-session.json` | `headless-perplexity-session.json` |
| 사용자 입력 | ✅ 필요 (로그인, 확인) | ❌ 불필요 (자동 처리) |
| 서버 환경 | ❌ 부적합 | ✅ 최적화 |
| 통계 수집 | ❌ 없음 | ✅ 자동 (`headless_stats/`) |
| 실행 속도 | 🐢 느림 (UI 렌더링) | ⚡ 빠름 (UI 생략) |
| CI/CD | ❌ 불가능 | ✅ GitHub Actions 지원 |

### Headless 모드 특징

- 🤖 **완전 자동화**: 브라우저 UI 없이 전체 프로세스 실행
- 🔄 **세션 자동 복원**: 세션 파일 자동 로드 및 재사용
- 📊 **통계 자동 수집**: `headless_stats/` 폴더에 JSON 형식 저장
- 🎯 **CI/CD 최적화**: GitHub Actions, Jenkins 등에서 바로 실행
- 🏆 **서버 환경**: 백그라운드 실행 및 로그 자동 저장

### 통계 파일 구조

```
backend/headless_stats/
├── crawling_stats_20250116_123456.json  # 수집 통계
│   ├── total_urls: 100
│   ├── processed_urls: 95
│   ├── total_restaurants: 285
│   └── success_rate: 95%
│
├── evaluation_stats_20250116_130000.json  # 평가 통계
│   ├── evaluated_restaurants: 280
│   ├── selection_count: 245
│   └── selection_rate: 87.5%
│
└── pipeline_stats_20250116_140000.json  # 통합 통계
    ├── crawling: {...}
    ├── evaluation: {...}
    └── overall_success_rate: 96.5%
```

### 서버 환경 설정 가이드

#### 1. 시스템 요구사항
```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y chromium-browser chromium-chromedriver

# macOS
brew install --cask google-chrome

# Python 3.8+
python3 --version

# Node.js 16+
node --version
```

#### 2. 의존성 설치
```bash
cd backend/perplexity-restaurant-crawling
npm install

cd ../perplexity-restaurant-evaluation
npm install
```

#### 3. 세션 파일 준비

첫 실행 전에 로컬에서 세션을 생성하고 서버로 복사:

```bash
# 로컬에서 일반 모드로 실행 (로그인 후 세션 저장)
npm run start

# 세션 파일을 headless 세션으로 복사
cp perplexity-session.json headless-perplexity-session.json

# 서버로 세션 파일 전송
scp headless-perplexity-session.json user@server:/path/to/backend/perplexity-restaurant-crawling/
scp headless-perplexity-session.json user@server:/path/to/backend/perplexity-restaurant-evaluation/
```

#### 4. 환경 변수 설정

`.env` 파일 준비:
```env
PERPLEXITY_SESSION_PATH=headless-perplexity-session.json
YOUTUBE_API_KEY=your_key
SUPABASE_URL=your_url
SUPABASE_SERVICE_KEY=your_key
```

#### 5. Cron 자동화 (선택)

매일 자동 실행:
```bash
# crontab -e
0 2 * * * cd /path/to/backend && python3 headless-restaurant-pipeline.py >> /var/log/tzudong.log 2>&1
```

---

## 📖 추가 문서

- [크롤링 시스템 상세](./perplexity-restaurant-crawling/README.md)
- [평가 시스템 상세](./perplexity-restaurant-evaluation/README.md)
- [공통 유틸리티](./utils/README.md)
- [Headless Stats README](./headless_stats/README.md)

---

## 📝 라이선스

이 프로젝트는 내부 사용을 위한 것입니다.

---

## 👥 기여자

- Backend 시스템 개발 및 문서화

---

**마지막 업데이트:** 2025-01-16
