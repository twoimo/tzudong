# Storyboard RAG operating profiles

This guide defines the required-provider execution profiles for the storyboard RAG stack. These profiles do not create fake fallback output. If a required worker, model, DB RPC, OAuth file, or queue step is unavailable, the caller must fail closed with a Korean status message, a cause code, and next actions.

## Shared contract

- Next.js routes perform auth, request validation, Supabase insert/RPC calls, and worker proxying only.
- Python FastAPI workers run BGE-M3 dense/sparse embedding and bge-reranker-v2-m3 reranking.
- GPU-heavy stages can be split behind `STORYBOARD_RAG_GPU_WORKER_URL` or `STORYBOARD_RAG_LLAVA_WORKER_URL`.
- `STORYBOARD_RAG_EXECUTION_PROFILE` selects the profile. `STORYBOARD_RAG_PROFILE` is accepted as a legacy alias.
- CI uses `ci_exception_only`: it verifies profile selection and fail-closed error mapping without credentials, network, quota, or GPU.

## Profiles

| Profile | Target | BGE embed/rerank | LLaVA caption | Ollama judge | Gemini/OpenAI judge |
| --- | --- | --- | --- | --- | --- |
| `xps_9550_local_dev` | XPS 9550 Windows local dev | local worker, queue 1, unload after request, fail closed if model missing | required remote GPU worker endpoint, queued, fail closed | local Ollama, queued, unload after request, fail closed if model missing | OAuth provider, queued, fail closed on OAuth/quota/network |
| `vps_6c_12gb` | 6c/12GB VPS | local worker, small queue/batch, fail closed | required remote GPU worker endpoint, queued, fail closed | remote worker preferred, queued, fail closed | OAuth provider, queued, fail closed |
| `gpu_cloud_worker` | GPU cloud worker | remote GPU worker, queued, fail closed | remote GPU worker, queued, fail closed | remote GPU/Ollama worker, queued, fail closed | OAuth provider, queued, fail closed |
| `macbook_pro_m5_max` | Future high-end Apple Silicon local dev | local worker, queued, fail closed | local worker first; remote endpoint allowed, queued, fail closed | local Ollama, queued, fail closed | OAuth provider, queued, fail closed |
| `ci_exception_only` | Tests without credentials/network/GPU | not invoked; fail-closed exception path only | not invoked; fail-closed exception path only | not invoked; fail-closed exception path only | not invoked; fail-closed exception path only |

## Required environment

```sh
STORYBOARD_RAG_EXECUTION_PROFILE=xps_9550_local_dev
STORYBOARD_RAG_WORKER_URL=http://127.0.0.1:8765
STORYBOARD_RAG_GPU_WORKER_URL=https://gpu-worker.example.internal
STORYBOARD_RAG_LLAVA_WORKER_URL=https://gpu-worker.example.internal
STORYBOARD_RAG_WORKER_TIMEOUT_MS=120000
```

`STORYBOARD_RAG_GPU_WORKER_URL` is the generic heavy-model endpoint. `STORYBOARD_RAG_LLAVA_WORKER_URL` overrides it for `/caption` when video captioning is split to a dedicated worker.

## UI trace obligations

The storyboard chatbot trace must show:

1. current execution profile;
2. remote/local provider location for BGE, reranker, LLaVA, Ollama, Gemini/OpenAI;
3. queue and timeout settings;
4. model-missing or OAuth-missing next action;
5. fail-closed cause code plus Korean explanation when a stage stops.

Stages shown to users are:

- worker 연결
- BGE 임베딩
- Supabase 검색
- reranker
- LLaVA caption
- judge

## Failure handling

Wrong implementation:

- generating fake embeddings when BGE is missing;
- claiming reranker success from original Supabase order;
- replacing LLaVA with a text-only caption placeholder;
- swallowing Supabase RPC errors and returning empty success;
- exposing raw stack traces, OAuth paths, tokens, or provider dumps to chatbot users.

Correct implementation:

- return fail-closed JSON with `causeCode`, `stage`, `stageLabel`, `message`, `nextActions`, and `trace`;
- keep raw technical details in server logs only;
- show Korean user-facing next actions such as model install, worker restart, OAuth check, timeout increase;
- never mark a model step passed without required-provider evidence.

## Testing strategy

- Unit tests validate profile selection and trace formatting without calling providers.
- Unit tests validate Korean fail-closed mapping for worker, BGE, Supabase, reranker, LLaVA, and judge failures.
- Focused API/source tests validate that Next.js does not run BGE/reranker locally and does not synthesize success.
- Live provider/browser QA is manual or explicit local/GPU worker verification only; it is never required in normal CI.

## Coverage audit and safe backfill runbook

Storyboard RAG coverage/backfill runs are audit-first and no-write by default. Store every run under `artifacts/storyboard-rag-coverage/<run_id>/` and keep the durable ledger in `.gjc/ultragoal/ledger.jsonl` (or the active `.gjc/_session-*/ultragoal/ledger.jsonl` runtime path). Required artifacts:

- `coverage-report.json` compares the frozen latest Tzuyang video window to live Supabase `documents` coverage, schema, indexes, grants, RLS, v1/v2 RPC behavior, and local source availability.
- `identity-conflicts.json` records the canonical write identity (`metadata.video_id`, `external_id`, `user_id`, `content_hash`, `embed_input_hash`, and `rollback_key`) and blocks conflicts instead of auto-repairing them.
- `embedding-contract-report.json` proves BGE-M3 dense shape/model/version (`vector(1024)` / `BAAI/bge-m3`), sparse lexical weights, reranker model/version (`BAAI/bge-reranker-v2-m3`), and route/batch input parity.
- `role-probes.json` proves anon denial, owner scoping, non-owner isolation, and `service_role` server/batch-only access without leaking tokens.
- `dry-run-manifest.json`, `canary-report.json`, and `blocked-backlog.json` separate preview counts, canary eligibility, readback, rollback drill, and durable blocked/unknown rows.

Safe execution order is fixed: Coverage -> Identity gates -> Embedding/RPC contract -> RLS/grants probes -> Dry-run Preview -> Canary -> Readback -> Rollback drill -> Full backfill or durable blocked backlog. Destructive production DB writes, quota-consuming APIs, and bulk provider calls require the previous gate's evidence plus rollback evidence before apply.

Next.js route handlers must remain bounded: they may authenticate, validate, call the live RAG worker, call Supabase, and return Korean fail-closed status. They must not run crawlers, ffmpeg, Gemini bulk jobs, full-channel scraping, or bulk embedding loops. Bulk/backfill work belongs in backend batch tooling with explicit preview/readback artifacts.

The route and batch embedding input must stay identical: `title + "\n\n" + content`. The `documents` route is bounded to 20 documents per request and calls the live worker; it must not embed locally or synthesize fallback vectors. Search rollback is controlled by `STORYBOARD_RAG_SEARCH_RPC_VERSION=v1`; the default path uses the versioned v2 RPC and additive indexes, with dual-read parity evidence recorded before any migration-dependent apply.

Do not use legacy one-off embedding scripts for this backfill path unless they are explicitly reviewed and wrapped in the same preview/readback/rollback gates. The current excluded legacy scripts are:

- `backend/storyboard-agent/scripts/01-bge-embed-and-store-supabase.py`
- `backend/storyboard-agent/scripts/99-openai-embed-and-store-supabase.py`
- `backend/storyboard-agent/scripts/migrate-embeddings-to-supabase.py`
