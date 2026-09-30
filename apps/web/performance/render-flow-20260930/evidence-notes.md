# Render-flow evidence commands and claim boundary

Run these commands only after candidate-v7 `paired-v6/raw.json`, `secondary-v5/raw.json` and `regression-candidate-v7-v1/raw.json` are complete. Candidate-v6 is rejected for final measurement because the reproduced fast-pan sequence populated 143 markers, panned to an empty viewport, then returned to the same center at zoom 14 but remained at zero markers for at least 12 seconds. Preserve all candidate-v6 raw evidence, including `paired-v5/raw.json`, `secondary-v4/raw.json` and `regression-candidate-v6-v1/raw.json`, but do not admit it. The pre-v7 scorer, verifier and canonical scripts are retained byte-for-byte as `score.mjs-v6.txt`, `verify-evidence.mjs-v6.txt` and `canonical.mjs-v6.txt` for raw reproduction.

`plan-v6.json` retains the plan-v5 budgets, cells, 31 primary pairs, 9 secondary pairs, two warmups and validity gate. Its frozen `correctnessGate` extends the earlier requirements with exact warm-cache DOM-ID/SDK-position restoration, viewport invalidation that does not wait for cluster debounce, and zero provider setters on unchanged idle. `secondary-label-correction.json` remains the measurement-only record that clusters with at least 1,000 members display `999+` while correctness requires the complete 2,000-member ID set. No threshold is lowered.

From `apps/web`:

```sh
node performance/render-flow-20260930/score.mjs \
  --plan performance/render-flow-20260930/plan-v6.json \
  --aa performance/render-flow-20260930/baseline-aa-v3/raw.json \
  --additional-aa performance/render-flow-20260930/baseline-aa-final-v1/raw.json \
  --resources-plan performance/render-flow-20260930/resources-plan.json \
  --raw performance/render-flow-20260930/paired-v6/raw.json \
  --raw performance/render-flow-20260930/secondary-v5/raw.json \
  --output performance/render-flow-20260930/scored.json
```

Additional retests are supplied by repeating `--raw`. Selection is deterministic in command order: only the first 31 valid quiet pairs per primary cell and first 9 per secondary cell are selected. Heavy-overlap, saturated, unequal-load and invalid-capture pairs remain in the all-observed or busy shared-host descriptive sections. No quiet result is inferred when fewer than the predeclared count survive.

The scorer uses 10,000 fixed-seed paired-index bootstrap resamples and a separate adjacent AB/BA block bootstrap. The trailing 31st pair is retained once in every block resample. Improvement requires both 95% lower bounds above zero, a delta above every absolute, relative, paired-sample MAD, retained A/A noise, alternating A/A and time-drift floor, and positive AB/BA and early/late sensitivity strata. The older A/A floor can only increase when `--additional-aa` is supplied.

Before generating the full-tree map, finish `REPORT.md` and retain the candidate-v7 receipt, all ten retained inputs, three-file source patch, raw pair/sample sidecars, screenshots, `regression-candidate-v7-v1/raw.json`, all candidate-v6 evidence and the canonical packet. Then run:

```sh
node performance/render-flow-20260930/verify-evidence.mjs create-map \
  --scored performance/render-flow-20260930/scored.json \
  --output performance/render-flow-20260930/artifact-map.json
```

Copy the printed `externalSha256` out of the evidence directory. Verify with that detached value:

```sh
node performance/render-flow-20260930/verify-evidence.mjs verify \
  --scored performance/render-flow-20260930/scored.json \
  --artifact-map performance/render-flow-20260930/artifact-map.json \
  --artifact-map-sha256 EXTERNAL_ARTIFACT_MAP_SHA256
```

The map creator refuses to overwrite an existing map. The verifier requires exact full-tree coverage, so any later file change requires a new map and a new external pin.

The project backlog scorer is a release/field governance envelope. Local browser data is never inserted as a field measurement. Prepare a zero-admitted packet with an unavailable field source and observed local browser-gate incidents:

```sh
node performance/render-flow-20260930/canonical.mjs prepare \
  --local-scored performance/render-flow-20260930/scored.json \
  --output-dir performance/render-flow-20260930/canonical-zero-admitted-v1 \
  --release-id render-flow-local-governance-20260930
```

Run the exact `scorerCommand` printed by `prepare`. It invokes `scripts/score-performance-backlog.mjs` with the detached score-map SHA-256. Then finalize the validation envelope using that same printed score-map pin:

```sh
node performance/render-flow-20260930/canonical.mjs finalize \
  --packet-dir performance/render-flow-20260930/canonical-zero-admitted-v1 \
  --score-map-sha256 SCORE_ARTIFACT_MAP_SHA256
```

Run the exact `validatorCommand` printed by `finalize`. It invokes `scripts/validate-performance-backlog.mjs` with a second detached map pin. `finalize` only assembles the validation envelope; the project validator command is the independent readback.

The canonical packet is explicitly bound to the frozen baseline Git SHA/tree. The candidate-v7 three-file patch remains an uncommitted patch identified by SHA-256; it is not represented as a candidate Git commit. The packet therefore cannot establish candidate release identity, G003 admission, deployment, field improvement or production health. Field measurement availability is `source_not_produced`, and local console/page/incomplete-request observations become `required_cell_console_page_network_errors` incidents rather than being hidden.

Local metric meaning remains narrow. `clickToExpandedMs` ends at the frozen sampler's stable DOM/hit-test condition after a post-click idle and target viewport match. It does not prove physical pixels or complete paint. FCP, LCP, DOM, marker, frame, heap and fixture-response-body byte summaries are secondary descriptions. Fixture bytes are kept separate from actual network transfer bytes, which remain unavailable. P95 is descriptive only and omitted below 20 observations.
