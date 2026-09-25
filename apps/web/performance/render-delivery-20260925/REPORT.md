# Rendering candidate: measured results and delivery state

Date: 2026-09-25. Candidate base: `af628142860e31b0e32f30d7d4e0b8970943f6fe`.

This report describes retained, source-bound laboratory measurements. It does not
establish a production performance gain, full-page LCP/INP improvement, or the
elimination of visible flicker. The original dirty checkout remains separate.

## Results

Each timed scenario has 31 paired samples. Times below are medians in milliseconds;
the delta is candidate minus baseline. Positive deltas are slower. The noise
column is twice the larger median absolute deviation (MAD) of the two variants.

| Scenario | Baseline | Candidate | Delta | Relative delta | Noise | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Home lazy-provider readiness, 200 synthetic rows | 0.600000 | 0.300000 | -0.300000 | -50.0000% | 0.200000 | Laboratory improvement |
| Google adapter, unchanged list in new array | 1.487000 | 0.115000 | -1.372000 | -92.2663% | 0.234000 | Laboratory improvement |
| Google adapter, 10% membership turnover | 1.436500 | 0.249000 | -1.187500 | -82.6662% | 0.087000 | Laboratory improvement |
| Google adapter, coordinate updates | 1.349500 | 0.146500 | -1.203000 | -89.1441% | 0.055000 | Laboratory improvement |
| Google adapter, full membership turnover | 1.434000 | 1.462500 | +0.028500 | +1.9874% | 0.148000 | Below budget/noise |
| Swipe, fresh visible ordering | 0.065667 | 0.046292 | -0.019375 | -29.5051% | 0.010000 | Laboratory improvement |
| Swipe, new search on same visible list | 0.028113 | 0.006262 | -0.021850 | -77.7234% | 0.000975 | Laboratory improvement |
| Swipe, same-search cache hit | 0.00001517 | 0.00002200 | +0.00000683 | +45.0550% | 0.00000100 | Below absolute budget |
| Swipe, nearest fallback | 0.124417 | 0.050625 | -0.073792 | -59.3101% | 0.003000 | Laboratory improvement |
| Swipe, revisit 64 searches | 0.00002325 | 0.00003375 | +0.00001050 | +45.1613% | 0.00000100 | Below absolute budget |
| Swipe, revisit 128 searches over capacity | 0.00002550 | 0.00558750 | +0.00556200 | +21811.7651% | 0.00025300 | Laboratory regression |

An improvement/regression is admitted only when the absolute delta exceeds all
three thresholds: the absolute budget, 5% of the baseline, and the noise budget.
The absolute budget is 0.05 ms for home/Google and 0.001 ms for swipe. Development
React StrictMode runs are correctness evidence only, without timing claims.

The home laboratory reproduced 200 row unmounts/remounts in the frozen boundary
and zero in the candidate. DOM identity and the draft survived all 31 candidate
samples. Both production React and development StrictMode correctness runs passed
29 checks; these include synthetic context forwarding, actions, provider changes,
cleanup, session-boundary draft reset, and hydration. Real login/provider service
integration has not been verified by this laboratory.

Google measurements use Chromium DOM and a simulated provider adapter, not the
live Google Maps SDK. The 13 correctness checks passed, including image decoding.
Retained marker IDs preserve marker/image identity; creation and detachment counts
are 200→0 for unchanged/coordinate scenarios, 200→20 for 10% turnover, and 200→200
for full turnover. The earlier v1 full-turnover regression remains in its original
directory and is not substituted for v2 evidence.

Swipe measurements retain 752 equivalence cases. The 128-search regression is a
real cost of bounded history and is not an improvement. No usage evidence has
been collected to claim that this access pattern is absent in the application.

## Mechanisms and complexity

**Home providers.** Replacing an ancestor component type discards its descendant
React state. The candidate keeps the projected context providers and application
children in a stable position, while the full providers run in a memoized sibling.
For R rows, lazy-provider readiness changes remount work from R rows to zero;
context consumers can still rerender. This is not a claim that all rendering is
O(1). The session-hint key deliberately still resets the subtree when the hint
changes between anonymous and session states, preserving the existing boundary
for private drafts.

**Google markers.** With P prior markers, N next items, A additions, and D removals,
the helper performs O(P + N) matching and updates plus O(A + D) provider
creation/detachment. The old effect recreated all N markers after detaching P.
Only the expensive provider operations become proportional to membership changes;
the complete reconciliation is not O(A + D). New markers attach before obsolete
ones detach. Callback and restaurant references refresh for retained IDs.

**Swipe selection.** A comparison pass builds at most one selection-ID set and
uses one output array with an in-place reversal of the nonmatching partition.
For N candidates, M selection merged IDs, and G total candidate merged IDs, this
pass is O(N + M + G), with O(N + M) working storage. Ordering and fallback history
each retain at most 64 entries per weakly keyed source array; the limit is not a
global 64-entry limit. Cached ordering arrays can therefore occupy O(64N) per
live source array. Eviction follows insertion/update order, not hit-promoted LRU.

## Source binding

The following detached artifact-map pins were verified against current measured
source in this continuation. Frozen inputs and raw samples remain in their
existing directories; they were not overwritten.

| Evidence | SHA-256 |
| --- | --- |
| Home production React `run-v2` | `2d30881df1d4a96aa674c4db271c415c7877e0ebeb112a580d49a7ec3956d44b` |
| Home development StrictMode | `57c229e697a3f719374cdf1da7e9e9d9e786b099e451bccfd709becc4778a87e` |
| Google reconciliation v2 | `8c565f743370310fafa691706b65484892f8664f4b348c4143b308890d8af376` |
| Swipe cache | `0b849d74053d47b3405218121dfbfcc6ef1afd39c1d0ecc4883a0874d3767675` |

## Outstanding verification and delivery

The candidate passed `npm run build` with the pinned Node 24 executable in this
continuation. Compilation, TypeScript, generation of 48 static pages, and the
route CSS boundary verifier completed with exit code zero. The verifier reported
192639 bytes for home/deferred CSS and 370197 bytes for general/admin CSS; these
are build outputs, not a before/after CSS improvement claim. `git diff --check`
also passed.

The home provider bridge does not fix the separate pending/desktop-to-mobile
ancestor change in `HomeLayoutContent`. Its effect on the real map and visible
frames still needs reproduction. Do not claim all viewport/login transitions
preserve map state.

Swipe caches require source arrays to be replaced when catalog/visible contents
change. The inspected home caller constructs its fallback catalog with a new
array; the inspected Naver render path copies its visible array before adding
expanded-cluster entries. A complete upstream item-mutation audit is still open.

The local stack failed analytics readiness. A fresh readback of the shared Colima
VM reported 7922 MiB total memory, 7886 MiB used, 35 MiB available, and zero swap.
Kernel logs independently showed repeated OOM kills of `beam.smp`. The task's
analytics container had restarted ten times at the inspected point. An attempted
temporary swap addition was rejected by automatic approval review because it
could not determine the request's security status; no successful swap-write
receipt exists. No other task's containers or VM were restarted by this
continuation. Do not keep retrying an unchanged stack start under these conditions.

The original production observations under `render-field-observation-20260925`
are single-window observations, not a paired baseline/candidate benchmark or INP.
Local full-page readiness, live provider interactions, paired page measurements,
protected `develop → data → main` promotion, GitHub release, production SHA/URL
readback, and local delivery must all be completed before marking the goal complete.
