# Real media and orchestration replay, 2026-10-07

Seven alternating baseline/candidate pairs completed, with separate cold and
restart observations (28 observations). All 48 generated JPEG bytes, archived
evaluation values, evaluation prompt hashes, transformed fields and trace IDs
were equal. All three seeded administrator-owned rows remained unchanged;
there were zero duplicate transformed IDs. No production code was changed.

The experiment executes actual ffmpeg, the LAAJ shell/parser, file receipts,
locks and transform scripts. Source components are frozen at baseline commit
`e6c7c97cc6fb9c4ac2e45297e22c2541bd5ad0d4` versus the working candidate. Its
three archived evaluations come from the original corpus. Original video files
were absent, so the actual media is a retained synthetic 640x360, 8 fps source.
The baseline's four changed component files and the candidate support helpers
are individually hashed; this is not a claim of an entire baseline checkout.

**The summed replay time is not an admitted production speedup.** The provider
command is replaced with deterministic response replay, bypassing the Node SDK
and its actual project admission/pacing. Baseline retains `sleep 2` per video;
candidate relies on the bypassed adapter's admission control. This creates a
known asymmetric pacing confound. Actual provider latency, billed tokens,
accuracy and stochastic variation are unmeasured. All provider and operational
DB calls were zero, and production models/caps were unchanged.

| Measurement, n=7 pairs | Baseline mean | Candidate mean | Candidate change | 95% CI for baseline minus candidate |
| --- | ---: | ---: | ---: | ---: |
| Cold replay sum | 7,563.23 ms | 3,187.19 ms | -57.86% | 4,125.42 to 4,626.66 ms |
| Restart replay sum | 610.67 ms | 638.38 ms | +4.54% | -78.86 to 23.45 ms |
| Cold CPU sum | 2,491.49 ms | 3,696.40 ms | +48.36% | -1,329.94 to -1,079.88 ms |
| Cold media wall | 478.63 ms | 699.42 ms | +46.13% | -379.11 to -62.47 ms |
| Cold sampled process-tree RSS | 593.54 MiB | 194.83 MiB | -67.17% | 197.89 to 599.52 MiB |
| Cold actual ffmpeg command peak | 12 | 4 | -66.67% | Deterministic event count, not a sampled latency estimate |

Intervals are paired t intervals with df=6; retained scores also include seeded
10,000-resample paired bootstrap intervals. Percentages in this table use the
ratio of means. The raw scorer retains mean paired percentages separately.
Cold baseline media wall CV was 37.50% and RSS CV was 37.53%, above the declared
20% noise budget. RSS and media timing are not admitted improvement claims.
The host was shared; another agent reported a 127-second web suite, and exact
overlap was not independently resolved. Successful conditions were not rerun
solely to hide this contention. CPU increased, and restart wall-time CI crosses
zero; both negative results are retained.

Actual subprocess fault probes, each a correctness observation rather than a
performance population estimate:

- Two independent processes targeting the same output: ffmpeg work 24 to 12
  calls; replay evaluations 6 to 3, with 3 duplicate evaluations to 0. Final
  frames, evaluation, trace IDs and protected transform rows remained equal.
- One damaged JPEG: baseline reused the damaged file. Candidate executed one
  ffmpeg segment, restored exact bytes and retained damaged bytes in history.
- Candidate provider-child timeout: exited 1 with zero partially published
  evaluation files; subsequent real orchestration recovered exact evaluation
  and transform output, including the three protected rows.
- The ffmpeg limit is **per Node process**. Two candidate Node processes reached
  8 simultaneous commands in aggregate. These results do not establish a
  host-wide media limit of 4.

The original corpus before/after hash covers 5,223 JSONL files, 37,932,900 bytes:
`f73f6a26e41bb2501d1e718915cd888a4e21c7eb407c66bd796c9aa6af759bf0`.
Both complete manifests are retained, and the source asset hashes stayed equal.
Runtime: pinned original Python 3.14.8, Node 24.21.0, Homebrew ffmpeg 9.0.2 on
macOS; the original backend dependency lock is hashed and was not installed or
changed. Frame resources cover the measured subprocess only, with no priming
mixed into cold observations. Process-tree sampling uses `ps` at a minimum
20 ms interval; sampler overhead and sampling gaps remain part of the evidence.

The primary sample explicitly uses three non-hyphen-leading IDs. A supplemental
real parser check accepted a leading-hyphen original ID with exact archived
evaluation output on Python 3.14.8; an initial suspicion about argparse was not
reproduced. This extra coverage check is retained in
`measured/leading-hyphen-check.json` and is not pooled into timing statistics.

Remaining full-goal gaps: real admitted-provider timing/tokens/quality; original
video coverage; parallel LAAJ under an unchanged admitted budget; whole-worker
graph and interruption recovery; storage RPC/CAS and rendered admin in the
same timed path. Protected fixture transform rows do not prove database or UI
protection. `liveEvidenceEligible` and `fullEndToEndGoalComplete` remain false.

Raw observations, process event traces, image manifests, source snapshots,
configuration, corpus hashes, statistical scores and readback validation are in
`measured/`. The two pilot runs are retained but excluded from all n=7 scores.

Reproduce the bounded experiment from the repository root:

```text
PYTHONDONTWRITEBYTECODE=1 /Users/twoimo/Documents/projects/tzudong/.venv/bin/python backend/bin/benchmark_media_orchestration.py --pairs 7 --output <new-evidence-directory>
```

The independent scorer reads frozen harness source and hashes every artifact;
its retained run passed ten checks. No hosted writes, provider calls,
deployment or commit was performed.
