# Restaurant Crawling Pipeline

## 전체 파이프라인 흐름

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Restaurant Crawling Pipeline                          │
└─────────────────────────────────────────────────────────────────────────────┘

    ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
    │  01-collect  │     │  02-collect  │     │  03-collect  │     │  04-collect  │
    │    -urls     │────▶│    -meta     │────▶│  -transcript │────▶│   -heatmap   │
    │      .js     │     │     .py      │     │      .js     │     │      .js     │
    └──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
           │                   │                    │                    │
           ▼                   ▼                    ▼                    ▼
      urls.txt           meta/*.jsonl         transcript/         heatmap/*.jsonl
                                               *.jsonl
                                                   │
                                                   ▼
                              ┌──────────────────────────────────────────────┐
                              │         05-extract-place-info.js             │
                              │         (meatcreator 채널만)                  │
                              └──────────────────────────────────────────────┘
                                                   │
                                                   ▼
                                           place_info/*.jsonl
                                                   │
                                                   ▼
                              ┌──────────────────────────────────────────────┐
                              │           06-gemini-crawling.sh              │
                              │                                              │
                              │  meta + transcript → Gemini CLI → 맛집 추출   │
                              └──────────────────────────────────────────────┘
                                                   │
                                                   ▼
                                           crawling/*.jsonl
```

---

## 디렉토리 구조

```
restaurant-crawling/
├── prompts/
│   ├── crawling_prompt.txt          # Gemini 크롤링 프롬프트
│   ├── crawling_with_transcript.yaml
│   ├── crawling_with_place_data.yaml
│   └── crawling_without_place_data.yaml
├── scripts/
│   ├── 01-collect-urls.js           # YouTube 채널에서 영상 URL 수집
│   ├── 02-collect-meta.py           # YouTube API로 메타데이터 수집
│   ├── 03-collect-transcript.js     # 자막 수집 (Maestra/TubeTranscript)
│   ├── 04-collect-heatmap.js        # 히트맵 SVG 수집
│   ├── 05-extract-place-info.js     # 지도 URL에서 장소 정보 추출
│   ├── 06-gemini-crawling.sh        # Gemini CLI로 맛집 정보 추출
│   ├── parse_result.py              # Gemini 응답 파싱
│   └── url-extractor.js             # 지도 URL API 유틸
└── README.md
```

---

## 각 스크립트 상세

### 1. 01-collect-urls.js

YouTube 채널에서 영상 URL 수집

```
┌────────────────────┐
│  YouTube Channel   │
│  (channel_id)      │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ Puppeteer로 채널   │
│ 페이지 스크롤      │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│  urls.txt          │
│  (video URLs)      │
└────────────────────┘
```

**입력:** channels.yaml의 channel_id
**출력:** `data/{channel}/urls.txt`

---

### 2. 02-collect-meta.py

YouTube Data API로 메타데이터 수집

```
┌────────────────────┐
│     urls.txt       │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐     ┌────────────────────┐
│ for each video_id  │────▶│ 이전 meta 있나?    │
└────────────────────┘     └─────────┬──────────┘
                                     │
                          ┌──────────┴──────────┐
                         YES                    NO
                          │                      │
                          ▼                      ▼
              ┌────────────────────┐  ┌────────────────────┐
              │ recollect_id = +1  │  │ recollect_id = 0   │
              │ (재수집)            │  │ (첫 수집)          │
              └─────────┬──────────┘  └─────────┬──────────┘
                        └──────────┬────────────┘
                                   │
                                   ▼
                       ┌────────────────────┐
                       │ YouTube Data API   │
                       │ 메타데이터 조회    │
                       └─────────┬──────────┘
                                 │
                                 ▼
                       ┌────────────────────┐
                       │ meta/{id}.jsonl    │
                       │ (append)           │
                       └────────────────────┘
```

**입력:** `urls.txt`
**출력:** `meta/{video_id}.jsonl`

**출력 필드:**
- `youtube_link`, `channel_name`, `title`, `published_at`
- `duration`, `is_shorts`, `description`, `category`, `tags`
- `stats` (view_count, like_count, comment_count)
- `recollect_id`, `recollect_reason`, `collected_at`
- `ads_info` (is_ads, what_ads)

---

### 3. 03-collect-transcript.js

자막 수집 (Maestra 우선, TubeTranscript fallback)

```
┌────────────────────┐
│     urls.txt       │
└─────────┬──────────┘
          │
          ▼
┌────────────────────────────────────────────┐
│ for each video_id                          │
│                                            │
│ 1. meta recollect_id > transcript recollect_id? │
│ 2. meta duration != transcript meta_duration?   │
└─────────┬──────────────────────────────────┘
          │
     YES (수집 필요)
          │
          ▼
┌────────────────────┐
│ Maestra로 시도     │
│ (Puppeteer)        │
└─────────┬──────────┘
          │
     실패 시
          │
          ▼
┌────────────────────┐
│ TubeTranscript     │
│ (youtube-transcript)│
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ transcript/{id}    │
│ .jsonl (append)    │
└────────────────────┘
```

**입력:** `urls.txt`, `meta/{video_id}.jsonl`
**출력:** `transcript/{video_id}.jsonl`

**출력 필드:**
- `youtube_link`, `language`, `collected_at`
- `recollect_id`, `recollect_reason`
- `transcript` (배열: start, duration, text)

---

### 4. 04-collect-heatmap.js

YouTube 히트맵 SVG 수집 (Puppeteer)

```
┌────────────────────┐
│     urls.txt       │
└─────────┬──────────┘
          │
          ▼
┌────────────────────────────────────────────┐
│ 수집 조건:                                  │
│ 1. meta title/duration 변경                │
│ 2. 스케줄: weekly/biweekly/monthly         │
│ 3. 6개월 이상 된 영상은 스킵               │
└─────────┬──────────────────────────────────┘
          │
          ▼
┌────────────────────┐
│ Puppeteer로        │
│ 유튜브 접속        │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ 프로그레스 바 hover│
│ → SVG path 추출    │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ heatmap/{id}.jsonl │
│ (append)           │
└────────────────────┘
```

**입력:** `urls.txt`, `meta/{video_id}.jsonl`
**출력:** `heatmap/{video_id}.jsonl`

**출력 필드:**
- `youtube_link`, `collected_at`
- `recollect_id`, `recollect_reason`
- `svg_path_data`

---

### 5. 05-extract-place-info.js

지도 URL에서 장소 정보 추출 (meatcreator 채널만)

```
┌────────────────────┐
│ meta description   │
│ 에서 지도 URL 추출 │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ URL 패턴 감지:     │
│ - naver.me         │
│ - kko.to           │
│ - goo.gl           │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ Puppeteer로        │
│ 장소 정보 수집     │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ 좌표 보완:         │
│ - 카카오 Geocoding │
│ - 네이버 검색      │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ place_info/{id}    │
│ .jsonl             │
└────────────────────┘
```

**입력:** `meta/{video_id}.jsonl`
**출력:** `place_info/{video_id}.jsonl`

**출력 필드:**
- `youtube_link`, `collected_at`
- `places` (배열: name, roadAddress, jibunAddress, phone, category, lat, lng, source, mapUrl, placeId)
- `hasPlaceInfo`, `failedUrls`

---

### 6. 06-gemini-crawling.sh

Gemini CLI로 맛집 정보 추출

```
┌────────────────────┐
│     urls.txt       │
└─────────┬──────────┘
          │
          ▼
┌─────────────────────────────────────┐
│ for each video_id                   │
└─────────┬───────────────────────────┘
          │
          ▼
┌─────────────────────────────────────┐
│ 중복 검사:                          │
│ crawling/{id}.jsonl 있으면 SKIP    │
└─────────┬───────────────────────────┘
          │
          ▼
┌─────────────────────────────────────┐
│ 필수 파일 검사:                     │
│ - meta/{id}.jsonl 없으면 SKIP      │
│ - transcript/{id}.jsonl 없으면 SKIP│
└─────────┬───────────────────────────┘
          │
          ▼
┌─────────────────────────────────────┐
│ 메타/자막 최신 줄 로드              │
│ - title, meta_recollect_id         │
│ - transcript, transcript_recollect_id│
└─────────┬───────────────────────────┘
          │
          ▼
┌─────────────────────────────────────┐
│ 프롬프트 생성                       │
│ crawling_prompt.txt + 자막 추가    │
└─────────┬───────────────────────────┘
          │
          ▼
┌─────────────────────────────────────┐
│ Gemini CLI 호출                     │
│ --model gemini-3-flash-preview     │
│ --output-format json --yolo        │
└─────────┬───────────────────────────┘
          │
     ┌────┴────┐
     │         │
   성공      실패
     │         │
     ▼         ▼
┌──────────┐ ┌──────────────────────┐
│ 파서실행 │ │ Fallback 모델 전환   │
│          │ │ (gemini-2.5-flash)   │
└────┬─────┘ └──────────────────────┘
     │
┌────┴────┐
│         │
파싱성공  파싱실패
│         │
▼         ▼
┌─────────────────┐  ┌──────────┐
│ crawling/{id}   │  │ 재시도   │
│ .jsonl 저장     │  │ (최대2회)│
└─────────────────┘  └──────────┘
     │
     ▼
┌─────────────────┐
│ sleep 12s       │
│ (5 RPM 제한)    │
└─────────────────┘
```

**입력:** `urls.txt`, `meta/*.jsonl`, `transcript/*.jsonl`
**출력:** `crawling/{video_id}.jsonl`

**출력 필드:**
```json
{
  "youtube_link": "https://...",
  "restaurants": [
    {
      "name": "음식점명",
      "phone": "전화번호",
      "address": "주소",
      "lat": 37.5,
      "lng": 127.0,
      "category": "고기",
      "reasoning_basis": "판단근거",
      "youtuber_review": "리뷰요약"
    }
  ],
  "recollect_version": {
    "meta": 0,
    "transcript": 0
  }
}
```

---

## recollect_id 시스템

| 스크립트 | 첫 수집 | 재수집 조건 |
|---------|--------|-----------|
| meta | 0 | 항상 (stats 변경 감지) |
| transcript | meta에서 상속 | duration 변경 |
| heatmap | meta에서 상속 | title/duration 변경 or 스케줄 |
| crawling | meta/transcript 참조 | 파일 없을 때만 실행 |

---

## 실행 방법

```bash
# 전체 채널
./scripts/01-collect-urls.js
python scripts/02-collect-meta.py
node scripts/03-collect-transcript.js
node scripts/04-collect-heatmap.js
node scripts/05-extract-place-info.js
./scripts/06-gemini-crawling.sh

# 특정 채널
./scripts/01-collect-urls.js --channel tzuyang
python scripts/02-collect-meta.py --channel tzuyang
node scripts/03-collect-transcript.js --channel tzuyang
node scripts/04-collect-heatmap.js --channel tzuyang
./scripts/06-gemini-crawling.sh --channel tzuyang
```
