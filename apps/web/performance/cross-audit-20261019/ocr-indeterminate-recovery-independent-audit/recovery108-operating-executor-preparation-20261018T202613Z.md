# Recovery 108 operating-executor preparation (provisional)

## Status and scope

This is a read-only implementation preparation note. It does not validate the Recovery 108 direction, change a launch hold, modify a workflow, execute SQL, inspect or mutate hosted state, change Git, deploy, or create a new approval policy. The 108 source was still changing after the catalog-integrity P1, so the operating executor must not be implemented or enabled from these provisional pins alone.

The concrete gap is real: `.github/workflows/review-media-sql-successor.yml` executes the legacy `86 -> 97 -> 102` path. The available source compilers describe the replacement `89 -> 100 -> 105 -> 106 -> 107 -> 108` path, but there is no operating controller or workflow path that rehearses and applies that complete chain.

## Read-only source snapshot

Observed at `2026-10-18T20:26:13Z`:

| Artifact | SHA-256 |
| --- | --- |
| `.github/workflows/review-media-sql-successor.yml` | `98d77342a8dac80729bf03e2d9fe0b826d1417c106836947558c73045e5f945b` |
| `apps/web/scripts/review-media-operating-orchestrator.mjs` | `fd34ebef0f798c5e1720c72975bf043bffee2d40d56a05558b9f00cced6d369a` |
| `apps/web/scripts/review-media-operating-capture.mjs` | `e534864bcefd2b22a4adcd0241ac080cffaa54b5ebc1b7da013d61b9bf675b66` |
| `apps/web/scripts/review-media-operating-admission.mjs` | `b518811cd6f53aaaa52ffba38b21258ebe79d3feb8d45798a70330478764f887` |
| `apps/web/scripts/review-media-feature-sql-successor.mjs` | `8b34863fd9f9355c0534796162320fcd4ab1921b7c038dc0596de146b49be192` |
| `apps/web/scripts/review-media-evidence-prefixed-sql-successors.mjs` | `d76e45f0d3284d47a32231495409843b640f8107969ebf23814498f277827d3d` |
| `apps/web/scripts/receipt-ocr-post105-sql-successor.mjs` | `4ba7e8b5c12e212809acf6d3c5fdaed4cf58ac70a1c663c25fb7db0bc979ebda` |
| `apps/web/scripts/receipt-ocr-post106-acl-admission-sql-successor.mjs` | `5dd0c66725e14ee9584dd162dccda4419c304ddbda6f3f28b1e645b7aa686b21` |
| `apps/web/scripts/receipt-ocr-recovery108-sql-successor.mjs` | `5a9154f51cfe19f25007ce1737eee969faa32c166698b977884218c370ad20f8` |
| evidence-prefixed predecessor manifest | `a48f4d883db91a2b4f44869476c9fe9e4f329468c1e406e3703823ffef1d6f92` |
| evidence-prefixed feature manifest | `45b7f146f31bca9afb863152fd616529e90562fb1b3ecbaa409c218439d41867` |
| post-105 manifest | `ecc1d0678210f4ac06fe47fc4b62cfdd0694511aacc18ab20978d3e83d82af81` |
| post-106 ACL manifest | `58adb514cbdf4221952b9bddfc75dead6a91f74d6fedc0d39445983c542e9b5a` |
| Recovery 108 manifest | `22b7f13a11800cffec67a96b834d10600f7b318c0c9e147e0cdbe5dc15b325a6` |

These are observation pins, not release pins. A final executor change must use the later independently audited source freeze.

## Existing contracts to preserve exactly

### Protected source and production rollback/readback

The existing workflow already requires an authenticated repository-owner `workflow_dispatch`, repository `twoimo/tzudong`, protected `refs/heads/main`, exact input/GitHub/checkout SHA equality, detached clean checkout, and an exact apply confirmation (`.github/workflows/review-media-sql-successor.yml:50-112`). These conditions should be reused unchanged.

The existing private Vercel adapter restricts reads to the pinned Tzudong team/project, checks the production deployment and both `tzudong.app` aliases, and requires the deployment Git SHA/ref/repository to equal the operating source (`review-media-sql-successor.yml:204-312`). The local operating bundle also binds protected main, current production deployment, runtime policy, source SHA, and a fixed 15-minute window (`review-media-operating-orchestrator.mjs:654-724`). This remains the named rollback/readback contract; no second approval or reviewer is added.

### Hold and launch admission

All five replacement manifests currently have `launchPolicy.state = held` and the same seven writer-fence requirements. The existing functions are the launch gates:

- `assertEvidencePrefixedLaunchReady(record)` for both evidence-prefixed phases;
- `assertPost105LaunchReady(record)`;
- `assertPost106AclLaunchReady(record)`;
- `assertRecovery108LaunchReady(record)`.

The aggregate executor must call all five before any write. It must not treat compiler success, local PG success, or this note as launch readiness. The current source-only loaders reject any state other than `held`; the minimum enabling change is to permit the existing `held|ready` states in their manifest validators while keeping the `assert*LaunchReady` functions fail-closed. The eventual held-to-ready change still occurs only in the exact protected-main manifests after the outstanding audit and database evidence; no additional virtual gate is introduced.

### Fresh writer fences and serialized custody

`review-media-operating-orchestrator.mjs:745-797` binds the owner dispatch and the four operator custody fences (`browserRpc`, `dashboard`, `directSql`, `providerIngress`). Lines 827-856 require zero in-flight writers under the exact four-relation `SHARE`-lock coverage. Lines 859-873 require exactly these seven manifest fences:

- `adminRecordMutationsHold = active`;
- `g037WriteFreeze = active`;
- `automaticReviewer = stopped`;
- `browserRpc = stopped`;
- `dashboard = stopped`;
- `directSql = stopped`;
- `providerIngress = stopped`.

The orchestrator captures them before rehearsal and recaptures them before apply (`review-media-operating-orchestrator.mjs:1208-1216,1286-1329`). It requires the durable runtime hold and four operator receipts to be unchanged, and writes a fresh quiescence receipt for apply. The Recovery 108 path should use this dependency-injected orchestrator rather than implement another fence scheme.

The workflow's private serialized runner holds `pg_advisory_xact_lock(hashtextextended('tzudong:review-media-sql-successor:workflow:v1', 0))` across the operating command and has bounded lock/idle timeouts (`review-media-sql-successor.yml:444-508`). Keep this outer serializer. The stage lock keys are already strictly increasing in chain order: `7311754282260311`, `...312`, `...313`, `...314`, `...318`; do not acquire them in another order.

### Fifteen-minute rollback rehearsal

The operating bundle window is exactly 15 minutes (`review-media-operating-orchestrator.mjs:71,378-394`). The feature executor demonstrates the required rollback shape: validate protected source and current production rollback, read the exact baseline, execute all expected states inside one transaction, issue `ROLLBACK`, reread the baseline, require exact equality, and bind journal/receipt hashes before preparing apply (`review-media-feature-sql-successor.mjs:1156-1296,1304-1371`). Its expiry guards arm `transaction_timeout` from the admission expiry and recheck before rollback/commit (`review-media-feature-sql-successor.mjs:1058-1123,1442-1479`). Reuse these conditions and timings.

## Existing compiler reuse points

### `89 -> 100 -> 105`

Use:

- `loadEvidencePrefixedSuccessorManifest('predecessor')` and `('feature')`;
- `buildEvidencePrefixedSuccessorStateQuery(record)`;
- `validateEvidencePrefixedStageStates(stages, record, { mode: 'operating' })`;
- `compileEvidencePrefixedApplyPlan(record, admission)`.

The compiler already binds the base mapping, evidence prefix, historical variant, target manifest source hashes, every ledger stage root, and terminal roots. Do not execute the old workflow's `86 -> 97 -> 102` compilers before or alongside this path.

One small compiler addition is needed: export a canonical expected-operating-stage generator, or an equivalent transaction-body API, so the controller can compile future stage readbacks without fabricating admission JSON. `compileEvidencePrefixedRehearsalAggregatePlan` uses rehearsal identities and is not by itself a live `89` rollback rehearsal.

### `105 -> 106 -> 107 -> 108`

Use:

- `loadRecovery108HeldManifest()` as the recursive root; it loads and verifies the 107 manifest, which loads the 105/106 compiler and the evidence-prefixed 105 predecessor;
- `compilePost106AclOperatingPlan(record.predecessorRecord)`, whose `basePlan` is the 105-to-106 plan and whose SQL applies 105-to-107 in one explicit transaction;
- `compileRecovery108OperatingPlan(record)`, whose `predecessorPlan` is that same verified 105-to-107 plan and whose own SQL applies 108 only after the exact 107 prior readback;
- `validatePost106AclTerminalState(...)` and `validateRecovery108TerminalState(...)` for exact terminal checks.

The current public compiler outputs contain embedded transaction boundaries. A live aggregate rollback rehearsal cannot safely concatenate them. The minimal compiler work is to expose transaction-body forms for the already-compiled operating plans, retaining the same prior/terminal readback assertions and advisory locks. Do not strip `BEGIN`/`COMMIT` with text replacement.

## Minimal implementation shape

1. Add one cohesive controller, for example `apps/web/scripts/receipt-ocr-recovery108-operating-successor.mjs`. It should adapt `loadRecovery108HeldManifest()` to the existing operating orchestrator, using the recursively verified root manifest SHA as the source-root identity. A new launch policy is unnecessary; the five existing launch policies remain authoritative.
2. Reuse `review-media-operating-orchestrator.mjs` through its existing dependency injection (`loadManifestImpl`, prepare/run rehearsal, prepare/run apply). A thin CLI wrapper can call its exported `main(argv, dependencies)` for both `capture-vercel` and `operate`; no duplicate Vercel, owner, fence, custody, or quiescence implementation is needed.
3. Add target-specific private admission/journal/receipt handling in the new controller. Bind the protected source SHA, recursive root manifest SHA, exact stage roots, rollback readback, writer-fence receipt hashes, rehearsal receipt, and the existing 15-minute expiry. Follow the exclusive-file and canonical-hash pattern from `review-media-feature-sql-successor.mjs`.
4. Add the small transaction-body/expected-stage exports described above. Compile one rollback-only rehearsal transaction in this exact order: `89 -> 100`, `100 -> 105`, `105 -> 106 -> 107`, then `107 -> 108`; read back every boundary; issue `ROLLBACK`; and prove the post-rollback state equals the original 89-row baseline byte-for-byte after canonical JSON normalization.
5. Compile apply from the same admitted plan and stage roots. Prefer one outer transaction with the same ordered stage locks, exact boundary readbacks, an expiry check immediately before commit, and a final 108 readback. This removes partial committed prefixes while preserving the compiler's “108 only after verified 107” rule. If PostgreSQL evidence shows one outer transaction is incompatible, retain the existing transaction boundaries and report exact partial terminal state; do not silently retry a partially committed chain.
6. Extend the existing workflow with a bounded target choice and exact script allowlist instead of creating a second owner/rollback/fence implementation. Preserve the existing target as its own unchanged path. The Recovery 108 target invokes only the new controller and must never fall through to the hard-coded legacy `apply-chain` at workflow lines 423-441.
7. Extend the existing workflow contract tests and add one target-specific controller test file. Do not weaken or delete the legacy workflow tests.

This is the smallest cohesive change: one controller, small compiler exports, one bounded workflow branch, and focused tests. It reuses the current authority and evidence pipeline and avoids a parallel approval system.

## Required verification before any apply

### Source/unit contract

- Recursive manifest/toolchain/source drift at every 89/100/105/106/107/108 edge fails before database access.
- Any constituent `launchPolicy = held` fails before database access; only all existing states `ready` admit apply.
- A bundle captured for the legacy target cannot be used for Recovery 108, and vice versa.
- Expired, future, over-15-minute, source-mismatched, protected-main-mismatched, production-deployment-mismatched, alias-mismatched, or changed-fence input fails closed.
- The exact stage order and ascending lock order are asserted.
- Apply always consumes the successful rehearsal receipt from the same window, source, manifest root, rollback deployment, and writer-fence evidence.

### Actual PostgreSQL 17 rehearsal

- Start from the exact hosted 89-row ledger identity and expected runtime objects.
- Execute the complete live-identity transaction through the 108 terminal state, observe each exact boundary, roll it back, and prove the full baseline state is restored.
- Repeat negative cases for one wrong ledger row/vector/root, one runtime-object mismatch, one stale fence, one expired admission, one boundary readback mismatch, and a forced statement failure; each must leave the baseline unchanged.
- After the final audited source freeze, repeat the catalog-integrity body/trigger/FK negative regressions from `catalog-integrity-counterexample-20261018T202159Z.md`.

### Protected workflow and production readback

- Run `observe` and `rehearse` first from the exact protected-main SHA.
- Confirm the workflow's live Vercel readback still resolves the exact production deployment and both production aliases to that SHA.
- Only after the external audit, source freeze, PG17 rehearsal receipts, required CI, and existing launch policies are ready may the already-authorized `apply` path run.
- After apply, require the 108 ledger/root/capability readback from the database and the unchanged production deployment/alias readback. A GitHub success status alone is not this evidence.

## Remaining boundaries

- Recovery 108 catalog-integrity remediation and its final source pins were still in progress; this note does not audit the later source.
- No complete-chain transaction has been compiled or run against PostgreSQL.
- No workflow syntax/action run, protected-main promotion, production readback, hosted DB mutation, or deployment occurred.
- The proposed single outer apply transaction is provisional until actual PG17 rehearsal proves compatibility and timeout headroom. It is not a validated release direction.
