# Untimed knowledge evidence semantics amendment

## Why this amendment exists

The prior exact-head evidence at commit `8ca2231308c0175497d99186b48fbff8dc3659f6` displayed `startSeconds=0` and `endSeconds=null` as `전체 영상`. That artifact remains unchanged as historical evidence of the then-rendered UI, but its meaning is rejected: `backend/knowledge_graph/caption_osk_adapter.py` defines the pair as an **untimed source link** and explicitly says it is not viewing coverage.

The corrected formatter displays `시간 정보 없음`. Video IDs, URLs, verification status, graph records, and source data remain unchanged. This amendment makes no claim that an entire video was viewed or analyzed.

## Boundaries

- Candidate commit before the working-tree correction: `8ca2231308c0175497d99186b48fbff8dc3659f6`.
- Prior evidence directory is immutable and bound by its artifact-map hash in `source-bindings.json`.
- The canonical export has 30 nodes and 88 edges. The deterministic meaning check enumerates every evidence item and reports the actual `0/null` denominator.
- Exhaustive fixed-export label counts have no sampling confidence interval. They do not imply latency improvement, provider quality, model quality, full-video coverage, hosted behavior, or deployment.
- Browser verification uses only the loopback synthetic reader and visible CUA interaction performed separately by the root agent.

## Verification commands

From `apps/web`, with the pinned dependency tree temporarily linked as `node_modules`:

```sh
/Users/twoimo/.bun/bin/bun test \
  tests-unit/admin-knowledge-graph-evidence.test.ts \
  tests-unit/admin-knowledge-graph-api.test.ts \
  tests-unit/admin-knowledge-graph-shards.test.ts \
  tests-unit/admin-knowledge-graph-titles.test.ts \
  tests-unit/admin-knowledge-graph.test.ts

PATH="/opt/homebrew/opt/node@24/bin:$PATH" ./node_modules/.bin/eslint \
  components/admin/AdminKnowledgeGraphPanel.tsx \
  lib/admin/knowledge-graph-evidence.ts \
  tests-unit/admin-knowledge-graph-evidence.test.ts

PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm run typecheck:parity
/Users/twoimo/.bun/bin/bun performance/knowledge-evidence-untimed-20261011/meaning-contract-check.ts
```

Runtime startup for CUA:

```sh
TZUDONG_FIXTURE_RUN_ID=run-1 performance/knowledge-evidence-untimed-20261011/start-loopback.sh
```

## Local results before CUA

- Deterministic export check: 30 nodes, 88 edges, 36 evidence items, and an actual exhaustive untimed denominator of 9.
- Historical formatter: 9/9 untimed items said `전체 영상`. Corrected formatter: 0/9 say `전체 영상`; 9/9 say `시간 정보 없음`.
- The IDs, URLs, status, and interval identity hash remained `92b33b452510c10a0fdaac45e19cd048952ee3c1ed965f95a828e2136ea84cc9` before and after formatting.
- Unit checks: 32 passed, 0 failed, 1,495 assertions across 5 files.
- Targeted ESLint: passed for the viewer, formatter, and formatter test.
- TypeScript native/compatibility parity: passed with 0 diagnostics and 3,142 logical inputs.
- The first parity attempt is retained separately: the evidence-only checker referenced the Bun global without project typings. It was changed to Node `writeFileSync`; no product source changed in that repair.
- The prior evidence directory's 34-file hash listing is byte-identical before and after this amendment setup.

These are fixed exhaustive label counts, so a sampling confidence interval does not apply. They do not measure latency, provider quality, model quality, full-video analysis, deployment, or hosted behavior.

## CUA correction verification

The corrected loopback viewer passed the scoped visible CUA check:

- Three graph views at 1440, 1024, and 390 CSS pixels each rendered 30 nodes and 88 edges, with document width equal to viewport width.
- Six evidence views passed: bounded and untimed evidence at each width.
- Bounded evidence remained `YouTube · QWtvZ6NfNJ8`, `1:21–1:24 · 미확인`, and exact `https://www.youtube.com/watch?v=QWtvZ6NfNJ8&t=81s`.
- Untimed evidence became `YouTube · 3Z-ngM3DVi0`, `시간 정보 없음 · 미확인`, and exact `https://www.youtube.com/watch?v=3Z-ngM3DVi0`.
- Nine raw JPEG screenshots are retained: three graph, three bounded, and three untimed cases.
- Passive CDP cursor 71–182 was complete: 0 runtime exceptions, 0 external requests, and 0 write requests. The bounded console window recorded 0 errors and 0 warnings.
- The first semantic bootstrap click had no visible effect even though the DOM reported an enabled button and no error; normal Enter activation navigated successfully. This is retained as a setup observation, not treated as a product pass for that click.

After CUA, the owning startup trap stopped the fixture. Ports 20502, 20503, and 20504 have no listeners, the temporary dependency link is absent, and `tsconfig.json` remains clean.

The raw `next-dev-run-1.log` retains the terminal's trailing whitespace. The full staged `git diff --check` reports that one raw-log line; the source-only check excluding that exact log passes. The log bytes and Git whitespace rules were not modified to hide the observation.

## Frozen source and contract hashes

| Binding | SHA-256 |
| --- | --- |
| Rejected formatter at commit `8ca2231308c0175497d99186b48fbff8dc3659f6` | `2743bfd2bda230d6a71b618bfb430cf766c754bbf27cc9c773f14d0b0df54e14` |
| Corrected formatter | `b704e7137558172effb87a82594543377d996ce18006212a6c1e88dab16953a0` |
| Corrected formatter test | `90efd43bf7b5f8d82bc8bf87018d44594e9f96f0290970177b6b1bb60d2d270f` |
| Viewer component | `2b7404aa62cc9d0271520b9517e8f6dbdadf10fff4c044cc9db82ddd153b9887` |
| Backend untimed-source contract | `83cec891cb5ee1453da591b519e8f54cb50ff10dbb07ca3aabd2e07e0aa0664d` |
| Graph manifest | `9f23f634c05b17f682eb8639c0dba4019b28ddd9dc1eadbeff5f8ffd6c958c6d` |
| Canonical 30-node shard | `58e4515bb880b788ee0c4e64a5cd7c12100974acec9dfc3f828334d1f40417f7` |
| Prior rejected evidence artifact map | `2e7c6baf59058316ec43420a4de7013e1a6c828097e56a8c1419c77dea5e243d` |

This evidence remains local and synthetic. It does not establish real authentication, database/provider behavior, deployment, full-video analysis, large-graph paging, or a performance improvement.
