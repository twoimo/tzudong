# Windows Bun TypeScript benchmark gate handoff

Source fix is ready for parent integration. Native Windows success is pending; no commit, push, CI rerun, deployment, browser, phone, DB, settings, Nightly workflow, UI, SQL or unit diagnostic helper change was performed.

## Bound ownership

Worktree: `/Users/twoimo/.codex/worktrees/review-commit-recovery-20261004/tzudong`
Branch: `codex/ts7-summary-quality-20261005`
Unchanged base HEAD: `c2c61614574927390f4ea4d90ccc3373ec7a1358`
Base tree: `c0d2cdbbda874e6b286b969d3bcd4a44f5336a7f`
Initially clean. Exactly three modified tracked files; `source-fix.patch` and `source-hashes.json` provide the integration payload and before/after hashes.

- `apps/web/scripts/measure-typecheck.mjs`
- `apps/web/scripts/verify-typecheck-benchmark-report.mjs`
- `apps/web/tests-unit/typecheck-benchmark-source.test.ts`

## Observed failure and evidence limits

PR #3117, run 37212205347, Windows Bun job 111465506075 completed with failure. Install, toolchain verify, native, compat and parity succeeded. Actual job parity was 0 diagnostics / 2,449 logical inputs, native 7.0.2 and compat 6.0.2.

Artifact 11306508253 has exactly one member: `c0d2cdbbda874e6b286b969d3bcd4a44f5336a7f/windows-bun/failure-receipt.json`. Its downloaded ZIP SHA-256 matches GitHub's external digest: `7e46ebd82851ab5a68cf7c70127909ee8ab4db8505d58749d30e971b608cb7fc`.

The receipt says sampler exit code 1, summaryPresent true, invalidReasons `["sampling-gap-exceeded"]`, 99 samples, maximumGapMs 96.9706000000001, maximumHostPressurePercent 31.883521875601456, 99 recorded control samples, lastControlFrame summary, zero sampler stderr bytes, and lastFailure null. This is an invalid cadence measurement, not evidence of a TypeScript, UI, or application-performance regression. The 60ms rejection is correct.

Source at the exact failed tree explains lastFailure null: measured failures are caught and wrapped with lastFailure, while warmups directly await runCompiler and abort. Thus the failure occurred in a warmup; the receipt does not identify native versus compat. The producer then deleted raw staging and published only the receipt. No failed raw data survived in this artifact, so collector scheduling, snapshot cost and pipe/writer backpressure cannot be distinguished. No native sampler implementation bug or byte corruption is claimed. The report validator subsequently failed ENOENT because report.json was never published; it did not reject an otherwise valid report. The required final gate correctly rejected these failed outcomes.

## Source change

Warmup cadence-only rejection now has bounded local recovery: no more than 3 total attempts (2 retries), using the existing per-compiler invalid-run budget shared with measured samples. Retrying requires clean compiler exit/output, terminal sampler evidence, a complete structurally valid summary whose only rejection is a gap over 60ms, and an independent readback proving cadence-only raw evidence. Setup, timeout, protocol, identity, host-pressure and compiler failures fail immediately. Invalid samples never enter statistics. Accepted warmups still need clean raw evidence and the unchanged sampler contract.

The first warmup keeps its historical `warmup-{kind}.ndjson` name; retries use distinct `warmup-{kind}-attempt-2.ndjson` / `-attempt-3.ndjson` names. Every outcome is checkpointed with its original raw hash. Failed publications preserve bounded, allowlisted telemetry and the stage/last failed attempt rather than deleting it. Caches are excluded. Structurally untrusted staging remains unpublished, with a sanitized `rawRetention: unpublished-stage` receipt; no unknown bytes are uploaded by this path. Failure publications cannot satisfy the success validator.

New reports use schema 5 to explicitly bind warmup retries and accepted raw paths. Schema 4 remains readable without rewriting frozen evidence. The validator verifies complete warmup ordering, rejected raw evidence, hashes and shared invalid counts. Pins, 10ms cadence, 60ms gap, 80% host-pressure limit, 2 retries, 3 invalid runs/compiler, sample/noise extension counts, performance thresholds and fail-closed CI gates remain unchanged. CI wiring and native sampler are unchanged.

## Verification

Execution from `apps/web` used `PATH=/opt/homebrew/opt/node@24/bin:$PATH` (Node v24.21.0, darwin-arm64) and Bun 1.4.0. All commands and actual receipts are in `verification.json`.

```sh
bun test tests-unit/typecheck-benchmark-source.test.ts tests-unit/typecheck-benchmark-fixtures.test.ts tests-unit/typescript-toolchain-source.test.ts tests-unit/typescript-toolchain-command.test.ts
node node_modules/eslint/bin/eslint.js scripts/measure-typecheck.mjs scripts/verify-typecheck-benchmark-report.mjs tests-unit/typecheck-benchmark-source.test.ts --max-warnings=0
node --check scripts/measure-typecheck.mjs
node --check scripts/verify-typecheck-benchmark-report.mjs
node scripts/run-typecheck.mjs --compiler parity
```

- Unit result: 51 passed, 0 failed, 1,516 expectations across 4 files. Added behavior cases cover checkpoint-before-retry, raw byte/hash preservation, exhaustion, shared invalid cap, immediate setup failure, non-retryable failures, schema 5 readback, rejection of forged ordering/count/cadence claims, failed-artifact publication and safe rejection of unknown staging bytes. Synthetic fixtures are tests, not claimed native Windows benchmark artifacts.
- Targeted ESLint, both Node syntax checks and `git diff --check` passed.
- Local parity: 0 diagnostics / 2,379 logical inputs. This is separate from the actual Windows/parent 2,449-input result. Local generated-input inventory differs; neither local result nor macOS fixtures establish native Windows execution.
- Frozen schema 4 compatibility: downloaded existing Windows npm artifact 11306119367 from the same CI run, verified ZIP digest `b29d30fdc428cd1177f9d44c5e9b5797761e33486e3348832b3d93641863867c`, retained its 19 original files without modification, and ran the modified validator. Exit 0, evidenceStatus conclusive, admittedSlices 2. This validates only the historical Windows npm evidence; it is not fresh Windows Bun proof. See `frozen-readback.json` for the exact command.

Separate setup failure: `node scripts/verify-typescript-toolchain.mjs` returned `TOOLCHAIN_RECEIPT_PATH_INVALID` because the existing `apps/web/node_modules` symlink resolves outside this APP_ROOT. The exact versions are present and parity executes, but the stricter provenance receipt check fails. The shared symlink/dependencies were preserved, no install or global toolchain changes were made. Available Node-24 npm is 11.19.0, so no release npm-authority command was claimed; release pin 11.6.2 is unchanged.

Configured local session metadata: model `gpt-6-astra`, reasoning effort `xhigh`, read from current local turn_context. This is configuration evidence, not server attestation. See `runtime-and-setup.json`.

## Parent integration and remaining readback

Integrate the three-file patch on the parent-owned delivery path, preserving all other work. On a new clean integrated revision, obtain a fresh required GHA Windows Bun run using the existing pinned workflow. Read back the producer exit, complete schema 5 report, all attempt/raw hashes, schema 5 validator exit and final mandatory gate. If cadence remains over budget through bounded attempts, keep the failure closed and inspect the newly retained raw/last-attempt evidence to diagnose the actual native scheduling/collector/writer cause. A failed warmup must not be marked passed merely because retry support exists.

Confirm the fresh run's compiler pins, zero diagnostics and actual logical-input count rather than reusing local counts. Preserve historical artifact IDs/digests and old raw bytes. Linux/macOS or the old Windows npm readback do not satisfy this outstanding Windows Bun requirement. Parent owns protected delivery; this agent spent only read-only GitHub operations.
