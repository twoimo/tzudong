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
