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

Interactive workflow: [storyboard-local-mlx.html](docs/architecture/storyboard-local-mlx/storyboard-local-mlx.html)

Workflow source: [storyboard-local-mlx.workflow.json](docs/architecture/storyboard-local-mlx/storyboard-local-mlx.workflow.json)

Interactive lifecycle: [storyboard-local-mlx.lifecycle.html](docs/architecture/storyboard-local-mlx/storyboard-local-mlx.lifecycle.html)

Lifecycle source: [storyboard-local-mlx.lifecycle.json](docs/architecture/storyboard-local-mlx/storyboard-local-mlx.lifecycle.json)

The local workspace separates **new project creation**, **scene editing**, **version history**, and **manual result import**. Saved projects open directly on the scene editor; connection diagnostics are under Settings. Text and image providers remain independent, and external AI is off by default with no automatic cloud fallback.

Historical restoration now uses immutable DB snapshots. Version preview and a confirmed whole-project or single-scene restore preserve the historical text, scene order, asset references, provenance and original image bytes. Restoration writes a new revision without calling a model or queueing a job; current provider settings and consent are retained. Applied projects start history from the state captured by the migration, not from invented earlier versions. Owner/admin checks, current revision, busy-project rejection and idempotent request IDs protect the operation.

The memory admission model is `used + additional_peak_estimate + reserve <= physical`, with initial reserve `max(16 GiB, 12.5% of physical RAM)`. Model residency and image decoding buffers count; measurements and estimates are not absolute guarantees. Image concurrency starts at one. Queue wait follows `W[i+1] = max(0, W[i] + S[i] - A[i])`; absent a live worker, estimated wait is unknown. Atomic claim, DB-clock leases, heartbeat, current-job ownership and project/scene revisions reject stale writes. Cancellation forbids late writes; retry is explicit. Original assets are immutable. The Archify viewer's fixed controls fall back to English for Korean-authored diagrams.

**Local evidence (2026-09-20):** real-model project v12 → edit v13 → scene restore v14 → full undo v15 → full restore v16. All 20 exported PNG/WebP files matched their original hashes and decoded successfully; these three restores created zero jobs. See the [verification report and responsive screenshots](docs/operations/evidence/storyboard-restore-20260920/README.md). Local migration and UI verification do not establish hosted migration, external Web review or production deployment.

**Map evidence (2026-09-20):** Seoul cluster expand kept 357 individual markers. Filtered list still opened restaurant detail. YouTube play control stayed centered. GPS button remains blocked with `DEVICE_LOCATION_OPERATOR_EVIDENCE_REQUIRED` until operator evidence hashes exist. Local DB has 0 reviews, so reviewer-join and review-image rendering were not live-verified. View/comment theme chips stay empty because `youtube_meta.viewCount`/`commentCount` and `youtube_video_kpi_snapshots` are all null/empty locally; recent-video and repeat-visit chips do filter. Hosted apply is still separate.

## Privacy

Source safeguards stay fail-closed: challenge-bound account creation, no under-14 registration until a verified guardian path exists, purpose/channel marketing consent with a separate night grant, shared redaction, memory-only device location, and Preview → Confirm → Apply → Readback → Audit for deletion/retention/incidents.

These are not legal compliance or production proof. Release stays blocked until the external gates in `AGENTS.md` have named receipts. The live app and release links above are status references only.
