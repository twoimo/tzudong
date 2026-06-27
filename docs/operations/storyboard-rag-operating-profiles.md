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
