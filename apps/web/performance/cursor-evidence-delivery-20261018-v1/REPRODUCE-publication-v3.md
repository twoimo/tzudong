# Public tier consistency delivery reproduction

Source candidate: `267969b2fe7f59f3af5303175842702a5727962b`, tree `070a79a76c1cba8c3b14060fcae9cc64af6a0994`.

This extends REPRODUCE-review-v2.md. Prior receipts remain historical. Do not edit the frozen pre-promotion-checkpoint-v1 child or replace failed/pilot results.

## Source verification

Use an isolated checkout and the npm authority lock. Node 24.22.0 was local, CI uses 24.21.0; npm11.6.2, Bun1.4.0, TS native7.0.2/compat6.0.2. From apps/web run the affected public-popularity-publication, evidence-engineering-remaining, and popularity-badge unit files, targeted lint, typecheck:parity, build and the dependency-modernization Chromium spec. Exact executed commands and outputs remain in tier-consistency-*.log. Local focused final: 42 pass, 0 fail, 360 assertions. Offline production browser: 3 pass; fixtures do not prove Naver/hosted data.

The before repro uses the db694a67 source and schema1 fixture. Run reproduce-tier-projection-before.mjs only from that historical source. It demonstrates compact representative public-a/fire vs full representative public-z/standard. Current schema2 resolves approved member identities without changing representative selection. Unknown/new/conflicting members fail closed to standard. The 5000-member and byte budget guards are correctness bounds, not performance benchmarks.

## Live anonymous verification

From repository root, use Node24 and PLAYWRIGHT_BROWSERS_PATH=/Users/twoimo/.codex/runtime-cache/cursor-evidence-browser-20261018. Run `node apps/web/performance/cursor-evidence-delivery-20261018-v1/run-live-readback-v3.mjs after EXACT_PRODUCTION_SHA`. This script asserts health project/SHA; actual Naver SDK/tiles; real marker detail open/close; visible review/stamp/ranking headings; public ranking RPC200; no pageerror/overflow; and exact schema2/unpublished/empty public snapshot. It uses fresh anonymous contexts at 1440x900, 834x1112, 430x860. It neither saves row bodies nor mutates accounts/reviews.

Run `run-public-assets-readback-v1.mjs after EXACT_PRODUCTION_SHA` to retain public API/asset response status, byte counts, SHA256. Compare all four display WebP digests with the exact main Git blobs, not merely RIFF headers. Repeat `run-console-boundary-diagnosis-v2.mjs after EXACT_PRODUCTION_SHA` for fixed bounded CSP/resource observation; preexisting errors must not be hidden.

These deterministic scripts use fixed phase-specific paths. Do not overwrite an existing receipt; a later run must first create a new version with distinct output filenames. Each viewport shares one browser process; treat the three viewports as functional scenarios, not independent performance users. No p95, confidence interval, memory, physical-device or field improvement is established by this readback.

The publication is intentionally unpublished and empty. No real restaurant receives a new grade, no raw shadow data is exposed, and no DB migration or Storage operation is part of this delivery.

## Protected delivery and rollback

Observe exact-head checks and all review threads, then use normal merge in feature→develop→data→main order. Required Release/Promotion Path contexts stay GitHub app15368, strict and admin-enforced with conversation resolution. Do not disable unrelated checks or use admin/force options.

Before production update, re-read the Git-integrated project, final main SHA/tree, current alias/deployment, and named rollback. Update only TZUDONG_APPROVED_PRODUCTION_SHA for production, preserving its sensitive type. Reconcile existing exact-SHA deployments before requesting one Git-based production build. Verify READY, alias, SHA, content bytes and actual flow independently.

Rollback only if the failed alias still targets this task's deployment; use the freshly named prior READY deployment and recheck health/alias/user flows. Never redeploy an old deployment ID and assume it resolves latest Git main.
