# Homepage KPI RPC: bounded API diagnostic

This procedure is prepared for a separately authorized deployment comparison. Authoring and offline tests do not establish a working production measurement environment. It makes no browser, paint, TTI, field CWV or G003 claim. The earlier frozen browser/preflight evidence stays unchanged.

## Freeze the comparison before either phase

Use one exact application commit for both deployments. Record the committed source SHA, deployment ID, origin and runtime TZUDONG_HOME_KPI_QUERY_MODE from the provider's readback, first **legacy**, then **rpc**. The same source must contain the instrumentation and both query paths; an older uninstrumented release is not this baseline. Keep the DB migration/function identity and relevant deployment configuration in a minimized supporting receipt. Do not record secrets or raw provider/environment dumps.

Keep the existing cohort file **outside the repository**: /workspace/scratch/57877157ba3f/kpi-input-cohort.json, shaped as {"videoIds":[100 unique strings]}. It was selected at 2026-11-15 06:31:18 UTC from the newest published videos in the global latest snapshot bucket, then sorted by video ID. Reuse the same bytes/order in both phases; do not replace missing rows or select a more favorable cohort. The tool retains only its count and SHA-256. The separate read-only DB EXPLAIN observations are query-plan evidence, not API/network timings.

Before each phase, prepare receipts/legacy-provenance.json or receipts/rpc-provenance.json with **exactly** these fields. Replace every example value with observed identity; the readback must be no more than 30 minutes old when starting:

~~~json
{
  "schemaVersion": 1,
  "mode": "legacy",
  "sourceSha": "<40 lowercase hex characters>",
  "deploymentId": "dpl_<observed deployment ID>",
  "origin": "https://<observed production hostname>",
  "observedAtUtc": "<YYYY-MM-DDTHH:mm:ss.sssZ>",
  "providerReadbackSha256": "<64 lowercase hex characters>"
}
~~~

The providerReadbackSha256 identifies the retained, minimized provider readback that ties source, deployment, alias and runtime mode together. These values are mandatory operator-supplied evidence; the diagnostic tool does not independently authenticate a provider deployment. Do not point a production alias at a source until its ordinary release and database gates pass.

## Execute the fixed phases

Use Node 24 and the same machine/network/process configuration for both invocations. From the repository root, run each command only after its corresponding provider readback. The script uses native Node fetch, no browser, no credentials and no cookies:

~~~sh
node apps/web/performance/kpi-rpc-20261115/diagnose.mjs --run \
  --cohort-file /workspace/scratch/57877157ba3f/kpi-input-cohort.json \
  --provenance-file apps/web/performance/kpi-rpc-20261115/receipts/legacy-provenance.json \
  --out apps/web/performance/kpi-rpc-20261115/receipts/legacy-pre.ndjson
~~~

After the same-source RPC deployment and fresh mode/source/deployment/alias readback:

~~~sh
node apps/web/performance/kpi-rpc-20261115/diagnose.mjs --run \
  --cohort-file /workspace/scratch/57877157ba3f/kpi-input-cohort.json \
  --provenance-file apps/web/performance/kpi-rpc-20261115/receipts/rpc-provenance.json \
  --out apps/web/performance/kpi-rpc-20261115/receipts/rpc-post.ndjson
~~~

Each invocation has five sequential slots, one POST per slot, with a 15-second deadline and 256 KiB response cap. There is no warmup, parallel load, redirect follow, retry or failure replacement. Native connection reuse and server/database cache state are not reset or classified as cold. A failed response remains in its original slot; all five planned slots are attempted unless receipt persistence fails. Invalid inputs, stale provenance or an existing output stop before requests. A persistence failure stops remaining slots; retain the partial receipt and do not rerun to fill it. Keep each printed receipt SHA outside the artifact map, then include the provenance files, minimized readback and NDJSON receipts in the final hashed artifact inventory.

Immediately after each phase, retain a second minimized provider readback confirming the same source, deployment, alias and runtime mode. A changed or unavailable identity makes the phase inconclusive; do not rerun to replace it. This before/after control-plane evidence supports the observation window but does not create a cryptographic deployment attestation on each HTTP response.

## Admit and interpret

Every slot retains UTC start/end, supplied mode, HTTP status, sanitized allowlisted Server-Timing, external elapsed time, response byte count, metric count and response SHA-256. It never retains the input IDs, raw response, arbitrary headers or free-form errors. An unrecognized timing header is discarded and the slot fails admission.

An admitted slot requires HTTP 200, exactly 100 valid metrics in cohort order, the observed mode, its complete timing set, and explicit cache-miss/bypass/dynamic/expired evidence with no cache-hit/stale or positive Age evidence. Missing cache evidence is CACHE_UNPROVEN, not an assertion that a cache was bypassed. Request no-cache alone is insufficient proof. Zero durations are retained; missing or invalid DB telemetry is not zero. Any failed slot makes that phase incomplete: report it, do not replace it.

Compare only phases whose source SHA, cohort SHA, script SHA and runtime/network setup match, with separate verified deployment IDs/modes. Show all five values, the median and range, including the first request. Equal counts and response hashes support data equivalence for these observations; differing response hashes or within-phase drift make that equivalence inconclusive and must be reported. The scheduled snapshot producer is not paused by this procedure. The response-body hash and cohort hash describe different bytes and must not be compared with one another.

| Observation | Boundary |
| --- | --- |
| kpi-bucket-request, kpi-rows-request | Legacy SDK/client + transport + DB awaits; never DB-only labels |
| kpi-rpc-request | One RPC SDK/client + transport + DB await |
| kpi-db-bucket, kpi-db-rows | Database intervals around each SQL stage, including its row materialization |
| kpi-db-total | Database function interval up to final envelope construction; excludes final serialization |
| kpi-body | Bounded request stream read/parse after handler entry, including waiting for incoming bytes |
| kpi-handler | Handler entry to header creation; excludes response serialization/flush and pre-handler work |
| externalTotalMs | Client fetch start to the final response-body byte, or to a failed request's termination; excludes JSON validation/receipt I/O |

Intervals overlap; do not add them. Subtracting DB total from RPC request time leaves a mixed SDK, transport, platform and serialization remainder, not an isolated network measurement. Five sequential samples per mode support descriptive per-request diagnosis only. No absolute or relative improvement acceptance budget is set, and no noise budget is estimated from these ten slots; report observed absolute/relative differences without a statistically established speedup, browser improvement or production-wide reliability claim.
