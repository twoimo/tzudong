# Homepage KPI Origin-corrected diagnostic, v2

**Local preparation only: the additional external execution is not yet authorized and has not run.** The original five legacy plus five RPC slots are complete and remain failed observations. This proposal needs a separate authorization for **five additional legacy POSTs, then five additional RPC POSTs: ten additional requests total**. It does not fill or replace the original slots. Offline synthetic tests make no HTTP or DB requests.

## Fixed source and existing deployments

Both existing deployments were observed Ready and already promoted to production once. RPC is Current in the operator's final original-phase readback. These are retained identities, not a fresh provider readback during local preparation.

| Expected mode | Existing deployment ID | Application source SHA |
| --- | --- | --- |
| legacy | `dpl_2zGM9JhP9TidhXoPXdNnaJSdA4Tf` | `d17885049e6add704bcb84a7a943f0427d613d29` |
| rpc | `dpl_HcAFUsjeauPqJeJUiCbuESNBCNi7` | `d17885049e6add704bcb84a7a943f0427d613d29` |

After separate authorization, the single release owner uses Vercel's normal **Instant Rollback** path to reconnect the production alias to the existing legacy deployment, then return to the existing RPC deployment. These are alias changes to previously promoted builds: no Promote rerun, rebuild, new deployment or DB change. Preserve the separate `086e63b` emergency rollback deployment and its retained full identity; it is not a diagnostic phase. Ordinary release gates, the approved source guard and manual domain assignment remain in force.

## Only change and execution prerequisites

The v2 script is an exact copy of the original except for adding `Origin: provenance.origin` to its request headers. The original script SHA-256 is `a51271cbc10fc562b56236349e3bff43d50e9a39f9d4746a30dacfc275dfad5c`. The application guard stays unchanged; no cookies, authorization, capability headers or request-based mode selector are added.

Before either authorized phase:

- Confirm that production's valid `NEXT_PUBLIC_SITE_URL` has the canonical origin `https://www.tzudong.app`, exactly matching `provenance.origin`. Missing or different configuration still fails closed. The script validates provenance format/freshness, not this environment value or provider authenticity. Do not use extra KPI probes.
- Retain a fresh minimized source/deployment/alias/configured-mode readback, no more than 30 minutes old, and prepare new provenance under this directory's `receipts/`. Use exactly the original fields: `schemaVersion` (1), `mode`, `sourceSha`, `deploymentId`, `origin`, `observedAtUtc`, `providerReadbackSha256`. Record unavailable environment-value readback explicitly. Intended mode is not observed runtime mode.
- Reuse the same bytes/order of the 100-ID cohort at `/workspace/scratch/57877157ba3f/kpi-input-cohort.json`, outside the repository. Do not reselect or replace IDs. Use Node 24 and the same machine, network and process configuration for both phases; retain the fixed DB function/migration identity without secrets.
- Use the identical v2 script hash for both phases and new output files. The copied script derives its own directory, restricting output to this v2 `receipts/` with exclusive creation. No v2 receipt exists at preparation time.

## Commands after separate authorization

These commands are proposals only. Do not execute before the additional ten-request budget and the corresponding deployment/provenance prerequisites are satisfied.

```sh
node apps/web/performance/kpi-rpc-20261115-origin-v2/diagnose.mjs --run \
  --cohort-file /workspace/scratch/57877157ba3f/kpi-input-cohort.json \
  --provenance-file apps/web/performance/kpi-rpc-20261115-origin-v2/receipts/legacy-provenance.json \
  --out apps/web/performance/kpi-rpc-20261115-origin-v2/receipts/legacy-origin-v2.ndjson
```

After Instant Rollback returns the alias to the existing RPC deployment and its identity is verified:

```sh
node apps/web/performance/kpi-rpc-20261115-origin-v2/diagnose.mjs --run \
  --cohort-file /workspace/scratch/57877157ba3f/kpi-input-cohort.json \
  --provenance-file apps/web/performance/kpi-rpc-20261115-origin-v2/receipts/rpc-provenance.json \
  --out apps/web/performance/kpi-rpc-20261115-origin-v2/receipts/rpc-origin-v2.ndjson
```

Immediately after each phase, retain another minimized readback of the same source, deployment and alias. Drift or unavailable identity makes the phase inconclusive. Only the planned responses' Server-Timing markers establish effective query mode; missing or mismatched markers fail admission.

## Preserve evidence and interpretation

The [original protocol](../kpi-rpc-20261115/PROTOCOL.md) remains unchanged; its admission, privacy, timing-boundary, data-equivalence and artifact-inventory rules apply in full. Preserve every byte of the original `diagnose.mjs`, `PROTOCOL.md` and `receipts/**`, including all ten failed slots. Preserve frozen browser/preflight evidence. Inventory v2 provenance, readbacks and receipts separately; never mix v1 and v2 timing samples.

Each phase has five fixed sequential slots, a 15-second deadline and a 256 KiB response cap. Warmups, retries, redirect following, parallel requests and failure replacements remain zero. Receipt persistence failure stops remaining slots without filling them. Invalid inputs, stale provenance or an existing output stop before requests. Retain only allowlisted timing/cache values, status, timestamps, counts and hashes; no raw IDs, response bodies, arbitrary headers or free-form errors.

Admission still requires HTTP 200, 100 valid metrics in cohort order, the expected mode, complete mode-specific timing and explicit uncached evidence without hit/stale or positive Age. Origin alone proves none of those. Missing cache/DB timing is not bypass/zero. Show all five values, median and range, including the first; any failed slot makes the phase incomplete. Caches/connections are not reset or classified as cold, and snapshot production is not paused. Report response-hash drift and overlapping timing boundaries.

No absolute/relative improvement acceptance budget is set, and no noise budget is estimated. Five samples per mode support descriptive diagnosis only, not statistical speedup, browser/paint/TTI/field CWV improvement, G003 acceptance or production-wide reliability.
