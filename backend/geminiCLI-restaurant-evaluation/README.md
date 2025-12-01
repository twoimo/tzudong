# 📊 GeminiCLI 음식점 평가 시스템

Google Gemini CLI를 사용한 음식점 정보 검증 및 평가 시스템입니다.

## 📋 목차

- [시스템 개요](#시스템-개요)
- [디렉토리 구조](#디렉토리-구조)
- [설치 및 설정](#설치-및-설정)
- [사용 방법](#사용-방법)
- [평가 방식](#평가-방식)
- [평가 루브릭](#평가-루브릭)
- [데이터 구조](#데이터-구조)

---

## 🎯 시스템 개요

### 주요 기능
- 크롤링 결과에서 유효한 평가 대상 선별
- RULE 기반 평가 (카테고리 + 위치 검증)
- LAAJ 기반 평가 (AI 신뢰도 평가)
- **YouTube 자막 기반 검증** (youtube-transcript-api 활용)
- Supabase 데이터베이스 삽입
- 에러 발생 시 자동 재시도

### 파이프라인 흐름

```
크롤링 결과                RULE 평가              LAAJ 평가
     │                        │                      │
     ▼                        ▼                      ▼
┌──────────┐           ┌──────────┐           ┌──────────┐
│ crawling │ ────────▶ │  rule_   │ ────────▶ │evaluation│
│ _results │  대상선별  │ results  │  AI 평가   │ _results │
│ _with_   │           │  .jsonl  │  + 자막    │  .jsonl  │
│ meta.jsonl│          └──────────┘           └──────────┘
└──────────┘                                       │
                                                   ▼
                                             ┌──────────┐
                                             │ Supabase │
                                             │    DB    │
                                             └──────────┘
```

### YouTube 자막 활용

평가 시 **YouTube 자막(Transcript)**을 자동으로 가져와 Gemini에게 함께 제공합니다:

- `youtube-transcript-api`를 사용하여 자막 추출
- 타임스탬프 형식: `[MM:SS] 자막 텍스트`
- 최대 50,000자 (약 12,500 토큰)
- 자동 생성 자막도 지원

```
예시:
[00:41] (군산시 산북동)
[01:20] 여기다 '산북동달구지'
[03:52] 역대급으로 곱이 가득 차 있어요
```

---

## 📁 디렉토리 구조

```
geminiCLI-restaurant-evaluation/
├── README.md                                                # 이 파일
├── .env                                                     # 환경변수
├── package.json                                             # npm 스크립트
├── tsconfig.json                                            # TypeScript 설정
├── data/
│   └── yy-mm-dd/                                            # 날짜별 폴더 (예: 25-01-15)
│       ├── tzuyang_restaurant_evaluation_selection.jsonl    # 평가 대상 선별 결과
│       ├── tzuyang_restaurant_evaluation_rule_results.jsonl # RULE 평가 결과
│       ├── tzuyang_restaurant_evaluation_results.jsonl      # LAAJ 평가 결과
│       ├── tzuyang_restaurant_evaluation_errors.jsonl       # 에러 로그
│       └── tzuyang_restaurant_transforms.jsonl              # DB 변환 결과
├── prompts/
│   └── evaluation_prompt.txt                                # LAAJ 평가 프롬프트
├── scripts/
│   ├── evaluation-pipeline.py                               # 🔥 전체 평가 파이프라인
│   ├── evaluation-target-selection.py                       # Step 1: 평가 대상 선별
│   ├── evaluation-rule.py                                   # Step 2: RULE 기반 평가
│   ├── evaluation.sh                                        # Step 3: LAAJ 평가 (Gemini CLI + 자막)
│   ├── parse_laaj_evaluation.py                             # Gemini 응답 파서
│   ├── transform_evaluation_results.py                      # Step 4: DB 형식 변환
│   ├── insert_to_supabase.ts                                # Supabase 삽입
│   └── retry_errors.sh                                      # 에러 재시도
└── temp/                                                    # 임시 파일 (자동 생성/삭제)
```

### 날짜 폴더 구조

모든 데이터는 실행 날짜 기준 `yy-mm-dd` 형식 폴더에 저장됩니다:

```
data/
├── 25-01-10/
│   ├── tzuyang_restaurant_evaluation_selection.jsonl
│   ├── tzuyang_restaurant_evaluation_results.jsonl
│   └── ...
├── 25-01-15/
│   ├── tzuyang_restaurant_evaluation_selection.jsonl
│   └── ...
```

- `PIPELINE_DATE` 환경변수 설정 시 해당 날짜 폴더 사용
- 미설정 시 오늘 날짜 기준 폴더 자동 생성

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
pip install requests python-dotenv youtube-transcript-api
```

### 3. Node.js 패키지 설치

```bash
cd geminiCLI-restaurant-evaluation
npm install
```

### 4. 환경 변수 설정

`.env` 파일 생성 (`.env.example` 참고):

```bash
# Naver Local Search API (위치 검증)
NAVER_CLIENT_ID=your_naver_client_id
NAVER_CLIENT_SECRET=your_naver_client_secret

# NCP Geocoding API (좌표 검증)
NCP_CLIENT_ID=your_ncp_client_id
NCP_CLIENT_SECRET=your_ncp_client_secret

# Supabase (데이터베이스)
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
```

---

## 💻 사용 방법

### 전체 파이프라인 실행 (권장)

```bash
cd scripts
python3 evaluation-pipeline.py
```

### npm 스크립트 사용

```bash
npm run pipeline       # 전체 파이프라인
npm run target         # 평가 대상 선별만
npm run rule           # RULE 평가만
npm run laaj           # LAAJ 평가만 (Gemini CLI)
npm run transform      # 결과 변환만
npm run insert         # Supabase 삽입만
npm run retry          # 에러 재시도
```

### 개별 스크립트 실행

```bash
# Step 1: 평가 대상 선별
python3 evaluation-target-selection.py

# Step 2: RULE 기반 평가
python3 evaluation-rule.py

# Step 3: LAAJ 평가 (Gemini CLI + 자막)
bash evaluation.sh

# Step 4: 결과 변환
python3 transform_evaluation_results.py

# Step 5: Supabase 삽입
npx tsx insert_to_supabase.ts
```

---

## 🔍 평가 방식

### 1. RULE 기반 평가

#### 카테고리 검증
- Naver Local Search API로 음식점 검색
- 카테고리 매칭 검증 (15개 카테고리)
- 결과: `category_valid` (boolean)

#### 위치 검증
- NCP Geocoding API로 좌표 검증
- 주소-좌표 일치 확인
- 결과: `location_valid` (boolean), 보정된 좌표

### 2. LAAJ 기반 평가 (자막 기반)

YouTube 자막을 활용한 5가지 AI 신뢰도 평가:

| 항목 | 설명 | 평가 기준 |
|------|------|-----------|
| `visit_authenticity` | 유튜버가 실제로 방문했는지 | 0~4 (int) |
| `rb_inference_score` | reasoning_basis 추론 합리성 | 0~2 (int) |
| `rb_grounding_TF` | reasoning_basis 실제 근거 일치 | true/false |
| `review_faithfulness_score` | 리뷰가 자막 내용과 일치하는지 | 0.0~1.0 (float) |
| `category_TF` | 카테고리가 업장과 일치하는지 | true/false |

---

## 📏 평가 루브릭

### [평가 항목 1] 방문 여부 정확성 (visit_authenticity)

**평가 목적**: 자막에서 유튜버가 실제로 해당 음식점을 방문했는지, 지점명까지 명확히 식별 가능한지 평가

| 점수 | 의미 |
|------|------|
| **0** | 자막에서 전혀 언급 없음 (데이터가 허구) |
| **1** | 음식점이 맞으며, 직접 방문했고 지점명까지 명확 ✅ |
| **2** | 음식점이 맞으며, 직접 방문은 맞지만 지점명 특정 불명확 |
| **3** | 음식점을 방문하지 않고, 해당 음식점의 음식 포장/배달 |
| **4** | 언급만 하거나(매장 안 감), 음식점(매장)이 아님 |

**반환 형식**:
```json
{
  "values": [
    {"name": "산북동달구지", "eval_value": 1, "eval_basis": "[01:20] 상호 자막 노출, [01:26] 입장 장면"}
  ],
  "missing": []
}
```

---

### [평가 항목 2] reasoning_basis 추론 합리성 (rb_inference_score)

**평가 목적**: reasoning_basis가 논리적 구조를 따르는지 평가

| 점수 | 의미 |
|------|------|
| **0** | 논리적 비약 있음 / 자막에서 확인 안 되는 내용으로 추측 |
| **1** | '방문 지역 언급 → 간판/편집자막 확인 → 음식점 특정' 순서로 자연스럽게 이어짐 ✅ |
| **2** | 위 구조는 아니지만, 자막 내용과 검색정보를 조합하여 논리적으로 특정 |

**반환 형식**:
```json
[
  {"name": "산북동달구지", "eval_value": 1, "eval_basis": "[00:41] 지역 언급, [01:20] 상호 자막으로 특정"}
]
```

---

### [평가 항목 3] reasoning_basis 실제 근거 일치도 (rb_grounding_TF)

**평가 목적**: reasoning_basis에 제시된 근거가 자막에서 확인 가능한지 검증

| 값 | 의미 |
|----|------|
| **true** | reasoning_basis의 핵심 근거가 자막에서 확인됨 ✅ |
| **false** | 핵심 근거(매장 위치나 이름 등)가 자막에서 전혀 확인 안 됨 |

**반환 형식**:
```json
[
  {"name": "산북동달구지", "eval_value": true, "eval_basis": "[00:41] '군산시 산북동' 언급, [01:20] '산북동달구지' 자막 확인"}
]
```

---

### [평가 항목 4] 음식 리뷰 충실도 (review_faithfulness_score)

**평가 목적**: tzuyang_review가 자막에서 확인되는 유튜버의 실제 멘트를 충실히 반영하는지 평가

| 점수 | 의미 |
|------|------|
| **0.0** | 자막에 없는 내용 지어냄, 과장/왜곡 |
| **1.0** | 자막의 실제 멘트 기반으로 충실하게 요약됨 ✅ |

**반환 형식**:
```json
[
  {"name": "산북동달구지", "eval_value": 1.0, "eval_basis": "[03:52] '역대급 곱', [07:07] '튀김처럼 바삭' 등 실제 평가 반영"}
]
```

---

### [평가 항목 5] 카테고리 정합성 (category_TF)

**평가 목적**: category 필드가 자막에서 확인되는 업장 성격과 일치하는지 평가

| 값 | 의미 |
|----|------|
| **true** | 자막에서 확인되는 메뉴/업장 유형과 category가 일치 ✅ |
| **false** | 자막에서 전혀 맞지 않음 (수정 필요 → category_revision 제공) |

**카테고리 목록** (15개):
```
치킨, 중식, 돈까스·회, 피자, 패스트푸드, 찜·탕,
족발·보쌈, 분식, 카페·디저트, 한식, 고기, 양식,
아시안, 야식, 도시락
```

**반환 형식**:
```json
[
  {"name": "산북동달구지", "eval_value": true, "category_revision": null}
]
```

---

## 📊 데이터 구조

### 입력 데이터 (`data/yy-mm-dd/tzuyang_restaurant_results_with_meta.jsonl`)

```json
{
  "youtube_link": "https://www.youtube.com/watch?v=abc123",
  "restaurants": [...],
  "youtube_meta": {...}
}
```

### RULE 평가 결과 (`data/yy-mm-dd/tzuyang_restaurant_evaluation_rule_results.jsonl`)

```json
{
  "youtube_link": "...",
  "restaurant_name": "산북동달구지",
  "category_valid": true,
  "location_valid": true,
  "corrected_lat": 35.9684,
  "corrected_lng": 126.6786,
  "naver_category": "고기"
}
```

### LAAJ 평가 결과 (`data/yy-mm-dd/tzuyang_restaurant_evaluation_results.jsonl`)

```json
{
  "youtube_link": "...",
  "evaluation_results": {
    "visit_authenticity": {"values": [...], "missing": []},
    "rb_inference_score": [...],
    "rb_grounding_TF": [...],
    "review_faithfulness_score": [...],
    "category_TF": [...]
  },
  "restaurants": [...],
  "youtube_meta": {...}
}
```

### 최종 변환 결과 (`data/yy-mm-dd/tzuyang_restaurant_transforms.jsonl`)

```json
{
  "youtube_link": "...",
  "name": "산북동달구지",
  "phone": "063-468-3534",
  "roadAddress": "전북특별자치도 군산시 칠성6길 144",
  "category": "고기",
  "source_type": "geminiCLI",
  "evaluation_results": {...},
  "youtube_meta": {...}
}
```

---

## 🔧 스크립트 설명

| 스크립트 | 용도 |
|----------|------|
| `evaluation-pipeline.py` | 전체 평가 파이프라인 자동화 |
| `evaluation-target-selection.py` | 크롤링 결과에서 평가 대상 선별 |
| `evaluation-rule.py` | RULE 기반 카테고리/위치 검증 |
| `evaluation.sh` | Gemini CLI로 LAAJ 평가 (자막 포함) |
| `parse_laaj_evaluation.py` | Gemini 응답 파싱 |
| `transform_evaluation_results.py` | DB 형식으로 변환 |
| `insert_to_supabase.ts` | Supabase 데이터베이스 삽입 |
| `retry_errors.sh` | 에러 파일 기반 재시도 (최대 5번) |

### 에러 재처리

LAAJ 평가 중 에러가 발생하면 `tzuyang_restaurant_evaluation_errors.jsonl`에 에러 항목이 저장됩니다.

에러 재처리 실행:
```bash
# 날짜 폴더 지정 필수
bash retry_errors.sh 25-01-15
```

- 에러 파일에서 항목을 읽어 재평가
- 성공 시 에러 파일에서 해당 항목 삭제
- 로그는 `log/geminiCLI-restaurant/yy-mm-dd/` 폴더에 저장

---

## ⚠️ Rate Limit

### Gemini CLI 무료 티어
- 60 RPM (분당 요청 수)
- 1,000 RPD (일일 요청 수)

### Naver API
- Local Search: 25,000 calls/day
- 스크립트에서 자동으로 0.1초 대기 적용

### NCP Geocoding
- 100,000 calls/day

---

## 🔗 관련 문서

- [크롤링 시스템 README](../geminiCLI-restaurant-crawling/README.md)
- [전체 파이프라인 README](../README-geminiCLI.md)
- [Gemini CLI 공식 문서](https://github.com/google/generative-ai-cli)
