# 📋 GeminiCLI Restaurant Pipeline 로그

이 폴더에는 GeminiCLI 음식점 파이프라인 실행 로그가 저장됩니다.

## 📂 폴더 구조

```
log/geminiCLI-restaurant/
├── README.md                       # 이 파일
├── report/                         # 📊 요약 리포트 (.json)
│   └── 25-12-01/                   # 날짜별 폴더 (yy-mm-dd)
│       ├── crawling_143052.json
│       ├── evaluation-rule_150823.json
│       ├── evaluation_160512.json
│       └── youtube-urls_141502.json
├── text/                           # 📄 텍스트 로그 (.log)
│   └── 25-12-01/
│       ├── crawling.log
│       ├── evaluation-rule.log
│       ├── evaluation.log
│       └── youtube-urls.log
├── structured/                     # 📋 구조화 로그 (.jsonl)
│   └── 25-12-01/
│       ├── crawling.jsonl
│       ├── evaluation-rule.jsonl
│       ├── evaluation.jsonl
│       └── youtube-urls.jsonl
└── supabase/                       # 💾 Supabase 삽입 로그 (.json)
    └── 25-12-01/
        └── insert-supabase_143052.json
```

## 📊 로그 파일 종류

### 폴더별 용도

| 폴더 | 확장자 | 용도 |
|------|--------|------|
| `report/` | `.json` | 실행 요약 리포트 (통계, 소요 시간 등) |
| `text/` | `.log` | 사람이 읽기 쉬운 텍스트 로그 |
| `structured/` | `.jsonl` | 프로그래밍 분석용 구조화 로그 |
| `supabase/` | `.json` | Supabase DB 삽입 로그 |

### 단계별 파일

| 파일명 패턴 | 설명 |
|------------|------|
| `youtube-urls_HHMMSS.json` | YouTube URL 수집 단계 |
| `crawling_HHMMSS.json` | 크롤링 단계 |
| `evaluation-rule_HHMMSS.json` | RULE 기반 평가 단계 |
| `evaluation_HHMMSS.json` | LAAJ 평가 단계 |
| `insert-supabase_HHMMSS.json` | Supabase DB 삽입 단계 |

> **Note**: 파일명의 `HHMMSS`는 스크립트 시작 시간 (시분초)

## 📝 로그 파일 형식

### 요약 리포트 예시 (`report/25-12-01/crawling_143052.json`)

```json
{
  "stage": "crawling",
  "started_at": "2025-12-01 03:00:15",
  "ended_at": "2025-12-01 03:45:32",
  "duration_seconds": 2717,
  "duration_formatted": "45m 17s",
  "gemini_model": "gemini-2.5-pro",
  "statistics": {
    "total_urls": 150,
    "success": 45,
    "failed": 2,
    "skipped": 103,
    "success_rate": "95.74%"
  },
  "gemini_stats": {
    "total_calls": 47,
    "total_time_seconds": 1854,
    "total_time_formatted": "30m 54s",
    "average_time_seconds": 39
  },
  "transcript_stats": {
    "success": 42,
    "failed": 5,
    "total_time_seconds": 235
  },
  "files": {
    "url_file": ".../data/25-12-01/tzuyang_youtubeVideo_urls.txt",
    "output_file": ".../data/25-12-01/tzuyang_restaurant_results.jsonl"
  }
}
```

### 텍스트 로그 예시 (`text/25-12-01/crawling.log`)

```
[2025-12-01T14:30:52+09:00] [INFO] ============================================================
[2025-12-01T14:30:52+09:00] [INFO] 🚀 [CRAWLING] 파이프라인 시작
[2025-12-01T14:30:52+09:00] [INFO] ⏰ 시작 시간: 2025-12-01 14:30:52
[2025-12-01T14:30:55+09:00] [INFO] 총 URL: 150개
[2025-12-01T14:31:02+09:00] [SUCCESS] [1/150] 처리 완료: https://youtube.com/watch?v=abc123
[2025-12-01T14:31:45+09:00] [WARNING] 자막 없음: https://youtube.com/watch?v=def456
...
```

### 구조화 로그 예시 (`structured/25-12-01/crawling.jsonl`)

```jsonl
{"timestamp": "2025-12-01T14:30:52+09:00", "level": "INFO", "phase": "crawling", "message": "파이프라인 시작"}
{"timestamp": "2025-12-01T14:31:02+09:00", "level": "SUCCESS", "phase": "crawling", "message": "처리 완료", "data": {"url": "https://youtube.com/watch?v=abc123", "restaurants": 3}}
{"timestamp": "2025-12-01T14:31:45+09:00", "level": "WARNING", "phase": "crawling", "message": "자막 없음", "data": {"url": "https://youtube.com/watch?v=def456"}}
```

## 📈 주요 지표 설명

### 통계 (statistics)

| 필드 | 설명 |
|------|------|
| `total_urls` / `total_records` | 처리 대상 총 개수 |
| `success` | 성공적으로 처리된 개수 |
| `failed` | 처리 실패 개수 |
| `skipped` | 이미 처리되어 건너뛴 개수 (중복 방지) |
| `success_rate` | 성공률 (success / (success + failed)) |
| `total_restaurants_evaluated` | 평가된 음식점 총 개수 (evaluation 전용) |

### Gemini 통계 (gemini_stats)

| 필드 | 설명 |
|------|------|
| `total_calls` | Gemini API 호출 총 횟수 |
| `total_time_seconds` | Gemini 응답 총 소요 시간 |
| `average_time_seconds` | Gemini 응답 평균 소요 시간 |

### 자막 통계 (transcript_stats)

| 필드 | 설명 |
|------|------|
| `success` | 자막 로드 성공 개수 |
| `failed` | 자막 로드 실패 개수 (자막 없는 영상) |
| `total_time_seconds` | 자막 로드 총 소요 시간 |

## 🔍 로그 분석 명령어

```bash
# 특정 날짜의 크롤링 통계 확인
jq '.statistics' log/geminiCLI-restaurant/report/25-12-01/crawling_*.json

# 모든 날짜의 성공률 추출
for f in log/geminiCLI-restaurant/report/*/crawling_*.json; do
  date=$(dirname "$f" | xargs basename)
  rate=$(jq -r '.statistics.success_rate' "$f")
  echo "$date: $rate"
done

# Gemini 평균 응답 시간 확인
jq '.gemini_stats.average_time_seconds' log/geminiCLI-restaurant/report/*/evaluation_*.json

# 특정 날짜의 전체 소요 시간
jq '.duration_formatted' log/geminiCLI-restaurant/report/25-12-01/*.json

# 텍스트 로그에서 에러만 추출
grep "\[ERROR\]" log/geminiCLI-restaurant/text/25-12-01/*.log

# 구조화 로그에서 WARNING 이상 필터링
cat log/geminiCLI-restaurant/structured/25-12-01/crawling.jsonl | \
  jq -c 'select(.level == "WARNING" or .level == "ERROR")'
```

## ⚠️ 주의사항

1. **폴더 구조**: 로그는 `report/`, `text/`, `structured/` 세 폴더로 분리되어 저장됩니다
2. **날짜 폴더**: 각 폴더 안에 실행 날짜 기준 `yy-mm-dd` 폴더가 생성됩니다
3. **파일명**: 타임스탬프는 `HHMMSS` 형식 (시분초)으로 스크립트 시작 시간입니다
4. **GitHub Actions**: 파이프라인 성공 시 로그 폴더도 자동 커밋됩니다
5. **Artifacts**: GitHub Actions 실행 시 로그는 30일간 Artifacts로도 보관됩니다

## 📁 관련 파일

- **워크플로우**: `.github/workflows/gemini-pipeline.yml`
- **로거 모듈**: `backend/utils/logger.py`
- **데이터 유틸리티**: `backend/utils/data_utils.py`
- **크롤링 스크립트**: `backend/geminiCLI-restaurant-crawling/scripts/crawling.sh`
- **평가 스크립트**: `backend/geminiCLI-restaurant-evaluation/scripts/evaluation.sh`
