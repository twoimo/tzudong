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
node scripts/pipeline.js --start-from=4     # DB 저장만
```

---

## 📦 파이프라인 구조

```
Phase 1: 채널 크롤링
└── crawl-channel.js (YouTube API로 영상 목록 수집)
        │
        ▼
Phase 1.5 & 1.6: 병렬 실행 ⚡
├── collect-transcripts.js (자막 수집)
└── collect-place-info.js  (맵 URL에서 장소 정보 수집)
        │
        ▼
Phase 2: AI 분석
└── extract-addresses.js (Gemini CLI로 맛집 정보 추출)
        │
        ▼
Phase 3: 좌표 보완
└── enrich-coordinates.js (Kakao/Naver API 지오코딩)
        │
        ▼
Phase 3.5: RULE 기반 평가 ✨ NEW
└── evaluation-rule.js (카테고리 + 위치 검증)
        │
        ▼
Phase 4: DB 저장
└── insert-to-supabase.js
```

---

## 📋 주요 기능

| 기능 | 설명 |
|------|------|
| 영상 수집 | YouTube Data API로 채널 영상 목록 수집 |
| 자막 수집 | Puppeteer로 외부 서비스에서 자막 수집 |
| 장소 정보 수집 | 네이버/카카오/구글 맵 URL에서 상세 정보 추출 |
| AI 분석 | Gemini CLI로 맛집 정보 및 리뷰 추출 |
| 좌표 보완 | 카카오/네이버 API로 지오코딩 |
| **RULE 평가** | 카테고리 유효성 + 위치 정합성 검증 |
| DB 저장 | Supabase restaurant_youtuber 테이블에 Upsert |

---

## 🔍 평가 시스템

### RULE 평가 (Phase 3.5)

| 항목 | 설명 | 검증 방식 |
|------|------|----------|
| `category_validity_TF` | 카테고리 유효성 | 15개 허용 목록과 비교 |
| `location_match_TF` | 위치 정합성 | Naver/NCP API로 주소 검증 |

### LAAJ 평가 (Phase 3.6)

Gemini CLI + 자막 기반 AI 평가:

| 항목 | 점수 | 설명 |
|------|------|------|
| `visit_authenticity` | 0~4 | 유튜버 실제 방문 여부 |
| `rb_inference_score` | 0~2 | reasoning_basis 추론 합리성 |
| `rb_grounding_TF` | bool | reasoning_basis 근거 일치 |
| `review_faithfulness_score` | 0.0~1.0 | 리뷰-자막 충실도 |
| `category_TF` | bool | 카테고리-업장 정합성 |

> ⚠️ LAAJ는 Gemini CLI 필요, 5 RPM 제한으로 느릴 수 있음

### 허용 카테고리 (15개)

```
치킨, 중식, 돈까스·회, 피자, 패스트푸드, 찜·탕, 족발·보쌈, 
분식, 카페·디저트, 한식, 고기, 양식, 아시안, 야식, 도시락
```

---

## 🔧 환경 변수

`.env` 파일에 설정:

```bash
# YouTube
YOUTUBE_API_KEY=your_key

# 카카오 (지오코딩 + 장소 검색)
KAKAO_REST_API_KEY=your_key

# 네이버 (장소 검색 + 평가)
NAVER_CLIENT_ID=your_id
NAVER_CLIENT_SECRET=your_secret

# NCP (평가용 지오코딩)
NCP_MAPS_KEY_ID=your_id
NCP_MAPS_KEY=your_key

# Supabase
SUPABASE_URL=your_url
SUPABASE_SERVICE_ROLE_KEY=your_key
```

> ⚠️ Gemini CLI는 OAuth 인증 사용 (`GEMINI_API_KEY` 불필요)

---

## 📁 디렉토리 구조

```
geminiCLI-youtuber-crawler/
├── scripts/
│   ├── pipeline.js              # 전체 파이프라인 오케스트레이터
│   ├── crawl-channel.js         # 채널 영상 수집
│   ├── collect-transcripts.js   # 자막 수집 (Puppeteer)
│   ├── collect-place-info.js    # 맵 URL에서 장소 정보 수집
│   ├── url-extractor.js         # URL 파싱 및 API 검색 유틸
│   ├── extract-addresses.js     # Gemini AI 분석
│   ├── enrich-coordinates.js    # 좌표 보완
│   ├── evaluation-rule.js       # RULE 기반 평가 ✨
│   ├── insert-to-supabase.js    # DB 저장
│   ├── gemini-oauth-manager.js  # OAuth 토큰 관리
│   └── check-quality.js         # 품질 검사
├── prompts/
│   ├── extract_with_place_data.txt     # 장소 데이터 있을 때
│   └── extract_without_place_data.txt  # 장소 데이터 없을 때
├── data/
│   ├── transcripts.jsonl        # 자막 캐시 (공유)
│   ├── place_info.jsonl         # 장소 정보 캐시 (공유)
│   └── yy-mm-dd/                # 날짜별 데이터
├── sql/
│   └── add_evaluation_column.sql  # restaurant_youtuber 테이블 생성
├── .env
└── package.json
```

---

## 🛠️ npm 스크립트

| 명령어 | 설명 |
|--------|------|
| `bun run full` | 전체 파이프라인 |
| `bun run crawl` | 영상 수집 |
| `bun run transcripts` | 자막 수집 |
| `bun run places` | 장소 정보 수집 |
| `bun run extract` | AI 분석 |
| `bun run geocode` | 좌표 보완 |
| `bun run insert` | DB 저장 |
| `bun run quality` | 품질 검사 |

---

## 📊 출력 데이터 필드

| 필드 | 설명 |
|------|------|
| name | 맛집 이름 |
| address | 도로명 주소 |
| phone | 전화번호 |
| categories | 카테고리 배열 |
| lat, lng | 좌표 |
| youtuber_review | 유튜버 리뷰 요약 |
| signature_menu | 대표 메뉴 |
| evaluation_results | RULE 평가 결과 (JSONB) |

---

## ⚡ 성능 최적화

| 항목 | 설명 |
|------|------|
| 병렬 실행 | 자막 + 장소 정보 동시 수집 |
| 캐시 재사용 | 자막/장소 정보 날짜 무관 공유 |
| 스킵 로직 | 이미 수집된 영상 자동 스킵 |
| API Fallback | 크롤링 실패 시 API로 자동 전환 |

---

## 🔐 Gemini OAuth 설정

```bash
# 1. CLI 설치
npm install -g @google/gemini-cli

# 2. 로그인 (브라우저 인증)
gemini

# 3. 확인
cat ~/.gemini/oauth_creds.json
```

---

## 🐛 트러블슈팅

| 문제 | 해결 |
|------|------|
| Gemini CLI 타임아웃 | 90초 후 다른 모델로 자동 전환 |
| 네이버 404 페이지 | 자동 스킵 후 자막에서 직접 추출 |
| 평가 실패 | `location_match_TF.falseMessage` 확인 |
