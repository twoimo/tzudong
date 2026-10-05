# PR2892 / PR2887 exact CI action reconciliation

Reference checkout: `/Users/twoimo/.codex/worktrees/promotion-sync-20261004/tzudong`, branch `codex/historical-quality-20261004`, HEAD `7a430454cf90a4d9f1ba0ce35ad3ffd5022ceebd`. PR3114 returned that same source head. No remote-main or deployment claim is made.

| PR | Exact historical head | Historical parent | Intent and verdict |
| --- | --- | --- | --- |
| 2892 | `b5fca0502d99809e4f300c054c7ec8b30c46cf2d` | `e777691191ae21eaed611a8c8d24b80ca68b7419` | Still needed at start; fulfilled in the local working patch by replacing the Helm setup action SHA with `9bc31f4ebc9c6b171d7bfbaa5d006ae7abdb4310`, exactly as the historical PR. |
| 2887 | `3a10ae6e8004c1f1488861b3f7c118653e62f0da` | `e777691191ae21eaed611a8c8d24b80ca68b7419` | Still needed at start; fulfilled in the local working patch by replacing the OpenTofu setup action SHA with `a1320f892987e89d278cc92dc5adc984fb93aca4`, exactly as the historical PR. |

Both original PRs each change one `uses` line in `.github/workflows/security-audit.yml`, inside `orchestration-readiness`. Local Git parent-to-head hunks match the read-only GitHub PR diff hunks. This is a per-intent equivalence conclusion, not a patch-count heuristic.

The current caller at lines 288-298 uses Helm `v4.2.4`, OpenTofu `1.12.6`, and `tofu_wrapper: false`, then runs `check_crawler_orchestration_readiness.py --run-tests --json`. The upstream immutable action manifests retain those inputs and use Node24. Read-only GitHub API tag resolution confirmed both exact hashes. The existing job uses GitHub-hosted `ubuntu-latest`; actual runner execution is not claimed.

Upstream primary evidence: [Helm action](https://github.com/Azure/setup-helm/blob/9bc31f4ebc9c6b171d7bfbaa5d006ae7abdb4310/action.yml), [OpenTofu action](https://github.com/opentofu/setup-opentofu/blob/a1320f892987e89d278cc92dc5adc984fb93aca4/action.yml). Sanitized local copies and tag resolutions are retained here.

Only `.github/workflows/security-audit.yml` changed in this subtask. Parsed YAML equality after normalizing the two SHA fields proves that job definitions, permissions, event paths, scanner commands, version inputs, workflow gates, and timeouts are unchanged. The patch retains the exact requested versions rather than upgrading to unrelated newer tags.

Validation: `bun test apps/web/tests-unit/security-workflow-source.test.ts` passed 3 tests / 128 assertions. The two targeted supply-chain tests in `validation.json` passed. `git diff --check -- .github/workflows/security-audit.yml` passed. No new repository tests were needed for this two-line change. `actionlint` is unavailable; YAML was parsed with installed PyYAML 6.0.3. No full suite, build, Naver measurement, hosted CI dispatch or mutation ran.

Reproduce from the reference checkout:

```sh
git show --no-patch --format='%H %P %s' b5fca0502d99809e4f300c054c7ec8b30c46cf2d 3a10ae6e8004c1f1488861b3f7c118653e62f0da
git diff e777691191ae21eaed611a8c8d24b80ca68b7419 b5fca0502d99809e4f300c054c7ec8b30c46cf2d -- .github/workflows/security-audit.yml
git diff e777691191ae21eaed611a8c8d24b80ca68b7419 3a10ae6e8004c1f1488861b3f7c118653e62f0da -- .github/workflows/security-audit.yml
bun test apps/web/tests-unit/security-workflow-source.test.ts
python3 -m unittest backend.utils.tests.test_supply_chain_contract.SupplyChainContractTests.test_security_audit_covers_only_exact_python_requirements backend.utils.tests.test_supply_chain_contract.SupplyChainContractTests.test_nullable_cas_migration_alone_triggers_its_real_postgres_suite -v
git diff --check -- .github/workflows/security-audit.yml
python3 /Users/twoimo/.codex/worktrees/marker-memory-lifetime-20261001/tzudong/apps/web/performance/repository-quality-20261004/agents/astra-historical/ci/validate-ci-pins.py
```

Parent integration must commit/push and run the hosted workflow. Existing PRs were read only and remain open at the captured readback. A separately observed existing supply-chain assertion hardcodes Next `16.3.5` while the current package manifest is `16.3.6`; that dependency-owner issue is outside this patch and was not changed or described as a test result.
