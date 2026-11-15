# Bombadil component QA

This is a bounded, synthetic-state test of real imported Tzudong React components.
It is separate from the Next app, production, authentication, Supabase, real map
providers, paid generation, and the frozen browser performance measurements.
Passing it does not establish those integrations or LCP/INP/CLS performance.

## Pinned tooling

| Input | Pin |
| --- | --- |
| Bombadil | Official release `v0.7.10`, source `832faf4d953e2c56d1d901aca1bb2c3c3170221d` |
| Linux x86-64 binary | 17,972,264 bytes; SHA-256 `6f2664ca7d4067017b4efb26db5c29d6dcfecdc78131f96989d336f12420cc1b` |
| Official declaration archive | 12,454 bytes; SHA-256 `47b6f9c112795bc26b285b1bb25a89df776f4c206c354b66d7a88da75f3e0ddf` |
| Node / npm / Bun | 24.22.1 / 11.6.2 / 1.4.0 |
| Browser | Repository `.github/chrome-for-testing.v1.json` and locked Playwright `browsers.json`, then actual Chrome version readback |

Official sources: [release](https://github.com/antithesishq/bombadil/releases/tag/v0.7.10),
[installation](https://antithesishq.github.io/bombadil/browser/2.1-installation.html),
[CLI](https://antithesishq.github.io/bombadil/browser/5.1.1-bombadil-browser-test.html).
The basic property-testing CLI needs no AI API key. The separate type archive is
editor support; the specification imports the CLI's built-in Bombadil runtime.
`test-external` controls a CDP browser. It is not an offline specification checker.

## Fixture scope

`apps/web/tests/bombadil/fixture-entry.tsx` imports the actual home theme/region
filters, theme disclosure, device-location disclosure, performance audit,
thumbnail brief editor, storyboard comic board/conversation, and skeletons.
State changes remain in fixture memory. Reference images are synthetic PNGs.
The performance component reads its committed, minimized static measurement
snapshot; it makes no fresh measurements. Its export is checked in memory.
Storyboard capability GET returns a clearly labelled local mock:
`{ok:true,configured:false,provider:null}`. Sending and generation stay unavailable.
The existing Next Image named-export adapter is reused only for Bun interop.

The standalone fixture reuses application styles. It does not run Next dev,
invent local Supabase credentials, bypass the real local-mode admission, or
simulate production authentication.

## Local build or serve (no browser launch)

Install the exact npm 11.6.2 CLI into a task directory and run `npm ci
--ignore-scripts` in `apps/web` against the committed lock. This intentionally
skips lifecycle scripts, including the Next sync patch, and is not equivalent
to canonical release installation. This component bundle does not start Next.
Missing native/optional dependencies stop the build; do not add fallback installs.

With an absolute Bun 1.4.0 binary path and a new, nonexistent output directory:

```bash
node scripts/run-bombadil-qa.mjs --build-fixture \
  --bun /absolute/path/to/bun --out /absolute/new/output

# Use a different new output directory to serve the fixture.
node scripts/run-bombadil-qa.mjs --serve-fixture \
  --bun /absolute/path/to/bun --out /absolute/new/served-output --port 3215
```

The server binds only `127.0.0.1`. No remote tunnel or shared-browser attachment
is provided. In the authoring environment the separate cloud browser could not
reach this executor's loopback server; that attempt is not rendered UI evidence.

## Hosted execution and admission

The new `Bombadil component UX QA` workflow uses a fresh GitHub-hosted job,
`contents: read`, no supplied secrets, and checkout credential persistence off.
It leaves existing CI gates and the frozen measurement workflow unchanged.
Chrome is installed before the run, then launched once with `chromiumSandbox:
true`. There are no sandbox-disabling flags, privilege/policy changes or browser
launch retries. Launch denial stops the job and is retained as a fixed failure
code. This workflow requires parent review before its first push/execution.

The harness owns a fresh temporary browser profile and its loopback debugger.
Bombadil connects only to that profile, never to a user's existing browser.
No extra Chrome permissions are granted. A deny-only loopback proxy never
forwards outside requests; context request interception additionally permits
only exact fixture asset and inert capability GET/HEAD URLs. All WebSockets,
arbitrary routes, query strings, redirects, writes, service workers and popups
are blocked. CSP denies frames, workers, objects and form submission.

Two fixed viewports run sequentially: 1024×768 and 390×844. Each runs seven
deterministic component cases, screenshots/geometry for five views, and one
30-second Bombadil exploration. The first property violation stops that phase;
there are no retries or replacement samples. Deterministic cases cover theme
toggle/disclosure focus, empty region recovery, location consent callbacks,
performance filtering/export, thumbnail reference role preservation,
storyboard pagination/unavailable send, and loading skeletons. Seven configured
Bombadil properties cover uncaught errors, rejected promises, local navigation,
page width, selected theme state, reference alignment and accessible names.
JavaScript coverage instrumentation is disabled; this is UI property evidence.

Acceptance requires the exact binary/browser authority, one sandbox-requested
launch without disabling flags, both case sets, nonempty Bombadil action and
snapshot traces, zero property violations/page errors/unexpected blocked app
requests, and owned-resource cleanup. A failure or absent receipt is not a pass.

## Evidence

`build-receipt.json` binds direct source hashes, compiled assets, source commit
and toolchain. `qa-receipt.json` records browser identity, per-view geometry,
fixed case/step names, allowlisted violation property names and first trace index,
trace hash/counts, zero-or-failed results and network counters.
Desktop/mobile PNGs contain only fixture data. Raw CLI errors, traces/resources,
download bodies, browser profiles, cookies, tokens and storage are not uploaded.
Owned temporary traces/profiles are removed after their minimized summary is extracted.

Review the actual hosted receipt and screenshots before claiming rendered UI
success. Component fixture evidence and a later protected preview/production
readback must remain separate in reports.
