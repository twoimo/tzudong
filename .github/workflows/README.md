# 🍜 GeminiCLI Restaurant Pipeline

쯔양 유튜브 채널의 음식점 정보를 자동으로 수집하고 평가하는 GitHub Actions 파이프라인입니다.

## 📋 개요

| 항목 | 설명 |
|------|------|
| **실행 브랜치** | `github-actions-restaurant` (데이터 전용 브랜치) |
| **실행 주기** | 2일마다 KST 02:00 (UTC 17:00) 자동 실행 (main) |
| **트리거** | `schedule` (main), `workflow_dispatch` (수동) |
| **타임아웃** | 3시간 (180분) |
| **결과 저장** | Supabase DB + GitHub 저장소 자동 커밋 |

### 브랜치 전략

| 트리거 | 실행 브랜치 | 데이터 저장 위치 |
|--------|------------|-----------------|
| `schedule` (2일마다) | main | main 브랜치에 커밋 |
| `workflow_dispatch` (수동) | 선택한 브랜치 | 해당 브랜치에 커밋 |

> **💡 권장**: `github-actions-restaurant` 브랜치에서 파이프라인을 실행하여 데이터를 분리 관리하세요.

---

## 🔄 파이프라인 단계

```
┌─────────────────────────────────────────────────────────────────┐
│                    GitHub Actions Pipeline                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1️⃣ YouTube URL 수집 (api-youtube-urls.py)                      │
│     └── 쯔양 채널의 모든 동영상 URL 수집                           │
│         ↓                                                       │
│  2️⃣ 크롤링 (crawling.sh)                                        │
│     └── Gemini CLI로 음식점 정보 추출                             │
│         ↓                                                       │
│  3️⃣ 메타데이터 추가 (api-youtube-meta.py)                        │
│     └── YouTube API + OpenAI로 광고 분석                         │
│         ↓                                                       │
│  4️⃣ LAAJ 평가 (evaluation.sh)                                   │
│     └── Gemini CLI로 5개 항목 평가                               │
│         ↓                                                       │
│  5️⃣ RULE 평가 (evaluation-rule.py)                              │
│     └── Naver API로 위치 정합성 검증                              │
│         ↓                                                       │
│  6️⃣ 변환 (transform_evaluation_results.py)                      │
│     └── 최종 데이터 형식으로 변환                                  │
│         ↓                                                       │
│  7️⃣ DB 삽입 (insert_to_supabase.ts)                             │
│     └── Supabase에 데이터 저장                                   │
│         ↓                                                       │
│  8️⃣ 자동 커밋                                                    │
│     └── data/ 폴더를 실행 브랜치에 커밋 (중복 방지용)              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📂 날짜별 폴더 구조

모든 결과 파일은 파이프라인 시작 날짜 기준으로 동일한 폴더에 저장됩니다.

```
backend/
├── geminiCLI-restaurant-crawling/
│   └── data/
│       ├── 25-12-01/
│       │   ├── tzuyang_youtubeVideo_urls.txt      # 수집된 URL
│       │   ├── tzuyang_restaurant_results.jsonl   # 크롤링 결과
│       │   ├── tzuyang_restaurant_results_with_meta.jsonl  # 메타 포함
│       │   └── tzuyang_restaurant_errors.log      # 에러 로그
│       ├── 25-12-03/
│       └── ...
│
├── geminiCLI-restaurant-evaluation/
│   └── data/
│       ├── 25-12-01/
│       │   ├── tzuyang_restaurant_evaluation_selection.jsonl
│       │   ├── tzuyang_restaurant_evaluation_rule_results.jsonl
│       │   ├── tzuyang_restaurant_evaluation_results.jsonl
│       │   ├── tzuyang_restaurant_evaluation_errors.jsonl
│       │   └── tzuyang_restaurant_transforms.jsonl  # 최종 결과
│       ├── 25-12-03/
│       └── ...
│
└── log/
    └── geminiCLI-restaurant/
        ├── report/
        │   └── 25-12-01/
        │       ├── crawling_143052.json
        │       ├── evaluation-rule_150823.json
        │       └── evaluation_160512.json
        ├── text/
        │   └── 25-12-01/
        │       └── *.log
        ├── structured/
        │   └── 25-12-01/
        │       └── *.jsonl
        └── supabase/
            └── 25-12-01/
                └── insert-supabase_213642.json
```

### 📅 날짜 폴더 통일

- 파이프라인 시작 시 `PIPELINE_DATE` 환경변수 설정 (예: `25-12-01`)
- 모든 스크립트가 동일한 날짜 폴더 사용
- 자정을 넘겨도 같은 폴더에 저장

---

## 🔐 필요한 Secrets

GitHub 저장소의 Settings > Secrets and variables > Actions에서 설정:

| Secret 이름 | 설명 |
|------------|------|
| `YOUTUBE_API_KEY_BYEON` | YouTube Data API v3 키 |
| `OPENAI_API_KEY_BYEON` | OpenAI API 키 (광고 분석용) |
| `GEMINI_API_KEY_BYEON` | Google Gemini API 키 |
| `NAVER_CLIENT_ID_BYEON` | Naver 검색 API Client ID |
| `NAVER_CLIENT_SECRET_BYEON` | Naver 검색 API Client Secret |
| `NCP_MAPS_KEY_ID_BYEON` | Naver Cloud Platform Maps API Key ID |
| `NCP_MAPS_KEY_BYEON` | Naver Cloud Platform Maps API Key |
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key |

---

## 🚀 수동 실행 방법

### 1. GitHub 웹에서 실행

1. Actions 탭 클릭
2. "🍜 GeminiCLI Restaurant Pipeline" 선택
3. "Run workflow" 버튼 클릭
4. **"Use workflow from"에서 `github-actions-restaurant` 브랜치 선택**
5. 실행할 단계 선택:
   - `all`: 전체 파이프라인
   - `crawling`: 크롤링만
   - `evaluation`: 평가만
   - `transform`: 변환만
   - `insert`: DB 삽입만

### 2. GitHub CLI로 실행

```bash
# github-actions-restaurant 브랜치에서 전체 파이프라인 실행
gh workflow run "gemini-pipeline.yml" -f phase=all --ref github-actions-restaurant

# 특정 단계만 실행
gh workflow run "gemini-pipeline.yml" -f phase=crawling --ref github-actions-restaurant
gh workflow run "gemini-pipeline.yml" -f phase=evaluation --ref github-actions-restaurant
gh workflow run "gemini-pipeline.yml" -f phase=insert --ref github-actions-restaurant
```

---

## 🔄 중복 검사 로직

### 데이터 중복 방지

각 단계에서 **모든 날짜 폴더**의 기존 데이터를 확인하여 중복 처리를 방지합니다.

| 단계 | 중복 검사 기준 |
|------|--------------|
| URL 수집 | `youtube_link` (모든 폴더의 urls.txt) |
| 크롤링 | `youtube_link` (모든 폴더의 results.jsonl) |
| 평가 | `youtube_link` (모든 폴더의 evaluation 파일) |
| Transform | `unique_id` (모든 폴더의 transforms.jsonl) |
| DB 삽입 | `unique_id` (Supabase DB 직접 조회) |

### 자동 커밋으로 영구 보존

1. 파이프라인 성공 시 `data/` 폴더를 실행 브랜치에 커밋
2. 다음 실행에서 이전 결과를 불러와 중복 검사
3. 신규 데이터만 처리

> **참고**: 브랜치별로 데이터가 분리 저장되므로, `github-actions-restaurant` 브랜치 사용 권장

---

## 📊 실행 결과 확인

### 1. GitHub Summary

파이프라인 완료 후 Actions 탭에서 Summary 확인:
- 처리 통계 (성공/실패/스킵)
- 단계별 소요 시간
- 상세 통계

### 2. Artifacts

30일간 보관되는 결과 파일:
- `pipeline-results-{run#}`: 모든 jsonl, txt 파일
- `pipeline-logs-{run#}`: JSON 로그 파일

### 3. Supabase DB

최종 데이터는 Supabase `restaurants` 테이블에 저장됩니다.

---

## 📝 로그 파일 형식

각 단계별로 JSON 로그 파일이 생성됩니다.

```json
{
  "stage": "crawling",
  "started_at": "2025-12-01 03:01:30",
  "ended_at": "2025-12-01 03:45:12",
  "duration_seconds": 2622,
  "duration_formatted": "43m 42s",
  "statistics": {
    "total_urls_processed": 12,
    "successful_extractions": 11,
    "failed_extractions": 1,
    "total_restaurants_found": 34
  },
  "gemini_stats": {
    "total_calls": 24,
    "total_time_seconds": 1856,
    "average_time_seconds": 77
  }
}
```

---

## ⚠️ 주의사항

1. **타임아웃**: 3시간 내에 완료되지 않으면 실패 처리됨
2. **Rate Limit**: 각 API 호출 사이에 적절한 대기 시간 설정됨
3. **비용**: YouTube, OpenAI, Gemini API 사용량에 따른 비용 발생
4. **저장소 용량**: data 폴더가 커밋되므로 저장소 용량 증가 주의

---

## 🔧 트러블슈팅

### 파이프라인 실패 시

1. Actions 탭에서 실패한 step 확인
2. 로그에서 에러 메시지 확인
3. Secrets 설정 확인
4. API 할당량 확인

### 중복 데이터 문제

1. 해당 날짜 폴더의 파일 확인
2. `unique_id` 또는 `youtube_link` 중복 여부 확인
3. 필요시 해당 날짜 폴더 삭제 후 재실행

### 자동 커밋 실패

1. `permissions: contents: write` 설정 확인
2. 브랜치 보호 규칙 확인
3. 변경사항이 있는지 확인

---

## 📈 모니터링

### 정상 작동 확인

- 2일마다 새로운 날짜 폴더 생성 여부
- Supabase DB에 신규 레코드 추가 여부
- GitHub Actions 실행 기록

### 알림 설정 (선택)

GitHub Actions에서 실패 시 이메일 알림을 받으려면:
1. Settings > Notifications에서 Actions 알림 활성화
2. 또는 Slack/Discord 웹훅 추가 가능

---

## 📚 관련 문서

- [프로젝트 설정 가이드](../../docs/SETUP_GUIDE.md)
- [데이터베이스 스키마](../../docs/DATABASE_SCHEMA.dbml)
- [제품 스펙](../../docs/PRODUCT_SPEC.md)
