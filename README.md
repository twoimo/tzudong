# 🗺️ 쯔동여지도 (Tzudong Map)

**쯔양이 다녀간 맛집을 한눈에! 전국 & 해외 맛집 지도 플랫폼**

Next.js 16 (Turbopack) + Supabase 기반의 풀스택 맛집 정보 플랫폼입니다.  
쯔양의 방문 맛집을 국내/해외 지도에서 확인하고, 사용자 리뷰와 스탬프 투어로 맛집 탐방을 즐길 수 있습니다.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fyourusername%2Ftzudong)

🔗 **Live Demo**: [https://tzudong.vercel.app](https://tzudong.vercel.app)

---

## ✨ 주요 기능

### 🗺️ 지도 기반 맛집 검색
| 기능 | 설명 |
|------|------|
| **국내 지도** | Naver Maps API로 전국 맛집 표시 (18개 지역) |
| **해외 지도** | Google Maps API로 글로벌 맛집 표시 (8개 국가) |
| **마커 클러스터링** | Supercluster 기반 대량 마커 그룹화 (전국 지도 전용) |
| **필터링** | 카테고리(15개), 지역, 방문횟수, 리뷰수 기반 필터 |
| **마커 그룹화** | 동일 위치 맛집 병합 표시 |
| **검색 기능** | 디바운싱, 인기 검색어, 최근 검색 기록(3개) |
| **주간 인기 맛집** | 검색 남용 방지 시스템 (1시간 3회 제한) |

### 📱 모바일/태블릿 UI/UX
- **반응형 디자인**: 모바일, 태블릿, 데스크톱 최적화
- **드래그 가능 바텀시트**: 지역/카테고리 필터, 검색, 맛집 상세정보
- **부드러운 스크롤**: 터치 기반 인터랙션 최적화
- **모바일 네비게이션**: 하단 네비게이션 바 (홈, 스탬프, 마이페이지)
- **검색 UX**: 최근 검색 3개, 인기 검색어 표시

### 👤 사용자 기능
- **소셜 로그인**: Google OAuth 인증
- **리뷰 시스템**: 별점, 사진, 영수증 인증 리뷰
- **스탬프 투어**: 방문 맛집 스탬프 수집
- **마이페이지**: 내 리뷰, 스탬프, 좋아요, 제보 내역을 패널에서 통합 관리
- **리더보드**: 리뷰 수/신뢰도 기반 랭킹

### 🎯 맛집 제보 & AI 평가 시스템
- YouTube URL 기반 자동 맛집 정보 추출
- Gemini CLI 기반 AI 평가 (RULE + LAAJ)
- 관리자 승인 워크플로우

### 📊 관리자 대시보드
- 맛집 정보 CRUD
- 리뷰/제보 승인 관리
- 영수증 OCR 검토
- 데이터 정합성 검증 도구

---

## 🏗️ 프로젝트 구조

```
tzudong/
├── apps/
│   └── web/                    # Next.js 16 Web Application
│       ├── app/                # App Router
│       │   ├── admin/          # 관리자 페이지 (맛집, 리뷰, 평가 관리)
│       │   ├── api/            # API Routes (admin, naver, youtube)
│       │   ├── mypage/         # 마이페이지
│       │   ├── stamp/          # 스탬프 투어
│       │   └── global-map/     # 해외 지도
│       ├── components/         # React 컴포넌트 (103개)
│       │   ├── admin/          # 관리자 컴포넌트 (17개)
│       │   ├── insight/        # 인사이트 분석 (5개)
│       │   ├── map/            # 지도 컴포넌트
│       │   └── ui/             # Radix UI 기반 공통 컴포넌트 (51개)
│       ├── hooks/              # Custom Hooks (8개)
│       ├── contexts/           # React Context (Auth, Layout, Notification)
│       ├── lib/                # 유틸리티 (Supabase, Web Vitals)
│       └── types/              # TypeScript 타입 정의
│
├── backend/                    # Python/Node.js 데이터 파이프라인
│   ├── geminiCLI-restaurant-crawling/    # YouTube 자막 기반 맛집 크롤링
│   ├── geminiCLI-restaurant-evaluation/  # AI 평가 시스템 (RULE + LAAJ)
│   ├── geminiCLI-ocr-receipts/           # 영수증 OCR 처리
│   ├── transcript-api/                   # YouTube 자막 API
│   ├── utils/                            # 공용 유틸리티
│   │   ├── data_utils.py                 # 날짜폴더 관리
│   │   ├── duplicate_checker.py/ts       # 중복 검사
│   │   └── logger.py                     # 로깅 시스템
│   └── log/                              # 파이프라인 실행 로그
│
├── supabase/                   # Supabase Configuration
│   ├── migrations/             # 데이터베이스 마이그레이션 (28개)
│   ├── backup-db/              # DB 백업 파일
│   └── functions/              # Edge Functions
│
├── .github/
│   └── workflows/              # GitHub Actions (6개)
│       ├── restaurant-pipeline.yml    # 통합 파이프라인 (URL→자막→크롤링→평가→DB)
│       ├── crawling-evaluation.yml    # 크롤링+평가 워크플로우
│       ├── ocr-review-receipts.yml    # 영수증 OCR 워크플로우
│       └── backfill-duration.yml      # 영상 길이 보강
│
├── docs/                       # 프로젝트 문서 (11개)
│   ├── PRODUCT_SPEC.md         # 제품 명세서
│   ├── PERFORMANCE.md          # 성능 최적화 가이드
│   ├── SETUP_GUIDE.md          # 설치 가이드
│   └── LEGAL_RISK_ANALYSIS.md  # 법적 리스크 분석
│
└── scripts/                    # 스크립트
    └── analyze-retention.js    # 리텐션 분석
```

---

## 🛠️ 기술 스택

### Frontend
| 카테고리 | 기술 |
|---------|------|
| **Framework** | Next.js 16 (App Router, Turbopack) |
| **Language** | TypeScript, React 19 |
| **Styling** | Tailwind CSS, shadcn/ui (Radix UI) |
| **State** | TanStack Query (React Query), Zustand |
| **Maps** | Naver Maps API, Google Maps API |
| **Auth** | Supabase Auth (Google OAuth) |
| **Animation** | Framer Motion |
| **Charts** | Recharts, D3-cloud (워드클라우드) |

### Backend & Data Pipeline
| 카테고리 | 기술 |
|---------|------|
| **Database** | Supabase (PostgreSQL) |
| **AI/LLM** | Google Gemini CLI, OpenAI |
| **OCR** | Google Gemini Vision API |
| **APIs** | YouTube Data API, Kakao/Naver Geocoding |
| **Image Processing** | OpenCV (Python), Puppeteer |
| **Runtime** | Python 3.11+, Node.js 20+, Bun |

### CI/CD & Automation
| 카테고리 | 기술 |
|---------|------|
| **Hosting** | Vercel |
| **Database** | Supabase |
| **CI/CD** | GitHub Actions |
| **Pipeline** | Gemini CLI 자동화 (URL→자막→크롤링→평가→DB) |

### Performance
| 최적화 | 구현 |
|--------|------|
| **Bundle** | Dynamic imports, Code splitting (160KB+ 자동 분리) |
| **Image** | AVIF/WebP 포맷, 반응형 크기, Lazy loading |
| **Cache** | React Query (staleTime: 60s, gcTime: 5m) |
| **Monitoring** | Web Vitals (LCP, FCP, CLS, INP), Vercel Speed Insights |

---

## 🚀 시작하기

### 사전 요구사항

| 도구 | 버전 | 비고 |
|------|------|------|
| Node.js | 18.17+ | 필수 |
| Bun | 1.2.0+ | 권장 (또는 npm/yarn) |
| Python | 3.11+ | 백엔드 파이프라인 |
| Gemini CLI | 최신 | `npm install -g @google/gemini-cli` |

### 1. 레포지토리 클론

```bash
git clone https://github.com/yourusername/tzudong.git
cd tzudong
```

### 2. 환경 변수 설정

`apps/web/.env.local` 파일 생성:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Google Maps
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_key

# Naver Maps  
NEXT_PUBLIC_NAVER_CLIENT_ID=your_naver_client_id
NEXT_PUBLIC_NAVER_CLIENT_SECRET=your_naver_client_secret

# AI APIs (백엔드용)
GOOGLE_API_KEY=your_gemini_api_key
OPENAI_API_KEY=your_openai_key
YOUTUBE_API_KEY=your_youtube_api_key
KAKAO_REST_API_KEY=your_kakao_key
```

### 3. Frontend 실행

```bash
cd apps/web

# 의존성 설치
bun install  # 또는 npm install

# 개발 서버 실행 (포트 8080)
bun run dev

# 프로덕션 빌드
bun run build
bun run start
```

### 4. Backend 파이프라인 실행 (선택)

```bash
cd backend

# Python 의존성 설치
pip install -r requirements.txt

# 전체 파이프라인 실행
python geminiCLI-restaurant-pipeline.py

# 특정 단계부터 실행
python geminiCLI-restaurant-pipeline.py --start-from 2  # 평가부터
python geminiCLI-restaurant-pipeline.py --start-from 5  # DB 삽입만
```

---

## 🔄 데이터 파이프라인

### 통합 파이프라인 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│  1️⃣ URL 수집                                                     │
│     YouTube Data API → tzuyang_youtubeVideo_urls.txt            │
└────────────────────────────────────┬────────────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  2️⃣ 자막 수집 (Puppeteer)                                        │
│     maestra.ai (Primary) / tubetranscript.com (Fallback)        │
│     → tzuyang_restaurant_transcripts.json                       │
└────────────────────────────────────┬────────────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  3️⃣ 크롤링 (Gemini CLI)                                          │
│     자막 + 프롬프트 → 음식점 정보 추출                              │
│     → tzuyang_restaurant_results.jsonl                          │
└────────────────────────────────────┬────────────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  4️⃣ 좌표 보강                                                     │
│     카카오 지오코딩 API → lat/lng 추가                             │
│     → tzuyang_restaurant_results_with_meta.jsonl                │
└────────────────────────────────────┬────────────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  5️⃣ AI 평가 (RULE + LAAJ)                                        │
│     Naver API 정합성 검증 + Gemini 품질 평가                       │
│     → tzuyang_restaurant_evaluation_results.jsonl               │
└────────────────────────────────────┬────────────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  6️⃣ DB 삽입                                                       │
│     Supabase restaurants 테이블                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 날짜별 폴더 관리

모든 데이터는 `YY-MM-DD` 형식의 날짜 폴더로 관리됩니다:

```
backend/geminiCLI-restaurant-crawling/data/
├── 25-12-01/
│   ├── tzuyang_youtubeVideo_urls.txt
│   ├── tzuyang_restaurant_transcripts.json
│   ├── tzuyang_restaurant_results.jsonl
│   └── tzuyang_restaurant_results_with_meta.jsonl
└── 25-12-02/
    └── ...
```

### GitHub Actions 자동화

| 워크플로우 | 설명 | 트리거 |
|-----------|------|--------|
| `restaurant-pipeline.yml` | 통합 파이프라인 | 수동 실행 |
| `ocr-review-receipts.yml` | 영수증 OCR 처리 | 수동 실행 |
| `backfill-duration.yml` | 영상 길이 보강 | 수동 실행 |

---

## � 영수증 OCR 시스템

사용자가 업로드한 영수증 이미지에서 맛집명과 메뉴 정보를 자동 추출합니다.

### 처리 흐름

```
1. 이미지 업로드 (JPEG/PNG)
2. OpenCV 전처리 (왜곡 보정, 이진화)
3. Gemini Vision OCR
4. 관리자 검토 → 승인/거부
```

### 주요 기능
- **자동 영수증 감지**: 사각형 윤곽선 검출, 원근 변환
- **조명 보정**: 그림자 제거, 대비 향상
- **멀티 OCR**: Gemini Vision API 기반 텍스트 추출

---

## 📊 성능 최적화

### 마커 클러스터링 최적화 (2025-12-29)
- ✅ **GeoJSON 캐싱**: WeakMap으로 재변환 방지
- ✅ **LRU 캐시**: 마커 HTML 최대 500개 메모리 관리
- ✅ **requestAnimationFrame**: 60fps 부드러운 애니메이션
- ✅ **줌 레벨 최적화**: 2단계씩 묶어 재계산 50% 감소
- ✅ **동적 크기 조정**: 맛집 개수 기반 시각적 차별화

### Frontend 성능 개선 (2025-12-28)
- ✅ **검색 디바운싱**: useDeferredValue로 검색 쿼리 70% 감소
- ✅ **쿼리 캐싱 강화**: staleTime 5분, gcTime 15분으로 DB 요청 80% 감소
- ✅ **의존성 최적화**: 불필요한 리렌더링 50% 감소
- ✅ **이벤트 핸들러 안정화**: useCallback으로 메모리 효율 개선

### 번들 최적화
- ✅ **동적 임포트**: 초기 번들 크기 ~40% 감소
- ✅ **이미지 최적화**: AVIF 포맷으로 전송 크기 ~60% 감소
- ✅ **React Query 캐싱**: 불필요한 네트워크 요청 ~70% 감소
- ✅ **컴포넌트 메모이제이션**: 리렌더링 최적화

### Lighthouse 점수

| 지표 | 이전 | 이후 | 개선 |
|------|------|------|------|
| **Performance** | 24/100 | 85-90/100 | +61-66점 |
| **LCP** | 3.5s | ~2.0s | -1.5s |
| **TBT** | 530ms | ~180ms | -350ms |
| **Speed Index** | 2.8s | ~2.0s | -800ms |

📘 **상세 가이드**: [PERFORMANCE.md](./docs/PERFORMANCE.md)

---

## 🆕 최신 업데이트

### 2025-12-30: 마이페이지 패널 통합 & SPA 경험 강화
- ✅ **마이페이지 패널화**: 별도 페이지 이동 없이 지도 위 패널에서 모든 기능 수행
- ✅ **통합 탭 구조**: 프로필, 제보/요청, 리뷰, 북마크를 하나의 패널에서 탭으로 전환
- ✅ **사이드바 연동**: 사이드바 메뉴 클릭 시 즉시 패널 오픈 (Zero Reload)
- ✅ **딥링킹 지원**: URL 파라미터(`?panel=mypage&tab=bookmarks`)로 특정 탭 직접 접근
- ✅ **UI 직관성 개선**: 하단 탭 네비게이션으로 모바일 친화적 UX 제공

### 2025-12-29: 마커 클러스터링 및 세계 최고 수준 성능 최적화
#### 🎯 마커 클러스터링 시스템
- ✅ **Supercluster 기반 클러스터링**: 대량 마커 효율적 그룹화
- ✅ **전국 전용 클러스터링**: 전국 지도만 클러스터링, 특정 지역은 개별 마커 표시
- ✅ **동적 클러스터 크기**: 맛집 개수에 따라 32px~64px 단계별 조정
- ✅ **순환 이모지 애니메이션**: 카테고리별 이모지 6초 주기 부드러운 전환
- ✅ **줌 레벨 2단위 묶기**: 불필요한 클러스터 재계산 50% 감소

#### ⚡ 세계 최고 수준 성능 최적화
- ✅ **GeoJSON 캐싱**: WeakMap 기반 동일 데이터 재변환 방지
- ✅ **LRU 캐시**: 마커 HTML 최대 500개 캐싱으로 메모리 누수 방지
- ✅ **requestAnimationFrame**: setInterval 대신 60fps 부드러운 애니메이션
- ✅ **React 메모이제이션**: useMemo로 displayRestaurants 필터링 최적화
- ✅ **마커 렌더링 최적화**: DOM 조작 최소화 및 콘텐츠 캐싱

#### 🔧 클러스터링 설정
```typescript
// 전국만 클러스터링 (zoom ≤ 16)
// 특정 지역(서울, 경기 등)은 모든 줌 레벨에서 개별 마커 표시
// 줌 레벨 2단계씩 변화 (7,8 → 8, 9,10 → 10, ...)
```

---

### 2025-12-28: 모바일/태블릿 UI/UX 개선
- ✅ 바텀시트 스크롤 문제 해결 (지역/카테고리 필터)
- ✅ 검색 드롭다운 표시 개선 (바텀시트 가림 현상 해결)
- ✅ 최근 검색 기록 3개로 제한
- ✅ 스크롤 영역 최적화 (적절한 패딩 적용)

### 검색 시스템 고도화
- ✅ **주간 인기 맛집**: 매주 월요일 00:00 자동 초기화
- ✅ **검색 남용 방지**: 1시간 내 동일 맛집 3회 제한
- ✅ **검색 로그 추적**: 사용자별/세션별 검색 이력 기록
- ✅ **병합 로직 적용**: 인기 검색어에서 중복 맛집 제거

### 성능 최적화
- ✅ RestaurantSearch 디바운싱 (검색 쿼리 70% 감소)
- ✅ MobileControlOverlay 쿼리 캐싱 (DB 요청 80% 감소)
- ✅ NotificationContext 의존성 최적화 (리렌더링 50% 감소)

### 에러 처리 개선
- ✅ NotificationContext 경고 메시지 최소화 (개발 환경 전용)

---

## 🗃️ 데이터베이스 스키마

### 주요 테이블

| 테이블 | 설명 |
|--------|------|
| `restaurants` | 맛집 정보 (이름, 주소, 좌표, 카테고리, 검색 카운트) |
| `search_logs` | 검색 이력 (사용자/세션별, 남용 방지용) |
| `reviews` | 사용자 리뷰 (사진, 별점, 영수증 인증) |
| `leaderboard` | 사용자 랭킹 (리뷰수, 신뢰도 점수, 배지) |
| `user_stamps` | 스탬프 기록 |
| `likes` | 맛집 좋아요 |
| `server_costs` | 월별 서버 운영 비용 |

📘 **상세 스키마**: [supabase/migrations/](./supabase/migrations/)

---

## 📚 주요 문서

| 문서 | 설명 |
|------|------|
| 📖 [PRODUCT_SPEC.md](./docs/PRODUCT_SPEC.md) | 제품 명세서 (기능, API, UI 설계) |
| 🚀 [PERFORMANCE.md](./docs/PERFORMANCE.md) | 성능 최적화 가이드 |
| ⚙️ [SETUP_GUIDE.md](./docs/SETUP_GUIDE.md) | 설치 및 환경 설정 |
| 📜 [LEGAL_RISK_ANALYSIS.md](./docs/LEGAL_RISK_ANALYSIS.md) | 법적 리스크 분석 |
| � [GitHub Workflows README](./.github/workflows/README.md) | CI/CD 파이프라인 가이드 |
| 🤖 [README-geminiCLI.md](./backend/README-geminiCLI.md) | 백엔드 파이프라인 상세 |

---

## 🔐 API 키 발급 가이드

| API | 발급 URL | 용도 |
|-----|----------|------|
| YouTube Data API | [Google Cloud Console](https://console.cloud.google.com/) | 영상 메타데이터 |
| Google Maps API | [Google Cloud Console](https://console.cloud.google.com/) | 해외 지도 |
| Gemini API | [Google AI Studio](https://aistudio.google.com/) | AI 크롤링/평가/OCR |
| OpenAI | [OpenAI Platform](https://platform.openai.com/) | 광고 분석 |
| Kakao 지오코딩 | [Kakao Developers](https://developers.kakao.com/) | 주소→좌표 변환 |
| Naver Maps/Search | [Naver Developers](https://developers.naver.com/) | 국내 지도, 검색 |
| Supabase | [Supabase Dashboard](https://supabase.com/) | 데이터베이스 |

---

## 🤝 기여하기

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📝 라이선스

MIT License - 자유롭게 사용하세요!

---

## 👨‍💻 개발자

**Tzudong Team** - 쯔양 맛집 지도 프로젝트

---

## 🙏 감사의 말

- **쯔양** - 맛집 컨텐츠 제공
- **Vercel** - 무료 호스팅
- **Supabase** - 백엔드 인프라
- **Naver & Google** - 지도 API
- **Google Gemini** - AI 파이프라인
