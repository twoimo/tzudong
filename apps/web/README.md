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

### 4. /insights 챗봇 QA

`/api/admin/insight/chat`, `/api/admin/insight/chat/stream`, `/api/admin/insight/chat/bootstrap`의 핵심 검증을 위한
스크립트/테스트가 추가되어 있습니다.

```bash
# 모의 의존성 주입 기반 단위 테스트 (항상 실행, 외부 의존성 없음)
bun run qa:insights-chat

# Supabase DB 데이터/RPC 점검 (서비스 롤 키 필요)
bun run qa:insights-chat:db

# youtube_link 정규화 dry-run (DB 미변경)
bun run qa:insights-chat:db -- --fix-video-links --dry-run

# youtube_link 정규화 실제 반영 (명시적 확인 필요)
bun run qa:insights-chat:db -- --fix-video-links --confirm-fix-video-links

# 단위 + DB 점검 + 라이브 API를 한 번에
INSIGHTS_CHAT_ADMIN_COOKIE="sb-xxx=..." \
INSIGHT_CHAT_QA_BASE_URL="http://localhost:8080" \
bun run qa:insights-chat -- --db --live

# 라이브 엔드포인트 점검 (선택)
INSIGHTS_CHAT_ADMIN_COOKIE="sb-xxx=..." \
INSIGHT_CHAT_QA_BASE_URL="http://localhost:8080" \
bun run qa:insights-chat -- --live
```

`INSIGHTS_CHAT_ADMIN_COOKIE`가 없으면 라이브 체크는 건너뜁니다.

관련 파일:
- `apps/web/scripts/insight-chat-qa.mjs`
- `apps/web/scripts/insight-chat-db-ops.mjs`
- `apps/web/tests-unit/insight-chat-api-routes.test.ts`

## 🎨 Pencil storyboard sync

Frontend ↔ Pencil Desktop storyboard work follows a controlled sync contract: app code/runtime stays the source of truth, code-to-Pencil artifacts are generated from manifests, and Pencil-to-code changes are review-queue proposals only. See [`docs/pencil-storyboard-sync.md`](docs/pencil-storyboard-sync.md) for the route inventory seed, artifact layout, reverse-sync guardrails, and code-review checklist.

## 📱 모바일 바텀시트 패턴

모바일 전용 폼/모달은 `components/ui/mobile-sheet-frame.tsx`의 공통 프리셋과 헤더를 우선 재사용합니다.

- `MOBILE_FULL_FORM_SHEET`
  - 리뷰 작성, 제보 작성, 프로필 수정처럼 **길고 단계가 있는 폼**용
  - full-height 고정, peek 비활성화, 하단 네비게이션 숨김
- `MOBILE_COMPACT_FORM_SHEET`
  - 인증/닉네임처럼 **짧은 입력 플로우**용
  - peek 허용, 상대적으로 낮은 기본 높이
- `MobileSheetHeader`
  - sticky 헤더 + 제목/설명 + 우측 action 슬롯 공통화
  - autosave/status 배지는 `children`, 닫기 버튼은 `action` 슬롯에 배치
- `MobileSheetStepIndicator`
  - 선형(step-by-step) 모바일 폼의 현재 단계 표시
  - 현재 단계는 `aria-current="step"`으로 노출

적용 예시:
- `components/reviews/ReviewModal.tsx`
- `components/reviews/ReviewEditModal.tsx`
- `components/auth/AuthModal.tsx`
- `components/modals/EditRestaurantModal.tsx`
- `components/profile/ProfileModal.tsx`

관련 회귀 테스트:

```bash
bun test tests-unit/mobile-sheet-frame.test.ts
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
