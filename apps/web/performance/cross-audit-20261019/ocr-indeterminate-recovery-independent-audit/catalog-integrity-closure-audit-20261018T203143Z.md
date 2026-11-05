# Recovery 108 catalog-integrity closure audit

## Scope and source identity

This is a narrow, independent, read-only delta audit of the catalog/seal correction requested after `catalog-integrity-counterexample-20261018T202159Z.md`. It compares the preserved pre-fix raw migration to the newly frozen candidate and reads the manifest, compiler, and ACL regression fixture. It does not execute PostgreSQL, run tests, alter source, mutate Git, or inspect hosted state.

Frozen candidate:

- raw migration SHA-256: `d3258b679cbf42ecd97edeab941a5bbaf30fa7b15d968081b60b8b600a3ecd1a`
- manifest SHA-256: `22b7f13a11800cffec67a96b834d10600f7b318c0c9e147e0cdbe5dc15b325a6`
- statement count: `83`
- statement-vector SHA-256: `3d0bfeb1229b194f818b95a1b4b1ba50609770a93afd8e3c67daabd513c0bd56`
- operating target root: `2c7b7fff113a68ad4b73a8ebb005296ddd1344de5fa09fcf828b905e4517bb1d`
- compiler SHA-256: `5a9154f51cfe19f25007ce1737eee969faa32c166698b977884218c370ad20f8`
- ACL/catalog drift fixture SHA-256: `76317420f3be8199fccfbf716ad024573dad324d6f906c3a811c70e4e28df66e`
- principal recovery fixture SHA-256: `095128056aa744abec6daf42d062cc2d2026673f18f7efb88855f580b47a4940`
- initial-default ACL fixture SHA-256: `01a712df0fa0de40c3b0760f52d51c8238bc0f4ecb5ebb8f53160eb1fa5a9e20`

Comparison source:

- preserved pre-fix raw migration SHA-256: `abc1cb12005e84ad49e40e04c35ab388289772938ba4ccc8882c58a6c61687ed`
- preserved path: `/Users/twoimo/.codex/runtime-cache/tzudong-resume-20261018/catalog-replay-108-fixed-20261018T201150Z/source-tree/backend/supabase/migrations/20261019130000_receipt_ocr_indeterminate_recovery.sql`

## Decision

**The prior catalog-integrity P1 is closed in source at the frozen hashes above. No new P1 was found in this delta.**

The new design stores actual catalog snapshots rather than semantic labels, recomputes them on every capability read, compares them by exact JSON equality, checks the full ledger identity, and retains an independent exact ACL predicate. The previously demonstrated same-owner body replacement, trigger disable, and lease-FK drift now make the capability fail closed.

This is source closure only. Actual PG15/17 parsing, install, hostile mutation, rollback, and restoration evidence is a separate gate owned by the database verification peers.

## Catalog snapshot coverage

### Functions

`backend/supabase/migrations/20261019130000_receipt_ocr_indeterminate_recovery.sql:1236-1309` builds a 17-function contract. Each entry binds:

- SHA-256 of `pg_get_functiondef`;
- language and volatility;
- `SECURITY DEFINER` state and `proconfig` including search path;
- owner;
- canonical sorted ACL entries including grant option.

The set includes all public/private preview, recovery, authorization, claim, claim-core, lease-release, photo-guard, capability, ACL-admission, and catalog-snapshot functions. Missing functions reduce the object count or produce a null aggregate and therefore cannot satisfy the getter's exact 17-entry checks.

### Tables, constraints, FKs, RLS, and policies

Migration lines 1311-1411 build a three-table contract for the operation receipt, execution lease, and catalog contract tables. Each entry binds:

- owner, relation kind, table ACL;
- RLS and force-RLS flags;
- ordered live columns with type, nullability, identity/generated flags, and default expression;
- named constraints with type and `pg_get_constraintdef` output;
- named policies with permissiveness, command, roles, `USING`, and `WITH CHECK` expressions.

The execution-lease `review_id ... ON DELETE RESTRICT` FK is therefore bound through the exact constraint definition. Dropping it or recreating it as `ON DELETE CASCADE` changes the snapshot. The operation identity, generation/CAS, policy/thinking/version binding columns, PK/unique constraints, and RLS policy remain included.

### Triggers

Migration lines 1413-1437 bind both critical triggers by relation and name, with:

- SHA-256 of `pg_get_triggerdef`;
- `tgenabled`;
- internal flag;
- trigger-function regprocedure.

The getter also independently requires both trigger rows and `tgenabled = 'O'` at lines 1554-1565. Missing, disabled, retargeted, or definition-drifted triggers cannot satisfy both the snapshot equality and explicit enabled check.

## Getter and independent ACL policy

`ocr_private.get_receipt_ocr_indeterminate_recovery_capability()` at migration lines 1450-1599:

1. requires the one catalog row and the migration ledger relation;
2. recomputes the catalog snapshot;
3. requires exact equality for all function, table, and trigger maps and exact counts `17/3/2`;
4. recomputes the complete migration-ledger count/root and compares it to the sealed `108` identity;
5. verifies the exact sealed migration statement vector exists;
6. checks both trigger enabled states, required public allowlist entries, and the independent `receipt_ocr_recovery_acl_admitted_v1()` result.

The ACL predicate at lines 1124-1234 remains a separate exact owner/ACL allowlist over the same 17 functions and three tables. This is useful defense in depth: a stored catalog ACL snapshot alone is not treated as the policy definition.

For normal object drift, the getter returns `held`. If a referenced base relation needed to resolve a regclass constant is itself removed, PostgreSQL may raise while evaluating the snapshot rather than return the bounded JSON. The application treats RPC errors as held, so execution remains fail closed; actual PG negative evidence should record whether each missing-object class returns `held` or raises.

## Seal order and predecessor-107 CAS rebind

The migration now creates all functions, wrappers, grants, allowlist rows, tables, policies, and triggers before inserting the unsealed snapshot at lines 1830-1845. It then verifies exactly one unsealed `17/3/2` row and proves the capability remains `held` before compiler sealing. This removes the previous declarative-row and early-seal gap.

The compiler's injected seal block at `apps/web/scripts/receipt-ocr-recovery108-sql-successor.mjs:284-346` runs only after the 108 ledger insertion and first recomputes the full 108 count/root. It then:

- updates exactly one existing 107 v2 contract only when version, name, statement count/vector, prior ledger count/root, non-null prior seal, and expected `5/2` snapshot cardinalities all match;
- binds that predecessor contract to ledger count `108` and the current target root;
- immediately requires the predecessor v2 capability to read back `ready`, so a fabricated or drifted predecessor snapshot causes the surrounding transaction to roll back;
- seals exactly one previously unsealed 108 row, requiring every seal field null and exact `17/3/2` cardinalities;
- writes the exact 108 migration identity, predecessor-107 identity, current 108 count/root, and seal time;
- immediately requires the 108 capability to read back `ready`.

The compiler terminal query independently requires the exact ledger count/root, the exact 108 statement vector, the exact predecessor v2 rebind, exact 108 seal metadata/cardinalities, predecessor capability ready, and 108 capability ready. The state query returns no admissible terminal row if the complete ledger identity differs.

The predecessor update initially filters on metadata/cardinality rather than full stored snapshot equality, but the immediate predecessor capability readback recomputes and equality-checks that snapshot. Because the update and readback are inside the same migration transaction, failure rolls the rebind and 108 install back together. This satisfies the required CAS behavior in source.

## Delta preservation of the original recovery protocol

A zero-context diff from `abc1cb12...` to `d3258b67...` has 13 hunks. They are limited to:

- catalog-contract ledger/root and trigger-contract columns/checks;
- removal of the old declarative insert;
- adding the catalog-snapshot helper to ACL/allowlist coverage;
- replacing the old existence-only capability getter with snapshot generation and equality checks;
- installing the actual unsealed catalog snapshot after final grants/allowlists;
- the unsealed held readback.

No hunk changes the operation receipt or execution lease table definitions, generation acquisition, authorization/claim/result logic, provider policy/thinking/version binding, photo/update guard behavior, lease lock/release behavior, idempotency keys, operation identity, row-lock order, or recovery action semantics. Those earlier contracts are byte-preserved relative to `abc1cb12...`.

## Regression fixture coverage

The bound ACL/catalog fixture contains rollback-only cases for:

- forbidden execute grant, grant option drift, and owner drift;
- same-signature authorize body drift;
- same-signature claim body drift;
- photo-guard body drift;
- both critical triggers disabled independently;
- execution-lease review FK removed;
- the FK recreated with `ON DELETE CASCADE`;
- exact ready restoration after every savepoint rollback.

The fixture confirms the intended counterexamples are encoded, but this audit did not execute it. Actual PG verification should additionally observe representative missing function/table/trigger cases and one policy/RLS or column/constraint drift case, since their fail-closed behavior is established here from the catalog query rather than this fixture's explicit cases.

## Remaining boundaries

- No PostgreSQL command or test was run by this auditor. Source and fixture presence are not PG15/17 evidence.
- A capability implemented inside PostgreSQL cannot defend against a trusted superuser deliberately replacing the snapshot verifier or getter with a function that lies. The current contract detects ordinary drift of those functions when the original verifier/getter runs; protection against a malicious database owner requires an external source/catalog attestor. This is a trust-boundary limitation, not a newly introduced recovery-protocol regression.
- Indexes not represented by constraints are not part of the table snapshot. The three protected tables' behavior-critical identity/FK/uniqueness requirements in this migration are constraint-backed; no delta removed them.
- The operating executor remains absent and held. `recovery108-operating-executor-preparation-20261018T202613Z.md` is only a provisional implementation note and is not release evidence.
