# Overseas map startup candidate

User outcome: switching to overseas must show a real, usable licensed map promptly on mobile, tablet and desktop. Preserve existing restaurant selection, filters, device-coordinate boundaries and protected delivery. No deployment, paid service, account change, bulk/offline tile download or hosted data mutation is included.

Base: `de62e9426ffd761c4be974a4ca670c034d98489e`. Previous unrelated detail-header and stamp edits remain in the owned candidate and are outside this measurement's source scope.

## Observed problem and decisions

- OM-01 ACCEPT: production/source CSP omits `https://tiles.openfreemap.org`. The standalone public style GET returned 200 in 116.5 ms on this host; this is not a browser paint measurement. Add only that exact origin to connect-src. Preserve script nonces, strict-dynamic, worker and image restrictions.
- OM-02 ACCEPT: pinned MapLibre 6.11.2 uses a separate worker module; the component does not configure the worker URL. The publisher's current Next/Webpack `new URL(...)` example was tested against the installed version: the emitted worker returned 200 but its relative `maplibre-gl-shared.mjs` import returned 404. Preserve that reproduction. Publish the installed worker, shared module and LICENSE.txt unchanged together at a content-hashed same-origin URL; fail on a missing or mismatched dependency. Configure `setWorkerUrl` with that generated URL. Native fixture and actual application builds must serve the complete dependency set with JavaScript MIME and immutable caching.
- OM-03 ACCEPT: country changes are an initialization dependency, so they destroy/recreate the map. Initialize per mount/retry, update the camera on country changes and clear owned markers/observers/listeners on cleanup.
- OM-04 ACCEPT: the full opaque loading layer also waits for restaurant data. Make map readiness independent of that query; show a nonblocking pin-loading status instead.
- OM-05 ACCEPT: the deferred overseas chunk has a null Suspense fallback and no intent preparation. Share one retryable import promise, prepare on pointer/focus intent, and display loading feedback during chunk loading. Do not mount a hidden second map or prefetch regions.
- OM-06 ACCEPT: errors leave an indefinite preparing screen. Offer an explicit retry after an error, and a slow-network notice after 12 seconds. Elapsed time alone is not a provider-failure diagnosis; late successful loading can still recover.
- OM-07 CONDITIONAL: keep OpenFreeMap/OpenStreetMap and visible source attribution. Commercial use is expressly permitted; OSM data remains ODbL and is not copyright-free. Preserve OpenMapTiles/OSM attribution and installed dependency licenses. Provider availability has no guaranteed SLA.

Alternative considered: replace the renderer/provider with raster tiles. This does not repair the demonstrated CSP and loading-state faults, introduces a new provider policy/runtime migration and does not establish faster loading. Defer unless the corrected current integration cannot meet the actual requirements. No standard OSM public tile scraping/proxy/cache workaround is included.

## Verification gates

1. Actual public proxy response includes only the exact additional tile origin, and retains production strict script policy. Existing auth/mutation and marker/device-location tests pass.
2. Native pinned Next production build emits and serves a usable same-origin MapLibre worker. Test real OpenFreeMap style/vector/glyph/sprite traffic under the actual proxy CSP.
3. Freeze original and candidate sources. Compare separate fresh browser contexts at the same viewport/network. Record module/worker/style failures, first map-ready timing, first visible tile screenshot and attribution. Do not report a percentage improvement when baseline never reaches readiness.
4. Target cold local map readiness within five seconds in matched native samples; report observed range and variability. Network/provider failure and software-rendered local results are separate from production or physical-device latency guarantees.
5. An intentionally pending restaurant query must not cover a ready map. Country changes must reuse the canvas; retry must cleanly create one replacement. Slow/error notices and a successful retry must be exercised.
6. Inspect mobile, tablet and desktop widths, and preserve click/selection plus attribution. No hidden GPS input or account data enters fixtures or reports.

The first retained 14-case run had one baseline assertion failure: its observer required a page-target CDP CSP event, while the browser emitted the worker CSP failure only to console. Candidate cases all passed. A focused two-case follow-up corrected the observer and additionally verified the retry's actual Nagoya tile coordinates. The initial failure remains in raw evidence and is not rewritten as a passing original run. No product change occurred between those runs.

## External validation and delivery

The focused GPT thesis/delta -> Gemini adversarial -> GPT reverse review remains a separate gate. Canonical shared admission currently has two ChatGPT operations owned by other sessions and zero free local slots. No current queue override was supplied for this map scope. Preserve those operations and prepare a single scoped request; no external report is claimed and no model/account/slot bypass is allowed. Continue reversible local implementation and native verification while that gate is unavailable.

Only claim local candidate verification actually observed. A production deployment needs the repository's explicit operator authority, protected develop -> data -> main path, current rollback SHA and exact deployed-SHA/live readback. The prior deployment and Nightly history are separate.

## Official sources read

- https://openfreemap.org/ (commercial use, required attribution, availability)
- https://openfreemap.org/quick_start/ (MapLibre integration)
- https://www.openstreetmap.org/copyright (ODbL and attribution)
- https://maplibre.org/maplibre-gl-js/docs/ (v6 worker setup, Next/Webpack and CSP)

The maintained pstack source check observed upstream `88d47514b82e7c44f00f2b2a72ff6dd12158038c`, matching the reviewed local source lock. No new upstream instructions were adopted. The historical Hycli/pstack pause memory was scoped to that other research context; it was not treated as authority to change this project's sessions or models.
