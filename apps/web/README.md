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

# Google geocoding
# Google Geocoding/Places API based address recovery is disabled.
# Use backend/bin/validate_google_maps_browser_candidates.mjs for read-only browser evidence.

# Naver Maps (국내 지도)
NEXT_PUBLIC_NAVER_CLIENT_ID=your_naver_client_id
NEXT_NAVER_CLIENT_SECRET=your_naver_client_secret

# Storyboard Agent (옵션)
STORYBOARD_AGENT_REMOTE_ENABLED=false
STORYBOARD_AGENT_API_URL=http://localhost:8001
STORYBOARD_AGENT_CHAT_PATH=/chat
STORYBOARD_AGENT_TIMEOUT_MS=8000
STORYBOARD_AGENT_MAX_RETRIES=3
STORYBOARD_ORCHESTRATOR_MAX_RETRIES=3
STORYBOARD_WEB_SEARCH_ENABLED=false
STORYBOARD_WEB_SEARCH_URL=https://api.tavily.com/search
STORYBOARD_BGE_ENABLED=false
```

### 3. 실행

```bash
# 개발 서버 실행 (기본: Next 16 기본 Turbopack + 캐시 재사용)
bun run dev

# 캐시를 비우고 개발 서버 재시작
bun run dev:clean

# Turbopack 이슈가 있을 때만 webpack 폴백 사용
bun run dev:webpack

# 프로덕션 빌드 및 실행
bun run build
bun run start
```
