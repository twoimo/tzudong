# Three admin RPC catalog successor (source preparation only)

This candidate groups the remaining August003 admin RPCs into one additive current52 → 53 successor. It does not apply the advisor or first admin-IDs RPC again. **Execution remains blocked:** `CURRENT52_SNAPSHOT_SHA256 = None` in `admin_management_group_plan.py` deliberately prevents preview, rehearsal, apply, and readback plan generation until the parent retains and reviews the actual committed current52 snapshot. There is no command-line bypass or blind-pin option. Unit tests substitute an explicitly labeled private fixture pin only.

The authorized manual advisor/admin catalog exception preserves `G037_WRITE_FREEZE`; producer writes stay frozen, and execution must not overlap any G037/G038 controller window. This is a current-state successor, not historical G037 exact29/41 closure, source-local migration approval, or a freeze-exit claim. Missing `restaurants_backup` satisfies its retirement requirement; the historical G037 ledger mismatch remains unchanged.

## Immutable inputs and persistent change

Base commit: `0ebb898c708dd2c966fd72dd43172a0cf843cf93`, tree `8e93abd2d3564b5d33609c05e751e4ccdd718005`.

The filename `20260906053936_admin_management_group_catalog_slice.sql` was generated with `npm exec --yes --package=supabase@2.115.0 -- supabase migration new admin_management_group_catalog_slice` from `backend`. Its two canonical parser statements are one atomic DO block and one transactional PostgREST notification. The planner pins migration bytes, the canonical parser, and the August source file. It appends the exact version, name, and actual two-statement vector inside the enclosing transaction; it does not use timestamp-generating `apply_migration` or rewrite historical empty vectors.

Only three functions and three matching `service_role` allowlist tuples persist. Bodies are byte-identical to `20260812000300_local_admin_data_boundary_convergence.sql` (file SHA256 `b23e7150d94538744fd34f061c426def63b2c9e25d3c30539a221d40845306bf`). Only `CREATE OR REPLACE FUNCTION` becomes `CREATE FUNCTION` to reject overlap. The allowlist uses the August signature spelling `timestamp with time zone` for append.

| RPC | prosrc SHA256 | Behavior |
| --- | --- | --- |
| `read_admin_user_management_metadata(uuid[])` | `c5bbfc08c18c198680419a192ccc70893f2338786af175555cdd3378ae97f656` | 1–200 unique nonnull requested IDs, request ordering, left joins preserve missing-profile rows |
| `read_admin_user_audit_events(integer)` | `b840e6884476b4790fc377fa042c67031d6cfef950caa1ce05d33ac81a8c9c6e` | 1–50 events ordered by created_at DESC, id DESC; exact 12-field projection |
| `append_admin_user_audit_event(...)` | `2d4e8d8d1731edc0f5d5ea1cc57fd6c5dd3381faa1374fa96e3fd43a571057a6` | Active enabled admin actor, minimized JSON, source helper/check validation, generated UUID |

All three are owned by `privacy_workflow_owner`, SECURITY DEFINER, PL/pgSQL, empty search_path, and service-role-only Data API execution. Read functions remain STABLE; append remains VOLATILE. Argument names/types/modes, outputs, volatility, defaults, strictness, parallel mode, body hashes, ACLs (including PUBLIC/default ACL fallback and grant options), and exact allowlist tuples are verified. The first admin-IDs RPC is preserved by the snapshot.

## Admission and restoration

PG17 installation requires a nonsuper workflow owner with NOLOGIN/NOINHERIT/NOBYPASSRLS and exactly two owner→postgres membership rows:

| Grantor | ADMIN | INHERIT | SET |
| --- | --- | --- | --- |
| Foreign | true | false | false |
| postgres itself | false | true | false |

Only the existing self-granted row's SET option is temporarily enabled, then restored to false. Neither membership is deleted. All role and membership metadata, including membership OIDs and grantors, must compare equal before/after. The protected temporary SECURITY DEFINER bridge invokes the existing G014 public allowlist, definer, and catalog assertions before and after installation **after SET is restored**. No G014 body is replaced and no persistent assertion bridge is created.

Dependency guards cover:

- Exact required column types/nullability and effective owner SELECT privileges across profiles, user_roles, user_account_status, and admin_audit_events; INSERT on all 15 explicitly written audit columns; public schema USAGE for owner and service_role, plus owner CREATE during installation.
- Actual RLS/FORCE/owner shapes, applicable unconditional permissive SELECT policies and no nontrivial restrictive SELECT policy; equivalent INSERT visibility for the audit table. A matching result count alone cannot prove full visibility.
- Valid immediate single-column unique user_id join keys on profiles/status; the audit table's exact 17-column width, four validated constraints (all pinned by snapshot), with explicit id-primary-key and exact whitelist-helper-expression guards; no foreign keys or rewrite rules.
- Exact enabled append-only UPDATE/DELETE trigger and source body hash, no INSERT trigger, source UUID/now defaults and effective default-function privileges, no sequence dependency. Unexpected sequence/default requirements deny; no grants are added to repair them.
- Exact source body hashes and invoker/immutable/path/overload/EXECUTE contracts for all four audit validation helpers.

The external snapshot combines the existing advisor projection (including every ordered ledger version/name/count/`to_jsonb(statements)::text` SHA256) with metadata hashes for roles, memberships, schemas, functions, types/enums, default ACLs, relations, columns, policies, constraints, indexes, defaults, triggers, rules, and other allowlist tuples. Target functions/tuples are excluded from the invariant projection and checked separately. Function bodies remain inside hash computation; no application rows or raw bodies are exported. Relation statistics/vacuum counters are excluded; this is a catalog invariant snapshot, not a data backup.

The planner locks the ledger, rechecks the full pinned preview, takes the bounded advisory/relation locks, runs installation and exact ledger insertion, verifies the prior projection plus exactly one new ledger row, then commits atomically. Rehearsal rolls back an inner subtransaction and checks complete restoration, then rolls back the outer transaction. Apply requires the retained rehearsal receipt and also performs its own real inner rollback rehearsal before installation. Intentional SQLSTATE collisions cannot create a success receipt. Lock timeout is two seconds; total statement timeout is sixty seconds. No retries: an ambiguous transport result requires independent read-only state verification.

## Parent integration still required

1. Finish the first-RPC current52 operation independently. Verify its exact commit/ledger readback and retain the actual current52 snapshot. Generate the group's read-only snapshot SQL using `--project-ref aqlcofblfxdrjhhdmarw --mode snapshot`; this is the only mode available before a trust pin. Review all additional group metadata/admission against the retained assessment. A new starting state must be reviewed, not blindly accepted merely because it hashes.
2. Review and source-pin `sha256(canonical_json(snapshot))` in `CURRENT52_SNAPSHOT_SHA256`. Input is exactly the known JSON object, not the CLI `boundary/rows/warning` wrapper. Retain the raw receipt and extraction/hash evidence externally without overwriting earlier receipts. Re-review the migration hash and planner after any source change.
3. Bind the new migration, planner, replay verifier, tests, and their imported source utilities in the shared clean-replay generator/workflow. Those existing files are intentionally not edited here. Mirror the first-RPC overlap branch near `generate_g014_catalog_contract_baseline.sh:1358`, retaining/hashing verifier, generated SQL, and successful receipt, and preserve the final actual G014 assertion. The new verifier imports the planner, which imports the advisor utility; bind all of these dependencies rather than only the entrypoint. Add the two new test modules to source and explicit private-PG test steps and workflow path filters. Do not treat a skipped test job as evidence.
4. For PG15 clean source replay, call `verify_admin_management_group_replay.py --source NEW_MIGRATION --predecessor AUGUST003 --output NEW_FILE`. It emits read-only SQL for already-present functions and the complete visibility/dependency/ACL/allowlist checks. It neither executes the PG17 migration nor grants missing access. Missing private catalog access is a real fail-closed prerequisite. This adapter is not hosted history repair. Parent must run the full canonical replay after wiring it; the private overlap fixture is not that full replay.
5. After promotion/review, the parent may generate a new preview and immutable rollback-only rehearsal plan, retain its successful receipt, then generate the exact apply plan. The validated parent transport form is pinned Supabase 2.115.0 `db query --linked --project-ref aqlcofblfxdrjhhdmarw --file WHOLE_PLAN --output-format json`. Do not split the file or substitute `apply_migration`. This candidate has no hosted transport or credentials and has made no hosted call.
6. Independently run the generated readback after confirmed commit. It checks the prior catalog/history plus the new exact vector, dependencies and three targets, then under service_role returns only aggregate booleans for metadata/audit reads and invokes append with a NULL actor/request to require fixed invalid-input denial. It never performs a positive append against hosted data. An empty admin-ID fixture is supported; emptiness itself does not establish broader account readiness.

## Observable source behavior and test limits

Duplicate valid append requests are **not idempotent**: the original source inserts a second event with a new id, even with the same request UUID. No unique request_id constraint or upsert is invented. Migration replay/application itself is fail-closed: a second attempt cannot silently insert another migration or replace existing functions.

The exact count helper accepts nonnegative integer values through 9,999,999,999; the web normalizer uses its own tighter bound. The SQL helper/check also permits a NULL reason through SQL three-valued logic because reason is nullable. Tests explicitly record this accepted-source behavior; this candidate does not claim all malformed fields receive a fixed 22023 denial or strengthen the original RPC silently. Arrays/scalars or other invalid JSON must fail without inserting; callers still enforce their existing bounded normalization. Changing those semantics requires a separately reviewed source correction.

Private tests use digest-pinned isolated PG17 and PG15 containers, no published ports, network none, and generated local credentials only where the PG15 image requires them. Fixtures use the actual audit table DDL, four actual helper bodies, actual append-only trigger, and all three actual RPC bodies. G014 assertion fixtures model membership/allowlist enforcement and inject before/after failures; they do **not** substitute for real hosted G014 execution or a full source replay. The atomic planner test substitutes the broad advisor fixture projection only, while exercising the real group snapshot, catalog changes, statement vectors, ledger locks, and rollback.

Run from the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 TZUDONG_ADMIN_GROUP_LOCAL_PG=1 python3 -B -m unittest \
  backend.supabase.tests.test_admin_management_group \
  backend.supabase.tests.test_admin_management_group_replay -v
```

Before commit, a failure rolls back all function/allowlist/ledger/temporary membership changes. After commit, do not delete ledger history or replay the old migration to undo the feature: stop the affected caller path if necessary and review a separate additive corrective migration using the retained exact state. Transactional DDL recovery and this catalog snapshot are not full database recovery, a usable backup receipt, retention/legal/location approval, or overall Kiro completion.
