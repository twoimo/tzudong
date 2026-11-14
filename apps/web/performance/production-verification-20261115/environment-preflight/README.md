# Local measurement capability preflight

This is a reusable **synthetic localhost capability kit**. It is not a production performance collector, a replacement for a failed measurement, or proof that a suitable production environment has been secured. The first v1 CI attempt is retained as failed with a zero-byte receipt; v2 retained a nonempty failed receipt. The current v3 adds bounded initialization diagnosis and has only pure software tests until a separate permitted runtime attempt is recorded.

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

Verification rejects duplicate/escaped duplicate keys, prototype keys, unknown nested payloads, wrong hashes, source-byte drift, incomplete profiles, inconsistent timing, and any production/field/G003 admission. It compares all 32 bytes of each recorded source digest against a fresh digest of the same fixed local source/authority/fixture bytes. It checks this kit's projections and their integrity; it is not an independent performance scorer or an authenticity signature.

## Outputs and stop conditions

The only successful label is `local-capabilities-observed`, after all three widths pass. `production.access`, `production.source` and `production.deployment` remain `not-tested`, and production-performance, field and G003 admissions remain zero. Absolute, relative and noise improvement budgets are **null / not applicable**. No TTI, TBT or performance-improvement judgment is produced.

Requested/acknowledged CPU or network controls are not empirical proof of a physical device speed, exact throughput, or equivalent future production conditions. Fresh profiles and fixture `no-store` responses do not establish CDN/backend coldness.

Browser version, launch, sandbox, endpoint, observer, paint, coverage, cleanup or trace failures retain a failed outcome. Work is deadline-gated; late resource acquisitions are disposed, disconnect/close are bounded, and pending work is joined or recorded as a failed drain before publishing a row. A failed close, failed late disposal, or failed drain never claims profile cleanup and never triggers a weaker launch. Stop and investigate owned-process cleanup in that permitted environment before another run.

Ordinary receipts use `local-environment-preflight.v3`. Every field, including partially populated failed profiles, must satisfy the strict known schema before privacy screening. The unchanged **object** boundary `assertPrivacySafe` then screens every field in small fixed sections and every bounded array record, including its tail. Its existing depth, entry and string limits are not raised. The complete serialized receipt remains capped at **64 KiB**; chunking the object screen does not relax that file limit.

`sourceDigests` contains six exact **32-element uint8 arrays** computed directly from the fixed public kit files, existing authority/lock files and owned fixture bytes. The synthetic screenshot's `sha256Bytes` uses the same representation, computed from its image bytes. These fields represent SHA-256 digests; they do not encode arbitrary text, and no general text-encoding facility or privacy exemption is introduced. The detached receipt SHA-256 used by `--verify` remains hexadecimal.

The receipt calls its fixed layout booleans `launch.mobileLayoutRequested` and `lighthouse.settings.mobileLayoutReported`. The generic privacy guard treats keys ending in `mobile` as phone fields, even for booleans; these names introduced in v2 state the measurements' actual layout meaning. Playwright's real `isMobile:false` option and Lighthouse's real `screenEmulation.mobile:false` option, and their required values, are unchanged. No raw diagnostic or personal-data field is renamed into an allowed field.

If schema, size, serialization or privacy screening fails, the writer constructs a separate `local-environment-preflight.failure.v3` envelope. It contains only fixed state/code values, known bounded profile IDs and booleans: `sourceVerified:false`, `projectionsRetained:false`, `productionTested:false`, and explicit `SOURCE_UNVERIFIED` / `RECEIPT_PROJECTION_NOT_RETAINED` codes. It copies no timestamp, tool metadata, digest, raw projection or original error text. Such an envelope is nonempty and cannot verify as a successful capability result. Filesystem write failures still cannot guarantee persistence. The original in-memory observation is not rewritten; process status and the printed receipt summary come from the bytes actually saved.

Free-form provider errors, page text, response bodies, headers, browser argv, storage and credentials are not retained. Invalid data in a failed profile is subject to the same schema and privacy checks as data in a successful one.

The Playwright persistent-context → owned loopback CDP → Puppeteer → Lighthouse connection and actual sandbox availability remain **runtime-unverified until the explicit command succeeds in a permitted environment**. Passing the included pure tests does not remove that limitation.

## Bounded v3 initialization diagnosis

Each ordinary profile has one strict `initialization` object:

| Field | Meaning |
|---|---|
| `failureStage` | Fixed stage active when the main work throws; null when that catch did not run. Cleanup or later validation can still fail independently. |
| `lastCompletedStage` | Last stage whose action completed successfully, or null. |
| `contextReturned` | Whether an object was returned through the owned context-acquisition gate before the recorded checkpoint. False does not prove that no OS process was ever created. |
| `failureKind` | Fixed classification of an explicit failure indicator, or `unknown`; null when no main-work exception was recorded. It is not a root-cause conclusion. |

The stage order is `context-launch`, `http-route`, `websocket-route`, `init-script`, `target-selection`, `foreground-request`, `cdp-session`, `command-line-read`, `version-read`, `launch-policy-check`, then `post-initialization`. These cover the eight initial awaits, synchronous target selection and policy evaluation, and the remaining existing work. The command-line stage includes its response-shape check. A stage is set immediately before its action and completion is recorded only after it succeeds. The catch freezes the failed state; finally seals it before cleanup. Late completion, repeated failure handling and cleanup cannot rewrite the snapshot.

Classification reads only exception name/code and at most the first **4,096 UTF-16 code units** of its message in memory. No message, stack, argv, path, encoded text or message hash is retained. The allowlist is deliberately narrow:

- `timeout`: `TimeoutError` or the runner's known bounded-timeout codes.
- `target-closed`: `TargetClosedError` or the exact target/page/context/browser-closed phrase. This alone never becomes a denial classification.
- `explicit-sandbox-denial`: only during context launch and only the explicit `No usable sandbox!`, `Running as root without --no-sandbox is not supported`, or `Chromium sandboxing failed!` indicator.
- `explicit-permission-denial`: a structured `EACCES`/`EPERM` code, or a context-launch message line containing both the explicit namespace-move failure and `Operation not permitted`. This identifies an access-failure indicator, not the responsible policy or configuration.
- `protocol-method-unavailable`: only in the corresponding command-line/version CDP stage, with the exact protocol error naming that expected `Browser.*` method as not found.
- `unknown`: everything else, including generic launch failures, sandbox advice, unreadable properties, or an indicator outside the inspected prefix.

Pure tests use synthetic errors to check this classification and stage retention; they do not establish what the failed CI emitted. Exact pinned Playwright error-source coverage is not claimed. A changed or absent message format remains unknown.

The new schema does not migrate or reinterpret v1/v2 receipts. Their archived bytes and source bindings remain unchanged. After a separately authorized single diagnosis, an explicit denial or unresolved initialization failure is a stop condition: no automatic repeat, different-runner workaround or weaker browser option is supplied.

## Owned CI capability check

`.github/workflows/web-measurement-preflight.yml` runs this synthetic kit on an isolated GitHub-hosted Ubuntu 24.04 runner when this kit or that workflow changes in a same-repository pull request. It checks out the exact PR head, installs the existing locked browser without a separate browser probe or OS-dependency retry, and invokes `--run-local` once. The job is restricted to `github.run_attempt == 1` and does not run on workflow reruns. It has no production target or secrets and does not modify the existing production performance workflow or the managed browser's policy.

The job retains `receipt.json`, a detached `receipt.sha256`, and `attempt.json` even on a capability failure. Setup failures retain fixed step outcomes and an explicit missing-receipt state. Offline verification checks the current source bytes. A missing or failed receipt keeps the job failed; there is no sandbox fallback, hidden retry, or conversion of failure into a pass. The archived attempt, not the presence of this workflow, establishes whether a particular runner actually passed.

### Retained v1 persistence failure and v2 correction

Run `43639072916`, head `ec7948e4d23b73099acde347157dcf8a9fbe53dc`, passed tooling and the original 17 pure tests, then failed the capability step. Its original `receipt.json` is **0 bytes** and offline verification reports `RECEIPT_INVALID_JSON`. Those archived bytes and the failed attempt are unchanged.

A pure reproduction identified a deterministic persistence defect: the actual public browser-contract SHA-256 string matched the unchanged guard's phone-number rule. v1 screened the complete JSON as plain text and then copied that same digest into its fallback, so both screens rejected it. The shared guard's own documentation specifies `assertPrivacySafe` for object/diagnostic boundaries. v2 uses that typed boundary, strictly limited digest arrays and a newly constructed minimal failure envelope. Tests cover the actual fixed public digest, the retained attempt's timestamp as a synthetic input, unchanged privacy rejection, partial failure retention, array bounds/tails, exclusive nonempty file writing and source-byte mismatch despite a recomputed detached receipt hash.

This explains the reproducible receipt-storage failure. It does **not** recover the lost original runtime error code, establish which browser stage ran, or identify why that runtime attempt failed. Pure tests do not establish that the Playwright/Puppeteer/Lighthouse runtime bridge or sandbox will succeed. No browser, dependency install, production request or CI retry is part of the v2 software tests.

### Retained v2 runtime failure

Run `43640481419`, head `bcbe47e256de511fd8a89f78c158815fa6173888`, passed tooling and 24 pure tests, then retained a **1,843-byte** ordinary v2 failed receipt. Its first profile has `LOCAL_PREFLIGHT_FAILED`, `freshOwnedProfile:true`, `profileCleaned:true`, no launch metadata and zero fixture document responses. The source-bound code permits a failure anywhere from context launch through the first browser identity reads and adjacent synchronous operations. Neither `launch:null` nor successful profile-directory cleanup identifies whether a browser context was returned. No sandbox cause is established. v3 adds the missing fixed stage evidence without changing browser options, pins, security requirements or measurement conditions, and does not infer the v1 or v2 failure cause retroactively.

## Existing authorities and preserved evidence

- `.github/chrome-for-testing.v1.json` and `.github/scripts/ensure-ci-chromium.mjs` (`loadPinnedPlaywright` only; the installer is never called).
- `apps/web/package-lock.json` and `apps/web/performance/initial-load-20261114/tools/package-lock.json`.
- `apps/web/performance/initial-load-20261114/production-attempts/index.json` and `run-43600568543.json`.
- `apps/web/performance/initial-load-20261114/fixture-runs/ci-43607098310-1/fixture-scored.json`.

No frozen production collector, protocol, measurement series, workflow, application source, browser policy or deployment configuration is modified by this kit. The historical production workflow still carries historical release identity and must not be dispatched as a current-release measurement plan.
