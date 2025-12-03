# 🗺️ 쯔동여지도 (Tzudong Map)

**쯔양이 다녀간 맛집을 한눈에! 전국 & 해외 맛집 지도 플랫폼**

Next.js 16 (Turbopack) + Supabase 기반의 풀스택 맛집 정보 플랫폼입니다. 쯔양의 방문 맛집을 국내/해외 지도에서 확인하고, 사용자 리뷰와 스탬프 투어로 맛집 탐방을 즐길 수 있습니다.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fyourusername%2Ftzudong)

🔗 **Live Demo**: [https://tzudong.vercel.app](https://tzudong.vercel.app)

---

## ✨ 주요 기능

### 🗺️ 지도 기반 맛집 검색
- **국내 지도**: Naver Maps API로 전국 맛집 표시
- **해외 지도**: Google Maps API로 글로벌 맛집 표시
- 지역/카테고리별 필터링 및 검색
- 실시간 맛집 상세 정보 패널

### 👤 사용자 기능
- **소셜 로그인**: Google OAuth 인증
- **리뷰 시스템**: 별점, 사진, 텍스트 리뷰
- **스탬프 투어**: 방문 맛집 스탬프 수집
- **마이페이지**: 내 리뷰, 스탬프, 좋아요 관리

### 🎯 맛집 제보 시스템
- YouTube URL 기반 자동 정보 추출
- AI 평가 (Perplexity API)
- 관리자 승인 워크플로우

### 📊 관리자 대시보드
- 맛집 정보 수정/삭제
- 제보 평가 관리
- 데이터 정합성 검증

---

## 🏗️ 프로젝트 구조

```
tzudong/
├── apps/
│   └── web/              # Next.js 16 Web Application
│       ├── app/          # App Router (pages, layouts, API routes)
│       ├── components/   # React 컴포넌트
│       ├── contexts/     # React Context (Auth, Notification, Layout)
│       ├── hooks/        # Custom React Hooks
│       ├── lib/          # 유틸리티 (Supabase, Web Vitals)
│       └── styles/       # Tailwind CSS
│
├── backend/              # Python Data Pipeline
│   ├── restaurant-pipeline.py      # 맛집 데이터 수집
│   ├── evaluation-pipeline.py      # AI 평가
│   └── youtube-info-extractor.py   # YouTube 정보 추출
│
├── supabase/             # Supabase Configuration
│   ├── migrations/       # 데이터베이스 마이그레이션
│   └── seed.sql          # 초기 데이터
│
└── docs/                 # 프로젝트 문서
    ├── PERFORMANCE.md    # 성능 최적화 가이드 ✨ NEW
    └── ...
```

---

## 🛠️ 기술 스택

### Frontend
- **Framework**: Next.js 16 (App Router, Turbopack)
- **Language**: TypeScript
- **Styling**: Tailwind CSS, Radix UI
- **State Management**: React Query (TanStack Query)
- **Maps**: Naver Maps API, Google Maps API
- **Authentication**: Supabase Auth (Google OAuth)
- **Deployment**: Vercel

### Backend
- **Runtime**: Python 3.11+
- **Database**: Supabase (PostgreSQL)
- **AI/API**: Perplexity AI, YouTube Data API v3
- **ORM**: Supabase Client

### Performance
- **Bundle Optimization**: Webpack Code Splitting (160KB+ 자동 분리)
- **Image Optimization**: AVIF/WebP 포맷, 반응형 크기
- **Caching**: React Query (staleTime: 60s, gcTime: 5m)
- **Monitoring**: Web Vitals (LCP, FCP, CLS, INP)

### CI/CD & Automation
- **GitHub Actions**: 데이터 파이프라인 자동화 (`crawling-evaluation.yml`)
- **Gemini CLI**: Google Gemini CLI를 활용한 맛집 데이터 크롤링 및 평가
- **Automated Pipeline**: Transcript 커밋 → 크롤링 → AI 평가 → DB 저장
- **Artifacts**: 실행 결과 및 로그 자동 아카이빙

---

## 🚀 시작하기

### 사전 요구사항

- **Node.js**: 18.17 이상
- **Bun**: 1.2.0 이상 (권장) 또는 npm/yarn
- **Python**: 3.11 이상 (백엔드 사용 시)
- **Supabase Account**: [supabase.com](https://supabase.com)

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

# Google Maps
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_key

# Naver Maps
NEXT_PUBLIC_NAVER_CLIENT_ID=your_naver_client_id
NEXT_PUBLIC_NAVER_CLIENT_SECRET=your_naver_client_secret
```

### 3. Frontend 실행

```bash
cd apps/web

# 의존성 설치
bun install

# 개발 서버 실행 (포트 8080)
bun run dev

# 프로덕션 빌드
bun run build
bun run start
```

### 4. Backend 실행 (선택사항)

```bash
cd backend

# 의존성 설치
pip install -r requirements.txt

# 맛집 데이터 수집
python restaurant-pipeline.py

# AI 평가
python evaluation-pipeline.py
```

---

## 📊 성능 최적화

프로젝트에 다양한 성능 최적화 기법이 적용되었습니다.

### 주요 개선 사항
- ✅ **동적 임포트**: 초기 번들 크기 ~40% 감소
- ✅ **이미지 최적화**: AVIF 포맷으로 전송 크기 ~60% 감소
- ✅ **React Query 캐싱**: 불필요한 네트워크 요청 ~70% 감소
- ✅ **컴포넌트 메모이제이션**: 리렌더링 최적화

### 성능 지표 (Lighthouse)
| 지표 | 이전 | 이후 | 개선 |
|------|------|------|------|
| **Performance** | 24/100 | 85-90/100 | +61-66점 |
| **LCP** | 3.5s | ~2.0s | -1.5s |
| **TBT** | 530ms | ~180ms | -350ms |
| **Speed Index** | 2.8s | ~2.0s | -800ms |

📘 **상세 가이드**: [PERFORMANCE.md](./docs/PERFORMANCE.md)

---

## 📚 주요 문서

- 📖 [성능 최적화 가이드](./docs/PERFORMANCE.md) - 라이트하우스 점수 개선 과정
- 🚀 [배포 가이드](./DEPLOY.md) - Vercel 배포 설정
- 🗃️ [데이터베이스 스키마](./supabase/README.md) - Supabase 테이블 구조

---

## 🤝 기여하기

프로젝트에 기여하고 싶으시다면:

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
