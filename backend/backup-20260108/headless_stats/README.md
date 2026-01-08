# Headless Stats

이 폴더는 Headless 모드로 실행된 파이프라인의 집계 결과를 저장하는 곳입니다.

## 파일 구조

```
headless_stats/
├── crawling_stats_YYYYMMDD_HHMMSS.json  # 수집 파이프라인 통계
├── evaluation_stats_YYYYMMDD_HHMMSS.json  # 평가 파이프라인 통계
└── pipeline_stats_YYYYMMDD_HHMMSS.json  # 전체 파이프라인 통계
```

## 통계 데이터 형식

### crawling_stats (수집 통계)
```json
{
  "start_time": "2024-01-01T00:00:00",
  "end_time": "2024-01-01T01:00:00",
  "duration_seconds": 3600,
  "total_urls": 100,
  "processed_urls": 95,
  "failed_urls": 5,
  "total_restaurants": 285,
  "error_details": [
    {
      "url": "https://youtube.com/...",
      "error": "Timeout error"
    }
  ]
}
```

### evaluation_stats (평가 통계)
```json
{
  "start_time": "2024-01-01T01:00:00",
  "end_time": "2024-01-01T02:00:00",
  "duration_seconds": 3600,
  "total_restaurants": 285,
  "evaluated_restaurants": 280,
  "failed_evaluations": 5,
  "average_evaluation_time": 12.5,
  "error_details": [
    {
      "restaurant_name": "식당명",
      "error": "Evaluation timeout"
    }
  ]
}
```

### pipeline_stats (전체 파이프라인 통계)
```json
{
  "start_time": "2024-01-01T00:00:00",
  "end_time": "2024-01-01T02:00:00",
  "total_duration_seconds": 7200,
  "crawling": {
    "duration_seconds": 3600,
    "success_rate": 95.0,
    "total_restaurants": 285
  },
  "evaluation": {
    "duration_seconds": 3600,
    "success_rate": 98.2,
    "evaluated_count": 280
  },
  "overall_success_rate": 96.5
}
```

## 사용 방법

### 1. 수집 파이프라인 실행
```bash
cd backend/perplexity-restaurant-crawling
python headless-crawling-pipeline.py
```

### 2. 평가 파이프라인 실행
```bash
cd backend/perplexity-restaurant-evaluation
python headless-evaluation-pipeline.py
```

### 3. 전체 파이프라인 실행
```bash
cd backend
python headless-restaurant-pipeline.py
```

## 참고사항

- 모든 통계 파일은 타임스탬프로 구분됩니다
- 에러 발생 시 상세 에러 정보가 `error_details` 배열에 저장됩니다
- 통계 파일을 분석하여 파이프라인 성능을 모니터링할 수 있습니다
