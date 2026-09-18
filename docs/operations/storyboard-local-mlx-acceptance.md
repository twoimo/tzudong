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
