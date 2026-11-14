# Local measurement capability preflight

This is a reusable **synthetic localhost capability kit**. It is not a production performance collector, a replacement for a failed measurement, or proof that a suitable production environment has been secured. The runtime has not been executed in the current workspace. Pure tests exercise software fixtures only.

## Scope and existing blockers

The retained CI fixture experiment already has 30 eligible observations at 390×844, 820×1180, and 1440×900. That experiment used localhost production builds, three fixed restaurants, and a mock map. It does not establish live production access.

The separate production runner's final ordinary anonymous health navigation returned HTTP 403 / `challenge_document` in run `43600568543`; all five recorded production attempts had zero performance trials. The current native browser also explicitly reports an organization policy blocking DevTools on the public site. This kit must not be used to evade that policy. It performs no production request, provider operation, authentication, access-policy change, or blocked-workflow retry.

Use the explicit runtime command only in an independently permitted, provisioned environment. A local capability result still leaves production access, source/deployment identity, app readiness, mobile-device emulation, and a new matched performance experiment to be established separately.

## What the kit checks

- Node 24, installed Playwright **1.64.1**, Google Chrome for Testing **156.0.8078.4**, and Lighthouse **13.5.0** against the existing repository contract/locks. The actual running browser product is checked through CDP. Puppeteer must match the existing Lighthouse tools lock.
- Three sequential **CSS width profiles**, with exact initial and timed dimensions **390×844**, **820×1180**, and **1024×768**, each DPR 2. Despite the short profile IDs, these use **desktop layout semantics**: `isMobile:false`, `hasTouch:false`, Lighthouse `mobile:false` and `formFactor:desktop`. They are not mobile/tablet device emulation or completed responsive QA.
- A fresh owned profile per attempted width. The browser sandbox is explicitly requested with `chromiumSandbox:true`; command-line readback must confirm the absence of disabling sandbox flags. No `--no-sandbox` fallback is available. This establishes requested/observed launch policy, not independent kernel-sandbox attestation.
- Owned `127.0.0.1` fixture routes only: `/fixture`, `/hero.svg`, and `/favicon.ico`, GET/HEAD. Other page HTTP requests are blocked, page-created WebSockets are closed, and service workers are disabled. The owned browser's loopback debugging connection is separate from fixture page requests. These controls do not attest to all Chrome-process background traffic or OS-wide network isolation.
- CDP acknowledgement of cache disable, service-worker bypass, 4× relative CPU slowdown and request-level network settings. Lighthouse's reported settings must match. Network settings are latency 562.5 ms, download 1474.56 Kbps and upload 675 Kbps; CDP byte conversion follows Lighthouse's `floor(Kbps × 1024 / 8)`.
- Navigation timing, observer FP/FCP/LCP, independent Paint Timeline, selected numeric trace events and their microsecond-to-millisecond normalization. Missing paint stays missing. Rounding/cross-API tolerance is 8 ms; Lighthouse's rounded trace-summary normalization uses 1 ms.
- Viewport/focus/visibility samples every 100 ms. The first sample must have a nonnegative time no later than first paint, and every in-trace sample must match the requested dimensions and visible/focused state. Gaps and the last-sample-to-trace-end interval must be at most **300 ms**. Missing early or final coverage fails the preflight.
- At least two recorded rAF callbacks inside the trace. This is frame-callback availability, not FPS, compositor presentation, or a physical-display measurement.
- The Lighthouse **in-trace** final screenshot's timing, decoded dimensions, byte count and hash. The image bytes are not retained, so this is a numeric projection, not independently reviewable visual QA. No post-cleanup screenshot substitutes for it.

Desktop layout semantics avoid the legitimate initial 980px layout width that can occur before a mobile document's viewport meta tag is parsed. The kit keeps the initial sample rather than concealing it. A future real-mobile harness needs its own explicit pre-paint/layout-viewport contract.

## Commands

Run from the repository root. Default and help only print usage; verification reads local files. None installs packages or launches a browser.

```sh
node apps/web/performance/production-verification-20261115/environment-preflight/preflight.mjs --help

node --test apps/web/performance/production-verification-20261115/environment-preflight/evidence.test.mjs
```

After independently establishing permission and provisioning the existing locked dependencies and browser, an operator can explicitly run:

```sh
node apps/web/performance/production-verification-20261115/environment-preflight/preflight.mjs \
  --run-local --output /absolute/path/to/a/new-local-preflight.json
```

The parent directory must already exist. The output is reserved with exclusive creation (`wx`, mode 0600); an existing receipt cannot be overwritten. No target URL, credentials, proxy, executable override, installer, retry, or alternative security policy can be supplied. A blocked width ends this preflight; it is not repeated, and unattempted widths are not passed.

Retain the SHA-256 printed after writing separately from the receipt. With the same kit and authority file bytes, verify offline:

```sh
node apps/web/performance/production-verification-20261115/environment-preflight/preflight.mjs \
  --verify /absolute/path/to/a/new-local-preflight.json --sha256 DETACHED_SHA256
```

Verification rejects duplicate/escaped duplicate keys, prototype keys, unknown nested payloads, wrong hashes, source-byte drift, incomplete profiles, inconsistent timing, and any production/field/G003 admission. It checks this kit's projections and their integrity; it is not an independent performance scorer or an authenticity signature.

## Outputs and stop conditions

The only successful label is `local-capabilities-observed`, after all three widths pass. `production.access`, `production.source` and `production.deployment` remain `not-tested`, and production-performance, field and G003 admissions remain zero. Absolute, relative and noise improvement budgets are **null / not applicable**. No TTI, TBT or performance-improvement judgment is produced.

Requested/acknowledged CPU or network controls are not empirical proof of a physical device speed, exact throughput, or equivalent future production conditions. Fresh profiles and fixture `no-store` responses do not establish CDN/backend coldness.

Browser version, launch, sandbox, endpoint, observer, paint, coverage, cleanup or trace failures retain a failed outcome. Work is deadline-gated; late resource acquisitions are disposed, disconnect/close are bounded, and pending work is joined or recorded as a failed drain before publishing a row. A failed close, failed late disposal, or failed drain never claims profile cleanup and never triggers a weaker launch. Stop and investigate owned-process cleanup in that permitted environment before another run.

Receipts are compact JSON capped at **64 KiB**, matching the unchanged shared privacy guard. If size or privacy validation rejects a projection, a compact failed receipt retains the attempted profile IDs/outcomes and marks their raw projections `RECEIPT_PROJECTION_NOT_RETAINED`. Such a receipt cannot pass. Free-form provider errors, page text, response bodies, headers, browser argv, storage and credentials are not retained.

The Playwright persistent-context → owned loopback CDP → Puppeteer → Lighthouse connection and actual sandbox availability remain **runtime-unverified until the explicit command succeeds in a permitted environment**. Passing the included pure tests does not remove that limitation.

## Existing authorities and preserved evidence

- `.github/chrome-for-testing.v1.json` and `.github/scripts/ensure-ci-chromium.mjs` (`loadPinnedPlaywright` only; the installer is never called).
- `apps/web/package-lock.json` and `apps/web/performance/initial-load-20261114/tools/package-lock.json`.
- `apps/web/performance/initial-load-20261114/production-attempts/index.json` and `run-43600568543.json`.
- `apps/web/performance/initial-load-20261114/fixture-runs/ci-43607098310-1/fixture-scored.json`.

No frozen production collector, protocol, measurement series, workflow, application source, browser policy or deployment configuration is modified by this kit. The historical production workflow still carries historical release identity and must not be dispatched as a current-release measurement plan.
