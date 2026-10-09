# CI diagnosis for `c90544c8`

Captured at `2026-10-09T10:44:25Z`. This is a read-only diagnosis of GitHub Actions runs `37917774396` and `37917774406`, plus one narrow correction to an unrelated failing source-contract test. No workflow rerun, hosted write, secret read, dependency update, commit, push, or PR comment was performed.

## Disposition

| Job | Concrete terminal cause | Attribution | Required correction |
| --- | --- | --- | --- |
| `generate` (`113778056807`) | The new migration aborts at `ADMIN_PRIVATE_CLEANUP_ACTION_METADATA_DRIFT` after the predecessor source hash and every replacement anchor pass. | Introduced by this batch: `20261009091342_admin_record_private_verification_cleanup.sql` is new in `c90544c8`. | Normalize function argument-default metadata semantically on the exact source-only Supabase/Postgres image, retain the source-body and all security metadata checks, and prove the clean replay before rerunning CI. |
| `npm-audit (apps/web)` (`113778057624`) | Locked `sharp@0.35.4` and `source-map-js@1.2.1` are now in high-severity advisory ranges. | Not introduced by this batch: the `package-lock.json` Git object is identical in `c90544c8` and its parent. | Update `sharp` to at least `0.35.5` and `source-map-js` to at least `1.2.2`; regenerate the release lock with npm `11.6.2`, reconcile `bun.lock`, and run required package checks. This dependency change was not applied here. |
| `orchestration-readiness` (`113778057816`) | `test_new_r4_index_name_is_not_created_by_a_prior_migration` treated a constraint-name reference in an exception allowlist as an earlier `CREATE INDEX`. | Existing false positive, newly surfaced by this run: neither the test nor the referenced migration changed in `c90544c8`. | Applied narrow test correction: detect an actual named `CREATE INDEX` statement rather than any occurrence of the name. The exact 22-module suite now passes all 213 tests. |

## 1. Catalog replay

Bounded failed-log evidence from run `37917774396`:

```text
verified 10 unauthorized ordered reconstruction source entries
G026 source-only empty-replay bundle verified
...
ERROR:  ADMIN_PRIVATE_CLEANUP_ACTION_METADATA_DRIFT
CONTEXT:  PL/pgSQL function inline_code_block line 89 at RAISE
Process completed with exit code 3.
```

The two earlier `No such image` messages are cache misses, not the terminal error: the log subsequently creates and starts the isolated database container and applies migrations until the SQL guard aborts.

The failing migration SHA-256 at `c90544c8` is `f58a41a339663e9c6aa79fc233573e0ad15d6f253f0afae62e30b67e8180a065`. Its action-function source hash check and six exact replacement-anchor checks precede the failing guard, so the failure is not an unrecognized predecessor body or missing replacement. The same guard compares all raw `pg_proc` fields except `prosrc` after reconstructing the function with `pg_get_functiondef`.

The snapshot function passes the same reconstruction pattern; the action function is the only one of the pair with four SQL argument defaults. The confirmed cause is the raw action-function catalog equality after `CREATE OR REPLACE`; `proargdefaults` is the high-confidence field-level inference from that difference, not a key name printed by the bounded CI log. A local PostgreSQL `17.11` probe using the exact predecessor function bodies and forward migration passes and yields the expected final action body hash `ab9c11c438e482bcdd1373ec3bb43a2abf579f535aad919a18a452930ec1912c`; the source-only CI reconstruction uses the pinned Supabase PostgreSQL 15 platform image and rejects the raw row equality.

The correction must keep the migration fail closed:

1. Snapshot `to_jsonb(p) - ARRAY['prosrc', 'proargdefaults']` and `pg_get_expr(p.proargdefaults, 0)` separately for both patched functions.
2. After `CREATE OR REPLACE`, require the normalized catalog JSON, semantic default expression, and exact patched `prosrc` to remain identical to their expected values.
3. Run `generate_g014_catalog_contract_baseline.sh` against the exact pinned source-only image and retain the generated hashes. Do not remove the metadata guard or accept the current failure as environment noise.

Before landing that normalization, one local diagnostic replay on the exact pinned image must emit only the changed `pg_proc` key names and confirm `proargdefaults` is the differing key. If it identifies another field, preserve that field and correct the reconstructed DDL instead of widening the exclusion.

The default Python test invocation did not cover this runtime path: `test_admin_record_private_verification_cleanup` ran one source assertion and skipped eight PostgreSQL tests without the owned-PG opt-in. That explains why the new migration reached CI despite its source-only replay incompatibility.

## 2. npm audit

Bounded failed-log evidence from run `37917774406`:

```text
sharp  <0.35.5
Severity: high
GHSA-wq5f-xc86-pv6w

source-map-js  1.0.0 - 1.2.1
Severity: high
GHSA-68fv-2mgg-jv7q

2 high severity vulnerabilities
Process completed with exit code 1.
```

`apps/web/package-lock.json` has Git object `d74afe2348aa40f47103c8b3faa025bfcaf78a10` in both `c90544c8` and its parent, and SHA-256 `e51df090f491484d0b6f60e749ff1ab0f2df59437d91151dfbb4eb18fca362eb`. The batch changed neither `package.json`, `package-lock.json`, nor `bun.lock`.

- `sharp@0.35.4` is direct and also selected for `next@16.3.8`. GitHub published the `sharp` advisory on `2026-10-06`; the first patched version is `0.35.5`.
- `source-map-js@1.2.1` is transitive through `@tailwindcss/node@4.3.3` and `postcss@8.5.28`. GitHub lists `1.2.2` as the first patched version; the advisory was updated on `2026-10-05`.

The exact dependency correction is to raise the direct `sharp` floor to `^0.35.5` and constrain `source-map-js` to `1.2.2` through the existing overrides policy, then regenerate `package-lock.json` with the repository-authoritative npm `11.6.2` and reconcile `bun.lock`. Required audit, install, typecheck, unit, and build checks remain mandatory. No audit waiver or dependency edit was made in this task.

## 3. Orchestration readiness

The CI wrapper intentionally emitted only a bounded report:

```json
{"blockerCodes":["tests_failed"],"testPlan":{"execution":{"exitCode":1,"testsRun":213}}}
```

Direct execution exposed the existing false positive:

```text
idx_restaurants_active_candidate_identity is already defined by prior migration(s)
['20261004190259_admin_record_guarded_actions.sql']
```

That earlier migration does not create the index. It only names it in the reviewed `unique_violation` constraint allowlist at line 590. The sole creation remains in `20260828000100_hosted_candidate_identity_unique.sql` as required. The failing test and the referenced earlier migration are byte-identical between `c90544c8` and its parent.

The narrow correction is in `backend/utils/tests/test_governance_boundaries.py`: `_CREATE_R4_INDEX_RE` now matches a real named `CREATE INDEX` statement, including the supported `UNIQUE`, `CONCURRENTLY`, `IF NOT EXISTS`, and optional `public.` forms. References in comments or exception allowlists no longer count as definitions.

Verification:

```text
python3 -m unittest backend.utils.tests.test_governance_boundaries -v
13 tests passed

uv run --isolated --no-project --python /opt/homebrew/bin/python3.11 \
  --with-requirements backend/test-requirements.txt python -c '<exact DEFAULT_TEST_MODULES runner>'
213 tests passed

python3 -m compileall -q backend/utils/tests/test_governance_boundaries.py
passed

git diff --check -- backend/utils/tests/test_governance_boundaries.py
passed
```

The corrected test SHA-256 is `9061715f12f30c9f1a5cd2032089ef7a1a9cdd53cef984282c98914ddd84b8bb`; the `c90544c8` preimage SHA-256 is `b8e79cbaa199044e113998ad5909778de4e1f6c39e53ff55e6010bc31f917c13`.

All three required jobs should be rerun only after the catalog migration and dependency corrections are present. The readiness correction alone does not make the PR mergeable.
