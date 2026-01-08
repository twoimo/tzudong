# 📺 유튜버 맛집 크롤러

유튜버 채널에서 맛집 정보를 자동 수집하고 **평가**하여 Supabase에 저장하는 파이프라인입니다.

## 🎯 대상 채널

- **정육왕 MeatCreator**: https://www.youtube.com/@meatcreator

---

## 🚀 빠른 시작

```bash
# 전체 파이프라인 실행
bun run full

# 상세 로그 포함
DEBUG=true bun run full

# 특정 단계부터 시작
node scripts/pipeline.js --start-from=2     # AI 분석부터
node scripts/pipeline.js --start-from=3.5   # RULE 평가부터
node scripts/pipeline.js --start-from=3.6   # LAAJ 평가부터
node scripts/pipeline.js --start-from=4     # DB 저장만
```

---

## 📦 파이프라인 구조

```
Phase 1:     채널 크롤링 (crawl-channel.js)
                  │
                  ▼
Phase 1.5-1.6: 병렬 실행 ⚡
              ├── 자막 수집 (collect-transcripts.js)
              └── 장소 정보 (collect-place-info.js)
                  │
                  ▼
Phase 2:     AI 분석 (extract-addresses.js)
                  │
                  ▼
Phase 3:     좌표 보완 (enrich-coordinates.js)
                  │
                  ▼
Phase 3.5:   RULE 평가 (evaluation-rule.js)
                  │
                  ▼
Phase 3.6:   LAAJ 평가 (evaluation-laaj.js)
                  │
                  ▼
Phase 4:     DB 저장 (insert-to-supabase.js)
```

---

## 🔍 평가 시스템

### RULE 평가 (Phase 3.5)

| 항목 | 검증 방식 |
|------|----------|
| `category_validity_TF` | 15개 허용 카테고리와 비교 |
| `location_match_TF` | Naver/NCP API 주소 검증 |

### LAAJ 평가 (Phase 3.6)

Gemini CLI + 자막 기반 AI 평가:

| 항목 | 점수 | 설명 |
|------|------|------|
| `visit_authenticity` | 0~4 | 실제 방문 여부 |
| `rb_inference_score` | 0~2 | reasoning_basis 합리성 |
| `rb_grounding_TF` | bool | 근거 일치 여부 |
| `review_faithfulness_score` | 0~1 | 리뷰-자막 충실도 |
| `category_TF` | bool | 카테고리 정합성 |

> ⚠️ LAAJ는 5 RPM 제한으로 느릴 수 있음

### 허용 카테고리

치킨, 중식, 돈까스·회, 피자, 패스트푸드, 찜·탕, 족발·보쌈, 분식, 카페·디저트, 한식, 고기, 양식, 아시안, 야식, 도시락

---

## 🔧 환경 변수

```bash
# YouTube
YOUTUBE_API_KEY=

# 카카오 (지오코딩)
KAKAO_REST_API_KEY=

# 네이버 (장소 검색)
NAVER_CLIENT_ID=
NAVER_CLIENT_SECRET=

# NCP (평가용 지오코딩)
NCP_MAPS_KEY_ID=
NCP_MAPS_KEY=

# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

> Gemini CLI는 OAuth 인증 사용

---

## 📁 디렉토리 구조

```
geminiCLI-youtuber-crawler/
├── scripts/
│   ├── pipeline.js              # 파이프라인 오케스트레이터
│   ├── crawl-channel.js         # 채널 영상 수집
│   ├── collect-transcripts.js   # 자막 수집
│   ├── collect-place-info.js    # 장소 정보 수집
│   ├── extract-addresses.js     # Gemini AI 분석
│   ├── enrich-coordinates.js    # 좌표 보완
│   ├── evaluation-rule.js       # RULE 평가
│   ├── evaluation-laaj.js       # LAAJ 평가
│   └── insert-to-supabase.js    # DB 저장
├── prompts/
│   ├── extract_with_place_data.txt
│   ├── extract_without_place_data.txt
│   └── evaluation_laaj.txt
├── data/
│   ├── transcripts.jsonl        # 자막 캐시
│   ├── place_info.jsonl         # 장소 정보 캐시
│   └── yy-mm-dd/                # 날짜별 데이터
├── sql/
│   └── add_evaluation_column.sql
└── package.json
```

---

## 🛠️ npm 스크립트

| 명령어 | 설명 |
|--------|------|
| `bun run full` | 전체 파이프라인 |
| `bun run crawl` | 영상 수집 |
| `bun run extract` | AI 분석 |
| `bun run geocode` | 좌표 보완 |
| `bun run insert` | DB 저장 |

---

## 📊 출력 데이터 필드

| 필드 | 설명 |
|------|------|
| name | 맛집 이름 |
| categories | 카테고리 배열 |
| address, lat, lng | 주소 및 좌표 |
| youtuber_review | 유튜버 리뷰 요약 |
| evaluation_results | RULE 평가 결과 |
| laaj_evaluation_results | LAAJ 평가 결과 |

---

## 🔐 Gemini OAuth 설정

```bash
npm install -g @google/gemini-cli
gemini  # 브라우저 인증
```

---

## 🐛 트러블슈팅

| 문제 | 해결 |
|------|------|
| Gemini 타임아웃 | 90초 후 모델 자동 전환 |
| 네이버 404 | 자동 스킵, 자막에서 추출 |
| 평가 실패 | `falseMessage` 필드 확인 |
