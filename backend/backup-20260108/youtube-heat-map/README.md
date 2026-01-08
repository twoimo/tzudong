# 🎬 YouTube Heatmap Scraper

YouTube 영상의 **"가장 많이 다시 재생된 구간(Most Replayed)"** 히트맵 데이터를 수집하는 서비스입니다.

## 📁 폴더 구조

```
youtube-heat-map/
├── data/
│   ├── heatMaps/              # {video_id}.jsonl 파일들
│   └── urls/
│       └── youtube-urls.txt   # 수집 대상 URL 목록
├── scripts/
│   ├── collect_urls.py        # Python: 쯔양 채널 URL 수집
│   ├── heatmap.js             # Node.js: Puppeteer 히트맵 수집 로직
│   └── collect.js             # Node.js: CLI 히트맵 수집 실행
├── package.json
└── requirements.txt
```

## 🚀 시작하기

### 설치

```bash
cd backend/youtube-heat-map

# Node.js 의존성
npm install

# Python 의존성
pip install -r requirements.txt
```

### 환경변수

```bash
export YOUTUBE_API_KEY_BYEON="your_api_key"
```

## ⚙️ 사용법

### 1. URL 수집

```bash
python scripts/collect_urls.py        # 기본 50개
python scripts/collect_urls.py 100    # 100개 수집
```

### 2. 히트맵 수집

```bash
npm run collect
```

## 📊 데이터 형식

### {video_id}.jsonl
```json
{
  "videoId": "xxx",
  "collectedAt": "2025. 12. 28. 오후 4:30:00",
  "meta": {
    "title": "영상 제목",
    "description": "영상 설명",
    "keywords": ["태그1", "태그2"],
    "category": "Entertainment",
    "publishDate": "2025-01-01"
  },
  "stats": {
    "viewCount": 100000,
    "likeCount": 5000,
    "commentCount": 300
  },
  "videoDurationMs": 600000,
  "heatmapMarkers": [...],
  "svgPathData": "M 0.0,100.0 C 1.0,91.4 ..."
}
```

## 📅 점진적 스케줄링

수집 간격이 점진적으로 늘어납니다:

| 수집 횟수 | 다음 수집 간격 |
|----------|---------------|
| 0회 (신규) | 즉시 |
| 1회 | 1주 후 |
| 2회 | 2주 후 |
| ... | ... |
| 12회+ | 12주 후 (최대) |

## 🔄 GitHub Actions

**실행 시간 (한국 시간, 매일):**
- 09:00, 15:00, 21:00

**설정:**
- 회당 최대 50개 URL 처리
- 10개마다 자동 커밋/푸시

### Rate Limiting

| 조건 | 대기 시간 |
|------|----------|
| 매 영상 | 2~5초 |
| 5개마다 | 10~15초 |
| 10개마다 | 30~40초 |

## ⚠️ 주의사항

- **조회수 5만 이상** 영상에서만 히트맵 존재
- 수동 챕터 설정된 영상은 히트맵 없음
