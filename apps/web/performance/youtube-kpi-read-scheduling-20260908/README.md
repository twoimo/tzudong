# YouTube KPI independent-read scheduling experiment

The only scheduling change is concurrent current-video-page and comparison-bucket reads after resolving the latest video bucket. Prior-video map reads still wait for both; map chunks and pagination remain sequential. The channel query already runs concurrently at the caller and is modeled that way. Channel identity/source filters and the 15-minute exclusive lower baseline bound are unchanged.

The existing service-role factory already caches its client for five minutes. Factory invocations are not client constructions. Neither query counts nor factory calls decreased. No result cache, cross-request deduplication, credentials, network access, database writes, collector execution, auth changes or frontend edits are introduced.

## Reproduce

From apps/web, run `bun performance/youtube-kpi-read-scheduling-20260908/measure.mjs`, then `bun performance/youtube-kpi-read-scheduling-20260908/score.mjs`. The harness executes frozen actual helper sources and the same frozen quality module, with a synthetic query transport only. Two warmup pairs precede 30 alternating baseline/candidate pairs per scenario. Video and channel helpers execute concurrently. Every measured pair requires identical payload hashes and query counts. Query-level start/end timings and all samples are retained in raw.json.

## Controlled results and budgets

| Synthetic cohort | Baseline median | Candidate median | Paired median improvement | Relative improvement | Paired difference MAD |
| --- | ---: | ---: | ---: | ---: | ---: |
| Empty publication cohort | 33.18 ms | 22.16 ms | 10.99 ms | 33.12% | 0.75 ms |
| 100 videos, one page | 44.26 ms | 33.37 ms | 10.92 ms | 24.67% | 0.77 ms |
| 1,200 videos, two pages | 114.13 ms | 103.48 ms | 10.75 ms | 9.42% | 1.79 ms |

Predefined exploratory budgets: absolute improvement at least 5 ms; relative improvement at least 5%; paired-difference median absolute deviation at most 2 ms. All three controlled scenarios meet these budgets. Transport delay is artificially fixed at 10 ms per query; these values are not production latency estimates. The canonical product budgets in ../performance-budgets.v1.json are not evaluated by this experiment.

Admitted G003 slices: **0**. No current G003 measured improvement is established. Retained sources freeze the helper and its quality dependency, not the full concurrently edited repository. freeze.json records the repository HEAD/tree only as provenance, not as the tested dirty-tree identity. The artifact map hashes all retained inputs, raw/scored output and runners; its own hash is reported outside the map in the task handoff.

## Limits and tradeoffs

Combined channel/video peak read concurrency increases from two to three; request count stays at 5, 6 and 12 for the respective scenarios. Production connection-pool contention is unmeasured. A failed row query can now launch the independent comparison read that the prior serial failure would have skipped. No further batching parallelism is justified by these results.

## Verification

23 focused runtime tests pass, including explicit pending-row overlap, failure propagation and fresh data on repeated calls; 10 existing snapshot contract tests pass. Targeted ESLint and diff whitespace checks pass. Node 24.20.0 typecheck:parity passes with zero diagnostics and 2,355 logical inputs. The earlier parent UI errors are no longer present in this check.
