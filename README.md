<div align="center">
  <p>
    <img src="apps/web/public/logo.png" width="72" alt="Tzudong Map logo" />
  </p>
  <h1>Tzudong Map</h1>
  <p><strong>A map-first restaurant product for places featured in Tzuyang videos.</strong></p>
  <p>
    <a href="https://tzudong.app">Live app</a>
    ·
    <a href="https://github.com/twoimo/tzudong/releases/tag/v1.2.4">Latest release</a>
    ·
    <a href="README.ko.md">한국어</a>
    ·
    <a href="CHANGELOG.md">Changelog</a>
    ·
    <a href="LICENSE">MIT</a>
  </p>
  <p>
    <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs" />
    <img alt="React 19" src="https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
    <img alt="Supabase" src="https://img.shields.io/badge/Supabase-PostgreSQL%20%2B%20Auth-3ecf8e?logo=supabase&logoColor=white" />
    <img alt="Runtime" src="https://img.shields.io/badge/runtime-Node%2024.x%20%2B%20Bun-c8a2c8" />
  </p>
</div>

---

Tzudong Map turns mukbang video evidence into a usable restaurant map: users discover places on mobile, operators verify data in an admin console, and the storyboard workspace creates visual cuts for content production.

## Highlights

| Product surface | What it does |
| --- | --- |
| **Map discovery** | Search, filters, clustered food markers, current-location flows, and restaurant detail bottom sheets. |
| **Community loops** | Reviews, stamp passport, ranking, likes, and profile surfaces for repeat engagement. |
| **Admin operations** | Guarded moderation, source readback, approve/delete/restore flows, and audit-friendly mutations. |
| **Storyboard workspace** | Chat-driven storyboard planning, 10-cut generation, cut metadata, image refresh, and provider readiness UX. |
| **Evidence pipeline** | Crawling, Rule/LLM-as-a-Judge evaluation, fail-closed validation, and Supabase-ready payloads. |

## Stack

- Web runtime: Node 24.x. Day-to-day install/unit flows may use Bun; npm 11.6.2, `package.json`, and `package-lock.json` are the release package authority.
- TypeScript: native CLI `@typescript/native` `7.0.2`; stable API/compatibility bridge `6.0.2` via `npm run typecheck:parity`.
- Serialized content patches: `develop -> data -> main`. Hosted apply, legal compliance, and live URL state are not claimed by this tree.
- Change history: [CHANGELOG.md](CHANGELOG.md) / [CHANGELOG.ko.md](CHANGELOG.ko.md).
- Docs index: [docs/README.md](docs/README.md). Product design: [docs/product/DESIGN.md](docs/product/DESIGN.md).

## Product tour

### Desktop

**Map discovery and restaurant detail**

<p align="center">
  <img src="apps/web/public/images/readme-product-tour.gif" width="900" alt="Tzudong Map desktop product tour" />
</p>

**Admin storyboard workspace**

![Storyboard workspace generating a 10-cut storyboard](apps/web/public/images/readme-storyboard-demo.gif)

### Mobile

<table>
  <tr>
    <td width="50%"><strong>Home map</strong><br /><small>Browse markers → expand restaurant detail</small><br /><img src="apps/web/public/images/readme-mobile-home-map.gif" alt="Home map marker browsing and expanded restaurant detail mobile demo" /></td>
    <td width="50%"><strong>Review feed</strong><br /><small>Scroll reviews → open restaurant detail</small><br /><img src="apps/web/public/images/readme-mobile-reviews-feed.gif" alt="Reviews feed mobile demo" /></td>
  </tr>
  <tr>
    <td width="50%"><strong>Stamp passport</strong><br /><small>Browse stamped places → read detail</small><br /><img src="apps/web/public/images/readme-mobile-stamp-passport.gif" alt="Stamp passport mobile demo" /></td>
    <td width="50%"><strong>Ranking profile</strong><br /><small>Open top profile → switch tabs</small><br /><img src="apps/web/public/images/readme-mobile-leaderboard-ranking.gif" alt="Ranking and profile mobile demo" /></td>
  </tr>
</table>

## Local architecture

System map: [interactive system architecture](docs/architecture/tzudong-system-architecture.html) · [Archify source](docs/architecture/tzudong-system-architecture.archify.json)

Worker admission flow: [interactive worker boosting flow](docs/architecture/tzudong-worker-boosting.workflow.html) · [Archify source](docs/architecture/tzudong-worker-boosting.workflow.archify.json)

Interactive workflow: [storyboard-local-mlx.html](docs/architecture/storyboard-local-mlx/storyboard-local-mlx.html)

Workflow source: [storyboard-local-mlx.workflow.json](docs/architecture/storyboard-local-mlx/storyboard-local-mlx.workflow.json)

Interactive lifecycle: [storyboard-local-mlx.lifecycle.html](docs/architecture/storyboard-local-mlx/storyboard-local-mlx.lifecycle.html)

Lifecycle source: [storyboard-local-mlx.lifecycle.json](docs/architecture/storyboard-local-mlx/storyboard-local-mlx.lifecycle.json)

Interactive map discovery: [map-discovery.html](docs/architecture/map-discovery/map-discovery.html)

Live browser captures: [workflow](docs/operations/evidence/storyboard-restore-20260920/archify-storyboard-workflow-desktop.png) · [lifecycle](docs/operations/evidence/storyboard-restore-20260920/archify-storyboard-lifecycle-desktop.png) · [map discovery](docs/operations/evidence/storyboard-restore-20260920/archify-map-discovery-desktop.png)

Map discovery source: [map-discovery.workflow.json](docs/architecture/map-discovery/map-discovery.workflow.json)

Evidence pipeline: [interactive data pipeline](docs/architecture/data-pipeline/tzudong-data-pipeline.html) · [dataflow source](docs/architecture/data-pipeline/tzudong-data-pipeline.dataflow.json)

Worker flow: [interactive worker boosting flow](docs/architecture/data-pipeline/worker-boosting.html) · [workflow source](docs/architecture/data-pipeline/worker-boosting.workflow.json)

The worker keeps image concurrency at `c=1`. A future bounded boost must pass memory admission and observed queue/run/RSS evidence before changing that cap; dynamic concurrency increase is not claimed as implemented. Queue claim and lease ownership, heartbeat freshness, revision checks, conditional save/readback, and late-write rejection define the persistence boundary. Operator observations are bounded and non-authoritative, with secrets and raw payloads excluded.

The local workspace separates **new project creation**, **scene editing**, **version history**, and **manual result import**. Saved projects open directly on the scene editor; connection diagnostics are under Settings. Text and image providers remain independent: local MLX, ChatGPT manual import, and Grok manual import are selectable with external AI off. OpenAI/xAI official APIs stay gated and currently unconfigured. There is no automatic cloud fallback.

Storyboard provider policy keeps `local-mlx`, `chatgpt-manual`, and `grok-manual` independently selectable for text and image without requiring an official external API; the manual choices return through user import. The `externalAI` consent gate applies only to the official API provider IDs `openai-api` and `xai-api`.

Historical restoration now uses immutable DB snapshots. Version preview and a confirmed whole-project or single-scene restore preserve the historical text, scene order, asset references, provenance and original image bytes. Restoration writes a new revision without calling a model or queueing a job; current provider settings and consent are retained. Applied projects start history from the state captured by the migration, not from invented earlier versions. Owner/admin checks, current revision, busy-project rejection and idempotent request IDs protect the operation.

The memory admission model is implemented in `apps/web/lib/admin/storyboard/resource-invariants.ts`: `used + additional_peak_estimate + reserve <= physical`, with initial reserve `max(16 GiB, 12.5% of physical RAM)`. The worker now uses host-wide `os.freemem()` by default and only adds model residency in the explicit RSS fallback; measurements and peak estimates are not absolute guarantees. The [runtime audit on 2026-09-21](docs/operations/evidence/storyboard-restore-20260920/runtime-audit-20260921.md) records the remaining stress-test and peak-inference limits. The queue-wait helper is currently unit-tested but has no runtime caller. Image concurrency starts at one. Queue wait follows `W[i+1] = max(0, W[i] + S[i] - A[i])`; absent a live worker, estimated wait is unknown. Atomic claim, DB-clock leases, heartbeat, current-job ownership and project/scene revisions reject stale writes. Cancellation forbids late writes; retry is explicit. Original assets are immutable. The Archify viewer's fixed controls fall back to English for Korean-authored diagrams.

The [2026-09-21 architecture and goal audit](docs/operations/evidence/storyboard-restore-20260920/architecture-goal-audit-20260921.md) joins the MLX, queue/lease, FSM, memory, map/filter, and hosted-feed readback evidence without treating hosted writes or deployment as complete.

**Local evidence (2026-09-20):** real-model project v12 → edit v13 → scene restore v14 → full undo v15 → full restore v16. All 20 exported PNG/WebP files matched their original hashes and decoded successfully; these three restores created zero jobs. See the [verification report and responsive screenshots](docs/operations/evidence/storyboard-restore-20260920/README.md). Local migration and UI verification do not establish hosted migration, external Web review or production deployment.

**Map evidence (2026-09-20, updated):** Seoul cluster expand kept individual markers and opened the restaurant list (66 places after the hot-view filter). YouTube play control stayed centered on 16:9 `sddefault`. GPS remains fail-closed with `DEVICE_LOCATION_OPERATOR_EVIDENCE_REQUIRED`. In the explicit hosted development mode, local `/feed` was rechecked on 2026-09-21 against the hosted Supabase project: the public feed rendered two verified reviews for 데일리픽스 and 스시린 under `쯔동마스터`, with no Nightly identity. The default local command remains isolated from hosted data. See [hosted readback and limitations](docs/operations/evidence/storyboard-restore-20260920/feed-local-readback-20260921.md). Theme chips live-rechecked: hot-view 125 (Seoul cluster 65 → list 66), comment-hot 125 (Seoul 65), fan-signal 63 (Seoul 32), recent-video 32 (Seoul 17), repeat 20 (Seoul cluster 12 → list 13), using hosted-read YouTube KPI snapshots copied locally (not invented). Public overlay/map panel elevation is `shadow-sm`; dropdown menus keep their `shadow-2xl` contract. Mobile `/feed` hides the write FAB while login or detail sheets are open. Desktop/390/320 screenshots: [public UI evidence](docs/operations/evidence/storyboard-restore-20260920/). Hosted deployment and protected promotion are still separate.

### Measured query and normalization optimizations (2026-09-21)

`apps/web/lib/restaurant-review-lookup.ts` re-built normalized names and addresses on every restaurant lookup, so one related-review count sweep (400 restaurants × 1,200 candidates = 480,000 candidate visits) re-ran about 1.94M string normalizations. Each record's prepared names and addresses are now cached in a WeakMap keyed by identity plus a field signature that invalidates when the record changes. The same sweep now performs 22,400 normalizations on a cold cache and 0 on a warm cache, and all 400 lookups return byte-identical id arrays. Retained evidence: [benchmark.json](apps/web/performance/review-lookup-memoization-20260921/benchmark.json) with the [repro script](apps/web/performance/review-lookup-memoization-20260921/benchmark-review-lookup.mjs). Median sweep time on this machine was 291.9 ms before and 144.4 ms cold / 132.6 ms warm after; the ratio (about 2x faster with 86.4x fewer normalizations) is the claim, not the absolute time.

Chunked `restaurants` and `reviews` lookups in `apps/web/hooks/use-restaurants.tsx` now run at most four chunks in parallel and still fill results by chunk index, so ordering is unchanged while round trips become `ceil(ceil(N / 80) / 4)` instead of `ceil(N / 80)` ([analytic table](apps/web/performance/review-lookup-memoization-20260921/chunked-roundtrips.json)).

Public `/feed` skips the approved-canonical `restaurants` lookup for a page when every reviewed restaurant on that page is already `approved`, which drops one database round trip per feed page in the common case. The lookup still runs whenever a review points at a non-approved or missing restaurant, so canonical substitution behavior is unchanged.

The same related-review sweep also re-ran name-compatibility checks for every candidate because the name gate ran first. `apps/web/lib/restaurant-review-lookup.ts` now applies the address gate first, computes name compatibility lazily only for candidates that share an address, skips candidates already present in the direct-id set, and intersects address sets without spreading them into arrays. The baseline is a frozen copy of the implementation from immediately before this change (`63c0dd1a`), not a re-written approximation. The 400 × 1,200 sweep returns byte-identical id arrays while name-gate evaluations drop from 480,000 to 12,852 (37.35x) and cold median sweep time drops from 83.28 ms to 37.89 ms (2.20x, p95 2.17x). Retained evidence: [benchmark.json](apps/web/performance/review-lookup-address-gate-20260921/benchmark.json) with the [repro script](apps/web/performance/review-lookup-address-gate-20260921/benchmark-review-lookup-address-gate.mjs). The report states its own absolute, relative, and noise budgets; the result is accepted only when dispersion stays within 15% MAD and the improvement exceeds the combined relative noise. The ratio is the claim, not the absolute time.

`apps/web/hooks/useUnvisitedRestaurants.tsx` rebuilt the merged restaurant list and evaluated every restaurant twice on each render of the home recommendation popup. The merge and the visit classification are now memoized on their inputs, and the unvisited list plus the visited count come from a single pass. Over 40 re-renders with unchanged inputs on a 1,200-restaurant list, `mergeRestaurants` calls drop 40 → 1, visit checks 96,000 → 1,200 (80x), and median wall time per render set drops from 279.7 ms to 5.1 ms (54.69x, p95 56.93x), with an identical unvisited list and count. Retained evidence: [benchmark.json](apps/web/performance/unvisited-restaurants-20260921/benchmark.json) with the [repro script](apps/web/performance/unvisited-restaurants-20260921/benchmark-unvisited-restaurants.mjs).

### Deployment and release path (verified 2026-09-21)

`apps/web/scripts/vercel-ignore-build.mjs` is the build gate: preview builds run only for `develop`, every other branch preview is skipped, and a `main` production build additionally requires `TZUDONG_APPROVED_PRODUCTION_SHA` to equal the commit being deployed. Branch-specific preview URLs therefore do not appear for feature branches by design; a CLI deployment of the branch head (`vercel deploy` from `apps/web`, project `tzudong`) is what produces a reviewable preview.

On the Hobby team, commits must be authored by the team owner. Commits authored with a placeholder address are refused before the build starts with `readyState: BLOCKED`, `alwaysRefuseToBuild: true`, and `seatBlock.blockCode: TEAM_ACCESS_REQUIRED` (Vercel: "the commit author doesn't have permission to create deployments for this project"). The repository now commits with the owner's GitHub-linked address, and the same CLI deployment that was refused before this change reaches `BUILDING`/`READY` afterwards.

`develop`, `data`, and `main` are protected: the `Release` and `Promotion Path` checks are required, force pushes are disabled, administrators are enforced, and conversation resolution is required, so promotion is serialized through pull requests in the order `develop -> data -> main`. Preview deployments carry Vercel Authentication, so an unauthenticated request to a preview URL answers `302` to the Vercel login flow rather than the application.

## Privacy

Source safeguards stay fail-closed: challenge-bound account creation, no under-14 registration until a verified guardian path exists, purpose/channel marketing consent with a separate night grant, shared redaction, memory-only device location, and Preview → Confirm → Apply → Readback → Audit for deletion/retention/incidents.

These are not legal compliance or production proof. Release stays blocked until the external gates in `AGENTS.md` have named receipts. The live app and release links above are status references only.
