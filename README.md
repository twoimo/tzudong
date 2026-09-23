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

### Home map mode filtering (2026-09-22)

`getRestaurantListByMode` in `apps/web/components/home/home-map-container.tsx` ran on every map move and swipe and rebuilt work that only depended on the restaurant row: a lowercased address string from three fields, then a scan of 35 overseas keywords with `String.includes`, plus a second keyword list when a country filter was selected. Classification now lives in `apps/web/lib/home-map-mode-filter.ts`, which caches each row's address text and both verdicts (coordinate bounds, overseas keyword) on the row object behind a field signature that invalidates on in-place edits, indexes keywords by first character instead of scanning the full list at every character, and reuses the keyword-index and country-verdict caches when the same country keyword list comes back. On a frozen copy of the implementation from immediately before the change, the 4,000-row fixture drops from a 2.449 ms median to 0.220 ms for domestic (11.11x, p95 11.38x), from 2.174 ms to 0.168 ms for overseas (12.94x, p95 12.91x), and from 2.639 ms to 0.253 ms with a country filter (10.43x, p95 10.03x), keeping identical id order and object identity with 0 mismatches; the slowest single call stays at 0.295 ms p95 against the 16 ms frame budget. Retained evidence: [benchmark.json](apps/web/performance/home-map-mode-filter-20260922/benchmark.json) with the [repro script](apps/web/performance/home-map-mode-filter-20260922/benchmark-home-map-mode-filter.mjs). The ratio is the claim, not the absolute time.

### Responsive my-page surfaces (2026-09-22)

`/mypage/profile` kept its desktop cards inside `md:h-full md:min-h-0 md:grid-rows-2`, so two viewport rows split the scroller height while the password form needed 348px. At 1024x900 the 비밀번호 변경 card measured `clientHeight 203` against `scrollHeight 348` under `overflow: hidden`, which clipped the form inside the card. The page surface now keeps only `lg:grid-cols-2 lg:auto-rows-auto lg:content-stretch lg:items-stretch` (the follow-up below moved the matrix breakpoint from `md` to `lg`): rows follow card content, the password card measures 306px with `clientHeight` equal to `scrollHeight`, and the grid box equals its scroll height (958 vs 956). `data-mypage-profile-viewport-fit` now reads `content` instead of `true`.

The shared list grid (`myPageResponsiveListClass`) went two-up at `md`, where the 256px sidebar leaves about 465px of content, so each card was about 227px wide. Bookmark headers then overflowed their own `overflow-hidden` card at every desktop width (768: clientWidth 225 vs scrollWidth 308, 1024: 356 vs 478, 1280: 318 vs 478, 1440: 371 vs 478) and the address column collapsed to 17px next to the 160px thumbnail. Review cards clipped at 768 (225 vs 248). The grid now goes two-up at `lg` and three-up at `2xl`, the bookmark and review header text columns take `min-w-0` with a `shrink-0` action, and the bookmark thumbnail is 128px wide with a matching `sizes` hint.

### Responsive my-page follow-up (2026-09-22)

The profile dashboard matrix started at `md`, where the 256px sidebar leaves 465px of content, so its two tracks measured 207.5px each and the tier headline ellipsized (`clientWidth 130` against `scrollWidth 155`). The matrix, its `col-start`/`row-start`/`h-full`/`min-h-0`/`overflow-hidden` placement, and the `content-stretch` surface now start at `lg`: at 1024 the tracks measure 333.5px and nothing ellipsizes, while 768-1023 stack into a single 431-697px card column with every card sized to its content (the tier card is 167px instead of a stretched 306px). At `2xl` the surface adds a third track, so 등급/비밀번호/최근 활동/계정 삭제/마케팅 수신 fill three 394px (1536) or 522px (1920) tracks, with the consent card spanning both rows in the third track. The profile page height drops from 958px to 538px at 1536 and above.

Bookmark cards pair a 128px thumbnail with text, so the shared list grid stayed too tight for them: at `lg` a two-up card is 358px, which left a 136px title column and a 180px address column against a 246px address, and three-up at `2xl` (405px) still cut the address to 227px. `myPageResponsiveMediaListClass` now waits for `xl` and never adds a third track, so bookmarks render one 713px track through 1024 and 486/566/614/806px two-up from 1280 with no ellipsis at any checked width. Review cards keep the shared `lg`/`2xl` grid because they stay under their clamp everywhere.

The submission lists put `md:col-span-2 xl:col-span-3` on their load-more row while the grid only declares columns from `lg`; at 768 `grid-column: span 2` created two implicit tracks (231.25px and 228.75px) and halved every submission card. The row now matches the declared tracks (`lg:col-span-2 2xl:col-span-3`): 472px single track at 768, 358px two-up at 1024, 405px three-up at 1536.

Retained evidence: [audit.json](apps/web/performance/mypage-responsive-20260922/audit.json) and [audit-round2.json](apps/web/performance/mypage-responsive-20260922/audit-round2.json), measured through the Chrome DevTools Protocol on the local dev server with a signed-in session at 390/640/768/1024/1280/1440 plus 1536/1600 for the list grid and 390/768/1024/1280/1536/1920 for the follow-up sweep. After the change no container with `overflow: hidden|clip` clips its own content on any of the six `/mypage` routes at any checked width, `documentElement.scrollWidth` equals `clientWidth` everywhere, and list cards measure 358/486/566px at 1024/1280/1440 and 405/427px three-up at 1536/1600. The source contracts are frozen in `tests-unit/mypage-mobile-cleanup-contract.test.ts` and `tests-unit/web-quality-performance-source.test.ts`; `npm run test:unit` (2314 tests, 318 files), `npm run lint`, and `npm run typecheck:parity` pass. The follow-up sweep covered all six routes at 390/768/1024/1280/1536/1920 (36 combinations) with 0 clipped containers, no document overflow, and no ellipsized text beyond a 3px title overflow at 768 on one long name. Local rendering does not establish hosted or production rendering.

### Responsive my-page desktop fill and target sizes (2026-09-22)

The full sweep across all seven `/mypage` routes at 320/390/640/768/1024/1280/1536/1920 (56 route-width combinations) found no horizontal overflow, no content cut by `overflow: hidden`, and no clipping beyond the app shell that hands scrolling to its inner panel. It did find trailing empty panel inside a stretched card and two undersized targets.

From `lg` up the profile matrix stretches the tier card to the password card's height, so the card measured 306px against 167px of content and ended with 139px of empty panel at 1024/1280/1440/1536/1920. The progress block now carries `lg:flex lg:flex-1 lg:flex-col lg:justify-center`, growing to 198px and centering the progress bar between the title and the metrics: dead space is 0 at every desktop width and the card height is unchanged at 306px.

The shared inline link (`myPageInlineLinkClass`, used by 영상 보기, 영상 #n and 관련 영상 보기) measured 68x20, below the 24px floor in WCAG 2.2 SC 2.5.8. It now carries `-my-1 min-h-8 py-1`, giving a 32px hit box while the negative margin holds the metadata row at 33px. The sidebar 닉네임 수정 button, the smallest desktop control at 35x28, moved to `h-8 px-2.5` for 39x32. The mobile hero keeps its own 28px 수정 badge because that class string is frozen by the cleanup contract, and 28px clears the floor.

Retained evidence: [audit-round3.json](apps/web/performance/mypage-responsive-20260922/audit-round3.json). The 2-up bookmark media list from `xl` and the 3-up text list from `2xl` were re-measured at 1024/1280/1536/1920 and left as they were, with every address and title still uncut. The new contracts are frozen in `tests-unit/mypage-mobile-cleanup-contract.test.ts`. Local rendering does not establish hosted or production rendering.

`/mypage/profile` was re-measured after the desktop-fill change at 320/390/414/640/768/1024/1280/1536/1920 with a signed-in session: 0 overflowing elements and 0 clipped containers at every width, `documentElement.scrollWidth` equal to `clientWidth` everywhere, a 0px sidebar below 768 and 256px above it, and the dashboard matrix at one track below 768, two tracks from 1024, and three from 1536 where the consent card spans both rows in the third track (covered ratio 0.879-0.906). At 1536 the page height is 538px against 958px at 1280. Retained evidence: [audit-verification-20260922.json](apps/web/performance/mypage-responsive-20260922/audit-verification-20260922.json). The one intentional difference below 768px is that the 등급 대시보드 tier-progress card is replaced by the grouped 내 활동 / 제보하기 quick-action list, so the 39% tier progress is desktop-only.

### Regional and district clustering reuse (2026-09-22)

One map refresh calls `getRegionalClusters` once and `getSeoulDistrictClusters` twice (`minClusterSize` 1 and 3) on the same list, and `apps/web/lib/clustering.ts` rebuilt every lookup table per call: the 18-name region table, the 18-entry short-name object plus its `Object.entries`, the 25-name district table, and a per-restaurant derived pass. District classification — the Seoul gate, 25 `String.includes` probes and the nearest-centre fallback — also ran once per call, so a single refresh classified every restaurant twice.

The tables are module-level constants built once at import, and each restaurant's derived values (id, address, coordinates, category label, and lazily the region or district) live in a `WeakMap` keyed by list identity with a field-level check that invalidates on in-place edits to either the list (length, order) or a row. `getRegionalClusters` builds that pass and caches it; `getSeoulDistrictClusters` reuses it when it is already there and otherwise computes in place without writing the cache, so a single-shot call is never charged for building entries it will not reuse. District classification runs once and is projected for both `minClusterSize` values.

The two grouping paths are separate functions. A single function accepting either the cached entries or the raw list measured anywhere from 0.5x to 1.1x of the previous code depending on the run, because the mixed argument shape and the doubled loop body left the isolated path in a lower JIT tier; splitting it into one monomorphic function per path removed that swing.

Against a frozen copy of the implementation from immediately before the change, the real 3-call bundle is 10.10x (300 rows), 13.82x (1,000), 16.22x (2,000) and 17.70x (4,000) faster on the warm path and 1.50x-2.31x faster on the cold path, with the per-call district pass after `getRegionalClusters` at 12.54x-24.11x warm and 1.36x-2.36x cold. The bundle's p95 is 0.038/0.087/0.142/0.247 ms warm and 0.36/0.68/3.10/2.20 ms cold against the 16 ms frame budget. Cluster order, member order, category order, centre coordinates and id arrays are identical with 0 mismatches at all four sizes on both paths, and the harness's self-comparison controls read 0.95-1.14.

The isolated single-shot cold call (`getSeoulDistrictClusters` with no preceding `getRegionalClusters` on that list) is reported as a diagnostic rather than gated: no caller invokes it that way, since `NaverMapView` always clusters regions first on the same list, and at 0.05-0.57 ms per call it swings between 0.54x and 1.11x with the JIT tier rather than with the code. The report states its own budgets — a 16 ms absolute frame budget, warm >= 2x and cold >= 1.3x on the bundle, a per-target no-regression rule, and 15% MAD on the warm samples whose medians back the headline ratios — and accepted three consecutive runs. Retained evidence: [benchmark.json](apps/web/performance/clustering-region-district-20260922/benchmark.json) with the [repro script](apps/web/performance/clustering-region-district-20260922/benchmark-clustering.mjs); the pre-change semantics are frozen in `tests-unit/clustering-region-district.test.ts` (21 tests). The ratio is the claim, not the absolute time, and local measurement does not establish hosted or production behaviour.

### Expanded-cluster marker lookup (2026-09-22)

While any cluster was expanded, `NaverMapView` copied the current id map and then inserted every restaurant ever seen in that session into both render maps. The snapshot was append-only. Marker drawing only looks up the current row, an expanded id, or the selected id, in that order.

The copy is gone. The snapshot now keeps those ids and drops the rest, and a lookup reads the existing maps plus that snapshot. On a 4,000-row list the render maps no longer hold a second copy: 9,600 entries become the 4,800 already in the lookup. After 4,000 stale rows the retained set is 4,813 instead of 17,600. After 12,000 stale rows it is 4,813 instead of 33,600. Probes for current, expanded, and selected ids matched the previous lookup with 0 mismatches; a stale id that is none of those is no longer returned. Wall-clock medians stayed inside the noise budget (combined MAD / median 0.26–0.47 against a 0.15 relative noise budget, absolute samples under the 16 ms frame budget), so this change does not claim a latency speedup. Retained evidence: [benchmark.json](apps/web/performance/expanded-cluster-snapshot-20260922/benchmark.json). Local measurement does not establish hosted or production behaviour.

### Visible marker review bubbles (2026-09-22)

`selectVisibleMarkerReviewBubbleTargets` built a related-id set for every candidate, then sorted the whole list to keep 3 or 5 bubbles. A restaurant id already makes that set non-empty, so the second pass never removed a row. Selection now keeps a bounded window of `limit` rows with the same stable rank order and builds related ids only for those rows. A missing list or options returns `[]` and logs `invalid-input` without the payload.

Against a frozen copy of the previous full sort, 200 / 1,000 / 4,000 candidates at limit 5 return identical targets (0 mismatches). Related-id sets per call drop from 205 / 1,005 / 4,005 to 5. Rank objects drop from the full candidate count to at most 5. Median wall-clock ratios were 1.85x / 2.24x / 3.57x, but combined MAD / median was 0.22–0.46 against a 0.15 relative noise budget, so the time ratio is not claimed. Samples stay under the 16 ms frame budget. Retained evidence: [benchmark.json](apps/web/performance/visible-marker-review-bubbles-20260922/benchmark.json). Local measurement does not establish hosted or production behaviour.

### Dashboard video id reuse (2026-09-23)

`extractVideoIdFromYoutubeLink` used to compile five regular expressions on every call, and dashboard summary, search, and video detail each parsed the same `youtube_link` again. The patterns now live once per process, and a 4,096-entry map remembers the id for that exact string. A link that is not a string returns null instead of throwing. Public video detail still answers `{ error: 'Video not found.' }` with status 404 for an id that cannot match the extractor (`[A-Za-z0-9_-]{6,128}`); the raw id is not written to the log, only `invalid-shape` and the length. The same cached restaurant array then keeps a `WeakMap` from video id to rows, so a later detail request on that array does not scan every row.

On this machine, 4,000 links × 6 passes (24,000 extractions) moved from a 1.455 ms median to 0.227 ms (6.41x). Combined MAD / median is 0.133 against a 0.15 noise budget, both sides stay under the 16 ms frame budget, and id mismatches are 0. Hoisting the expressions without the map was 1.79x, but that pair's noise exceeded 0.15, so the accepted claim is the cached result. Six repeated lookups on one 4,000-row array moved from 1.416 ms to 0.001 ms after the map existed; that after-time is on the timer floor, so 1416x is only the repeat-hit figure. A cold single pass that rebuilds the map was 0.176 ms versus 0.230 ms (0.77x) and its noise exceeded 0.15, so the first lookup is not claimed as faster. A merged restaurant that is alone skips the date-sort copy. Retained evidence: [benchmark.json](apps/web/performance/dashboard-video-id-20260923/benchmark.json) with the [repro script](apps/web/performance/dashboard-video-id-20260923/benchmark-dashboard-video-id.mjs). Local measurement does not establish hosted or production behaviour.

### Map selection id matching (2026-09-23)

`findMatchingRestaurantInList` checked merged ids with `Array.includes` for every candidate and every child id. It now uses one set per search and still returns the earliest candidate, including a name-and-coordinate match that appears before an id match. Empty and missing lists return null. On 4,000 candidates with 8 target ids and 4 child ids each, the median moved from 0.260 ms to 0.171 ms (1.52x) with the same matched id, but combined MAD / median was 0.217 against the 0.15 noise budget, so the time ratio is not claimed. Both medians stay under the 16 ms frame budget. Retained evidence: [benchmark.json](apps/web/performance/map-restaurant-lookup-20260923/benchmark.json) with the [repro script](apps/web/performance/map-restaurant-lookup-20260923/benchmark-map-restaurant-lookup.mjs). Local measurement does not establish hosted or production behaviour.

### Dashboard updated-at sort (2026-09-23)

Dashboard restaurant paging and the summary checksum sorted every row by parsing `updated_at` inside the comparator, so a 4,000-row sort parsed the same strings about `n log n` times. Each row is now parsed once, then the numeric timestamps are sorted. Tie order stays the input order, and an empty page stays empty. On this machine the median moved from 4.423 ms to 0.533 ms (8.30x). Combined MAD / median is 0.142 against the 0.15 noise budget, both sides stay under the 16 ms frame budget, and the ordered ids match with 0 mismatches. Retained evidence: [benchmark.json](apps/web/performance/dashboard-updated-at-sort-20260923/benchmark.json) with the [repro script](apps/web/performance/dashboard-updated-at-sort-20260923/benchmark-dashboard-updated-at-sort.mjs). Local measurement does not establish hosted or production behaviour.

### Deployment and release path (verified 2026-09-21)

`apps/web/scripts/vercel-ignore-build.mjs` is the build gate: preview builds run only for `develop`, every other branch preview is skipped, and a `main` production build additionally requires `TZUDONG_APPROVED_PRODUCTION_SHA` to equal the commit being deployed. Branch-specific preview URLs therefore do not appear for feature branches by design; a CLI deployment of the branch head (`vercel deploy` from `apps/web`, project `tzudong`) is what produces a reviewable preview.

On the Hobby team, commits must be authored by the team owner. Commits authored with a placeholder address are refused before the build starts with `readyState: BLOCKED`, `alwaysRefuseToBuild: true`, and `seatBlock.blockCode: TEAM_ACCESS_REQUIRED` (Vercel: "the commit author doesn't have permission to create deployments for this project"). The repository now commits with the owner's GitHub-linked address, and the same CLI deployment that was refused before this change reaches `BUILDING`/`READY` afterwards.

`develop`, `data`, and `main` are protected: the `Release` and `Promotion Path` checks are required, force pushes are disabled, administrators are enforced, and conversation resolution is required, so promotion is serialized through pull requests in the order `develop -> data -> main`. Preview deployments carry Vercel Authentication, so an unauthenticated request to a preview URL answers `302` to the Vercel login flow rather than the application.

## Privacy

Source safeguards stay fail-closed: challenge-bound account creation, no under-14 registration until a verified guardian path exists, purpose/channel marketing consent with a separate night grant, shared redaction, memory-only device location, and Preview → Confirm → Apply → Readback → Audit for deletion/retention/incidents.

These are not legal compliance or production proof. Release stays blocked until the external gates in `AGENTS.md` have named receipts. The live app and release links above are status references only.
