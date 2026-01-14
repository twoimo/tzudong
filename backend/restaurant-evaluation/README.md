# Restaurant Evaluation Pipeline

맛집 데이터를 평가하고 최종 형식으로 변환하는 파이프라인입니다.

---

## 전체 흐름

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              입력 데이터                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  crawling/{video_id}.jsonl  ← 06-gemini-crawling.sh                         │
│  map_url_crawling/{video_id}.jsonl ← 05-map-url-crawling.js                 │
└─────────────────────────────────────────────────────────────────────────────┘
                ↓                                           ↓
┌─────────────────────────────────┐       ┌─────────────────────────────────┐
│   geminiCLI 파이프라인 (평가 포함) │       │ map_url_crawling 파이프라인      │
│                                 │       │           (평가 스킵)            │
├─────────────────────────────────┤       ├─────────────────────────────────┤
│                                 │       │                                 │
│  07-target-selection.py         │       │  (07-09 없음)                   │
│         ↓                       │       │         ↓                       │
│  08-rule-evaluation.py          │       │  10-transform.py                │
│         ↓                       │       │    source_type: "map_url_crawling"│
│  09-laaj-evaluation.sh           │       │    evaluation_results: null     │
│    • Enum 검증 실패 시 3회 재시도   │       │                                 │
│    • 실패 → errors/ 저장         │       │                                 │
│    • 다음 실행 시 재시도          │       │                                 │
│         ↓                       │       │                                 │
│  10-transform.py                │       │                                 │
│    source_type: "geminiCLI"     │       │                                 │
│                                 │       │                                 │
└─────────────────────────────────┘       └─────────────────────────────────┘
                ↓                                           ↓
                └───────────────────┬───────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                         evaluation/transforms.jsonl                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                         11-supabase-insert.py                                │
│                                  ↓                                          │
│                            Supabase DB                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 07-target-selection.py

### 기능
crawling 데이터에서 평가 대상을 선정합니다.

### 입력
| 파일 |
|------|
| `crawling/{video_id}.jsonl` |

### 출력
| 조건 | 파일 |
|------|------|
| 평가 대상 | `evaluation/selection/{video_id}.jsonl` |
| 평가 제외 | `evaluation/notSelection/{video_id}.jsonl` |

### evaluation_target 생성 로직
```python
for restaurant in restaurants:
    origin_name = restaurant.get("origin_name")
    address = restaurant.get("address")
    if origin_name:
        # address가 null이면 False, 아니면 True
        is_valid = address is not None
        evaluation_target[origin_name] = is_valid
```

### 분류 조건
| 조건 | 파일 위치 | notSelected_reason |
|------|----------|------------------|
| 음식점 0개 | notSelection/ | `no_restaurants` |
| 모든 origin_name이 null | notSelection/ | `all_names_null` |
| 유효한 음식점 존재 | selection/ | - |

### 출력 구조
```json
{
  "youtube_link": "...",
  "channel_name": "...",
  "evaluation_target": {
    "상호명1": true,
    "상호명2": false
  },
  "restaurants": [...],
  "recollect_version": { "meta": 0, "transcript": 0 }
}
```

> **Note**: youtube_meta는 저장하지 않음. 10-transform에서 recollect_version 기반으로 meta 파일에서 조회.

### notSelection 추가 필드
```json
{
  "is_notSelected": true,
  "notSelected_reason": "no_restaurants" | "all_names_null"
}
```

---

## 08-rule-evaluation.py

### 기능
카테고리 유효성 및 위치 정합성을 평가합니다.

### 입력
| 파일 |
|------|
| `evaluation/selection/{video_id}.jsonl` |

### 출력
| 파일 |
|------|
| `evaluation/rule_results/{video_id}.jsonl` |

### 평가 1: category_validity_TF
유효한 카테고리 목록:
```
치킨, 중식, 돈까스·회, 피자, 패스트푸드, 찜·탕, 족발·보쌈,
분식, 카페·디저트, 한식, 고기, 양식, 아시안, 야식, 도시락
```

```json
[
  { "origin_name": "상호명", "eval_value": true }
]
```

### 평가 2: location_match_TF
1단계: 네이버 지역검색 API → 지번주소 비교
2단계: 20m 이내 + 시군구 일치

성공 시 출력:
```json
{
  "origin_name": "원본 상호명",
  "naver_name": "네이버 검색 상호명",
  "eval_value": true,
  "origin_address": "원본 주소",
  "naver_address": [{
    "roadAddress": "...",
    "jibunAddress": "...",
    "englishAddress": "...",
    "addressElements": [...],
    "x": "127.xxx",
    "y": "37.xxx",
    "distance": 15.5
  }],
  "falseMessage": null
}
```

실패 시:
```json
{
  "origin_name": "...",
  "naver_name": null,
  "eval_value": false,
  "origin_address": "...",
  "naver_address": null,
  "falseMessage": "1단계 실패: 지번주소 불일치" | "2단계 실패: 20m 이내 후보 없음"
}
```

### 출력 구조
```json
{
  "youtube_link": "...",
  "channel_name": "...",
  "evaluation_target": {...},
  "evaluation_results": {
    "category_validity_TF": [...],
    "location_match_TF": [...]
  },
  "restaurants": [...],
  "recollect_version": { "meta": 0, "transcript": 0 }
}
```

> **Note**: youtube_meta 대신 recollect_version만 저장.

---

## 09-laaj-evaluation.sh

### 기능
Gemini CLI로 LAAJ(LLM-as-a-Judge) 5개 평가 항목을 평가합니다.

### 입력
| 파일 |
|------|
| `evaluation/rule_results/{video_id}.jsonl` |
| `transcript/{video_id}.jsonl` |

### 출력
| 조건 | 파일 |
|------|------|
| 성공 | `evaluation/laaj_results/{video_id}.jsonl` |
| 실패 | `evaluation/errors/{video_id}.jsonl` |

### 스킵 조건
1. laaj_results 파일 존재
2. evaluation_target에 true인 항목 없음
3. 자막 없음

### 재시도 로직
- 파싱 실패 시 Gemini 재호출 + 재파싱 (최대 3회)
- 3회 실패 → errors/ 저장
- 다음 실행 시 errors/ 파일 자동 재시도 (에러 파일 삭제 후 진행)

### errors 출력 구조
```json
{
  "youtube_link": "...",
  "video_id": "...",
  "error": "파싱 실패 (3회 시도 후)" | "Gemini CLI 호출 실패",
  "recollect_version": { "meta": 0, "transcript": 0 }
}
```

### 평가 항목 5개 (evaluation_prompt.txt)

| 항목 | 타입 | 설명 |
|------|------|------|
| visit_authenticity | int 0-4 | 방문 여부 정확성 |
| rb_inference_score | int 0-2 | reasoning_basis 추론 합리성 |
| rb_grounding_TF | bool | reasoning_basis 실제 근거 일치도 |
| review_faithfulness_score | float 0-1 | 음식 리뷰 충실도 |
| category_TF | bool | 카테고리 정합성 |

### visit_authenticity 점수 기준
| 점수 | 의미 |
|------|------|
| 0 | 자막에서 전혀 언급 없음 (허구) |
| 1 | 직접 방문, 지점명 명확 |
| 2 | 직접 방문, 지점명 불명확 |
| 3 | 포장/배달 |
| 4 | 언급만 함 / 음식점 아님 |

### 출력 구조 (evaluation_results에 추가)
```json
{
  "visit_authenticity": {
    "values": [
      { "origin_name": "상호명", "eval_value": 1, "eval_basis": "[01:55] 간판+내부 확인" }
    ],
    "missing": ["누락된 상호명"]
  },
  "rb_inference_score": [
    { "origin_name": "상호명", "eval_value": 1, "eval_basis": "..." }
  ],
  "rb_grounding_TF": [
    { "origin_name": "상호명", "eval_value": true, "eval_basis": "..." }
  ],
  "review_faithfulness_score": [
    { "origin_name": "상호명", "eval_value": 1.0, "eval_basis": "..." }
  ],
  "category_TF": [
    { "origin_name": "상호명", "eval_value": true, "category_revision": null }
  ]
}
```

---

## 10-transform.py

### 기능
모든 데이터를 최종 형식으로 변환합니다.

### 입력
| 소스 | 파일 |
|------|------|
| laaj_results | `evaluation/laaj_results/*.jsonl` |
| notSelection | `evaluation/notSelection/*.jsonl` |
| map_url_crawling | `map_url_crawling/*.jsonl` |
| meta | `meta/{video_id}.jsonl` |

### 출력
| 파일 |
|------|
| `evaluation/transforms.jsonl` |

### 중복 검사
```python
existing_trace_ids = set()
if output_file.exists():
    for line in f:
        data = json.loads(line.strip())
        tid = data.get("trace_id")
        if tid:
            existing_trace_ids.add(tid)

# 저장 시 중복 체크
if record["trace_id"] not in existing_trace_ids:
    # 저장
else:
    # 스킵
```

### trace_id 생성
```python
trace_id = sha256(youtube_link + trace_id_name + youtuber_review)
# trace_id_name = naver_name이 있으면 naver_name, 없으면 origin_name
```

---

### 케이스 1: geminiCLI - laaj_results
```json
{
  "youtube_link": "...",
  "trace_id": "sha256 해시",
  "channel_name": "...",
  "status": "pending",
  "youtube_meta": {...},
  "origin_name": "Gemini가 추출한 상호명",
  "naver_name": "네이버 검색 상호명" | null,
  "trace_id_name_source": "naver" | "original",
  "phone": "..." | null,
  "category": "..." | null,
  "reasoning_basis": "..." | null,
  "youtuber_review": "...",
  "origin_address": {
    "address": "Gemini가 추출한 주소",
    "lat": null,
    "lng": null
  },
  "roadAddress": "...",
  "jibunAddress": "...",
  "englishAddress": "...",
  "addressElements": [...],
  "lat": 37.xxx,
  "lng": 127.xxx,
  "geocoding_success": true | false,
  "geocoding_false_stage": null | 1 | 2,
  "is_missing": false,
  "is_notSelected": false,
  "evaluation_results": {...},
  "source_type": "geminiCLI",
  "description_map_url": null,
  "recollect_version": { "meta": 0, "transcript": 0 }
}
```

### 케이스 2: geminiCLI - evaluation_target에만 있는 항목
`evaluation_target`에 있지만 `restaurants` 리스트에 없는 항목
```json
{
  "origin_name": "상호명",
  "naver_name": null,
  "trace_id_name_source": "original",
  "is_missing": true,
  "is_notSelected": false | true,
  "evaluation_results": null,
  "source_type": "geminiCLI"
}
```

### 케이스 3: geminiCLI - visit_authenticity.missing 항목
LAAJ 평가 결과의 `visit_authenticity.missing`에 있는 항목
```json
{
  "origin_name": "LAAJ에서 missing으로 보고된 상호명",
  "naver_name": null,
  "trace_id_name_source": "original",
  "is_missing": true,
  "is_notSelected": false,
  "evaluation_results": null,
  "source_type": "geminiCLI"
}
```

### 케이스 4: geminiCLI - notSelection
```json
{
  "naver_name": null,
  "trace_id_name_source": "original",
  "geocoding_success": false,
  "geocoding_false_stage": 0,
  "is_missing": false,
  "is_notSelected": true,
  "evaluation_results": null,
  "source_type": "geminiCLI"
}
```

### 케이스 5: map_url_crawling
```json
{
  "youtube_link": "...",
  "trace_id": "sha256 해시",
  "channel_name": "...",
  "status": "pending",
  "youtube_meta": {...},
  "origin_name": "크롤링 원본 상호명",
  "naver_name": "네이버 검색 상호명",
  "trace_id_name_source": "naver" | "original",
  "phone": "...",
  "category": "...",
  "reasoning_basis": "LLM이 추출한 추론 근거",
  "youtuber_review": "LLM이 추출한 유튜버 리뷰",
  "origin_address": null,
  "roadAddress": "...",
  "jibunAddress": "...",
  "englishAddress": "...",
  "addressElements": {...},
  "lat": 37.xxx,
  "lng": 127.xxx,
  "geocoding_success": true,
  "geocoding_false_stage": null,
  "is_missing": false,
  "is_notSelected": false,
  "evaluation_results": null,
  "source_type": "map_url_crawling",
  "description_map_url": "https://place.naver.com/..."
}
```

---

## 11-supabase-insert.py

### 기능
transforms.jsonl 데이터를 Supabase에 삽입합니다.

### 입력
| 파일 |
|------|
| `evaluation/transforms.jsonl` |

### 출력
| 대상 |
|------|
| Supabase `restaurants` 테이블 |

### 중복 검사
```python
existing = supabase.table("restaurants").select("trace_id").execute()
existing_ids = {row["trace_id"] for row in existing.data}

if trace_id in existing_ids:
    stats["skipped"] += 1
    continue
```

### 필드 매핑
| transforms 필드 | DB 필드 |
|----------------|--------|
| trace_id | trace_id |
| youtube_link | youtube_link |
| channel_name | channel_name |
| status | status |
| origin_name | origin_name |
| naver_name | naver_name |
| trace_id_name_source | trace_id_name_source |
| phone | phone |
| category | category |
| reasoning_basis | reasoning_basis |
| youtuber_review | youtuber_review |
| origin_address | origin_address |
| roadAddress | **road_address** |
| jibunAddress | **jibun_address** |
| englishAddress | **english_address** |
| lat | lat |
| lng | lng |
| geocoding_success | geocoding_success |
| geocoding_false_stage | geocoding_false_stage |
| is_missing | is_missing |
| is_notSelected | **is_not_selected** |
| evaluation_results | evaluation_results |
| youtube_meta | youtube_meta |
| source_type | source_type |
| - | created_at (자동 생성) |

---

## 폴더 구조

```
data/{channel}/
├── crawling/                    ← 06에서 생성
│   └── {video_id}.jsonl
├── map_url_crawling/            ← 05에서 생성
│   └── {video_id}.jsonl
├── meta/
│   └── {video_id}.jsonl
└── evaluation/
    ├── selection/               ← 07 출력 (평가 대상)
    │   └── {video_id}.jsonl
    ├── notSelection/            ← 07 출력 (평가 제외)
    │   └── {video_id}.jsonl
    ├── rule_results/            ← 08 출력
    │   └── {video_id}.jsonl
    ├── laaj_results/            ← 09 출력 (성공)
    │   └── {video_id}.jsonl
    ├── errors/                  ← 09 출력 (실패)
    │   └── {video_id}.jsonl
    └── transforms.jsonl         ← 10 출력 (최종)
```

---

## 실행 방법

```bash
# geminiCLI 파이프라인 (전체 평가)
python 07-target-selection.py -c tzuyang --data-path ../data/tzuyang
python 08-rule-evaluation.py -c tzuyang --data-path ../data/tzuyang
./09-laaj-evaluation.sh -c tzuyang --data-path data/tzuyang
python 10-transform.py -c tzuyang --data-path ../data/tzuyang
python 11-supabase-insert.py -c tzuyang

# map_url_crawling 파이프라인 (평가 스킵)
python 10-transform.py -c meatcreator --data-path ../data/meatcreator
python 11-supabase-insert.py -c meatcreator
```

---

## 환경 변수

```bash
# 네이버 검색 API
NAVER_CLIENT_ID_BYEON=xxx
NAVER_CLIENT_SECRET_BYEON=xxx

# NCP 지오코딩
NCP_MAPS_KEY_ID_BYEON=xxx
NCP_MAPS_KEY_BYEON=xxx

# Gemini
GEMINI_API_KEY=xxx
PRIMARY_MODEL=gemini-2.5-flash
FALLBACK_MODEL=gemini-2.5-flash

# Supabase
SUPABASE_URL=xxx
SUPABASE_KEY=xxx
```
