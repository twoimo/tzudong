# Restaurant Crawling Pipeline

유튜브 영상에서 맛집 정보를 수집하는 파이프라인입니다.

---

## 전체 흐름

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Phase 1: 기초 데이터 수집                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  urls.txt → 01-collect-urls.py → 02-collect-meta.py                         │
│                                       ↓                                      │
│                              03-collect-transcript.js                        │
│                                       ↓                                      │
│                              04-collect-heatmap.js                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                        ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Phase 2: 맛집 정보 수집                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  05-map-url-crawling.js (지도 URL → 직접 수집) [정육왕 전용]          │   │
│   │                                                                     │   │
│   │  description에서 지도 URL 추출                                        │   │
│   │         ↓                                                           │   │
│   │  ┌──────────────────────────────────────────────────────────────┐   │   │
│   │  │ 네이버/카카오/구글 지도 → Puppeteer 수집                        │   │   │
│   │  │         ↓                                                    │   │   │
│   │  │ 네이버 검색 API 보완 (시군구 비교)                              │   │   │
│   │  │         ↓                                                    │   │   │
│   │  │ NCP 지오코딩 + 20m 검증                                       │   │   │
│   │  │         ↓                                                    │   │   │
│   │  │ Gemini CLI → youtuber_review, category 추출                  │   │   │
│   │  │    • Enum 검증 (naver_name, category)                        │   │   │
│   │  │    • 검증 실패 시 최대 3회 재시도                               │   │   │
│   │  └──────────────────────────────────────────────────────────────┘   │   │
│   │         ↓ 성공                    ↓ 실패                            │   │
│   │  map_url_crawling/{video_id}.jsonl   (저장 안 됨 → 06으로)           │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  06-gemini-crawling.sh (자막 → Gemini CLI 추출) [쯔양]              │   │
│   │                                                                     │   │
│   │  스킵 조건:                                                          │   │
│   │    - crawling/{video_id}.jsonl 존재                                 │   │
│   │    - map_url_crawling/{video_id}.jsonl 존재                         │   │
│   │         ↓                                                           │   │
│   │  meta + transcript → Gemini CLI → parse_result.py                   │   │
│   │         ↓                                                           │   │
│   │  파싱 실패 시 2회 재시도 (Gemini 재호출)                               │   │
│   │         ↓                                                           │   │
│   │  crawling/{video_id}.jsonl                                          │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🤖 자동화 (Daily Pipeline)

**`backend/run_daily.sh`** 스크립트를 통해 매일 새벽 4시에 전체 파이프라인이 순차적으로 실행됩니다.

### Crontab 설정
```bash
# 매일 새벽 4시 00분 실행 (로그 저장)
0 4 * * * /home/ubuntu/tzudong/backend/run_daily.sh >> /home/ubuntu/tzudong/backend/log/cron/daily_$(date +\%Y-\%m-\%d).log 2>&1
```

### 실행 순서
`urls.txt` → `01` (탐색) → `02` (메타/스케줄) → `04` (히트맵 5일차) → `03` (자막)

---

## 01-collect-urls.py

### 기능
YouTube 채널의 모든 동영상 URL을 수집합니다.

### 입력
- YouTube Data API (채널 업로드 플레이리스트)

### 출력
| 파일 | 형식 |
|------|------|
| `urls/urls.txt` | URL 1개/줄 |

### 저장 조건
- **항상 저장** (기존 URL에 append)

### 중복 처리
```python
existing_urls = set()
for line in f:
    url = line.strip()
    if url and url.startswith("http"):
        existing_urls.add(url)
# 기존에 없는 URL만 추가
```

---

## 02-collect-meta.py

### 기능
YouTube Data API로 영상 메타데이터를 수집하고, 광고 분석을 수행합니다.

### 입력
| 소스 | 파일 |
|------|------|
| URLs | `urls/urls.txt` |
| 이전 메타 | `meta/{video_id}.jsonl` |

### 출력
| 파일 |
|------|
| `meta/{video_id}.jsonl` |

### 저장 조건 (Data Collection Strategy)

스크립트는 **매일 실행**되지만, 데이터 **저장(수집)** 은 다음 규칙을 따릅니다.

| 영상 연령 (D+일) | 저장 주기 (Schedule) | 목적 | 비고 |
| :--- | :--- | :--- | :--- |
| **D+0 ~ D+5** | **저장 안 함** (Skip) | 조회수 불안정 시기 | 단, 최초 1회는 무조건 저장 |
| **D+5 ~ D+30** | **주 1회** 저장 (Weekly) | 초기 조회수 추이 확인 | 매주 특정 요일에 저장 |
| **D+30 ~ D+60** | **월 1회** 저장 (Monthly) | 중장기 데이터 확보 | 매월 특정 일에 저장 |
| **D+60 이후** | **저장 중단** (None) | 아카이빙 완료 | 정기 수집 종료 |

> **💡 중요**: 위 스케줄과 관계없이, **[제목 / 썸네일 / 영상길이]** 중 하나라도 변경되면 **즉시 저장**합니다.
4. **썸네일 백필**: `thumbnails/`에 파일이 없으면 자동 다운로드

### recollect 관리 (`recollect_vars`)
기존 `recollect_reason` (String)에서 **`recollect_vars` (List)** 로 변경되었습니다.

```python
# 변경 감지 (List 반환)
recollect_vars = detect_changes(meta, previous_meta)
# 예: ["duration_changed", "scheduled_weekly", "thumbnail_changed"]


# recollect_id 설정
if previous_meta:
    prev_recollect_id = previous_meta.get("recollect_id", 0)
    new_recollect_id = prev_recollect_id + 1
else:
    new_recollect_id = 0

meta["recollect_id"] = new_recollect_id
meta["recollect_vars"] = recollect_vars  # List[str]
meta["collected_at"] = datetime.now(KST).isoformat()
```

### 출력 구조
```json
{
  "youtube_link": "https://www.youtube.com/watch?v={video_id}",
  "channel_name": "tzuyang",
  "title": "영상 제목",
  "published_at": "2025-12-01T00:00:00Z",
  "duration": 1234,
  "is_shorts": false,
  "description": "영상 설명 (500자)",
  "category": "22",
  "tags": ["태그1", "태그2"],
  "stats": {
    "view_count": 123456,
    "like_count": 1234,
    "comment_count": 100
  },
  "recollect_id": 3,
  "recollect_vars": ["scheduled_weekly", "thumbnail_changed"],
  "collected_at": "2025-12-01T12:00:00+09:00",
  "ads_info": {
    "is_ads": false,
    "what_ads": null
  }
}
```

---

## 03-collect-transcript.js

### 기능
Puppeteer로 maestra.ai / tubetranscript.com에서 자막을 수집합니다.

### 입력
| 소스 | 파일 |
|------|------|
| URLs | `urls/urls.txt` |
| meta | `meta/{video_id}.jsonl` |
| 이전 자막 | `transcript/{video_id}.jsonl` |

### 출력
| 파일 |
|------|
| `transcript/{video_id}.jsonl` |

### 수집 조건
```javascript
// meta.recollect_id > transcript.recollect_id
// AND (신규 OR meta.recollect_vars에 "duration_changed" 포함)
if (!latestTranscript || recollectVars.includes("duration_changed")) {
    toCollect.push({ videoId, recollectVars, metaRecollectId });
}
```

### 저장되는 경우
1. 신규 영상 (transcript 파일 없음)
2. duration_changed (영상 길이 변경)

### 저장되지 않는 경우
1. 이미 수집됨 (recollect_id 동일)
2. title_changed만 발생 (자막과 무관)

### 출력 구조
```json
{
  "youtube_link": "https://www.youtube.com/watch?v={video_id}",
  "language": "ko",
  "collected_at": "2025-12-01T12:00:00+09:00",
  "transcript": [
    { "start": 0, "text": "첫 번째 세그먼트" },
    { "start": 5.5, "text": "두 번째 세그먼트" }
  ],
  "recollect_id": 0,
  "recollect_vars": []
}
```

---

## 04-collect-heatmap.js

### 기능
Puppeteer로 YouTube 히트맵(SVG 경로)을 수집합니다.

### 입력
| 소스 | 파일 |
|------|------|
| URLs | `urls/urls.txt` |
| meta | `meta/{video_id}.jsonl` |
| 이전 히트맵 | `heatmap/{video_id}.jsonl` |

### 출력
| 파일 |
|------|
| `heatmap/{video_id}.jsonl` |

### 수집 조건
```javascript
// (신규 OR title_changed OR duration_changed OR 주기적 수집)
// AND (업로드 5일 경과)

// 참고: 메타데이터 변경(ID 증가) 없이도 주기적 수집 가능
```

### 저장되는 경우
1. 신규 영상
2. title_changed
3. duration_changed
4. 주기적 수집 (publish 후 일정 기간)

### 저장되지 않는 경우
1. SVG path 추출 실패 (`svg_not_found`)
2. **업로드 5일 미만** 영상 (히트맵 생성 대기)

### 출력 구조
```json
{
  "youtube_link": "https://www.youtube.com/watch?v={video_id}",
  "collected_at": "2025-12-01T12:00:00+09:00",
  "recollect_id": 0,
  "recollect_vars": ["title_changed"],
  "svg_path_data": "M0,0 L100,50..."
}
```

---

## 05-map-url-crawling.js (정육왕 전용)

### 기능
영상 설명에서 지도 URL을 추출하고 Puppeteer로 장소 정보를 수집합니다.
Gemini CLI로 자막에서 youtuber_review, category, reasoning_basis를 추출합니다.

### 입력
| 소스 | 파일 | 용도 |
|------|------|------|
| URLs | `urls/urls.txt` | 수집 대상 목록 |
| meta | `meta/{video_id}.jsonl` | description에서 지도 URL 추출 |
| transcript | `transcript/{video_id}.jsonl` | Gemini CLI에서 리뷰 추출 |
| crawling | `crawling/{video_id}.jsonl` | 중복 검사 (이미 06으로 수집된 경우 스킵) |

### 출력
| 파일 |
|------|
| `map_url_crawling/{video_id}.jsonl` |

### 중복 검사
```javascript
// 05 결과(map_url_crawling) 또는 06 결과(crawling)가 이미 존재하면 스킵
const mapUrlCrawlingFile = path.join(mapUrlCrawlingDir, `${videoId}.jsonl`);
const crawlingFile = path.join(crawlingDir, `${videoId}.jsonl`); // 06 결과 확인

if (fs.existsSync(mapUrlCrawlingFile) || fs.existsSync(crawlingFile)) {
    skipped++;
    continue;  // 이미 처리됨
}
```

### 처리 흐름

#### 1. 지도 URL 추출
```javascript
// extractMapUrls()
patterns = [
    /naver\.com|naver\.me/,  // 네이버 지도
    /kakao\.com|kko\.to/,    // 카카오 지도
    /google\.com|goo\.gl|maps\.app/  // 구글 지도
];
```

#### 2. Puppeteer 수집
- 네이버: `collectFromNaverMap()` → name, address, 좌표
- 카카오: `collectFromKakaoMap()` → name, address
- 구글: `collectFromGoogleMap()` → name, address, 좌표

#### 3. 네이버 검색 보완
```javascript
// enrichWithNaverSearch()
// 검색 실패 → null 반환 (저장 안 됨)
if (!naverResults || naverResults.length === 0) {
    log('warning', `네이버 검색 실패 (폐업 등): ${placeInfo.origin_name}`);
    return null;
}

// 시군구 불일치 → null 반환 (저장 안 됨)
if (!matched) {
    log('warning', `시군구 일치 항목 없음 (실패 처리): ${placeInfo.origin_name}`);
    return null;
}

// 성공 시 필드 설정 (origin_name은 collect 함수에서 이미 설정됨)
placeInfo.naver_name = matched.name;      // 네이버 검색 상호명
placeInfo.jibunAddress = matched.address;     // 지번주소
placeInfo.roadAddress = matched.roadAddress;  // 도로명주소

// 주의: category는 여기서 설정하지 않음 (Gemini가 자막 분석 후 설정)
```

#### 4. 지오코딩 검증
```javascript
// verifyAndGeocode()
// 주소 없음 → null 반환
if (!addressToGeocode) return null;

// 지오코딩 실패 → null 반환
if (!geocodeResult) return null;

// 원본 좌표 있고 20m 초과 → null 반환
if (distance > 20) {
    log('warning', `좌표 20m 초과 (실패): ${placeInfo.naver_name}`);
    return null;
}
```

#### 5. 필수 필드 검증
```javascript
// hasRequiredFields()
if (!placeInfo.naver_name) return false;   // 네이버 검색 통과 필수
if (!placeInfo.jibunAddress) return false; // 지번주소 필수
if (placeInfo.lat == null || placeInfo.lng == null) return false; // 좌표 필수
```

#### 6. Gemini CLI로 리뷰/카테고리 추출
```javascript
// extractYoutuberReview()
// 프롬프트에 naver_name 목록과 영상 정보 전달
// 응답에서 각 음식점별 youtuber_review, category, reasoning_basis 추출

// Enum 검증 (naver_name)
if (!review.naver_name || !placeNames.includes(review.naver_name)) {
    throw new Error(`naver_name Enum 검증 실패: ${review.naver_name}`);
}

// Enum 검증 (category)
if (review.category && !VALID_CATEGORIES.includes(review.category)) {
    throw new Error(`category Enum 검증 실패: ${review.category}`);
}

// 검증 실패 시 throw Error → catch에서 재시도 (최대 3회)
```

카테고리 Enum:
```javascript
const VALID_CATEGORIES = [
    '치킨', '중식', '돈까스·회', '피자', '패스트푸드', '찜·탕',
    '족발·보쌈', '분식', '카페·디저트', '한식', '고기', '양식', '아시안', '야식', '도시락'
];
```

### 저장되는 경우
모든 조건 통과:
1. 지도 URL 추출 성공
2. Puppeteer 수집 성공 (name, address 존재)
3. 네이버 검색 통과 (시군구 일치)
4. 지오코딩 성공 (20m 이내)
5. 필수 필드 존재 (naver_name, jibunAddress, lat, lng)
6. Gemini CLI 성공 (Enum 검증 통과)

### 저장되지 않는 경우
1. 지도 URL 없음
2. Puppeteer 수집 실패 (name/address 없음)
3. 네이버 검색 실패 (폐업 등)
4. 시군구 불일치
5. 지오코딩 실패
6. 20m 초과
7. 필수 필드 누락
8. Gemini CLI 3회 실패

### 출력 구조
```json
{
  "youtube_link": "https://www.youtube.com/watch?v={video_id}",
  "recollect_version": {
    "meta": 0,
    "transcript": 0
  },
  "restaurants": [
    {
      "origin_name": "크롤링 원본 상호명",
      "naver_name": "네이버 검색 상호명",
      "jibunAddress": "서울시 강남구...",
      "roadAddress": "서울시 강남구 OO로...",
      "englishAddress": "...",
      "addressElements": {...},
      "lat": 37.xxx,
      "lng": 127.xxx,
      "category": "한식",
      "youtuber_review": "유튜버 리뷰 (LLM 추출)",
      "reasoning_basis": "추론 근거 (LLM 추출)",
      "description_map_url": "https://place.naver.com/..."
    }
  ],
  "channel_name": "meatcreator"
}
```

---

## 06-gemini-crawling.sh (쯔양)

### 기능
Gemini CLI로 자막에서 맛집 정보를 추출합니다.

### 입력
| 소스 | 파일 | 용도 |
|------|------|------|
| meta | `meta/{video_id}.jsonl` | title, recollect_id |
| transcript | `transcript/{video_id}.jsonl` | 자막 텍스트 |

### 출력
| 파일 |
|------|
| `crawling/{video_id}.jsonl` |

### 중복 검사
```bash
# 이미 처리됨
CRAWLING_FILE="$full_data_path/crawling/${VIDEO_ID}.jsonl"
if [ -f "$CRAWLING_FILE" ]; then
    SKIPPED=$((SKIPPED + 1))
    continue
fi

# 05에서 처리됨 (map_url_crawling 존재 시 스킵)
MAP_URL_CRAWLING_FILE="$full_data_path/map_url_crawling/${VIDEO_ID}.jsonl"
if [ -f "$MAP_URL_CRAWLING_FILE" ]; then
    log_debug "map_url_crawling에서 처리됨 - 스킵: $VIDEO_ID"
    continue
fi
```

### 저장되는 경우
1. crawling 파일 미존재
2. map_url_crawling 파일 미존재
3. Gemini CLI 성공
4. parse_result.py 검증 통과

### 저장되지 않는 경우
1. 이미 crawling 파일 존재
2. map_url_crawling 파일 존재
3. meta 없음
4. transcript 없음
5. Gemini CLI 실패
6. 파서 검증 실패 (필수 필드 누락)

### 필수 필드 검증 (parse_result.py)
```python
required_fields = ["origin_name", "address", "category"]
for field in required_fields:
    if field not in restaurant:
        return False  # 저장 안 됨
```

### 출력 구조
```json
{
  "youtube_link": "https://www.youtube.com/watch?v={video_id}",
  "restaurants": [
    {
      "origin_name": "Gemini가 추출한 상호명",
      "address": "Gemini가 추출한 주소",
      "category": "한식",
      "reasoning_basis": "추론 근거",
      "youtuber_review": "유튜버 리뷰"
    }
  ],
  "channel_name": "tzuyang",
  "recollect_version": {
    "meta": 0,
    "transcript": 0
  }
}
```

---

## 폴더 구조

```
data/{channel}/
├── urls/
│   └── urls.txt              ← 01 출력
├── meta/
│   └── {video_id}.jsonl      ← 02 출력
├── thumbnails/
│   └── {video_id}-{recollect_id}.jpg  ← 02 출력 (버전 관리)
├── transcript/
│   └── {video_id}.jsonl      ← 03 출력
├── heatmap/
│   └── {video_id}.jsonl      ← 04 출력
├── map_url_crawling/         ← 05 출력 (정육왕)
│   └── {video_id}.jsonl
└── crawling/                 ← 06 출력 (쯔양)
    └── {video_id}.jsonl
```

---

## 채널별 처리

| 채널 | 05 (지도 URL) | 06 (Gemini) | 조건 |
|------|--------------|-------------|------|
| 정육왕 | ✅ 실행 | map_url_crawling 있으면 스킵 | 지도 URL 기반 |
| 쯔양 | - | ✅ 실행 | 자막 기반 |

---

## 개발 환경 설정

### 폰트 (Tab0 Mono K)
코드 가독성을 위해 **Tab0 Mono K** 폰트 사용을 권장합니다. 프로젝트 루트의 `Tab0MonoK.ttc`를 설치하여 사용할 수 있습니다.

```bash
# 폰트 설치 (Linux)
mkdir -p ~/.local/share/fonts
cp ../../Tab0MonoK.ttc ~/.local/share/fonts/
fc-cache -fv
```

---

## 실행 방법

```bash
# 기초 데이터 수집
python 01-collect-urls.py --channel meatcreator
python 02-collect-meta.py --channel meatcreator
node 03-collect-transcript.js --channel meatcreator
node 04-collect-heatmap.js --channel meatcreator

# 맛집 정보 수집 (정육왕)
node 05-map-url-crawling.js --channel meatcreator

# 맛집 정보 수집 (쯔양)
./06-gemini-crawling.sh --channel tzuyang
```

---

## 환경 변수

```bash
# YouTube Data API
YOUTUBE_API_KEY_BYEON=xxx

# OpenAI (광고 분석)
OPENAI_API_KEY=xxx

# 네이버 검색 API
NAVER_CLIENT_ID_BYEON=xxx
NAVER_CLIENT_SECRET_BYEON=xxx

# NCP 지오코딩
NCP_MAPS_KEY_ID_BYEON=xxx
NCP_MAPS_KEY_BYEON=xxx

# Gemini CLI
GEMINI_API_KEY=xxx
PRIMARY_MODEL=gemini-2.5-flash
```
