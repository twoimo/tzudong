# 🗺️ 쯔동여지도 (Tzudong Map)

**쯔양이 다녀간 맛집을 한눈에! 전국 & 해외 맛집 지도 플랫폼**

Next.js 16 (Turbopack) + Supabase 기반의 풀스택 맛집 정보 플랫폼입니다.

🔗 **Live Demo**: [https://tzudong.app](https://tzudong.app)

---

## ✨ 주요 기능

### 🗺️ 지도 기반 맛집 검색
- **국내/해외 지도**: Naver Maps + Google Maps API (전국 18개 지역, 해외 8개 국가)
- **마커 클러스터링**: Supercluster 기반 대량 마커 그룹화
- **스마트 필터링**: 카테고리(15개), 지역, 방문횟수, 리뷰수
- **검색 시스템**: 디바운싱, 인기 검색어, 최근 검색 기록
- **주간 인기 맛집**: 검색 남용 방지 시스템 (1시간 3회 제한)

### 📱 반응형 UI/UX
- **모바일 최적화**: 드래그 가능 바텀시트, 하단 네비게이션
- **터치 인터랙션**: 부드러운 스크롤 및 제스처
- **반응형 디자인**: 모바일/태블릿/데스크톱 완벽 대응

### 👤 사용자 기능
- **소셜 로그인**: Google OAuth 인증
- **리뷰 시스템**: 별점, 사진, 영수증 인증
- **스탬프 투어**: 방문 맛집 스탬프 수집
- **리더보드**: 리뷰 수/신뢰도 기반 랭킹

### 🎯 AI 평가 시스템
- YouTube URL 기반 자동 맛집 정보 추출
- Gemini CLI 기반 AI 평가 (RULE + LAAJ)
- 관리자 승인 워크플로우

---

## 🛠️ 기술 스택

### Frontend
- **Framework**: Next.js 16 (App Router, Turbopack), React 19, TypeScript
- **Styling**: Tailwind CSS, shadcn/ui (Radix UI)
- **State**: TanStack Query, Zustand
- **Maps**: Naver Maps API, Google Maps API

### Backend
- **Database**: Supabase (PostgreSQL)
- **AI/LLM**: Google Gemini CLI, OpenAI
- **APIs**: YouTube Data API, Kakao/Naver Geocoding
- **Runtime**: Python 3.11+, Node.js 20+, Bun

### Performance
- **Lighthouse 점수**: Performance 85-90/100
- **Bundle 최적화**: Dynamic imports, Code splitting
- **Image 최적화**: AVIF/WebP, Lazy loading
- **Cache**: React Query (staleTime: 60s, gcTime: 5m)

---

## 🚀 시작하기

### 사전 요구사항
- Node.js 18.17+
- Bun 1.2.0+ (권장) 또는 npm/yarn
- Python 3.11+ (백엔드 파이프라인)

### 설치 및 실행

```bash
# 1. 레포지토리 클론
git clone https://github.com/twoimo/tzudong.git
cd tzudong

# 2. 환경 변수 설정
cp apps/web/.env.example apps/web/.env.local
# .env.local 파일에 API 키 입력

# 3. 의존성 설치 및 실행
cd apps/web
bun install
bun run dev  # http://localhost:8080
```

### 필수 환경 변수

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

---

## 📚 문서

| 문서 | 설명 |
|------|------|
| [PRODUCT_SPEC.md](./docs/PRODUCT_SPEC.md) | 제품 명세서 |
| [PERFORMANCE.md](./docs/PERFORMANCE.md) | 성능 최적화 가이드 |
| [SETUP_GUIDE.md](./docs/SETUP_GUIDE.md) | 설치 및 환경 설정 |
| [README-geminiCLI.md](./backend/README-geminiCLI.md) | 백엔드 파이프라인 |

---

## 🔐 API 키 발급

| API | 발급 URL | 용도 |
|-----|----------|------|
| YouTube Data API | [Google Cloud Console](https://console.cloud.google.com/) | 영상 메타데이터 |
| Google Maps API | [Google Cloud Console](https://console.cloud.google.com/) | 해외 지도 |
| Gemini API | [Google AI Studio](https://aistudio.google.com/) | AI 분석 |
| Kakao 지오코딩 | [Kakao Developers](https://developers.kakao.com/) | 주소 변환 |
| Naver Maps/Search | [Naver Developers](https://developers.naver.com/) | 국내 지도 |
| Supabase | [Supabase Dashboard](https://supabase.com/) | 데이터베이스 |

---

## 🤝 기여하기

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m '[Add] AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📝 라이선스

MIT License - 자유롭게 사용하세요!

---

## 👨‍💻 개발팀

**타이니번 데이터랩** - 쯔동여지도 프로젝트

© 2026 타이니번 데이터랩

---

## 🙏 Credits

- **쯔양** - 맛집 컨텐츠
- **Vercel** - 호스팅
- **Supabase** - 백엔드 인프라
- **Naver & Google** - 지도 API
- **Google Gemini** - AI 파이프라인
