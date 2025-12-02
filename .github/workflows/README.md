# 🍜 GeminiCLI Restaurant Pipeline

쯔양 유튜브 채널의 음식점 정보를 자동으로 수집하고 평가하는 3-part 파이프라인입니다.

## 📋 개요

| 항목 | 설명 |
|------|------|
| **실행 브랜치** | `github-actions-restaurant` (데이터 전용 브랜치) |
| **결과 저장** | Supabase DB + GitHub 저장소 자동 커밋 |

### 🎯 파이프라인 분리 이유

YouTube Transcript API는 클라우드 IP (GitHub Actions/Azure)를 차단하기 때문에, 파이프라인을 3개로 분리했습니다:

| 단계 | 실행 환경 | 워크플로우/도구 |
|------|----------|----------------|
| 1️⃣ URL 수집 | GitHub Actions | `api-youtube-urls.yml` |
| 2️⃣ Transcript 수집 | 로컬 (FastAPI) | `transcript-api/` |
| 3️⃣ 크롤링 + 평가 | GitHub Actions | `crawling-evaluation.yml` |

---

## 🔄 3-Part 파이프라인

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         3-PART PIPELINE ARCHITECTURE                        │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  PART 1: URL 수집 (GitHub Actions - 2일마다 자동)                            │
│  📄 api-youtube-urls.yml                                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  • 쯔양 채널에서 YouTube Video URL 수집                                      │
│  • 모든 날짜 폴더의 기존 URL과 중복 검사                                       │
│  • 신규 URL만 저장 및 자동 커밋                                               │
│                                                                             │
│  OUTPUT: data/{yy-mm-dd}/tzuyang_youtubeVideo_urls.txt                      │
│                                                                             │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PART 2: Transcript 수집 (로컬 FastAPI - 수동)                               │
│  📁 backend/transcript-api/                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ⚠️ YouTube가 클라우드 IP를 차단하므로 로컬에서 실행 필요                      │
│                                                                             │
│  1. FastAPI 서버 실행: uvicorn main:app --reload                            │
│  2. 웹 UI에서 "Transcript 수집" 버튼 클릭                                    │
│  3. 수집 완료 후 "GitHub 커밋" 버튼 클릭                                      │
│                                                                             │
│  OUTPUT: data/{yy-mm-dd}/tzuyang_restaurant_transcripts.json                │
│                                                                             │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │ (Push 트리거)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PART 3: 크롤링 + 평가 (GitHub Actions - Push시 자동 또는 수동)               │
│  📄 crawling-evaluation.yml                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1️⃣ 크롤링 (crawling.sh)                                                    │
│     └── 모든 날짜 폴더의 URL + Transcript 읽기                               │
│     └── Transcript가 있는 URL만 처리 (없으면 스킵)                            │
│     └── Gemini CLI로 음식점 정보 추출                                        │
│         ↓                                                                   │
│  2️⃣ 메타데이터 추가 (api-youtube-meta.py)                                   │
│     └── YouTube API + OpenAI로 광고 분석                                     │
│         ↓                                                                   │
│  3️⃣ LAAJ 평가 (evaluation.sh)                                              │
│     └── Gemini CLI로 5개 항목 평가                                           │
│         ↓                                                                   │
│  4️⃣ RULE 평가 (evaluation-rule.py)                                         │
│     └── Naver API로 위치 정합성 검증                                         │
│         ↓                                                                   │
│  5️⃣ 변환 (transform_evaluation_results.py)                                 │
│     └── 최종 데이터 형식으로 변환                                             │
│         ↓                                                                   │
│  6️⃣ DB 삽입 (insert_to_supabase.ts)                                        │
│     └── Supabase에 데이터 저장                                               │
│                                                                             │
│  OUTPUT: data/{yy-mm-dd}/tzuyang_restaurant_results.jsonl 외 다수            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📁 워크플로우 파일

| 파일 | 설명 | 트리거 |
|------|------|--------|
| `api-youtube-urls.yml` | URL 수집 | 2일마다 자동, 수동 |
| `crawling-evaluation.yml` | 크롤링 + 평가 | Transcript 커밋 시, 수동 |

---

## 📂 날짜별 폴더 구조

모든 결과 파일은 파이프라인 시작 날짜 기준으로 동일한 폴더에 저장됩니다.

```
backend/
├── geminiCLI-restaurant-crawling/
│   └── data/
│       ├── 25-12-01/
│       │   ├── tzuyang_youtubeVideo_urls.txt           # URL 목록
│       │   ├── tzuyang_restaurant_transcripts.json     # Transcript (로컬 수집)
│       │   ├── tzuyang_restaurant_results.jsonl        # 크롤링 결과
│       │   ├── tzuyang_restaurant_results_with_meta.jsonl
│       │   ├── tzuyang_no_transcript.log               # Transcript 없는 URL
│       │   └── tzuyang_restaurant_errors.log
│       └── 25-12-03/
│           └── ...
│
├── geminiCLI-restaurant-evaluation/
│   └── data/
│       ├── 25-12-01/
│       │   ├── tzuyang_restaurant_evaluation_selection.jsonl
│       │   ├── tzuyang_restaurant_evaluation_rule_results.jsonl
│       │   ├── tzuyang_restaurant_evaluation_results.jsonl
│       │   ├── tzuyang_restaurant_evaluation_errors.jsonl
│       │   └── tzuyang_restaurant_transforms.jsonl
│       └── 25-12-03/
│           └── ...
│
├── transcript-api/                                     # FastAPI 서버
│   ├── main.py
│   ├── requirements.txt
│   └── services/
│       ├── youtube.py                                  # Transcript 수집
│       └── github.py                                   # Git 커밋/푸시
│
└── log/
    └── geminiCLI-restaurant/
        ├── report/{yy-mm-dd}/
        ├── text/{yy-mm-dd}/
        ├── structured/{yy-mm-dd}/
        └── supabase/{yy-mm-dd}/
```

---

## 🚀 실행 방법

### Part 1: URL 수집 (자동/수동)

**자동 실행**: 2일마다 KST 02:00 (UTC 17:00)

**수동 실행**:
```bash
# GitHub CLI
gh workflow run "api-youtube-urls.yml" --ref github-actions-restaurant

# 또는 GitHub 웹에서
# Actions > "📺 YouTube URL 수집" > Run workflow
```

### Part 2: Transcript 수집 (로컬)

```bash
# 1. FastAPI 서버 시작
cd backend/transcript-api
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# 2. API 엔드포인트
# GET  http://localhost:8000/status      # 상태 확인
# POST http://localhost:8000/collect     # Transcript 수집
# POST http://localhost:8000/commit      # GitHub 커밋

# 3. 또는 웹 UI에서
# - "Transcript 수집" 버튼 클릭
# - 완료 후 "GitHub 커밋" 버튼 클릭
```

**Transcript JSON 형식**:
```json
[
  {
    "youtube_link": "https://www.youtube.com/watch?v=...",
    "transcript": [
      {"start": 0.0, "text": "안녕하세요"},
      {"start": 2.5, "text": "오늘은..."}
    ],
    "collected_at": "2025-01-15T10:30:00"
  }
]
```

### Part 3: 크롤링 + 평가 (자동/수동)

**자동 실행**: Transcript 파일이 커밋되면 자동 트리거

**수동 실행**:
```bash
# 전체 파이프라인
gh workflow run "crawling-evaluation.yml" -f phase=all --ref github-actions-restaurant

# 특정 단계만
gh workflow run "crawling-evaluation.yml" -f phase=crawling --ref github-actions-restaurant
gh workflow run "crawling-evaluation.yml" -f phase=evaluation --ref github-actions-restaurant
gh workflow run "crawling-evaluation.yml" -f phase=transform --ref github-actions-restaurant
gh workflow run "crawling-evaluation.yml" -f phase=insert --ref github-actions-restaurant
```

---

## 🔐 필요한 Secrets

GitHub 저장소의 Settings > Secrets and variables > Actions에서 설정:

| Secret 이름 | 용도 | 사용 단계 |
|------------|------|----------|
| `YOUTUBE_API_KEY_BYEON` | YouTube Data API v3 | URL 수집, 메타데이터 |
| `GOOGLE_API_KEY_BYEON` | Google Gemini API | 크롤링, 평가 |
| `OPENAI_API_KEY_BYEON` | OpenAI API (광고 분석) | 메타데이터 |
| `NAVER_CLIENT_ID_BYEON` | Naver 검색 API | RULE 평가 |
| `NAVER_CLIENT_SECRET_BYEON` | Naver 검색 API | RULE 평가 |
| `NCP_MAPS_KEY_ID_BYEON` | Naver Cloud Maps API | RULE 평가 |
| `NCP_MAPS_KEY_BYEON` | Naver Cloud Maps API | RULE 평가 |
| `SUPABASE_URL` | Supabase 프로젝트 URL | DB 삽입 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role | DB 삽입 |

---

## 🔄 중복 검사 로직

### 모든 날짜 폴더 검사

각 단계에서 **모든 날짜 폴더**를 검사하여 중복을 방지합니다:

| 단계 | 중복 검사 기준 | 검사 파일 |
|------|--------------|----------|
| URL 수집 | `youtube_link` | 모든 폴더의 `tzuyang_youtubeVideo_urls.txt` |
| Transcript 수집 | `youtube_link` | 모든 폴더의 `tzuyang_restaurant_transcripts.json` |
| 크롤링 | `youtube_link` + Transcript 존재 여부 | 모든 폴더의 URL + Transcript 파일 |
| 평가 | `youtube_link` | 모든 폴더의 evaluation 파일 |
| Transform | `unique_id` | 모든 폴더의 `transforms.jsonl` |
| DB 삽입 | `unique_id` | Supabase DB 직접 조회 |

### Transcript 필수 조건

`crawling.sh`는 **Transcript가 있는 URL만 처리**합니다:
- 모든 날짜 폴더에서 URL 수집
- 각 URL에 대해 Transcript 존재 여부 확인
- Transcript 없으면 `tzuyang_no_transcript.log`에 기록 후 스킵

### 자동 커밋으로 영구 보존

1. 각 파이프라인 성공 시 자동 커밋
2. 다음 실행에서 이전 결과를 불러와 중복 검사
3. 신규 데이터만 처리

---

## 📊 실행 결과 확인

### GitHub Actions Summary

각 워크플로우 완료 후 Summary에서 확인:
- 처리 통계 (성공/스킵/에러)
- Transcript 수, URL 수
- 단계별 결과

### Artifacts (30일 보관)

- `url-collection-{run#}`: URL 파일
- `pipeline-results-{run#}`: 크롤링/평가 결과

### Supabase DB

최종 데이터는 `restaurants` 테이블에 저장됩니다.

---

## ⚠️ 주의사항

1. **YouTube IP 차단**: Transcript 수집은 반드시 로컬에서 실행
2. **타임아웃**: 크롤링+평가 파이프라인은 3시간 제한
3. **Rate Limit**: API 호출 사이에 적절한 대기 시간 설정됨
4. **비용**: YouTube, OpenAI, Gemini, Naver API 사용량에 따른 비용 발생

---

## 🔧 트러블슈팅

### Transcript 수집 실패

```
❌ 로컬에서만 실행 가능
YouTube가 클라우드 IP를 차단합니다.
```
→ 로컬에서 FastAPI 서버 실행 후 수집

### 크롤링 스킵됨

```
⏭️ No transcript found for URL, skipping
```
→ 해당 URL의 Transcript를 먼저 수집해야 함

### 파이프라인이 트리거 안 됨

Transcript 커밋 후에도 크롤링이 시작 안 되면:
1. 커밋 경로 확인: `backend/geminiCLI-restaurant-crawling/data/**/tzuyang_restaurant_transcripts.json`
2. 브랜치 확인: `github-actions-restaurant`
3. 수동으로 워크플로우 실행

### 중복 데이터 문제

1. 해당 날짜 폴더의 파일 확인
2. 필요시 해당 날짜 폴더 삭제 후 재실행

---

## 📚 관련 문서

- [프로젝트 설정 가이드](../../docs/SETUP_GUIDE.md)
- [데이터베이스 스키마](../../docs/DATABASE_SCHEMA.dbml)
- [제품 스펙](../../docs/PRODUCT_SPEC.md)
