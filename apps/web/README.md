# 🍜 쯔동여지도 Frontend

Next.js 16 (App Router) 기반의 맛집 지도 웹 애플리케이션입니다.

## 🛠️ 기술 스택

- **Framework**: Next.js 16 (webpack dev/build parity)
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
```

### 2. 로컬 Supabase 준비

기본 개발 명령은 저장소가 생성한 로컬 Supabase 스택만 사용합니다. 먼저
저장소 루트의 [`backend/supabase/README.md`](../../backend/supabase/README.md)에
따라 스택을 생성·마이그레이션하세요. `bun run dev`는 owner-only
`stack.env`와 provenance, 서비스 readiness, 현재 migration ledger를 검증한 뒤
loopback 값만 자식 프로세스에 전달합니다. 검증에 실패하면 hosted 자격 증명으로
fallback하지 않고 종료합니다.

로컬 DB를 유지하면서 GitHub 나이틀리 상태 같은 비-DB 운영 설정도 확인해야 하면,
복사나 자동 탐색 대신 owner-only 파일의 절대 경로를 그 실행에만 명시합니다. 이
파일의 Supabase/Postgres/DB 연결 값은 제거되고 생성된 loopback 값으로 교체됩니다:

```bash
bun run dev -- --operator-env-file /absolute/path/to/owner-only.env.local
```

### 3. Hosted 환경 변수 설정 (명시적 opt-in)

Hosted Supabase를 의도적으로 디버깅할 때만 `.env.local` 파일을 생성하고 아래
변수를 설정한 뒤 `bun run dev:hosted`를 사용하세요. 기본 로컬 명령은 Bun·Next의
자동 dotenv 재로딩을 차단하고, 파일에서 필요한 비-DB 운영 설정만 격리해 읽은 뒤
Supabase/Postgres/DB 연결 변수 전체를 제거하고 생성된 loopback 값을 주입합니다:

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

# Receipt OCR (Gemini-only)
GEMINI_API_KEY=your_gemini_api_key
# Optional: comma-separated model failover list. If unset, GEMINI_OCR_DEFAULT_MODEL or gemini-3.6-flash is used.
GEMINI_OCR_MODEL=gemini-3.6-flash
GEMINI_OCR_DEFAULT_MODEL=gemini-3.6-flash
# Optional: LOW, MEDIUM, or HIGH. Defaults to MEDIUM; overrides GEMINI_THINKING_LEVEL for receipt OCR only.
GEMINI_OCR_THINKING_LEVEL=MEDIUM

# Storyboard Agent (옵션)
# Local command bridge: backend/storyboard-agent를 Next.js API에서 직접 실행한다.
# apps/web 기준 상대 경로 또는 절대 경로를 직접 설정한다. 셸 메타문자/인자는 허용하지 않는다.
# 기본값은 LangGraph command bridge이며, 로컬 환경에서 Python/runtime 준비가 안 되면 fail-closed fallback으로 내려간다.
# 아래 값은 LangGraph 대신 legacy Codex bridge를 강제로 쓰고 싶을 때만 명시적으로 override 한다.
STORYBOARD_AGENT_COMMAND=../../backend/storyboard-agent/scripts/run-storyboard-agent.py
# Optional: apps/web 기준 상대 경로 또는 절대 경로. 비우면 repo 루트 backend/storyboard-agent를 자동 탐지.
STORYBOARD_AGENT_ROOT=
# Optional: 기본값은 Windows에서 python, macOS/Linux에서 python3.
STORYBOARD_AGENT_PYTHON=
# STORYBOARD_AGENT_RUNTIME=codex_cli_oauth
STORYBOARD_AGENT_CODEX_MODEL=gpt-5.5
STORYBOARD_AGENT_CODEX_EFFORT=low
# milliseconds; command bridge timeout.
STORYBOARD_AGENT_TIMEOUT_MS=120000

# YouTube Thumbnail Agent (옵션)
# 채팅으로 들어온 캔버스 수정/초기화/생성 brief 작업은 기본적으로 로컬 Codex CLI OAuth 세션의 gpt-5.5 low(고속)가 처리한다.
THUMBNAIL_AGENT_COMMAND=../../backend/thumbnail-agent/scripts/run-thumbnail-agent.py
THUMBNAIL_AGENT_ROOT=
THUMBNAIL_AGENT_PYTHON=python3
THUMBNAIL_AGENT_RUNTIME=codex_cli_oauth
THUMBNAIL_AGENT_CODEX_MODEL=gpt-5.5
THUMBNAIL_AGENT_CODEX_EFFORT=low
THUMBNAIL_AGENT_TIMEOUT_MS=120000

# Remote service bridge: 별도 HTTP 서버를 쓸 때만 활성화한다.
STORYBOARD_AGENT_REMOTE_ENABLED=false
STORYBOARD_AGENT_API_URL=http://localhost:8001
STORYBOARD_AGENT_CHAT_PATH=/chat
STORYBOARD_AGENT_MAX_RETRIES=3
STORYBOARD_ORCHESTRATOR_MAX_RETRIES=3
STORYBOARD_WEB_SEARCH_ENABLED=false
STORYBOARD_WEB_SEARCH_URL=https://api.tavily.com/search
STORYBOARD_BGE_ENABLED=false
```

### 4. 실행

```bash
# 기본 개발 서버: 검증된 로컬 Supabase + webpack
bun run dev

# hosted .env.local을 명시적으로 사용할 때만
bun run dev:hosted

# hosted/고급 디버깅용 캐시 정리 경로
bun run dev:clean

# Turbopack 비교가 필요할 때만 별도 실행
bun run dev:turbopack

# webpack 개발 서버를 명시적으로 실행
bun run dev:webpack

# 프로덕션 빌드 및 실행
bun run build
bun run start
```

## YouTube thumbnail backend-agent bridge

The admin YouTube thumbnail generator can run in `backend_agent` mode. This mode adds a thin LangGraph-style orchestration layer for concept, layout, prompt addendum, safety review, and next actions, then still calls the existing web provider layer. The exact OpenAI path remains `openai-gpt-image` with `model: gpt-image-2`; the backend command does not generate images and does not treat `gpt-image-2` as a Codex agent model.

```bash
THUMBNAIL_AGENT_COMMAND=../../backend/thumbnail-agent/scripts/run-thumbnail-agent.py
THUMBNAIL_AGENT_ROOT=../../backend/thumbnail-agent
THUMBNAIL_AGENT_PYTHON=python3
THUMBNAIL_AGENT_RUNTIME=local_graph
THUMBNAIL_AGENT_TIMEOUT_MS=120000
```

If `THUMBNAIL_AGENT_COMMAND` is not configured, the Next.js route uses a local adapter that emits the same orchestration contract and keeps direct provider mode available.
