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

Hosted Supabase를 의도적으로 디버깅할 때만 저장소 루트의 `.env.local` 파일을 생성하고 아래
변수를 설정한 뒤 `bun run dev:hosted`를 사용하세요. 이 명령은 `--hosted` 표시가
있어야 하는 명시적 원격 디버깅 경로입니다. 앱에서 수행한 동작에 따라 해당
Supabase project를 변경할 수 있으므로 production 자격 증명을 사용하지 마세요.
기본 Next-dev 명령은 Bun·Next의 자동 dotenv 재로딩을 차단하고, 파일에서 필요한 비-DB 운영 설정만
격리해 읽은 뒤 Supabase/Postgres/DB 연결 변수 전체를 제거하고 생성된
loopback 값을 주입합니다. `bun run build` / `bun run start`는 이번 기본값
변경 범위가 아닙니다.

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

# Gemini server-only credentials: real values belong in the approved private runtime/vault.
# Funded key stays blank here; a nonempty placeholder would mask the general key.
# OCR: GEMINI_CREDITS_API_KEY exclusively when present, otherwise GEMINI_OCR_API_KEY → GEMINI_API_KEY.
# Storyboard/RAG: GEMINI_CREDITS_API_KEY → STORYBOARD_GEMINI_API_KEY → GEMINI_API_KEY.
GEMINI_CREDITS_API_KEY=
GEMINI_OCR_API_KEY=
STORYBOARD_GEMINI_API_KEY=
GEMINI_API_KEY=
# Receipt OCR (Gemini-only): preserve the current model and thinking baseline.
GEMINI_OCR_DEFAULT_MODEL=gemini-3.6-flash
GEMINI_OCR_THINKING_LEVEL=MEDIUM
# Optional explicit model list; preserve existing operator choices.
# GEMINI_OCR_MODEL=gemini-3.6-flash

# Storyboard: explicit Gemini outbound worker, no provider/model fallback.
# Exact code allowlist (not env overrides): gemini-3.8-flash text;
# gemini-3.1-flash-image (Nano Banana 2), gemini-3-pro-image (Nano Banana Pro) images.
# Legacy STORYBOARD_AGENT_COMMAND/Codex/MLX/Ollama producers are retired and refuse execution.
# See `bun run storyboard:gemini-worker -- --help` for origin/private token-file arguments.
# --env-file must be an absolute private operator file. Preserve existing token and project limits.

# Gemini RAG: configure the existing operator-owned worker URL; unset fails closed.
# Run backend/storyboard-agent/scripts/run_rag_worker.py with its pinned runtime and
# requirements-rag-worker.txt. Supply server-only Gemini credentials to that process too.
STORYBOARD_RAG_WORKER_URL=
# /embed: gemini-embedding-001, 1024 dimensions, retrieval task, L2 normalization.
# Fingerprint: gemini-embedding-001:1024:retrieval:l2:v1; existing vectors stay isolated.
# /rerank: embedding_cosine in that space; /caption: gemini-3.8-flash.
# Preserve crawler-shared GEMINI_BUDGET_PROJECT, GEMINI_BUDGET_PATH (or
# TZUDONG_PROVIDER_STATE_DIR), GEMINI_REQUESTS_PER_MINUTE and GEMINI_MAX_INFLIGHT.
# Keep existing approved values; pacing defaults are not verified provider quotas.

# YouTube Thumbnail Agent (옵션)
# 채팅으로 들어온 캔버스 수정/초기화/생성 brief 작업은 기본적으로 로컬 Codex CLI OAuth 세션의 gpt-5.5 low(고속)가 처리한다.
THUMBNAIL_AGENT_COMMAND=../../backend/thumbnail-agent/scripts/run-thumbnail-agent.py
THUMBNAIL_AGENT_ROOT=
THUMBNAIL_AGENT_PYTHON=python3
THUMBNAIL_AGENT_RUNTIME=codex_cli_oauth
THUMBNAIL_AGENT_CODEX_MODEL=gpt-5.5
THUMBNAIL_AGENT_CODEX_EFFORT=low
THUMBNAIL_AGENT_TIMEOUT_MS=120000

STORYBOARD_WEB_SEARCH_ENABLED=false
STORYBOARD_WEB_SEARCH_URL=https://api.tavily.com/search
```

### 4. 실행

```bash
# 기본 개발 서버: 검증된 로컬 Supabase + webpack
bun run dev

# hosted .env.local을 명시적으로 사용할 때만 (원격 디버깅)
bun run dev:hosted

# 로컬 Supabase는 유지하면서 owner-only 파일의 Client ID로 실제 Naver provider를 확인하는 명시적 smoke 경로
bun run dev -- --live-naver-provider-smoke --operator-env-file /absolute/path/to/owner-only.env.local

# 승인된 실제 Client ID를 현재 프로세스에 명시한 뒤, 전용 server mode와 Chromium spec을 결합한 Playwright smoke 실행
NEXT_PUBLIC_NAVER_CLIENT_ID="$NAVER_APPROVED_CLIENT_ID" bun run test:naver-live-provider

# 아래 Next-dev 별칭도 로컬 스택 검증을 통과해야 함
bun run dev:clean
bun run dev:turbopack
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
