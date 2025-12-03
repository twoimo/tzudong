# 🍜 GeminiCLI Restaurant Pipeline

쯔양 유튜브 채널의 음식점 정보를 자동으로 수집하고 평가하는 **통합 파이프라인**입니다.

## 📋 개요

| 항목 | 설명 |
|------|------|
| **워크플로우** | `restaurant-pipeline.yml` (통합 워크플로우) |
| **실행 브랜치** | `github-actions-restaurant` (데이터 전용 브랜치) |
| **결과 저장** | Supabase DB + GitHub 저장소 자동 커밋 |

---

## 🔄 통합 파이프라인

### 📄 `restaurant-pipeline.yml`

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    🍜 Restaurant Pipeline (통합)                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  1️⃣ url-collection                                                          │
│  📹 YouTube URL 수집                                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│  • 쯔양 채널에서 YouTube Video URL 수집 (api-youtube-urls.py)               │
│  • 모든 날짜 폴더의 기존 URL과 중복 검사                                       │
│  • 신규 URL만 저장 → 자동 커밋                                               │
│                                                                             │
│  OUTPUT: data/{yy-mm-dd}/tzuyang_youtubeVideo_urls.txt                      │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  2️⃣ transcript-collection                                                   │
│  📝 Transcript 수집 (Puppeteer)                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  • Puppeteer 기반 자막 수집 (transcript-puppeteer.ts)                        │
│  • 1차: maestra.ai (Primary)                                                │
│  • 2차: tubetranscript.com (Fallback)                                       │
│  • 30개마다 자동 커밋                                                        │
│                                                                             │
│  OUTPUT: data/{yy-mm-dd}/tzuyang_restaurant_transcripts.json                │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  3️⃣ crawling-evaluation                                                     │
│  🍜 크롤링 + 평가                                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1️⃣ 크롤링 (crawling.sh)                                                    │
│     └── Transcript 있는 URL만 처리                                          │
│     └── Gemini CLI로 음식점 정보 추출                                        │
│         ↓                                                                   │
│  2️⃣ 메타데이터 추가 (api-youtube-meta.py)                                   │
│     └── YouTube API + OpenAI로 광고 분석                                     │
│         ↓                                                                   │
│  3️⃣ 평가 (evaluation-pipeline.py)                                          │
│     └── LAAJ 평가 + RULE 평가                                               │
│     └── Naver API로 위치 정합성 검증                                         │
│         ↓                                                                   │
│  4️⃣ 변환 및 DB 삽입                                                         │
│     └── Supabase에 데이터 저장                                               │
│                                                                             │
│  OUTPUT: data/{yy-mm-dd}/tzuyang_restaurant_*.jsonl                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📁 워크플로우 파일

| 파일 | 설명 | 트리거 |
|------|------|--------|
| `restaurant-pipeline.yml` | 통합 파이프라인 (URL → Transcript → 크롤링+평가) | 수동 (workflow_dispatch) |

### 실행 옵션

워크플로우 실행 시 `step` 파라미터로 단계 선택 가능:

| step 옵션 | 설명 |
|-----------|------|
| `all` | 전체 파이프라인 (기본값) |
| `url-collection` | 1단계: URL 수집만 |
| `transcript-collection` | 2단계: Transcript 수집만 |
| `crawling-evaluation` | 3단계: 크롤링+평가만 |

---

## 📂 날짜별 폴더 구조

모든 결과 파일은 파이프라인 시작 날짜(KST) 기준으로 동일한 폴더에 저장됩니다.

```
backend/
├── geminiCLI-restaurant-crawling/
│   ├── scripts/
│   │   ├── transcript-puppeteer.ts     # Puppeteer 자막 수집 스크립트
│   │   ├── crawling.sh                 # 크롤링 스크립트
│   │   ├── api-youtube-urls.py         # URL 수집
│   │   └── api-youtube-meta.py         # 메타데이터 추가
│   └── data/
│       ├── 25-12-03/
│       │   ├── tzuyang_youtubeVideo_urls.txt           # URL 목록
│       │   ├── tzuyang_restaurant_transcripts.json     # Transcript (Puppeteer)
│       │   ├── tzuyang_transcript_errors.json          # Transcript 에러
│       │   ├── tzuyang_restaurant_results.jsonl        # 크롤링 결과
│       │   ├── tzuyang_restaurant_results_with_meta.jsonl
│       │   └── tzuyang_crawling_errors.jsonl
│       └── 25-12-04/
│           └── ...
│
├── geminiCLI-restaurant-evaluation/
│   └── data/
│       └── 25-12-04/
│           ├── tzuyang_restaurant_evaluation_selection.jsonl
│           ├── tzuyang_restaurant_evaluation_rule_results.jsonl
│           ├── tzuyang_restaurant_evaluation_results.jsonl
│           └── tzuyang_restaurant_transforms.jsonl
│
└── log/
    └── geminiCLI-restaurant/
        ├── report/{yy-mm-dd}/
        ├── text/{yy-mm-dd}/
        └── structured/{yy-mm-dd}/
```

### Transcript JSON 형식

```json
[
  {
    "youtube_link": "https://www.youtube.com/watch?v=xxx",
    "language": "ko",
    "collected_at": "2025-12-04T01:30:00+09:00",
    "transcript": [
      {"start": 0.0, "text": "안녕하세요"},
      {"start": 2.5, "text": "오늘은 맛집 투어입니다"}
    ]
  }
]
```

---

## 🚀 실행 방법

### GitHub 웹 UI에서 실행

1. Actions 탭으로 이동
2. **"🍜 Restaurant Pipeline (통합)"** 선택
3. **"Run workflow"** 클릭
4. `step` 선택 (all / url-collection / transcript-collection / crawling-evaluation)
5. **"Run workflow"** 버튼 클릭

### GitHub CLI에서 실행

```bash
# 전체 파이프라인
gh workflow run "restaurant-pipeline.yml" \
  -f step=all \
  --ref github-actions-restaurant

# URL 수집만
gh workflow run "restaurant-pipeline.yml" \
  -f step=url-collection \
  --ref github-actions-restaurant

# Transcript 수집만
gh workflow run "restaurant-pipeline.yml" \
  -f step=transcript-collection \
  --ref github-actions-restaurant

# 크롤링+평가만
gh workflow run "restaurant-pipeline.yml" \
  -f step=crawling-evaluation \
  --ref github-actions-restaurant
```

### 로컬에서 실행 (테스트용)

```bash
cd backend/geminiCLI-restaurant-crawling/scripts

# Transcript 수집 (Puppeteer)
npx ts-node transcript-puppeteer.ts --date 25-12-04

# 크롤링
bash crawling.sh

# 평가
cd ../../geminiCLI-restaurant-evaluation/scripts
python3 evaluation-pipeline.py
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

**증상**: `maestra_fallback_failed` 에러

**해결**:
1. maestra.ai와 tubetranscript.com 모두 해당 영상의 자막이 없음
2. 영상이 자막을 제공하지 않는 경우 (라이브 등)
3. `tzuyang_transcript_errors.json`에서 실패 URL 확인

### 크롤링 스킵됨

**증상**: `No transcript found for URL, skipping`

**해결**: 해당 URL의 Transcript를 먼저 수집해야 함
```bash
# Transcript 수집 단계만 재실행
gh workflow run "restaurant-pipeline.yml" \
  -f step=transcript-collection \
  --ref github-actions-restaurant
```

### 파이프라인 중간 단계 실패

**해결**: 실패한 단계만 재실행
```bash
# 예: 크롤링+평가만 재실행
gh workflow run "restaurant-pipeline.yml" \
  -f step=crawling-evaluation \
  --ref github-actions-restaurant
```

### 중복 데이터 문제

1. 해당 날짜 폴더의 파일 확인
2. 필요시 해당 날짜 폴더 삭제 후 재실행

---

## 📚 관련 문서

- [프로젝트 설정 가이드](../../docs/SETUP_GUIDE.md)
- [데이터베이스 스키마](../../docs/DATABASE_SCHEMA.dbml)
- [제품 스펙](../../docs/PRODUCT_SPEC.md)
