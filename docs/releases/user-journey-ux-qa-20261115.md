# Tzudong user journey and interface QA — 2026-11-15

## Scope and source

This change starts from production/main `d17885049e6add704bcb84a7a943f0427d613d29`
in a separate `feat/user-journey-ux-qa-20261115` worktree. The earlier dirty KPI
worktree, measurement workflow, environment-denial evidence and original v1/v2
measurement artifacts are unchanged. Merge, hosted QA and deployment are separate
verification steps; an implementation or local test is not a production receipt.

The operator requested real-user QA, less generic visual styling, compact admin
layouts, a viewport-aware loading experience, a map status slot, improved video
insights and thumbnail creation, a four-panel storyboard beside AI conversation,
and a maintainable performance audit page.

## Design references applied

| Reference | Reviewed revision | Application |
| --- | --- | --- |
| [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | `d643997c82e94742dd3bee43210b0198e8bbba3d` | Dense operational workspaces, readable controls, responsive layout, named interactive elements and progressive disclosure |
| [unslop](https://github.com/heydamir/unslop), Damir Sokolovsky | `620163eedb3529d9cd23a3994ed8d287d06f760d` | Product-led spacing, neutral surfaces, restrained typography, real content and removal of repetitive status chrome; original skill CC BY 4.0 |
| [Bombadil](https://github.com/antithesishq/bombadil) | Official `v0.7.10` binary | Bounded synthetic component property tests; pin and harness documented in [Bombadil QA](../operations/bombadil-qa.md) |

The design direction is a Korean restaurant map and video operations desk:
calm, precise and friendly, with food images, charts and story panels as the
content. Existing Korean typography and brand color remain. A generated landing
page/font suggestion was unsuitable for this application and was not applied.
Layout uses a 4px spacing rhythm, 40px desktop navigation and 44px touch controls.

## Observed production problems and changes

The public map and authenticated admin console were inspected through the
existing browser session. No production records were created, modified or
deleted and no paid generation was submitted during these observations.

| Actual observation | Change | Relevant behavior retained |
| --- | --- | --- |
| A selected map theme placed a wide criteria banner beside/over the existing map loading notice | Criteria now use the same status position and open a short explanation on request, for both domestic and overseas maps | Loading, errors, result counts and empty states take priority; filter calculation and toggle behavior remain |
| Small public map controls and loose repeated list spacing | 14px control labels, compact restaurant rows and clearer visual hierarchy | Existing search, restaurant selection and map navigation |
| Dashboard title/count row was followed by three redundant operational status cards | Pending reviews, collection state and Sentry summary share the header | Unknown, failed and known-zero states remain distinct; retry/focus recovery remains |
| Sentry issue count and total occurrences could be confused | The header uses explicit count semantics | Underlying Sentry query and diagnostics |
| Sidebar footer used a compressed account label and conspicuous colored avatar | Neutral 32px avatar in a 56px account row with a clear name, role and menu affordance; 240px expanded sidebar | Account/theme/order menu and keyboard access |
| Video insights used a second title area and separated controls with excess vertical space | Title, result count, period/category controls and navigation form a compact region | Filter state, pressed semantics and corresponding chart/skeleton heights |
| Thumbnail examples could immediately enqueue generation | Example selection prepares the configuration and preview; generation has an explicit action | Queue, readiness, idempotency, provider and existing generation safeguards |
| Thumbnail brief and attachment roles were difficult to inspect | Editable topic/main/subtitle configuration; reference previews, roles and removal preserve file/role alignment | File/type/size validation and explicit generation |
| Storyboard startup exposed worker/model detail before the creative task | Left four-panel comic board, right planning conversation/request panel; advanced settings are disclosed when needed | 5–12 scene contract, saved project/history, private assets, revision/readback and worker/model allowlists |
| A static browser loading layout differed from the workspace | The outer module and loaded storyboard share one bounded skeleton | The console remains the single lazy-loading owner |
| Performance evidence lived outside the operator's workflow | New “웹 성능 감사” sidebar page with comparison bars, tables, individual samples and sanitized JSON export | No automatic new measurement or operational requests |

The storyboard's 2×2 presentation is pagination in groups of four, not a reduction
of the production scene contract to four. The existing five-to-twelve-scene
generation, per-scene editing, retries and historical records remain available
subject to their original readiness checks.

## Data and integration boundaries

### Performance audit

The committed snapshot is derived by whitelist from the retained origin-v2
analysis (SHA-256 `80795786da10461b2cf2c5694b4c94128ef117d48d35a3ded191487ca20e4abf`).
It contains timing arrays and hashes, not video IDs, response bodies, cookies,
keys or provider URLs. It records the analysis timestamp separately from the
two request windows.

The cohort is **100 videos**. Both modes retain all five sequential observations,
including the first large value. Legacy bucket/row times are added per request
before summarizing; RPC request/DB times are subtracted per request before
summarizing. Unmeasured DB/browser values remain unavailable, never zero.

| Median, ms | Existing query | RPC query |
| --- | ---: | ---: |
| External request | 1177.385 | 832.895 |
| Handler | 608.082 | 267.540 |
| Data-request wait | 607.344 | 266.341 |
| DB internal | Unmeasured | 2.811 |

The RPC residual median is 263.530ms and combines transport, gateway, SDK and
serialization-related work. It is not a pure-network measurement. The same
source was measured on different deployments in fixed legacy-then-RPC order;
this is descriptive evidence, not randomized causal attribution or a user-wide
performance improvement claim. Previous 403 observations remain a separate
failure record. LCP, INP and CLS remain unmeasured in this snapshot.

### Storyboard readiness and AI conversation

The inspected production UI reported a held runtime capability and no connected
generation worker. The exact failing DB condition cannot be inferred from that
banner alone. `get_feature_runtime_capability` must satisfy the existing strict
ready contract, and generation still checks it. This UI work does not apply a
migration, waive readiness or manufacture a generation success.

The new planning route authenticates the administrator, checks same-origin
requests, bounds input/output and duration, validates model provenance and
removes raw provider errors. It does not write a project or generate an image.
A proposal becomes a request only through an explicit review action. Conversation
is held in page memory, not persisted as an invented assistant history.

Web planning supports the existing allowlisted **OpenAI Responses** client only.
The Gemini worker uses a Python-backed project budget runtime that cannot be
assumed inside a web deployment. Its budget guard and worker client are preserved;
Gemini planning configuration is unavailable rather than bypassing the budget.
AI planning is default-off until its server-only provider/model/enable/hourly-cap
configuration and credential exist. Its small in-process cap is not represented
as a distributed spend limit. No live provider call is part of this QA record.

## Validation record

| Layer | Result at implementation checkpoint | Limits |
| --- | --- | --- |
| Public and authenticated production inspection | Map, dashboard, insights, storyboard and thumbnail loaded and inspected | Existing production source, before deployment |
| Root focused unit/source/SSR checks | 108 passed, 0 failed, 2934 assertions across 11 files | No browser interaction or provider calls |
| Thumbnail/insights/status checks | 35 passed, 0 failed, 172 assertions | Local handlers and synthetic queue behavior |
| Storyboard focused checks | 85 passed, 0 failed, 2597 assertions across 8 files | Includes source contracts; no live AI request |
| Native/compat TypeScript parity | Passed, 0 diagnostics, 3065 logical inputs | Local candidate; not a provider deployment |
| Targeted lint | 60 changed code files passed | Source/static checks |
| Bombadil request policy | 5 passed, 0 failed | Static/method/URL boundaries, not browser execution |
| First full web build | Failed: worker-only Python budget dependency entered the new route bundle | Found before deployment; fixed by preserving worker path and narrowing web planning |
| Corrected full web build | Passed: compile, type check, 58 static pages and route CSS boundary verification | Local candidate; not a production deployment |
| Local browser performance preflight | Previously denied; frozen evidence retained | Not retried or relabelled as successful |
| Cloud browser → executor fixture | Connection refused because the runtimes have separate loopback networks | No tunnel, browser-profile attachment or hidden fallback |
| New hosted component workflow | Execution and screenshots must be reviewed before rendered-UI success is claimed | Synthetic components, not full Next/auth/DB/map integration |
| First hosted workflow registration | Failed before any job/browser: `runner.temp` is unavailable in job-level `env` | Moved cache-path setup into an executed step; original failed run retained |
| Release and deployment | Exact-head protected checks and final deployment readback are required | Local results are not substitutes |

Independent review corrected the video-cohort unit and analysis-time label,
connected the previously missed overseas map path, and identified conversation
remount and create-in-flight proposal conflicts. Corrections preserve a single
conversation instance within a saved project and block proposal application while
a creation request is in flight.

The hosted fixture has its own [bounded execution and receipt contract](../operations/bombadil-qa.md).
Record the actual workflow run, source SHA, screenshot review, release checks,
rollback deployment and production readback in the release result. A failed or
missing check must remain visible and is not a successful acceptance result.
