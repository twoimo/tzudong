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
│   │  05-naver-map-crawling.js (지도 URL → 직접 수집)                      │   │
│   │                                                                     │   │
│   │  description에서 지도 URL 추출                                        │   │
│   │         ↓                                                           │   │
│   │  ┌──────────────────────────────────────────────────────────────┐   │   │
│   │  │ 네이버 지도                                                   │   │   │
│   │  │   Puppeteer → NCP 지오코딩 → 필수필드 검증                      │   │   │
│   │  ├──────────────────────────────────────────────────────────────┤   │   │
│   │  │ 카카오/구글 지도                                              │   │   │
│   │  │   Puppeteer → 네이버 검색 API → NCP 지오코딩 → 필수필드 검증     │   │   │
│   │  │              (실패 시 null)   (시군구 비교)                     │   │   │
│   │  └──────────────────────────────────────────────────────────────┘   │   │
│   │         ↓                                                           │   │
│   │  필수필드: name, jibunAddress, lat, lng                              │   │
│   │         ↓ 있음                    ↓ 없음                            │   │
│   │  naver_map/{video_id}.jsonl      (저장 안 됨 → 06으로)               │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  06-gemini-crawling.sh (자막 → Gemini CLI 추출)                      │   │
│   │                                                                     │   │
│   │  스킵 조건:                                                          │   │
│   │    - crawling/{video_id}.jsonl 존재                                 │   │
│   │    - naver_map/{video_id}.jsonl 존재                                │   │
│   │         ↓                                                           │   │
│   │  meta + transcript → Gemini CLI → parse_result.py                   │   │
│   │         ↓                                                           │   │
│   │  crawling/{video_id}.jsonl                                          │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 05-naver-map-crawling.js 상세 흐름

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  입력: meta/{video_id}.jsonl (description에서 지도 URL 추출)                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                        ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  extractMapUrls() - URL 추출                                                │
│    - 네이버: naver.com, naver.me                                            │
│    - 카카오: kakao.com, kko.to                                              │
│    - 구글: google.com/maps, goo.gl, maps.app                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                        ↓
                         ┌──────────────┼──────────────┐
                         ↓              ↓              ↓
                    [네이버]        [카카오]        [구글]
                         ↓              ↓              ↓
               collectFromNaverMap  collectFromKakaoMap  collectFromGoogleMap
                         ↓              ↓              ↓
                  Puppeteer 수집    Puppeteer 수집    Puppeteer 수집
                         ↓              ↓              ↓
                         │      ┌───────┴───────┐      │
                         │      ↓               ↓      │
                         │  name/address    name/address
                         │  없음? → null    없음? → null
                         │      ↓               ↓      │
                         │  enrichWithNaverSearch()    │
                         │  (네이버 검색 API 보완)      │
                         │  실패? → null (폐업 등)      │
                         │  시군구 불일치? → null       │
                         │      └───────┬───────┘      │
                         └──────────────┼──────────────┘
                                        ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  verifyAndGeocode() - NCP 지오코딩                                           │
│    - 원본 좌표 있음: 20m 비교 → 일치 시 지오코딩 결과 사용                       │
│    - 원본 좌표 없음: 시군구 비교 → 일치 시 지오코딩 결과 사용                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                        ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  hasRequiredFields() - 필수 필드 검증                                        │
│    - name (상호명)          ✓ 필수                                          │
│    - jibunAddress (지번주소) ✓ 필수                                          │
│    - lat, lng (좌표)        ✓ 필수                                          │
│    - roadAddress, englishAddress, addressElements → 비어있을 수 있음          │
└─────────────────────────────────────────────────────────────────────────────┘
                         ↓ 통과                    ↓ 누락
                  places 배열에 추가         (06 파이프라인으로 처리)
                         ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  extractYoutuberReview() - Gemini CLI로 youtuber_review 추출                 │
│    - 프롬프트: prompts/naver_map_review.txt                                  │
│    - 입력: 영상 제목, 설명, 자막, 음식점 목록                                   │
│    - 출력: youtuber_review, category                                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                        ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  출력: naver_map/{video_id}.jsonl                                           │
│                                                                             │
│  {                                                                          │
│    "youtube_link": "https://...",                                           │
│    "recollect_version": {"meta": 2, "transcript": 1},                       │
│    "restaurants": [                                                         │
│      {                                                                      │
│        "name": "식당명",                                                     │
│        "jibunAddress": "지번주소",                                           │
│        "roadAddress": "도로명주소",                                          │
│        "lat": 37.5, "lng": 127.0,                                           │
│        "category": "한식",                                                   │
│        "description_map_url": "https://place.naver.com/...",                │
│        "youtuber_review": "..."                                             │
│      }                                                                      │
│    ],                                                                       │
│    "channel_name": "meatcreator"                                            │
│  }                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 폴더 구조

```
data/{channel}/
├── urls/
│   └── urls.txt
├── meta/
│   └── {video_id}.jsonl
├── transcript/
│   └── {video_id}.jsonl
├── heatmap/
│   └── {video_id}.jsonl
├── naver_map/              ← 05에서 생성 (지도 URL 기반)
│   └── {video_id}.jsonl
└── crawling/               ← 06에서 생성 (Gemini CLI 기반)
    └── {video_id}.jsonl
```

---

## 채널별 처리

| 채널 | 05 (지도 수집) | 06 (Gemini 크롤링) | 비고 |
|------|---------------|-------------------|------|
| 정육왕 | ✅ 실행 | naver_map 있으면 스킵 | 지도 URL 기반 |
| 쯔양 | - | ✅ 실행 | 자막 기반 |

---

## 실행 방법

```bash
# 기초 데이터 수집
python 01-collect-urls.py --channel meatcreator
python 02-collect-meta.py --channel meatcreator
node 03-collect-transcript.js --channel meatcreator
node 04-collect-heatmap.js --channel meatcreator

# 맛집 정보 수집 (정육왕)
node 05-naver-map-crawling.js --channel meatcreator

# 맛집 정보 수집 (쯔양)
./06-gemini-crawling.sh --channel tzuyang
```

---

## 환경 변수

```bash
# 네이버 API
NAVER_CLIENT_ID_BYEON=xxx
NAVER_CLIENT_SECRET_BYEON=xxx

# NCP 지오코딩
NCP_MAPS_KEY_ID_BYEON=xxx
NCP_MAPS_KEY_BYEON=xxx

# Gemini
GEMINI_API_KEY=xxx
PRIMARY_MODEL=gemini-3-flash-preview
```
