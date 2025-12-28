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
│   ├── collect_urls.py        # Python: YouTube API로 URL 수집
│   ├── heatmap.js             # Node.js: Puppeteer 히트맵 수집 로직
│   └── collect.js             # Node.js: CLI 히트맵 수집 실행
├── package.json
└── requirements.txt
```

## 🚀 시작하기

### 설치

```bash
cd backend/youtube-heat-map

# Node.js 의존성 (히트맵 수집)
npm install

# Python 의존성 (URL 수집)
pip install -r requirements.txt
```

### 환경변수 설정

```bash
export YOUTUBE_API_KEY="your_api_key_here"
```

## ⚙️ 사용법

### 1. URL 수집 (Python)

```bash
# 채널 영상 수집
python scripts/collect_urls.py --channel-id UCxxxxxx --max-results 50

# 검색어로 수집
python scripts/collect_urls.py --search "키워드" --max-results 20

# 재생목록에서 수집
python scripts/collect_urls.py --playlist-id PLxxxxxx

# 단일 영상 추가
python scripts/collect_urls.py --video-id dQw4w9WgXcQ
```

### 2. 히트맵 수집 (Node.js)

```bash
npm run collect
```

## 📊 데이터 형식

### youtube-urls.txt
```
https://www.youtube.com/watch?v=VIDEO_ID_1
https://www.youtube.com/watch?v=VIDEO_ID_2
```

### {video_id}.jsonl
```json
{
  "videoId": "xxx",
  "collectedAt": "2025-12-27T16:00:00.000Z",
  "meta": {
    "title": "영상 제목",
    "channelId": "UCxxxxxx",
    "channelName": "채널명",
    "description": "영상 설명",
    "keywords": ["태그1", "태그2"],
    "category": "Entertainment",
    "publishDate": "2025-01-01",
    "uploadDate": "2025-01-01"
  },
  "stats": {
    "viewCount": 100000,
    "likeCount": 5000,
    "commentCount": 300
  },
  "videoDurationMs": 600000,
  "heatmapMarkers": [
    {"startMillis": 0, "endMillis": 10000, "intensityScoreNormalized": 0.5}
  ],
  "svgPathData": "M 0.0,100.0 C 1.0,91.4 ..."
}
```

## ⚠️ 주의사항

- **조회수 5만 이상** 영상에서만 히트맵 데이터가 존재합니다.
- 수동으로 챕터가 설정된 영상은 히트맵이 없을 수 있습니다.

## 🔄 GitHub Actions

주간 자동 수집: `.github/workflows/youtube-heatmap.yml`
