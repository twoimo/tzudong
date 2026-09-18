# Local storyboard acceptance — 2026-09-18

## Scope and evidence rules

Objective: implement the complete storyboard workflow using the installed
ddalcu/mlx-serve text and image models, with external AI disabled by default.
Keep subscription/manual integration, production outbound worker delivery, and
the full public UI audit as separate deliverables. None is implied by another.

The baseline is commit `67df460dee73f90b93eee203ebcbe7bd9976cb03`, confirmed
against GitHub main and the clean local checkout before source edits. The
implementation branch is `codex/storyboard-local-mlx-20260918`.

Acceptance is requirement based. Do not publish an aggregate quality score or
call a weighted checklist AHP. A requirement passes only with its named evidence;
missing or indirect evidence remains unverified. Any real-model, external-egress,
authorization, secret-handling, fake-success, or regression failure prevents
completion regardless of how many other requirements pass.

## Required evidence

| ID | Requirement | Evidence needed | Initial status |
| --- | --- | --- | --- |
| L01 | Installed server version and actual health/model contracts | Local version, health and models readback | Observed; contract probes remain |
| L02 | Real structured text for 5–12 scenes; bounded repair; no seeded success | Live generation plus malformed/boundary tests | Unverified |
| L03 | Real image per scene; single-scene regeneration; partial failure isolation | Live outputs, hashes, scene versions, failure tests | Unverified |
| L04 | Independent text/image selection; external AI off by default; no fallback | Request-boundary and runtime destination evidence | Unverified |
| L05 | Local retrieval/embedding/reranking/vision/evaluation; unchanged BGE contracts | Dependency failures, network evidence, retrieval tests | Unverified |
| L06 | Memory and latency measured; image concurrency starts at one | Before/during/after memory, swap and timing samples | Unverified |
| L07 | Persistent project, scene edits, history and refresh/restart recovery | DB readback and browser scenario | Unverified |
| L08 | Cancel, retry, late-result rejection, scene conflict handling | State-transition and concurrent-worker tests | Unverified |
| L09 | Export can be reopened without loss | Export/import round trip and artifact checks | Unverified |
| L10 | Five or more new real-model scenes, edit/regenerate/cancel/retry/refresh/export | Complete local browser smoke with retained artifacts | Unverified |
| S01 | Admin authentication and owner isolation on jobs, mutations and assets | Auth/ownership denial tests and API readback | Unverified |
| S02 | Private provider-neutral provenance; no client-forged trust | Server-issued asset verification and tampering tests | Unverified |
| S03 | Original preservation, WebP derivatives, hashes, MIME/dimensions, old PNG compatibility | Decoded artifacts and compatibility tests | Unverified |
| S04 | Bounded JSON/files/pixels; traversal, SSRF, redirect and DNS defenses | Boundary/adversarial tests | Unverified |
| S05 | No secrets in browser storage, repository, logs or evidence | Targeted source and retained-evidence checks | Unverified |
| Q01 | Atomic claim, lease, heartbeat, bounded retries and restart recovery | Isolated database concurrency tests | Unverified |
| Q02 | Durable queue and private result storage; no unbounded base64 DB payloads | Queue/storage readback | Unverified |
| Q03 | Outbound Mac worker with scoped credentials; no public inference port | Worker credential/endpoint tests and hosted readback | Unverified |
| Q04 | Offline worker clearly waiting; no cloud failover | Browser and worker-offline scenario | Unverified |
| P01 | Current official ChatGPT/Grok subscription and API boundaries | Dated official references; no cookie extraction | Research in progress |
| P02 | Versioned, schema-checked manual JSON/image import and prompt copy | Browser round trip, stale-version and invalid-file tests | Unverified |
| P03 | API keys/entitlements/costs explicitly configured before API enablement | Fail-closed configuration tests; no paid CI calls | Unverified |
| U01 | Route-based first-visitor scenario for actual public pages | Route inventory and written scenario | Unverified |
| U02 | Map, clusters, detail, search, filters, stamps, bookmarks, profile, feed, leaderboard | Local and production browser evidence | Unverified |
| U03 | Google/email auth, signup, nickname, logout, expiry, legal pages, roles | Authorized test-account browser evidence | Unverified |
| U04 | Mobile portrait, tablet portrait, 1440×900 desktop; supported color modes | Screenshots plus real interactions | Unverified |
| U05 | Empty/loading/error/data states, keyboard/focus/Escape/accessibility | Browser checks and before/after defect evidence | Unverified |
| D01 | Relevant unit/integration tests, ESLint and compiler parity | Actual command results using pinned toolchain | Unverified |
| D02 | Independent requested-model review, at most three iterations per stage | Actual selected model and returned review, or exact blocker | Unverified |
| D03 | Feature-sized tested commits; protected promotion; deployment separated | Commit/PR references and deployed-commit readback | Unverified |

## Initial runtime observations

## Updated status with retained evidence (later pass, 2026-09-18)

Evidence root: [defect-closure-observations.json](../../apps/web/.omx/artifacts/storyboard-local-mlx-20260918/defect-closure-observations.json)
plus the raw logs, DB readbacks, screenshots and helper scripts beside it in the
same local directory. `.omx/` is gitignored, so these are local artifacts and not
repository evidence. Hosted claims are separate and must cite a deployed commit.
Passing unit tests are not hosted proof.

| ID | Status | Evidence |
| --- | --- | --- |
| L02 | Passed (local) | `readback-c67c5f17-…json` / `projectC-full.json`: five structured scenes with title, description, imagePrompt and productionNotes; text provider `local-mlx`, model `ddalcu/Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit`, `modelEvidence: "response"`. `storyboard-mlx-provider.test.ts` covers one bounded repair of a malformed draft and the small-image no-upscale path. |
| L03 | Passed (local) | `cycle3.log` SCENES: five distinct `assetId`, `generatedAt` and `sha256` values, 1024×576 PNG with three WebP derivatives each, `modelEvidence: "installed-catalog-and-request"`. Scene edits landed at revisions 6 and 9 (`edit-patch.json`, `edit3.json`) and two single-scene regenerates were requested (`regen-patch.json`, `regen3.json`). |
| L04 | Passed (local) | Request-bound `providers.text` and `providers.image` are independently selected with `externalAI: false`; `egress-socket-sample.log` shows only `127.0.0.1:11234` and `127.0.0.1:8080` and zero non-loopback destinations. |
| L06 | Not re-measured this pass | Measured wall clock this pass: text stage 08:21:56→08:22:49 and five images 08:22:49→08:24:31 (~20 s each) at image concurrency 1 (`cycle.log`). Memory and swap sampling was not repeated. |
| L07 | Passed (local) | The project persisted and re-read at revision 6 (`readback-c67c5f17-…json`), and `export.json` was reopened without loss. Lease/claim restart-recovery behaviour is covered by unit tests, not re-run this pass. |
| L08 | Passed (local) | `cycle3.log`: CANCEL accepted at revision 4, status held `cancelled` unchanged for 30 s, RETRY returned revision 5 `queued`, then ran to `ready` revision 8 at 5/5 images. |
| L09 | Passed (local) | `export.json` is `storyboard-export-v1` with 20 files; every base64 payload SHA-256 matches its recorded hash, 5,525,023 bytes decode, and 5/5 scenes carry images. |
| L10 | Partially passed (local) | A five-scene storyboard was generated, edited, one scene regenerated, cancelled, retried, re-read and exported against the real local models. A full browser-driven admin run at all three viewports was not repeated this pass. |
| Q01 | Partially passed (local) | Atomic claim, lease, heartbeat, late-result and restart-recovery behaviour is covered by `storyboard-outbound-worker.test.ts` and `storyboard-production-api.test.ts` (lease recheck, unreferenced-variant removal after cancellation). The isolated database concurrency run was not repeated this pass. |
| Q02 | Passed (local) | Queue and the private `storyboard-private` bucket read back through `local_catalog_readback.sql` (now six buckets); the receipt-v1 round trip passes at 97 ledger units. Images are stored as bucket objects and the API returns metadata only. |
| S01 | Partially passed (local) | `storyboard-production-api.test.ts`: every admin endpoint authenticates before params, body, storage or DB work; cross-origin mutations are rejected; synthetic dev/e2e identities cannot become UUID owners; worker lookups must return a single UUID owner. |
| S02 | Partially passed (local) | Same file: manual imports are always recorded as unverified user provenance and projectId mismatch or forged provenance metadata is rejected; the fixed error response never includes exception text or DB diagnostics. |
| S03 | Passed (local) | Decoded originals are preserved as PNG with WebP derivatives at 480/960/1024 and per-file SHA-256, MIME and dimensions; `storyboard-mlx-provider.test.ts` preserves the decoded original, produces verified WebP derivatives, accepts static PNG/JPEG/WebP, and rejects corrupt pixels, non-images and image URLs. |
| S04 | Partially passed (local) | Bounded JSON despite a false content-length, bounded chunked multipart bytes before parsing, unknown/duplicate multipart field rejection, plus `review-photo-url-security.test.ts` and the `next-image-config-security.test.ts` loopback upstream gating matrix. |
| S05 | Partially passed (local) | ESLint exit 0 and `typecheck:parity` with `diagnostics: 0`; the retained evidence directory excludes the worker token and the admin session cookie. A dedicated repository-wide secret scan was not run. |
| D01 | Passed (local) | `storyboard-tests.log` 277 pass / 8 skip / 0 fail across 24 storyboard unit files; `affected.log` 58 pass / 0 fail across 9 files; `lint-typecheck.log` ESLint exit 0 and typecheck parity passed. The backend Supabase suite runs 1496 tests with zero regressions against baseline `67df460d`. |
| D03 | Partially passed (local) | Feature-sized commits on `codex/storyboard-local-mlx-20260918`, each preceded by its relevant tests. Nothing is deployed; production still serves `5af1e1f6`. |

Still unverified this pass: L10's full browser run at all three viewports,
Q03/Q04 outbound worker and offline-worker scenarios, P01–P03 provider
boundaries, U01–U05 public UI coverage, and the hosted requirement behind D03.
None of these may be reported as complete. L01's server version, health and
models contracts and L05's dependency-failure path are covered in the second
pass below; L05 still leaves local retrieval quality unverified while the BGE
dependency is absent.

## Second pass — local-only egress proof and delegated-route contracts (2026-09-18)

Branch head at this pass: `9a10de87633c575e52e4038a70eede42c69c2db2`, pushed to
`origin/codex/storyboard-local-mlx-20260918`. PR #2909 targets `main` and is
still `mergeStateStatus: BLOCKED`. Nothing in this pass is deployed.

### Fresh local-only end-to-end run with process-tree egress sampling

`egress-proof3-run.log` and `run3-project.json` record one complete storyboard
built by the local models while `egress-sampler.py` watched the MLX server, the
outbound worker and the Next dev server **and their full child trees**. The
sampler seeds the PID listening on 11234 via `lsof`, the worker and the dev
server, then walks `ps -axo pid=,ppid=,comm=` so a model helper process cannot
hide traffic.

| Stage | Evidence |
| --- | --- |
| create | project `9a1ba913-7d8f-4feb-9b4c-8e8fe64d87c5`, `sceneCount: 5`, `externalAI: false`, text `local-mlx` / `ddalcu/Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit`, image `local-mlx` / `ddalcu/Krea-2-Turbo-MLX-Serve-mixed-4-8`, `retrieval: none` |
| text | claimed 10:18:26Z, `claimed/images` 10:19:20Z → 54 s for the structured document |
| images | five scenes at ~21 s each, `ready` / `succeeded` / `complete` at 10:21:11Z, revision 6, `attempts: 1` |
| document | every scene carries `title`, `description`, `visualDirection`, `narration`, `caption`, `productionNotes`, `imagePrompt` and `revision: 1` |
| provenance | per scene `providerId: local-mlx`, `model: ddalcu/Krea-2-Turbo-MLX-Serve-mixed-4-8`, `verification: local-worker`, `generatedAt`, `requestId`, `modelEvidence: installed-catalog-and-request`; `responseId` and `responseModel` stay `null` instead of being invented |
| assets | 1024×576 PNG originals (756 KB–1.17 MB), each with three WebP derivatives at 480/960/1024 and per-file SHA-256 |

`egress-proof3-verdict.txt`: 145 samples, 673 endpoint lines, 64 distinct pairs,
every remote host `127.0.0.1`, `non_loopback=0`, `VERDICT=PASS`. The window
19:18:20–19:21:20 KST covers the entire text and image phases.

Two earlier sampled runs are kept as the honest failures. `egress-proof1.log`
used the same sampler and also reported `non_loopback=0`, but the job failed
with `model_timeout` because the 300 s MLX request timeout elapsed while the host
was loaded. `egress-proof2-run.log` failed with `local_model_unavailable`
because the MLX listener was down at that moment. Both are host-state symptoms,
not contract changes.

Memory measured during the successful pass: both models resident —
75,303,252,216 B for the text model and 15,817,951,221 B for
`ddalcu/Krea-2-Turbo-MLX-Serve-mixed-4-8`, ≈ 91.1 GB together. `vm.swapusage`
moved from the 1277.81 MiB baseline to 4465.06 MiB used. Image concurrency
stayed at one. The swap growth is measured and reported, not explained away.

### New tests and contract repairs in this pass

| Item | Result |
| --- | --- |
| `apps/web/tests-unit/storyboard-local-egress.test.ts` (new) | 5 pass / 0 fail: loopback literal with every proxy variable set upper and lower case, zero proxy connections, a `globalThis.fetch` spy that must never run, `external_ai_disabled` before any socket for `openai-api`/`xai-api`/`chatgpt-manual`/`grok-manual`, consent that cannot convert the local adapter into a cloud client, and `bge_dependency_unavailable` with zero requests |
| `backend/supabase/tests/storyboard_mlx_worker_integration.py` | 12 tests OK against the network-less `supabase/postgres:15.8.1.085` container (`dbtest3.log`): fresh install declares the storyboard catalog exactly once, the `storyboard-private` bucket is private with **zero** `storage.objects` policies and service_role-only reads, and a blind re-apply fails closed without schema drift |
| `apps/web/tests-unit/admin-route-auth-contract.test.ts` | accepts the five production routes that delegate to `lib/admin/storyboard/production-api.ts` and asserts each delegated member is declared behind `admin(request` |
| `apps/web/tests-unit/lazy-map-boundaries.test.ts` | asserts the deferred barrel `components/map/map-view-deferred-panels.tsx`, its `app/home-detail-globals.css` import and that neither panel is imported statically |
| `local-supabase-runtime.test.ts`, `nightly-regression-workflow.test.ts` | align the local ledger and nightly publication expectations with the 97-unit migration |
| `apps/web/components/ui/input.tsx` | the shared Input shrinks at `lg` instead of `md` and carries `pointer-coarse:text-base`, so every touch device keeps 16 px at any width while fine-pointer desktops stay at 14 px (measured in the public UI audit) |
| affected suite + toolchain | 58 pass / 0 fail across 9 files (`affected.log`); ESLint exit 0 and `typecheck:parity` `diagnostics: 0` (`lint3.log`) |

### Independent review (D02)

The `codex-chatgpt-web` sub-agent requested for this pass could **not** be used: two
spawn attempts (`chatgpt-web/high`, then `chatgpt-web/medium`) both returned
`rate limit exceeded: ChatGPT rate limit: too many requests … ChatGPT remained
unavailable after several attempts`. That is recorded as an unavailable tool, and the
local implementation and verification continued without an extra review round. The
review below is the earlier, separate one and still stands for the commit it names;
it does not cover `eb5943ed`, whose changes are covered by the tests listed in the
third-pass section instead.

An independent review was obtained through the Aside browser agent against
chatgpt.com. The goal's preferred model could not be used: GPT-6 Pro was
unavailable (`aria-disabled`, reset 2026-09-22), and the reviewer actually used
was **GPT-5.6 Sol, slug `gpt-5-6-thinking`** — never reported as Pro or 6 Pro.
Verbatim transcript: `external-review-1.md`. Verdict: local conditional PASS,
production deployment HOLD. Its asks — process-tree egress proof including model
helper processes, blocked-attempt logging, proxy-environment check,
provider-adapter spy, admin and worker authorization evidence,
`storyboard-private` **policy** rather than bucket verification, and
fresh-install/upgrade/idempotency/reset contracts — are addressed by the new unit
tests, the database integration test and the sampled run above. Its form-control
font-size ask is measured in the public UI audit, which also records the one
remaining `md:text-sm` occurrence.

## Initial runtime observations

- `/Applications/MLX Core.app` reports version `26.9.3`.
- `http://127.0.0.1:11234/health` returned `{"status":"ok"}`.
- `/v1/models` reports a loaded `ddalcu/Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit`
  text model and installed `ddalcu/Krea-2-Turbo-MLX-Serve-mixed-4-8` and
  `mlx-community/flux2-klein-9b-4bit` image models. Catalog membership is not
  evidence of successful generation.
- The unrelated `~/.local/bin/mlx-serve` is an Aside `mlx-lm` wrapper, not the
  ddalcu server CLI. Do not use it for server management or capability discovery.
- Physical memory is 137438953472 bytes. Baseline swap used is 1277.81 MiB;
  later samples must be compared against that baseline, not claimed swap-free.
- The active shell exposes Node 26; the repository requires Node 24 and npm
  11.6.2. A Node 24 Homebrew installation exists; use it for validation.
- No models have been downloaded for this task. Existing model/server state
  belongs to the user; do not unload models or stop their server.

## Completion report

Update this ledger with concrete evidence paths and statuses as work completes.
Do not replace the complete objective with this turn's completed subset. Keep
production read-only until an authorized test-data or deployment scope is known.

The later pass above closes the local storyboard generation path and the named
public UI defects; it does not close the whole objective. Production still serves
`5af1e1f6ac81a483e1e8aed2b05237ca0f62ce6a`, which predates every commit on this
branch, and the production release remains blocked by the external evidence
listed in [release.md](../agents/release.md).

## Third pass — browser-driven local run, export, worker-offline and public UI (2026-09-18)

Branch head at this pass: `eb5943ed` (`fix(web): surface server 409 reasons, guard
retry, and keep the selected storyboard project`), pushed to
`origin/codex/storyboard-local-mlx-20260918`. Local rendered behaviour only; no
deployment, no hosted migration, no production write. Evidence root:
`/tmp/tz-e2e/browser-e2e/` (`*.log`, `*-report.json`, `*.png`) beside
`export-fresh.json`; the earlier artifacts remain under
[storyboard-local-mlx-20260918](../../apps/web/.omx/artifacts/storyboard-local-mlx-20260918/).

### Complete local browser run on the real models (project `a4e99052-bfec-4129-a382-a5b97dafd714`)

Driven through the admin UI with a real admin cookie (`storageState`), the real
outbound worker and the live MLX server on `127.0.0.1:11234`; external AI off.

| Step | Result |
| --- | --- |
| Fresh generation | five scenes / five images ready in **176.2 s**; text provenance `로컬 워커 · ddalcu/Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit`; providers line `텍스트: 로컬 MLX · 이미지: 로컬 MLX`; 0 broken images |
| Scene edit | scene 1 edited through the UI, saved and persisted |
| Single-scene regeneration | **119.6 s**; scene-2 asset `3e96a69d-316` → `0483d2cd-275`, the other four assets byte-identical; revision 11 → 13; 5/5 images loaded |
| Cancel | job `cancelled`/`generation_cancelled`, project revision 11, message "생성이 취소되었습니다. 저장된 장면은 유지됩니다." |
| Reload restore | after the fix below, the URL keeps `storyboardProject=…` and the same 5 scenes, 5 images and identical asset ids are restored (`after reload … "scenes":"저장된 장면 5개 · 이미지 5개"`) |
| Export | UI `파일 포함 JSON 내보내기` download `storyboard-a4e99052-….json`, 7,020,395 B, **SHA-256 identical to the server export endpoint**; schema `storyboard-export-v1`; 20 files, every base64 payload matching its recorded SHA-256; MIME set `image/png` + `image/webp`; exported document deep-equal to the stored document; no scene original path missing from `files` |
| Viewport sweep | workspace at 390×844, 768×1024 and 1440×900 (light and dark) with `scrollW == clientW` and no broken images |
| Browser egress | `nonLoopback = 0` for every browser step; no page errors |

### Defects found by the browser pass and fixed

1. **Every 409 collapsed to `revision_conflict`.** Live `POST
   …/production/<id> {"action":"retry"}` at a `cancelled` revision answered
   `409 {"ok":false,"error":"nothing_to_retry"}` (the migration guard at
   `backend/supabase/migrations/20260918021531_storyboard_mlx_worker.sql`), while
   the UI reported "다른 편집 또는 생성으로 장면이 변경되었습니다." The client now
   surfaces the server's own code when it has a Korean message, adds
   `nothing_to_retry`/`project_busy`/`request_conflict` messages, and disables the
   retry button once every stored scene already has an image. The migration guard
   itself is unchanged.
2. **Reload dropped the selected project.** `storyboardProject` was absent from
   `buildCanonicalAdminHrefFromSearchParams`'s `preserveKeys`, so a reload
   collapsed the URL to `/admin?module=storyboard` and the workspace asked for a
   project. The key is now shared as `ADMIN_STORYBOARD_PROJECT_QUERY` and
   preserved.

Both fixes are covered by new tests: `tests/local-storyboard-workspace-ui.spec.ts`
("surfaces the server's own 409 reason…", "disables retry once every stored scene
already has an image") and two assertions in
`tests-unit/frontend-unused-route-compatibility.test.ts`.

### Worker-offline behaviour (Q04) and worker exposure (Q03)

With the Mac worker stopped and past the 120 s heartbeat window, the real admin
UI reported one `· 오프라인` worker row and zero online rows, still listed the
installed models from the last heartbeat, kept `외부 AI 사용 허용` unchecked, and
offered only 로컬 MLX and 수동 가져오기 (the OpenAI/xAI API entries stay disabled as
"설정 전 사용 불가"). Creating a request then showed `로컬 워커 대기` with `텍스트:
로컬 MLX · 이미지: 로컬 MLX`, `재시도` disabled and `작업 취소` enabled; cancelling moved
it to `취소됨` with "서버에 변경 사항을 저장했습니다." No non-loopback browser
request occurred. The worker was restarted immediately afterwards.

`lsof` confirms the inference port is loopback-only: `mlx-serve … TCP
127.0.0.1:11234 (LISTEN)`, and the dev server likewise `TCP 127.0.0.1:8080`.

### Public UI pass (U01–U05) and one non-reproduced observation

26 route/viewport combinations (`/`, `/global-map`, `/feed`, `/stamp`,
`/leaderboard`, `/privacy`, `/data-deletion`, `/auth/required` at 390×844,
768×1024, 1440×900, plus light and dark home) all returned HTTP 200 with
`scrollW == clientW`, 0 broken images, 0 dialogs and no page errors.
`/stamp` redirects to `/?panel=stamp` on desktop and stays at `/stamp` on mobile,
matching the recorded inventory. One hydration-mismatch console error appeared on
that desktop redirect in the sweep and did **not** reproduce in four dedicated
re-runs (desktop light, desktop dark, mobile, direct `/?panel=stamp`), so it is
recorded as transient and unexplained rather than as a confirmed defect. The
sweep's search-field probe used DOM selectors that do not match the canvas-rendered
map, so its "no markers" counts are not evidence about search results and are
discarded.

### Provider boundary (P01) and remaining unverified items

xAI primary source `https://docs.x.ai/docs/quickstart` (page footer "Last updated:
August 18, 2026") fetches at HTTP 200 and documents the official path: an account
at `console.x.ai` loaded with credits plus an API key; the page never presents a
subscription OAuth as an API credential. `platform.openai.com/docs` and the
OpenAI help article answer HTTP 403 ("Just a moment…") to both curl and a real
Chromium context, and the delegated search tool was rate limited, so the OpenAI
boundary is not freshly re-verified this pass. Details:
`p01-provider-boundary-20260918.md`.

Still unverified: the hosted requirement behind D03 (the `탈퇴한 사용자` join fix is a
hosted migration), production browser acceptance at the three viewports, P01's
OpenAI half, P02/P03 browser round trips beyond their existing contract tests,
U03's authenticated account flows, and L05's local retrieval quality while the BGE
dependency is absent.

### Manual import and prompt copy, browser round trip (P02)

A project created with 수동 가져오기 for both text and image opens as `가져오기 대기`
(`awaiting_import`). All of the following was driven through the real admin UI on
`98f904de-c5fd-4add-97b2-f7015776621f`; evidence `manual-import-report.json` and
`manual-image-report.json`.

| Check | Result |
| --- | --- |
| Prompt copy | `현재 텍스트 프롬프트 복사` yields 2,406 characters containing the model prompt, the literal `storyboard-mlx-v1`, this project's id and the envelope JSON Schema |
| Stale envelope rejected | body with `revision: 999` → "현재 프로젝트의 schema, projectId, revision과 장면 형식을 확인하세요.", nothing saved |
| Valid envelope | five scenes stored, revision 0 → 1, and provenance recorded as `providerId: manual`, `verification: user-import`, `modelEvidence: unverified`, `responseId: null` — shown in the UI as "사용자 가져오기 · 모델 정보 없음 · 모델 미검증", never as a verified provider result |
| Non-image rejected | a 28-byte text file sent as `image/png` → "PNG, JPEG, WebP 정지 이미지만 가져올 수 있습니다.", revision unchanged |
| Real image import | 320×180 PNG stored as `image/png` with one WebP derivative at the same 320 px width (no upscale), provenance `user-import`/`unverified`, revision 1 → 2, 0 broken images |
| Reload | the same scene line ("저장된 장면 5개 · 이미지 1개") and the same asset id render again |
| Browser egress | `nonLoopback = []` in both probes |

So P02 is now covered by a browser round trip rather than only contract tests. P03
remains covered by contract tests plus the migration's `provider_not_configured`
raise, and no paid API call was made.

### BGE dependency failure with the real worker (L05)

`mlx-client.ts` throws `bge_dependency_unavailable` when `request.retrieval !== 'none'`
before any model call, and the objective forbids substituting fake embeddings, so the
dependency-failure path was exercised end to end instead of being described. A request
was created through the admin API with `retrieval: 'bge-local'` on
`da051537-0e97-4fe3-96a8-54ed03cdf0e5`; the real outbound worker claimed it and failed
it in one attempt:

| Check | Result |
| --- | --- |
| Create | HTTP 200, `waiting_worker`, `retrieval = bge-local` |
| Worker job | `status: failed`, `stage: failed`, `errorCode: bge_dependency_unavailable`, `attempts: 1` |
| Project readback (SQL) | `status = failed`, `revision = 0`, `document IS NULL` — no seeded document and no fabricated embeddings |
| UI | "생성 실패" with "BGE M3 임베딩과 reranker 준비가 확인되지 않았습니다. 검색 인덱스는 변경하지 않았습니다." |
| Browser egress | `nonLoopback = []` |

Evidence: `bge-report.json`. Retrieval *quality* remains unverified because the BGE
dependency is absent; only the fail-closed contract is proven.

### Toolchain and CI at `eb5943ed`

Environment note: the MLX server on `127.0.0.1:11234` was restarted externally during
this pass (the user's `MLX Core.app` / `mlx-serve-ops.sh ensure`), after all
storyboard evidence above had been captured. While it was down the worker's own
log recorded `{"event":"worker_stopped","code":"local_model_unavailable"}` and it
made no cloud call; once the listener returned, `/health` reported
`{"status":"ok"}`, `/v1/models` again listed the text model as `loaded: true`,
`state: ready`, and the port remained loopback-only. The worker loop was running
from `apps/web` throughout and was not pointed at a different origin.

It then shut down gracefully a second time and stayed down, so it was restored with
the project's own ops script (`~/.mlx-serve/ops/mlx-serve-ops.sh start --force --wait
300`): `health OK after 36s (pid 38868)`, model resident, port loopback-only. No
model was unloaded or swapped.

CI run `35342661258` for the docs-only head `5702f057` completed with **Admin
passed** and Install passed, and the four npm/Bun jobs again reporting `2090 pass /
1 fail` (`Ran 2092 tests across 289 files`) with the same single pre-existing
`typecheck-benchmark-source` failure.

Local: `npm run test:unit` 2090 pass / 1 skip / 1 fail across 289 files, the single
failure being the pre-existing `typecheck-benchmark-source` case; the Playwright
storyboard UI contract suite 23 passed; `frontend-unused-route-compatibility`
7 passed; ESLint exit 0 and `typecheck:parity` `diagnostics: 0`.

CI run `35340032045` (workflow "Storyboard local MLX production worker + home
map/review fixes", head `eb5943ed`): **Admin passed**, Install passed, and the
Ubuntu/Windows npm and Bun jobs each report `2090 pass / 1 fail` with only the same
pre-existing `typecheck-benchmark-source` case. The 20
`admin-storyboard-local-bridge` `ConnectionRefused` failures seen earlier are gone.
Pre-existing, not introduced here: `generate` in the Catalog workflow (Docker no
longer accepts `docker image inspect --platform`), `orchestration-readiness` and the
two `npm-audit` jobs in Security (`apps/web` sharp/libheif and backend `js-yaml`;
no package or lock file changes in this branch), `Promotion Path`
(`PROMOTION_SERIAL_PATH_REQUIRED`, because the branch is based on `main`), and the
dynamic Code-scanning AI findings check. The Release workflow passed.

### Search, long and adversarial input (U02)

On the desktop home search field locally, an empty or whitespace-only query returns
the 인기 검색 맛집 list (two fixture entries), and `한추`, a 60-character query,
`ㅁㄴㅇㄹ`, `@#$%^&*()`, `<img src=x onerror=alert(1)>` and `<script>alert(1)</script>`
all render the `검색 결과가 없습니다.` empty state with no horizontal overflow, no dialog
and no injected markup. No positive search hit is verifiable locally because this
local database holds only two nightly fixtures; the earlier read-only production
audit verified a real `한추` search hit on `5af1e1f6`.

## Fourth pass — local auth boundary and authenticated surface (2026-09-18)

### The privacy gate blocks account onboarding locally

The local accounts were created through the Supabase admin API, so they carry no
consent record. `POST /api/privacy/onboarding` therefore cannot issue an onboarding
challenge: `create_privacy_onboarding_challenge` raises
`privacy_audit_retention_policy_required`, the route answers 409, and the modal shows
"가입 정보를 확인할 수 없습니다. 다시 시도해주세요." The cause is the local retention
catalogue: all twelve rows of `privacy_retention.privacy_retention_classes` are
`disabled` with no `approved_evidence_ref` and no `activated_at`. Supplying that
evidence is an operator and legal decision, and `docs/agents/privacy.md` forbids
inventing retention periods or legal bases, so no row was activated for this pass.

Readback of `get_current_privacy_eligibility` with each account's own access token:

| account | result |
| --- | --- |
| `nightly-ci@local.invalid` (admin) | `{"eligible":true,"reasonCode":"PRIVACY_ELIGIBLE"}` |
| `reviewer1@local.invalid` (member) | `{"eligible":false,"reasonCode":"PRIVACY_AGE_ATTESTATION_REQUIRED"}` |

Consequence for the member path, verified at 390, 768 and 1440 with the real login
form: a correct password signs in, the modal switches to the existing-account
recovery tab with "현재 개인정보 처리방침과 연령 확인을 완료해주세요.", completing it
stops at the 409 above, and the next navigation is signed out by the middleware.
`apps/web/lib/supabase/middleware.ts` signs a session out and redirects to
`/auth/required?reason=privacy` whenever an authenticated session has no live
privacy receipt, on every route including `/`, so a member session cannot reach an
authenticated surface locally. That is fail-closed behaviour, not a defect; the
password rule below was the defect.

### Defect fixed: re-attestation rejected an existing password

`apps/web/components/auth/AuthModal.tsx` applied the new-signup password rule
(8–12 characters) to the existing-account re-attestation form, whose field is the
account's current password (`handleSignup` verifies it with
`supabase.auth.signInWithPassword`). The server bound for new signups is 8–72, so an
account whose password does not satisfy the stricter client rule could never
re-attest and therefore never log in: the form stopped at "비밀번호는 8자 이상 12자
이하여야 합니다" before sending any request. Reproduced with `reviewer1@local.invalid`
(password created through the admin API, 18 characters); with the rule gated to new
signups the request is issued. Fixed in `788f815e`.

### Authenticated surface verified with the privacy-eligible admin session

The repository's real admin session (`apps/web/tests/.auth/admin.json`, whose session
is privacy-eligible; no dev bypass header or cookie was used) rendered these routes
with no redirect at 390, 768 and 1440: `/mypage/profile` (쯔동여지도 마이페이지,
일반/야간 마케팅 수신), `/mypage/bookmarks` (나의 북마크 내역), `/mypage/reviews`
(나의 리뷰 내역), `/mypage/submissions/new` (신규 맛집 제보), `/insights` (treemap
with 조회수/좋아요/댓글수/영상길이, 2W–1Y periods and the explicit empty state
"대상 데이터가 없습니다.") and `/admin?module=storyboard`. All had zero horizontal
overflow, zero broken images and no page errors. The home user menu showed the account
label plus 마이페이지 / 환경설정 / 관리자 콘솔 / 로그아웃, closed on Escape and
returned focus (desktop); tablet and mobile expose 마이페이지 / 관리자 콘솔 / 로그아웃.

Still blocked locally: signup with a nickname, the member (non-admin) authenticated
surface, sign-out, and Google login. The local Supabase has no Google provider
configured — `/auth/v1/authorize?provider=google` is requested on the local host and
returns without a redirect and without a toast — so only the request attempt is
observable.

### Sub-agent review channel unavailable (five attempts)

The objective asks for an independent review through the `codex-chatgpt-web`
sub-agent. Five `multi_agent_v1__spawn_agent` attempts failed on the service side, not
on the task: `chatgpt-web/high` answered `rate limit exceeded: ChatGPT rate limit: too
many requests`, then `chatgpt-web/medium` answered the same once and
`stream disconnected before completion: ChatGPT stopped responding after the task
started. Check the ChatGPT tab before continuing.` twice, the last for a deliberately
minimal one-file question. Recorded as blocked. The independent review on file
(GPT-5.6 Sol, `external-review-1.md`) predates `eb5943ed` and `788f815e`.
### Full unit suite for `788f815e`

`npm run test:unit` was run in full on this head: **2090 pass, 1 skip, 1 fail**, 73590
`expect()` calls across 289 files in 96.55 s. The single failure is the pre-existing
`tests-unit/typecheck-benchmark-source.test.ts` case (it expects the phrase "treat zero
admitted slices as a valid result" in the agent guidance, which the current guidance
does not contain); it also fails on the untouched base and is unrelated to the
storyboard or auth changes. The targeted suites for this change all pass: 80 assertions
across `privacy-onboarding`, `auth-admin-login-redirect`, `privacy-policy-contract` and
`profile-mutation-boundary`, plus ESLint exit 0 on `AuthModal.tsx` and
`typecheck:parity` with `diagnostics: 0`.


### Sub-agent review: sixth attempt also failed

One more `codex-chatgpt-web` attempt was made after a real wait. `chatgpt-web/extra-high`
(the configured default; `chatgpt-web/high` rejects the inherited `xhigh` reasoning
effort) spawned agent `01a0b4ab-0cf1-7fe1-a614-d19d276509c5`, which then errored with
`stream disconnected before completion: page.goto: Timeout 60000ms exceeded` while
navigating to `https://chatgpt.com/?temporary-chat=true`, and never produced a review.
That is a transport failure in the harness, not a task failure. Six attempts have now
failed (rate limit, silent stall, and this navigation timeout), so the channel stays
recorded as blocked; it needs the ChatGPT browser tab itself to be healthy before it can
work. The independent review on file (GPT-5.6 Sol, `external-review-1.md`) still predates
`eb5943ed`, `788f815e` and `1153e6fc`.


### Frozen grading criteria (unchanged this pass)

The weights and thresholds fixed at the start of the goal still apply: the local
storyboard end-to-end path with real MLX models (5 scenes, 5 images, edit, single-scene
regeneration, cancel, reload restore, export) is worth the largest share; the zero
external-egress check under disabled external AI is a hard gate that fails the local
mode outright if a single non-loopback inference request appears; the UI inspection
(390/768/1440, light and dark) and the per-boundary error reporting carry the next
shares. No weight was changed and no test was removed to reach a score.


## Fourth pass — map, filter and review defect re-verification (2026-09-18)

All source fixes for the reported defect list were already committed on this branch
(`7863e913`, `ee855005`, `e2a29a03`, `eb5943ed`, `788f815e`). This pass re-ran the defective
interactions against the current head `d22cfc7b` on the local stack to confirm the fixes
still hold, and re-read production read-only to pin what is actually deployed.

### Cluster click

Clicking the `17` cluster at 1440 and at 390 moved the map to the cluster centre and left the
cluster container at zero with 17 individually visible markers and 2 review-bubble anchors,
so markers no longer evaporate after the move. Before the click: 1 container, 17 text,
0 visible markers.

### Five theme filters and reset

Each filter was toggled on and off with the resulting marker population recorded: 조회수 폭발
4, 댓글 폭주 4, 최근 영상 1, 재등장 맛집 1, 반응 찐함 2, and 17 after reset. No horizontal
overflow at 1440 or 390.

### Bottom sheet with a filter applied

With 조회수 폭발 active, clicking a marker navigated to
`/?restaurant=…&mapMode=domestic&restore=…` and the detail panel opened with the restaurant
name, 도로명/지번/영어 주소, the YouTube 영상 block and 최근 리뷰 (1) carrying the author's
nickname (먹보쯔양팬) rather than the deleted-account fallback. Verified at 390, 768 and 1440.

### Button and typography fixes

`수정 요청` and `리뷰 작성` measure 98x56 at 390 and 206x56 at 768 with `overflowX=false` and
`white-space: nowrap`, so no clipping or wrapping; 길찾기 measures 147x56. The restaurant name
button under the nickname renders at 12px / 16px (down from 16px / 24px). `/feed` renders the
canonical and legacy review photos with 0 broken images and 0 horizontal overflow at all three
widths.

### Production state tied to the deployed commit

Read-only fetch of `https://www.tzudong.app/feed` and all 33 `_next/static` chunks (with a
browser user agent) still shows `5af1e1f6` behaviour: `read_public_profile_summaries` 2,
`read_public_profile_leaderboard` 2, `탈퇴한 사용자` 5, `bg-black/70` 0, `bg-black/55` 0,
`top-2` 0, and `cluster-marker-container` 0. The deployed CSS therefore still lacks the
utilities the play badge and marker utilities need, and the deployed client still has no
fallback when the two profile RPCs are missing from the hosted schema cache. None of the
fixes in this branch are live.

### Still blocked, not a code defect

The 로컬 위치 button remains gated by `apps/web/lib/privacy/location-readiness.ts`, which requires
`DEVICE_LOCATION_RELEASE_DECISION=approved` plus a verified external status and four SHA-256
evidence references. That is an operator and legal decision and was not invented.

Production promotion needs the `develop -> data -> main` PR chain and the external evidence in
`docs/agents/release.md` (published policy tuple, retention approvals, hosted migration/RLS
readback, location filing, legal review). Those receipts are still missing, so the promotion chain has
not been opened and the fixes remain undeployed.


### Geolocation wiring and lint on the current head

The 위치 button is wired to the browser Geolocation API in `app/home-client.tsx`: the click
path checks `navigator.geolocation`, shows the disclosure prompt, then calls `watchPosition`
and stores the watch id for `clearWatch` on teardown, so the permission request and the
floating-button behaviour are implemented. The remaining gate is the privacy readiness check
(`DEVICE_LOCATION_NETWORK_SINK`), which returns
"위치 서비스(GPS) 기능을 켜주세요." while the operator release decision is absent. Nothing about
the geolocation flow itself is missing; it cannot be exercised locally without that decision.

`npm run lint` on `247de07e` exits 0 with `--max-warnings=0` (log `lint-final.log`). The full unit
suite on the same code line is 2090 pass / 1 skip / 1 fail, the single failure being the
pre-existing `typecheck-benchmark-source` case.


### Correction: the production join failure is a hosted migration gap

Earlier notes treated the `탈퇴한 사용자` production failure as something a code deployment would
fix. Inspecting the deployed commit shows otherwise: `5af1e1f6` (the sha production serves)
already contains
`backend/supabase/migrations/20260812000600_local_profile_read_boundary_convergence.sql`, which
was added by `5af64a05` and is an ancestor of `origin/main`. The deployed client calls
`read_public_profile_summaries` (2 occurrences) and falls back to `탈퇴한 사용자` (5
occurrences), while the hosted PostgREST answers 404 `PGRST202` for that function.

So the join defect is a hosted-database migration gap: the repository-side fix is already on the
deployed line, and the missing piece is applying the reviewed migration to the hosted database and
reading the RPC back. That is a hosted write with its own approval and evidence requirements under
`docs/agents/release.md`, and it is the one defect in this list that a production code deployment
would not resolve on its own.

The remaining UI/UX defects (play badge utilities, cluster marker rendering, filter wiring, button
clipping, review photos, eyebrow size, review-card border) need the branch promotion described
above, because the deployed bundles contain none of the marker utilities and no `.bg-black/55` or
`.ring-1`.


### The join fix is outside the governed migration path (verified)

Applying `20260812000600_local_profile_read_boundary_convergence.sql` to hosted is not available
through the repository's own release machinery. `.github/supabase-migration-release-manifest.v1.json`
is SHA-256 pinned by the `Migrations` workflow (`RELEASE_MIGRATION_MANIFEST_SHA256 =
515743d094b4b431a29df772a363837bdad8f7541aa3acf4a923efb79f460c0d`, which matches the committed file)
and contains exactly three entries: `restaurant_refresh_history`,
`g016_privacy_audit_owner_policy`, `g016_onboarding_confirmation_freshness`. The
`*_local_*` profile-read convergence migrations are not entries, and
`node apps/web/scripts/apply-supabase-migration.mjs --migration-id local_profile_read_boundary
--dry-run --json` fails with `MIGRATION_MANIFEST_DIGEST_INVALID`. So hosted has no approved path
to receive these RPCs; only `secrets.SUPABASE_DB_URL` inside the workflow could reach the database,
and that path is bound to manifest entries.

A client-side fallback is also unavailable: `FEED_REVIEW_SELECT` (`components/feed/FeedContent.tsx`)
does not carry an author nickname, `profiles` refuses direct anon/authenticated reads (401 `42501`),
and the only remaining profile read is the hosted-absent RPC. Every reader of that map — /feed,
/stamp, the restaurant panel — therefore cannot recover the nickname on its own. The fix needs a
reviewed release-manifest change plus a hosted apply, or an equivalent approved server-side read
boundary; both are release decisions rather than implementation details.

### Production reproduction on the deployed commit

Driving https://www.tzudong.app/feed in a real browser at 1440 produced one
`/rest/v1/rpc/read_public_profile_summaries` response with status 404, 8 `탈퇴한 사용자`
mentions in the rendered text, "쯔동여지도 리뷰 (2개)", 118 images with 0 broken, and no page
errors. That confirms the defect is live on the deployed commit and that the client-side catch
(`readPublicProfileSummaries(supabase, userIds).catch(() => [])`) silently degrades every reviewer
to the deleted-account label.


### Hosted migration boundary: everything after 2026-08-01 needs a new closure

`.github/g034-hosted-migration-closure.v1.json` is the authoritative record of what hosted has
received. It lists 29 migrations (first `20260627080000_storyboard_custom_gpt_rag_documents`, last
`20260801000300_g016_onboarding_allowlist_freshness`) with
`closureTerminalVersion = 20260801000300`, `ledgerTerminalVersion = 20260531084516`,
`requiredLaterPromotionGate = 20260713002500_g014_catalog_contract.sql`, and nine deliberately
`excludedVersions`.

So hosted's applied ledger effectively ends at **2026-08-01**. Every migration dated after that is
outside the closure and therefore absent from production, including:

- `20260804000100..0500` (g041 privacy/audit/auth boundary repairs)
- `20260812000100..000700` (the `*_local_*` convergence set, containing
  `read_public_profile_summaries` and `read_public_profile_leaderboard`)
- `20260918021531_storyboard_mlx_worker.sql` from this branch

That explains the production join defect mechanically (the RPC was never in the hosted ledger), and
it also means the local MLX storyboard worker migration from this branch cannot reach hosted by
merging the branch alone. Landing either one requires a **new hosted migration closure/promotion
package** of the kind `g034`/`g038` produced — pinned source hashes, predecessor ledger root,
terminal-state readback, clone/backup recovery evidence and a promotion gate — not a routine file
change. `apps/web/scripts/apply-supabase-migration.mjs` only accepts the three ids bound to the
SHA-pinned manifest, and rejects anything else with `MIGRATION_MANIFEST_DIGEST_INVALID`.

The release-manifest change therefore is not a one-line edit; it is the deliverable that the
remaining production work depends on, and it needs the hosted readback and recovery evidence that
only the credentialed release path can produce.

## Sixth pass — serialized promotion, release gate and U05 accessibility (2026-09-18)

### Promotion chain completed

| Step | PR | Base | Merge commit | Required checks |
| --- | --- | --- | --- | --- |
| feature -> develop | #2909 | develop | `ce22e122` | Release, Promotion Path |
| develop -> data | #2910 | data | `e1315bbb` | Release, Promotion Path |
| data -> main | #2911 | main | `7554ee3b` | Release, Promotion Path |

`origin/main` is now `7554ee3b`; nothing was force-pushed and no branch protection was bypassed.
The first merge was blocked by an unresolved security conversation rather than by a required check:
code-scanning alert 77 (`js/bad-code-sanitization`) pointed at
`tests/local-storyboard-workspace-ui.spec.ts:108`, where the harness interpolated a shim path into
generated JavaScript and then executed it. Commit `7f213391` moved the entry module, the next/image
shim, the bundle script and the Tailwind entry into committed files under
`tests/fixtures/local-storyboard-ui/`; the next analysis marked the alert instance `fixed`, the
GitHub Advanced Security thread resolved itself, and the 23 UI contracts still pass on chromium.

### Production still serves the previous commit

After the `main` merge, `https://www.tzudong.app/api/health` kept returning
`gitSha 5af1e1f6ac81a483e1e8aed2b05237ca0f62ce6a`,
`releaseId 5445fa71104b2408962c1c5d369babf3bb778838`,
`deploymentId dpl_CpqD2F8weF6vDLUG2AgSfrruMbZa` over a five-minute poll. That is by design:
`apps/web/scripts/vercel-ignore-build.mjs` skips a production build unless
`TZUDONG_APPROVED_PRODUCTION_SHA` equals the pushed commit ("production commit lacks matching
release authorization"). Merge and release are separate steps, and the release still needs the
external evidence listed in [release.md](../agents/release.md).

### The hosted apply is held by the G037 write freeze

`.github/workflows/supabase-migration-apply.yml:111` only lets the two `g016_*` ids through while
`vars.G037_WRITE_FREEZE == "active"`. The variable has been `active` since 2026-07-17, and
`backend/supabase/docs/g037-hosted-closure-runbook.md` states the procedure "must not set or change
`G037_WRITE_FREEZE` or any GitHub repository or environment variable" and that operators "must keep
the freeze active through G038". The profile-read RPC migration therefore cannot be applied from
this work, and no release-manifest entry was authored for it: the manifest's `expectedPriorState`
and `terminalReadback` are hosted assertions, and writing them without a credentialed readback
would be fabricating release evidence.

### The g034 preflight cannot validate its own bound closure (pre-existing)

```sh
python3 backend/supabase/scripts/preflight_g034_hosted_migration_closure.py --validate-only
# exit 1; artifact blockers: ['clone-backup-recovery-required', 'manifest-invalid']
python3 -m unittest backend.supabase.tests.test_preflight_g034_hosted_migration_closure
# FAILED (failures=2, errors=2)
```

`EXPECTED_MANIFEST_SHA256` in the script is `1f568404...500a8e1` (set 2026-07-17, `4a47fb77`) while
the committed `.github/g034-hosted-migration-closure.v1.json` hashes to `bba79f26...fccf8ab95`;
`EXPECTED_SEMANTICS.closureTerminalVersion` is `20260713002400` against the manifest's
`20260801000300`, and the script expects 28 entries with nine exclusions against the manifest's 29
entries with three. The manifest last changed 2026-08-03 (`279a8191`). Both files are identical to
`origin/main`, so the hosted-closure preflight has been non-functional on `main` since that date;
it only runs on manual dispatch, so no automatic CI job catches it.

### U05 — keyboard, focus, Escape, names and contrast at 390/768/1440 (light and dark)

Probes: `probe-u05-keyboard-focus-contrast.mjs` and `probe-u05-modal.mjs`, run against the local dev
server with the real components. Raw output and screenshots:
[u05-accessibility](../../apps/web/.omx/artifacts/storyboard-local-mlx-20260918/u05-accessibility/)
(`probe.json`, `modal.json`, `modal-after.json`, `shots/*.png`, `lint.log`, `typecheck.log`,
`unit.log`).

| Check | 390x844 | 768x1024 | 1440x900 |
| --- | --- | --- | --- |
| Horizontal overflow | 0 px | 0 px | 0 px |
| Tab stops sampled / without a visible indicator | 10 / 0 | 10 / 0 | 10 / 0 |
| Contrast pairs measured below AA | 0 of 12 | 0 of 12 | 0 of 31 |
| Login dialog announces a name (`aria-labelledby` resolves) | yes | yes | yes |
| Focus stays inside the open dialog after 6 tabs | yes | yes | yes |
| Escape closes the dialog | yes | yes | yes |
| Focus returns to the invoking control after Escape | no | no | no |

Both preferences rendered identically because the public app is light-only: there is no color-theme
control (`HOME_MAP_THEME_FILTERS` are content filters, not palettes), so the `prefers-color-scheme:
dark` captures in `shots/` are the light appearance and no dark-theme claim is made. Contrast was
measured only where an opaque background ancestor exists; text over video thumbnails, the map canvas
and gradients was counted as indeterminate (5 of 17 candidates on mobile, 1 of 32 on desktop) rather
than as a pass.

**Defect fixed (this pass): the desktop login dialog never declared modality.** The mobile and
tablet login sheet reported `aria-modal="true"`, while the desktop Radix dialog reported `null` and
exposed no `aria-modal` on any ancestor, even though it dims the page, traps focus and hides 45
background nodes with `aria-hidden`. `apps/web/components/ui/dialog.tsx` now sets
`aria-modal="true"` on `DialogPrimitive.Content` (every dialog in this app renders with the backdrop
overlay; callers can override). Before: `modal.json` — 1440 `ariaModal: null`. After:
`modal-after.json` — 1440 `ariaModal: "true"` with the mobile and tablet sheets unchanged. This also
matches the project's own release-visual contract, which uses
`[role="dialog"][aria-modal="true"]` as the modal selector
(`tests/release-visual-cells.template.json`).

**Measured gap left open:** after Escape, focus lands on `<body>` at all three viewports instead of
returning to the control that opened the login surface. The opener lives inside the user-menu
popover, which unmounts as the dialog opens, so the restore target no longer exists; fixing it
means keeping a stable focus owner across the two surfaces. It is recorded here as a measured
limitation rather than silently reported as a pass.

Checks for this pass: `npm run lint` exit 0, `npm run typecheck:native` exit 0, and `npm run
test:unit` 2090 pass / 1 skip / 1 fail with the same pre-existing `TypeScript 7 dual-toolchain`
failure seen before the change (2092 tests across 289 files, 101 s).

## Seventh pass — CI recovery and the second promotion chain (2026-09-19)

Branch head at this pass: `f2c8bdf5` on `codex/storyboard-local-mlx-20260918`, promoted through
four PRs. This section was written after those merges, so it is deliberately unpromoted: it
records the tree it describes rather than travelling with it.

| PR | Base | Head | Merge commit |
| --- | --- | --- | --- |
| #2912 | develop | `codex/storyboard-local-mlx-20260918` | `838757d6` |
| #2914 | develop | `codex/sync-develop-main-20260919` | `3a5f7b88` |
| #2913 | data | develop | `6e98d17d` |
| #2915 | main | data | `8a8439d0` |

All four carried `Release` and `Promotion Path`; nothing was force-pushed and branch protection
was not bypassed. `origin/main` is `8a8439d0`, `origin/data` is `6e98d17d`, `origin/develop` is
`3a5f7b88`.

The direct `develop -> data` promotion first reported `BEHIND`: `data` carried the #2910 merge
commit that `develop` never received, and GitHub refuses a server-side branch update on a
protected branch (`422 protected branch 'develop' check failed: Changes must be made through a
pull request`). #2914 merged `main`, which already contained `data`, back into `develop`; that
restored `develop ⊇ main ⊇ data` and let #2913 and #2915 merge normally. The desktop dialog
modality fix (`f3516043`) is on `main` as part of this chain.

### CI on `main` is green again

`web-admin-ci` had failed on `main` at `7554ee3b` and `67df460d`, and on `develop` at `ce22e122`,
always on the same case: `TypeScript 7 dual-toolchain and benchmark contract > treats bounded
aggregate noise as zero admitted slices without hiding an observed regression`. That case pinned
two sentences in `AGENTS.md` which the 2026-09-08 guidance rewrite moved into
`docs/agents/verification.md`, the guide `AGENTS.md` routes toolchain and performance work to.
`26836cc6` resolves the guidance from both files; the assertions themselves are unchanged.

Readback: CI on `develop` @ `3a5f7b88` success, CI on `main` @ `8a8439d0` success — the first
green `CI · main` since `535ff5e2` (2026-09-06).

### The release is still held

After the promotion the production readback is unchanged
(`5af1e1f6ac81a483e1e8aed2b05237ca0f62ce6a`, `dpl_CpqD2F8weF6vDLUG2AgSfrruMbZa`) and
`TZUDONG_APPROVED_PRODUCTION_SHA` is still unset, so no production build was authorized. The
concrete release action, the rollback target and the two still-unmet prerequisites are recorded
in [production-release-readiness-20260918.md](production-release-readiness-20260918.md).
