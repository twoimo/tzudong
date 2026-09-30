# Home viewport continuity: reproduced remount and retained measurements

Date: 2026-09-30. Frozen baseline: `157ced98a2414d434132c99f74c72bbe5f796ca4`.

The home shell previously replaced `HomeRuntimePendingShell` with
`MobileHomeLayout` at the mobile/tablet boundary. That change of ancestor type
discarded `HomeClient`, its map instance and its in-memory state. The candidate
keeps the map under the same main element and React child position in pending,
desktop and mobile modes. Mobile navigation/modals are siblings of that main;
their existing effects and lazy-loading boundaries remain in place.

This fixes one reproduced remount cause. The overall rendering/flicker goal is
still active: live-provider frame/pixel evidence, authenticated interactions and
paired page metrics across the other public routes are not established here.

## Retained results

Each admitted timed result uses 31 paired samples, alternating variant order.
Times are medians. Delta is candidate minus baseline. Noise is twice the larger
median absolute deviation (MAD). A delta is admitted only when its absolute value
exceeds the absolute budget, 5% of the baseline and noise.

| Measurement | Baseline | Candidate | Absolute delta | Relative delta | Noise | Absolute budget | Classification |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Structural React lab transition, 200 memoized rows | 0.445 ms | 0.075 ms | −0.370 ms | −83.146% | 0.060 ms | 0.05 ms | Local improvement |
| Local production route: mobile nav and marker DOM ready after resize | 27.1 ms | 19.9 ms | −7.2 ms | −26.568% | 4.6 ms | 1 ms | Local improvement |
| Local production route: frames with no marker DOM | 1 frame | 0 frames | −1 frame | −100% | 0 frames | 0 frames | Local improvement |
| Local production route: maximum frame callback gap | 9.3 ms | 9.3 ms | 0 ms | 0% | 0.2 ms | 1 ms | Below budget/noise |

Structural lab row mounts/unmounts per boundary transition are **200→0**.
The complete Next route creates **1→0** new simulated provider map objects per
desktop→mobile transition. All 31 candidate route samples retained both the map
container and provider instance. Both variants had zero horizontal overflow and
one `main#main-content`.

## What was exercised

The structural lab compiles the actual frozen/current `HomeRuntimeShell` source
with production React. It controls the viewport mode and substitutes service
contexts and lazy chrome; the subtree has 200 memoized synthetic rows. Four
warmup pairs precede 31 scored pairs. Fourteen checks cover pending→desktop,
pending→mobile, both boundary directions, same-mode updates, and server markup
hydration followed by a controlled mode transition. The candidate preserves the
map DOM, selected synthetic value, main element and focus in every check. The
baseline loses them only on transitions that replace the mobile ancestor.

The route experiment uses separately built Next.js 16.3.5 production bundles,
Node 24.21.0, the existing three public restaurant fixtures, and the existing
simulated Naver provider. Both variants run sequentially behind the same local
origin; the fixture helper's exact-origin check is preserved. External requests
and WebSockets are blocked. Two warmup pairs precede 31 scored pairs.

The route readiness metric starts before the browser resize command and ends
when a frame sees the target viewport, mobile navigation, a map container and
marker DOM. It includes command transport and rendering, and is **not INP**.
Frames are then observed for a fixed one-second window. Marker absence is a DOM
predicate, not a pixel blankness detector; the simulated provider has no real map
tiles. Screenshots confirm layout geometry and the controlled detail state.

The final candidate also passed the persisted Playwright regression for mobile search
selection followed by mobile→desktop→mobile, retaining the same map container
and provider creation count. A Chromium CDP touch gesture emitted one trusted
`touchstart` and changed the selected detail from 정원분식 to 명동칼국수. This
exercises the native Chromium input/event pipeline; it does not prove physical
device/WebKit behavior or a live Naver SDK gesture.

There were zero page runtime errors. Each sampled page in both variants recorded
two console errors under the external-request fence. Their exact cause remains
unclassified, so this experiment does not establish an error-free complete page.
Raw load/LCP counters are retained for further analysis, but no page-load gain
is admitted from them in this report.

## Mathematical interpretation

React retains state when component type, key and position remain stable. For R
descendant rows, replacing the ancestor triggers R cleanup/mount pairs. Keeping
that ancestor removes this O(R) remount work and preserves the provider instance.
The candidate still runs mobile chrome effects, reconciliation, device-specific
marker/layout updates and context-driven renders. Total page rendering is not
claimed to be O(1), and no live SDK initialization complexity is assumed.

For paired timings B and C, the reported delta is median(C)−median(B), the
relative delta is 100×delta/median(B), and the noise budget is
2×max(MAD(B), MAD(C)). For the structural case, 0.370 ms exceeds 0.05 ms,
0.05×0.445=0.02225 ms, and 0.060 ms. For route readiness, 7.2 ms exceeds 1 ms,
0.05×27.1=1.355 ms, and 4.6 ms. The maximum callback-gap delta is below its 1 ms
budget and is not an improvement.

## Provenance and verification

Detached artifact-map pins, emitted by the measurement commands and independently
verified:

- `candidate-v2/artifact-map.json`: `c5c6a7948a6802529643d6d86341ed0c13aa0c7a9eda9130b2a87f0427d97ac9`
- `route-v7/artifact-map.json`: `bf3ec0a9a1a9c71e69c33fcc0cfa8b4f1e920406b36c7b96aaa72e0b27b9f823`

Both verifiers re-read artifact hashes and current affected source and recompute
medians, deltas, noise and admission from retained raw pairs. Build receipts bind
the two route bundles to retained build IDs and five frozen input hashes. The
baseline is copied from the exact frozen Git tree; candidate code is also archived from its immutable commit and
locked dependencies are copied into task-owned scratch. Neither build replaces
files in the caller checkout. Audits do not require transient `.next` trees. Frozen source,
the browser bundle, raw pairs, scored outputs, screenshots and regression output
remain in this directory. Earlier structural runs and failed route setup runs
are retained separately and are not substituted for the admitted runs.

Both production fixture builds passed compilation, TypeScript and all 48 static
pages. Native/stable type parity passed with 2,517 logical inputs and zero
diagnostics. The initial full unit suite had 2,444 passes, one skip and one stale
source-string assertion failure. The assertion that required the old ancestor
branch was removed from both affected source-contract files; their 38 tests
then passed. The new browser regression supplies behavioral coverage for the
replaced shape. After review repairs, all 72 affected unit tests passed with
3,321 expectations, type parity passed again, and both browser regressions
passed. The second regression enters fullscreen through the mock SDK click
event and verifies desktop entry plus return to mobile; it is fixture input
evidence, not a native or physical-device click claim. Full source lint passed after excluding the two generated local
measurement build directories; application and measurement scripts were included.
The route CSS boundary verifier also passed against the candidate build: home
192,639 raw bytes / 45,626 gzip bytes, general/admin 370,197 raw bytes / 67,656
gzip bytes. These are validation outputs, not a CSS reduction claim.

## Remaining goal evidence

- Read back the live SDK and deployed revision after this source change is promoted.
- Measure actual tile/marker pixels and browser frame timing under real catalog
  and provider load; include desktop/mobile and the reported flicker triggers.
- Complete authenticated-session and physical-device/WebKit interaction coverage.
- Analyze the retained load counters and extend paired measurements to the other
  affected public routes before making an overall performance claim.
- Investigate the two fenced-console errors and revalidate the separate
  over-capacity swipe-cache regression rather than calling all scenarios faster.

This report is local evidence. Protected promotion, deployment and release for
this continuation were not performed at the time this report was written.

## Review repairs and current evidence

The detail sheet and desktop detail renderer now receive the same viewport value
from HomeClient, removing their former independent 50 ms debounce window. Mobile
fullscreen is derived only in mobile mode and its stored flag is cleared on
desktop entry. The browser test samples every animation frame during both
breakpoint directions and never observes more than one detail panel. This is a
state-consistency assertion, not an additional timed performance claim.

The provider mock and map-creation counter execute in one init script, and tests
require a positive numeric initial count. The Node executable is configurable
and version-checked. The final route run is `route-v7`; intermediate v4/v5 test
setup failures are retained and are not admitted measurements. Old v3 raw values
remain historical evidence, auditable with `--frozen-only`, rather than current
route results. The source-only structural v2 result remains applicable because
the measured shell bytes are unchanged.

Five anonymous real-provider visits to production SHA `157ced98...` reproduced
one new map per breakpoint transition and lost map/detail DOM identity in every
visit. Two frames per visit had no loaded image anywhere inside the map
container. This image predicate includes markers/attribution and is not a
pixel-level tile blankness detector. The retained live baseline is under
`../home-live-readback-20260930/baseline-v1/`; its detached map hash is
`df298024193ceff7977e6da0271accbade5b420e2cb2c4af71695062f707cb84`.
These visits are sequential observations; they establish the live trigger, not
an alternating paired speedup. Candidate production readback is still pending.

A one-visit diagnostic classified a blocked fixture persistence request and,
on production, a provider CSP block plus two persistence HTTP 401 responses.
It does not fully classify the two errors in every historical resize sample.
Fixed codes only are retained in `../home-live-readback-20260930/diagnostic-v1/`.
The independent cache revalidation retained all six scenarios and again admitted
the 128-search over-capacity regression; see its separate report.

The final baseline build (`build-baseline-v3`) is bound to commit
`157ced98a2414d434132c99f74c72bbe5f796ca4` and tree
`2de4984fffa83011c67b7ccb9336a2c163517981`. The final candidate build
(`build-candidate-v4`) is bound to commit
`5213864b2cd8e8965c6f529652fe3272f471cbe0` and tree
`9fd8dfd5aeaa4a6225a022aff38e8d38ca37575d`. Both are archived full code
trees, not caller working-file snapshots. The candidate v3 attempt failed
Google font fetching; it produced no admitted sample. A direct font endpoint
check returned HTTP 200 and the subsequent serial v4 build passed. Older v6
results remain historical and are superseded by v7 for current route claims.

WebKit 26.5 also reproduced one provider recreation and lost map DOM identity in
all five baseline visits. Its retained pin is
`ecb324522892c8b8bd46cc36ae10284f6ef43aceedfd1302ccbf971934a9fa38`.
`../home-live-readback-20260930/verify-live.mjs` independently checks detached
pins, retained hashes, exactly five observations, deployment/project SHA,
anonymous scope, bounded metrics and expected identity invariants. Scored
outputs classify timings as sequential observations without speedup admission.
A clean scratch audit accepted the original data and rejected altered raw data,
wrong expected SHA/kind, and an incomplete run even with consistent new hashes.
