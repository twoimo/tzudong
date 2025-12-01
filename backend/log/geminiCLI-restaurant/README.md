# 📋 GeminiCLI Restaurant Pipeline 로그

이 폴더에는 GeminiCLI 음식점 파이프라인 실행 로그가 저장됩니다.

## 📂 폴더 구조

```
log/geminiCLI-restaurant/
├── README.md                    # 이 파일
├── 25-12-01/                    # 날짜별 폴더 (yy-mm-dd)
│   ├── crawling_20251201_030015.json
│   └── evaluation_20251201_034532.json
├── 25-12-03/
│   ├── crawling_20251203_030012.json
│   └── evaluation_20251203_033845.json
└── ...
```

## 📊 로그 파일 종류

| 파일명 패턴 | 설명 |
|------------|------|
| `crawling_YYYYMMDD_HHMMSS.json` | 크롤링 단계 실행 로그 |
| `evaluation_YYYYMMDD_HHMMSS.json` | LAAJ 평가 단계 실행 로그 |

## 📝 로그 파일 형식

### 크롤링 로그 예시 (`crawling_*.json`)

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
    "total_time_seconds": 235,
    "total_time_formatted": "3m 55s"
  },
  "parser_stats": {
    "total_time_seconds": 12,
    "total_time_formatted": "12s"
  },
  "meta_stats": {
    "success": 1,
    "duration_seconds": 45,
    "duration_formatted": "45s"
  },
  "files": {
    "url_file": "/backend/geminiCLI-restaurant-crawling/data/25-12-01/tzuyang_youtubeVideo_urls.txt",
    "output_file": "/backend/geminiCLI-restaurant-crawling/data/25-12-01/tzuyang_restaurant_results.jsonl",
    "error_log": "/backend/geminiCLI-restaurant-crawling/data/25-12-01/tzuyang_restaurant_errors.log"
  }
}
```

### 평가 로그 예시 (`evaluation_*.json`)

```json
{
  "stage": "evaluation",
  "started_at": "2025-12-01 03:45:32",
  "ended_at": "2025-12-01 04:23:18",
  "duration_seconds": 2266,
  "duration_formatted": "37m 46s",
  "gemini_model": "gemini-2.5-pro",
  "statistics": {
    "total_records": 45,
    "success": 43,
    "failed": 1,
    "skipped": 1,
    "total_restaurants_evaluated": 127,
    "success_rate": "97.73%"
  },
  "gemini_stats": {
    "total_calls": 44,
    "total_time_seconds": 1672,
    "total_time_formatted": "27m 52s",
    "average_time_seconds": 38
  },
  "transcript_stats": {
    "success": 40,
    "failed": 4,
    "total_time_seconds": 198,
    "total_time_formatted": "3m 18s"
  },
  "parser_stats": {
    "total_time_seconds": 8,
    "total_time_formatted": "8s"
  },
  "files": {
    "input_file": "/backend/geminiCLI-restaurant-evaluation/data/25-12-01/tzuyang_restaurant_evaluation_rule_results.jsonl",
    "output_file": "/backend/geminiCLI-restaurant-evaluation/data/25-12-01/tzuyang_restaurant_evaluation_results.jsonl",
    "error_file": "/backend/geminiCLI-restaurant-evaluation/data/25-12-01/tzuyang_restaurant_evaluation_errors.jsonl",
    "error_log": "/backend/geminiCLI-restaurant-evaluation/data/25-12-01/tzuyang_restaurant_evaluation_errors.log"
  }
}
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
jq '.statistics' log/geminiCLI-restaurant/25-12-01/crawling_*.json

# 모든 날짜의 성공률 추출
for f in log/geminiCLI-restaurant/*/crawling_*.json; do
  date=$(dirname "$f" | xargs basename)
  rate=$(jq -r '.statistics.success_rate' "$f")
  echo "$date: $rate"
done

# Gemini 평균 응답 시간 확인
jq '.gemini_stats.average_time_seconds' log/geminiCLI-restaurant/*/evaluation_*.json

# 특정 날짜의 전체 소요 시간
jq '.duration_formatted' log/geminiCLI-restaurant/25-12-01/*.json
```

## ⚠️ 주의사항

1. **날짜 폴더**: 로그는 파이프라인 실행 날짜 기준으로 폴더에 저장됩니다
2. **파일명 타임스탬프**: 파일명의 타임스탬프(`YYYYMMDD_HHMMSS`)는 스크립트 시작 시간입니다
3. **GitHub Actions**: 파이프라인 성공 시 로그 폴더도 자동 커밋됩니다
4. **Artifacts**: GitHub Actions 실행 시 로그는 30일간 Artifacts로도 보관됩니다

## 📁 관련 파일

- **워크플로우**: `.github/workflows/gemini-pipeline.yml`
- **크롤링 스크립트**: `backend/geminiCLI-restaurant-crawling/scripts/crawling.sh`
- **평가 스크립트**: `backend/geminiCLI-restaurant-evaluation/scripts/evaluation.sh`
- **유틸리티**: `backend/utils/data_utils.py`
