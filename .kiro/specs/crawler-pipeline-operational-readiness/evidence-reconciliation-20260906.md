# Retained evidence reconciliation — 2026-09-06

This documentation-only candidate starts from freshly fetched protected main `535ff5e27c2e7c27f385e862a824a58d0cc30b92`, tree `8e93abd2d3564b5d33609c05e751e4ccdd718005`. The evidence cutoff is 2026-09-06 06:11:13 UTC. No hosted mutation, deployment, push, credential change, freeze exit or fresh service verification is performed by this reconciliation. The parent owns DB diagnosis and subsequent operations; parallel RPC source work is outside this patch.

## Accounting and historical scope

The operational-readiness checklist contains **1,310 entries**. This patch reflects **11 demonstrably completed historical actions**, changing **1,270 checked / 40 open** to **1,281 checked / 29 open**. This is not full Kiro completion. The separate orchestration checklist remains **71/71**; its retained 208-test result binds `eddef9a456ce0225c27cc203b9c434624234ee3f`, not this documentation commit.

The earlier external `closure-reconciliation-at-a8129e26.md` reports proposed 1,280/30 accounting. That proposal was not reflected in base main's actual checkboxes. Its 50-row ledger and scheduler observations are historical. This document corrects accounting from the actual fresh source and preserves that immutable report. A checkbox here indexes a completed historical action; it is not independent evidence, current release readiness, reusable approval or authorization to replay an operation.

| Tasks reflected | Proven scope | Evidence IDs |
| --- | --- | --- |
| 7.168, 7.395, 14.15 | Protected develop → data → main PRs 2865–2867, ending at `047ae53da5d45383a96cfd7ad1c2d69fb84a11c8`; identical source tree and normal merge parents retained | promotion-develop, promotion-data, promotion-main |
| 7.169, 7.195, 7.365, 7.396 | Exact-main one-run authorization, dedicated-role/secret metadata and actual run 33952539659. Source validation was valid; the expected runtime probe result was authorization-denied. This closes only admission/selected probe tasks, not mutation execution or recovery | probe-authorization, probe-readback, dedicated-role |
| 7.80 | One actual additive advisor apply on approved main `ac07c3779ce50a4ab17a18f9e69a6a66a189eb6c`; independent committed readback: 50 → 51 ledger rows, 26 function paths fixed, four constraints validated, G014 passed, unrelated ACL/catalog/role state preserved; official mutable-path warnings 26 → 0, 34 other notices remain | advisor-audit |
| 14.17, 14.62, 14.84 | Existing authorized web release `5af1e1f6ac81a483e1e8aed2b05237ca0f62ce6a`, exact project `prj_sau35J5uUtShIQ9OKofRtOVVnTSl`, deployment `dpl_CpqD2F8weF6vDLUG2AgSfrruMbZa`; READY, target, aliases, timestamps, actor, protected PRs/rollback, post-alias health and public-page rendering retained; DNS unchanged | web-completion, web-actor |

The nested deployment and advisor artifact bindings (35 files) were independently hashed from disk during this reconciliation. Full-file hashes below differ from any embedded canonical-payload digest. Raw receipts remain outside the repository. Hash agreement establishes retained-file integrity; it does not independently authenticate an operator or prove facts beyond the recorded operation.

## DB and production boundaries

The new admin-ID RPC source reached protected main through PRs 2884–2886. Its B9 rehearsal exited unsuccessfully without a success receipt. A separate post-failure snapshot at 05:54:05 UTC matched the pre-attempt snapshot exactly, SHA-256 `18b4ec8e2180789f8b6d90fe43f1218e81be4ed4ea69379bd46b9022d40139e2`, retaining 51 ledger rows. The RPC was absent in the retained diagnostic readback; apply was not admitted. The subsequent server-log lookup returned HTTP 403, so the SQL/transport root cause was not established at this cutoff. Do not retry the spent operation or infer a successful RPC apply from source promotion or private fixture tests.

Task **7.81 remains open conservatively**: the advisor apply/readback/audit receipt and before/after generated-type equality are available, but full hosted/source RPC/type reconciliation remains incomplete. The generated canonical types are 199,749 bytes, SHA-256 `26e74351720389ad2dec32a4c80a59a741296f9538be2de1c13b4ff3b72bab47`; no source types were overwritten. Do not present this equality as whole-catalog parity or close 7.15/7.38. The current 51-row ledger, historical G037 41-row terminal and 29-entry target manifest are different scopes.

Retained 05:35 UTC domain health identifies the existing `5af1e1f6` deployment above. The Vercel project target's different ID `dpl_9Hw63yPiPng2QmM15CzUz3u2xfmf` was CANCELED with no assigned alias, not a replacement serving deployment. No new web deployment is established by the backend-only source promotion. Public HTTP 200 checks prove deployment identity, not authenticated DB features. Producer freeze remains active in retained receipts.

## All remaining open items

| Tasks | Status and missing evidence |
| --- | --- |
| 5.5, 5.6 | Scheduled run 33991530487 was created at 05:55:36 KST, outside 04:00-04:45, and skipped. Mac held marker proves no producer execution; no real sleep/wake coalescing proof. |
| 7.15, 7.37, 7.38, 7.81 | The advisor operation is committed, with unchanged before/after generated types. This does not reconcile source types and the entire hosted catalog or establish all G037 read-only modes. The admin-ID rehearsal has no success receipt and its separate readback remains at ledger 51; no RPC apply admitted. |
| 7.94, 7.95, 7.96 | Deferred leaked-password protection requires a superseding named-owner decision, plan eligibility, actual activation and independent readback. |
| 8.12 | Latest retained Drive run failed REMOTE_AUTH_FAILED. Existing 246 remote-byte verifications stand; 192095 manifest rows are not unique files or all-version completion. Valid automation authentication and duplicate/version/size reconciliation remain. |
| 10.13, 10.14 | Three approved live Rust parity receipts and subsequent explicit shim-retirement approval are absent. |
| 11.7, 11.8, 11.9, 11.10, 11.12, 11.32, 11.33, 11.34, 11.35 | A custody map and local compiler observations exist, but the map is not a scoring map. Required real frozen baseline/candidate cohorts, health/manifest/raw/scored/validator artifacts and measurement windows are incomplete. Neither improvement nor valid zero admission is established. |
| 14.18 | User explicitly reported no retention/legal/location documents. Named policy, retention, provider, location, applicable guardian/incident and Korean legal/privacy receipts remain required; authorization is not a substitute. |
| 14.48, 14.50, 14.51 | Historical G037/G038 execution/recovery is not established by current ledger 51 or a denied read-only probe. Freeze remains active; controlled freeze exit and a non-expired exact-protected-commit Closure readback remain unproven. |
| 14.103, 14.106 | Named security/operations decisions and registrar/Cloudflare ownership evidence remain missing. No DNS or security settings changed. |
| 16.100, 16.151 | Queue flag remains disabled; later bound approval/publication and P5 owner/commit-bound phase evidence remain external gates. |

The performance custody map verifies 13 artifact entries and two source CLI pins, but explicitly has `scoringMap: false`, `improvementEstablished: false` and `zeroAdmissionEstablished: false`. Compiler/build observations and an incomplete map do not close application-performance tasks, including 11.10/11.34. No fabricated zero-admission result is recorded.

The user reported that retention, legal and location documents are unavailable. These remain missing evidence, not refusal of technical authorization. No retention periods, legal basis, filing, notification receipt, backup/PITR restoration, provider verification or paid-plan eligibility is invented. Phase gates and DNS ownership decisions remain external. These open groups include feasible technical work and evidence collection, not just human approval blockers.

## Retained evidence file index

Resolve each root from the table below, then append the relative path. The machine-readable companion `evidence-reconciliation-20260906.json` exhaustively maps the original 40 open IDs into 11 historical completions and 29 remaining IDs. It contains only bounded file references, hashes and scope statements.

| Root | External directory |
| --- | --- |
| B5 | `/Users/twoimo/.codex/artifacts/tzudong-kiro-closure-20260905` |
| B6 | `/Users/twoimo/.codex/artifacts/tzudong-kiro-db-completion-20260906` |
| B9 | `/Users/twoimo/.codex/artifacts/tzudong-admin-rpc-apply-v3-20260906` |

| Evidence ID | Root / relative path | File SHA-256 |
| --- | --- | --- |
| promotion-develop | B5 / `pr-2865-merge-readback.json` | `d5fadd8ef2bdb54cb320fb439dc3b5be3f3ba8d73e0448ee7910697aa5019ed6` |
| promotion-data | B5 / `pr-2866-merge-readback.json` | `80993eb81e52bcc82d53d7ec5a886899593a478b4baeddaad50ea09a475487d9` |
| promotion-main | B5 / `pr-2867-merge-readback.json` | `b8532bebdb5e2a54925d783556ec2d7ec1ab823bc50df5f8e96ebee1aed405bc` |
| probe-authorization | B5 / `g037-runtime-probe-exact-main-authorization.v2.json` | `e3af85d9c1d1ce9c5862e64e2abbf02c5c40b639ea4c50a6a431791752be2601` |
| probe-readback | B5 / `g037-runtime-probe-run-readback.v2.json` | `6d70aa9b909d1dc497d2498c8b6ecd9cb683fe629fde103fc34dbe27d4eca67d` |
| dedicated-role | B5 / `g037-dedicated-credential-current.json` | `1607b04beeb92f28daeddc06babcc930f7e1faaa64871b4e29685a9a56d40a5b` |
| web-completion | B5 / `production-deployment-complete-5af1e1f6.json` | `acb2343ca7b7770094f27247c6df00269fc0f44c39be562ec4a1d4f57ca0a48e` |
| web-actor | B6 / `production-deployment-actor-readback.json` | `a3c1d49933a32731be1f7e24e8cb8768c5b385a4858aaad044d3e653d0ff04bb` |
| advisor-audit | B6 / `advisor-committed-audit-v3.json` | `9afa9fcd81a274613f43babc35bebd7eddfb05a6164254b6880d8ca41b9ef81a` |
| types-comparison | B6 / `hosted-types-comparison-after-advisor.json` | `f619c8019ef0f0fa980587cf09eefa14c76322f1cb5fd2dbdeba3d3f8209f0e5` |
| current-main | B6 / `pr-2886-merge-readback.json` | `b31027dffceff8bebda3c1f9312974a3419b7cf6755932cdb7aa6bc97ccafee2` |
| rehearsal-failure | B9 / `rehearse-outcome.json` | `0a5e93feb9bb5cfcbe5271f12374ace424bb2074bc64dd949d2055154f26b40f` |
| rehearsal-restored | B9 / `failed-rehearsal-independent-snapshot.json` | `851910e255bbbd0c3c4ed9ef9091870bc7292cacc53bb1c7cedbca7d14a7d695` |
| diagnostic-denied | B9 / `post-failure-diagnostic-status.json` | `54e98ba0c7e32b8431b08b7c426faaa363d0ac433d8c336837ea1c9a02d17ac9` |
| schedule | B6 / `schedule-cadence-assessment-33991530487.json` | `256a4113517afc2d808976a8fe07f9f991e54bc4e65f54a6e6df5b2e12113379` |
| mac-held | B6 / `natural-schedule-held-readback-20260906.json` | `1d6d4596f084ac3e4141e7efb40bab3dc1dcee279e0ca72c974e407258e1122d` |
| performance | B6 / `performance-custody-parent-readback.json` | `6127d2ef7127a9895c8078a95543fa5d79201405a92aa31c22d64ba56c994b1d` |
| orchestration | B6 / `orchestration-current-main-20260906.json` | `3013fad23be7a7219c11c67b4aacefaaf535e956fed3c595cff9ef9f63f9cb14` |
| backend-checks | B6 / `backend-canonical-checks-current-main.json` | `d60d41e6c9012abd35e966a45e37865588fcbd637db4f4c2ef3723c2b27175e0` |
| drive-diagnostics | B6 / `gdrive-inventory-diagnostics-readback/summary.json` | `6e7ef0b8dd97b1fc2bf55814ed992e2719212fac5422638d176046049fe59cc1` |
| web-health | B6 / `production-health-admin-rpc-before-apply.json` | `2b1adb0598a0dc47d1bf3e9b464982a7a8bf88abf9ee844376a1ff7aa14d1167` |
| web-canceled-target | B9 / `vercel-target-deployment-readback.json` | `a8ad43cf57d62dc735d9519a22cd0152dbdaa2adcd35bfd0929c75f27a23a5c0` |

## Documentation validation

The reconciliation check compared base and candidate task IDs and markers: all 1,310 IDs were preserved, exactly the 11 mapped historical IDs changed from open to checked, and the 29 remaining IDs match the inventory without duplicates or omissions. All 22 directly indexed file hashes and all 35 nested deployment/advisor artifact hashes matched retained bytes. The separate 71-item orchestration checklist was unchanged. `git diff --check` passed. No application tests were rerun for this documentation-only change; earlier test evidence retains its original source binding.
