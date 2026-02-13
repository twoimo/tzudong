# 🍜 쯔동여지도 Frontend

Next.js 16 (App Router) 기반의 맛집 지도 웹 애플리케이션입니다.

## 🛠️ 기술 스택

- **Framework**: Next.js 16 (Turbopack)
- **Language**: TypeScript
- **Styling**: Tailwind CSS, Radix UI (Shadcn UI)
- **State Management**: React Query (TanStack Query), Zustand
- **Maps**: Naver Maps API (국내), Google Maps API (해외)
- **Backend Integration**: Supabase (Auth, Database, Storage)
- **Performance**: Web Vitals, Bundle Analyzer

## 🚀 시작하기

### 1. 설치

```bash
# 의존성 설치
bun install
# 또는
npm install
```

### 2. 환경 변수 설정

`.env.local` 파일을 생성하고 다음 변수를 설정하세요:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Google Maps (해외 지도)
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_key
# Google Geocoding (선택: 없으면 NEXT_PUBLIC_GOOGLE_MAPS_API_KEY fallback)
# HTTP referrer 제한 키는 Geocoding REST에서 REQUEST_DENIED 발생 가능
GOOGLE_GEOCODING_API_KEY=your_google_geocoding_server_key

# Naver Maps (국내 지도)
NEXT_PUBLIC_NAVER_CLIENT_ID=your_naver_client_id
NEXT_PUBLIC_NAVER_CLIENT_SECRET=your_naver_client_secret
```

### 3. 실행

```bash
# 개발 서버 실행
bun run dev

# 프로덕션 빌드 및 실행
bun run build
bun run start
```

## 📁 폴더 구조

```
apps/web/
├── app/                  # App Router
│   ├── (auth)/           # 인증 관련 페이지
│   ├── admin/            # 관리자 페이지
│   ├── mypage/           # 마이페이지
│   ├── reviews/          # 리뷰 페이지
│   ├── layout.tsx        # 루트 레이아웃
│   └── page.tsx          # 메인 홈 (지도)
│
├── components/           # React 컴포넌트
│   ├── home/             # 홈 화면 관련 (지도, 패널)
│   ├── ui/               # 공통 UI 컴포넌트 (Radix UI)
│   └── ...
│
├── contexts/             # Context API (Auth, Notification)
├── hooks/                # Custom Hooks
├── lib/                  # 유틸리티 (Supabase, Web Vitals)
└── types/                # TypeScript 타입 정의
```

## 📊 성능 최적화

이 프로젝트는 Lighthouse 점수 90+를 목표로 최적화되었습니다.

- **Code Splitting**: `next/dynamic`을 사용한 컴포넌트 지연 로딩
- **Image Optimization**: AVIF/WebP 포맷 사용, 반응형 이미지
- **Caching**: React Query `staleTime`, `gcTime` 최적화
- **Bundle Optimization**: Webpack `splitChunks` 설정

자세한 내용은 [PERFORMANCE.md](../../docs/PERFORMANCE.md)를 참고하세요.
