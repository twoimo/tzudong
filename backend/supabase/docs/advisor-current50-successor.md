# Current-state advisor successor: 50 → 51

This is an **offline SQL-plan generator**, not a hosted executor or a claim of
historical G037 closure. It never connects to a database, reads credentials,
retrieves backups or retries execution. The parent supplies fresh externally
retained metadata and controls transport, one-shot attempt custody and backup
risk decisions. Existing G037 immutable29/41, exclusions, and connection v1
artifacts remain unchanged. Missing historical G037/G038 objects are never
recreated here, current50 is not treated as their historical terminal state, and
this tool makes no broader execution or freeze-exit claim. A successful current
G014 assertion is only this transition's baseline evidence.

The only target is `aqlcofblfxdrjhhdmarw`. The only new ledger entry is
`20260903174413 / advisor_followup_hardening`, using the original 14,235-byte
migration SHA-256
`ae834917e3f6c6653d570dacd27d3894d15fcac2a4f09db86f0f9d0f51815148`.
The existing pinned parser produces exactly 17 unchanged executable statements;
the canonical JSON vector SHA-256 is
`9bc0ce1bb00777a5f49e5176fee8d28ce936918d3d9372def9fa3bf2ab06b287`.
No migration, legacy manifest, parser or historical ledger row is rewritten.

## Evidence and ordering

1. Retain the separately obtained exact-main runtime-probe receipt. Its expected
   `authorization-denied` result proves the restricted EXECUTE boundary, not a
   historical ledger or closure. Keep `G037_WRITE_FREEZE` and all existing
   producer/ingress freeze controls active. This explicitly authorized manual
   advisor transition is a narrow exception for the exact reviewed plan only;
   do not resume producers, remove global freeze settings, or overlap another
   G037/G038 controller execution/reconciliation window. No freeze exit is claimed.
2. Retain the connector-bound `hosted-current50-ledger-metadata-v1` envelope with
   `projectId`, `observationSource`, and `ledger`. The ordered 50 entries contain
   `version`, `name`, `statement_count`, `statements_pg_json_sha256`. The hash is
   PostgreSQL `encode(sha256(convert_to(to_jsonb(statements)::text,'UTF8')),'hex')`.
   Empty historical arrays are admissible and preserved exactly; SQL NULL arrays
   are denied. No historical statement vectors are manufactured.
3. Generate `snapshot` SQL and have the parent run it read-only on that exact
   target. CLI JSON may wrap results in `boundary`/`rows`/`warning`. Retain only the
   single known JSONB snapshot object from that result as snapshot JSON; reject
   missing, ambiguous or multiple candidate objects rather than guessing a key.
   This snapshot uses the actual intended `postgres` executor. Dedicated G037
   credentials have insufficient privileges and are not used for this operation.
4. Generate and externally retain the `preview` JSON; review its exact bytes and
   independently retain its SHA-256. No snapshot or hosted metadata is committed
   to the repository. Catalog fields are counts, fixed booleans or hashes, never
   user rows, raw function bodies, ACL entries or membership identities.
5. Generate `rehearse` using the preview and external digest. Run once. It takes
   transaction advisory lock `(6051,51)` and ACCESS EXCLUSIVE locks on the ledger,
   three affected public tables and manifest. It rechecks the complete preview
   **after locks** under READ COMMITTED, avoiding a stale snapshot after a waiter
   acquires the lock. It executes the real 17 statements and canonical ledger
   insertion inside a PL/pgSQL subtransaction, checks the exact expected state,
   intentionally rolls back that subtransaction, then checks the original state
   again before returning `rehearsed-rolled-back`. Only temporary execution state
   remains in the outer transaction; no persistent objects are added by rehearsal.
6. Retain that rehearsal JSON and its external SHA-256. Only an exact matching
   rehearsal permits generating `apply`. Review and retain the generated plan
   hash. The apply plan locks/rechecks the same preview, runs the same unchanged
   statements and insertion, verifies, and commits one transaction. Preview drift
   never causes automatic rebase, refresh, repair, or retry.
7. The apply result is intentionally `apply-verified-uncommitted`: a result row
   preceding COMMIT is not proof of commit. After transport completion, run the
   separate `readback` plan on a **new transaction**. Its `current51-observed`
   receipt verifies this preview plus exactly one canonical advisor row, all
   postconditions and the G014 assertion. It explicitly says
   `historical_closure: false`. A lost or ambiguous response permits readback
   only; never rerun apply to discover whether it committed.

A committed replay is denied by the exact50 precondition. The tool's exclusive
output-file creation prevents accidental overwrites, but **a saved SQL file is
not a cryptographic single-use capability**. The parent must mark an attempt
consumed before transport and never resubmit that plan after failure or ambiguity.
This bounded implementation deliberately does not invent a remote journal or
reuse the historical G037 authorization system.

## Commands (offline generation only)

From the isolated checkout, replace `/external/...` with parent-controlled files.
All output paths must be new. `--project-ref` accepts only the fixed target.

```sh
python3 backend/supabase/scripts/advisor_successor_plan.py snapshot \
  --project-ref aqlcofblfxdrjhhdmarw --output /external/advisor-snapshot.sql
python3 backend/supabase/scripts/advisor_successor_plan.py preview \
  --project-ref aqlcofblfxdrjhhdmarw --ledger /external/current50-ledger-metadata.json \
  --snapshot /external/advisor-snapshot.json --output /external/advisor-preview.json
python3 backend/supabase/scripts/advisor_successor_plan.py rehearse \
  --project-ref aqlcofblfxdrjhhdmarw --preview /external/advisor-preview.json \
  --preview-sha256 EXTERNALLY_RETAINED_PREVIEW_SHA256 --output /external/advisor-rehearse.sql
python3 backend/supabase/scripts/advisor_successor_plan.py apply \
  --project-ref aqlcofblfxdrjhhdmarw --preview /external/advisor-preview.json \
  --preview-sha256 EXTERNALLY_RETAINED_PREVIEW_SHA256 \
  --rehearsal /external/advisor-rehearsal.json \
  --rehearsal-sha256 EXTERNALLY_RETAINED_REHEARSAL_SHA256 --output /external/advisor-apply.sql
python3 backend/supabase/scripts/advisor_successor_plan.py readback \
  --project-ref aqlcofblfxdrjhhdmarw --preview /external/advisor-preview.json \
  --preview-sha256 EXTERNALLY_RETAINED_PREVIEW_SHA256 --output /external/advisor-readback.sql
```

The generator has no transport. The parent may use the independently verified
CLI 2.115.0 `db query --linked --project-ref aqlcofblfxdrjhhdmarw --file ... --output-format json`
route (parent has confirmed the read-only snapshot invocation), but must
first verify its whole-file, single-connection transaction/error semantics using
local evidence or an appropriate controlled transport test. No splitting into
separate API requests, statement-autocommit, MCP-generated migration version,
or post-hoc `migration repair` is permitted. PostgreSQL does not expose the
Supabase project ref as a portable trusted SQL primitive: fixed-target admission
is enforced by the generator and the parent's authenticated transport receipt,
not by a comment magically proving the remote project's identity. The SQL also
requires database `postgres`, PostgreSQL 17 and current/session role `postgres`.

### Transport evidence boundary

Independent official CLI v2.115.0 source inspection pinned commit
`18ae43a34a2257458197b62f74e2a97e2b5cf7f9`: `apps/cli/src/legacy/commands/db/query/query.handler.ts`
lines 349–362 read the whole file; lines 179–243 issue one `query` POST and
handle its response. Lines 262–270 require `--linked` with `--project-ref`.
This is client forwarding evidence; linked connection resolution can have
additional temporary-role/pooler side effects and is not itself proof of a
write-free transport setup.

The parent's externally retained `advisor-transport-readonly-probes.json`,
SHA-256 `3f4992cfa3adce9af48eca2494b2559e0d38e23ecb0908893e420229b66f5a9d`,
binds CLI 2.115.0 and the fixed project. Its read-only same-file probe returned
`same_transaction_observed=true` and `read_only=true`; the deliberate fixed
error returned exit 1, `LegacyDbQueryUnexpectedStatusError`, the expected error
constant, and no success rows. Combined with the pinned source, this establishes
the tested full-file read-only transaction and error behavior. It does not prove
hosted advisor rehearsal, write COMMIT, receipt delivery after COMMIT, or backup
recovery. Preserve the rehearsal requirement and independent current51 readback;
never retry an ambiguous apply.

## What is checked; what remains blocked

The complete ordered prior ledger projection must remain identical. The new
row must contain the exact parser vector (its PostgreSQL JSON hash is computed
inside the plan, not confused with the compact canonical-vector hash above).
All 26 functions remain invoker functions with the exact fixed path. For the
other 25 functions, every other `pg_proc` attribute (including body, owner and
ACL) remains hash-bound. For `public.touch_admin_workflow_updated_at()` ONLY,
`functions_stable` excludes `prosrc` in addition to `proconfig`. Its original
`prosrc` SHA-256 is separately retained as `touch_body_sha256` in the complete
preview, compared again after acquiring locks and after rehearsal rollback.
Owner, ACL, OID, language, return type and every other attribute remain in the
stable fingerprint; no owner or ACL repair is admitted by this successor.

Version 2 admits exactly two touch prebody SHA-256 values:

- Externally observed raw body: `7b8fa73618493b886781741cfe7eeb7e6d8140c72647054cd31b5d3dae390c9d`.
- Exact original-migration body: `8cf3d1c1e38e477afed9d3bf3df0546d107b10ac99f7ad73e16e630e55db0729`.

The first was independently classified by minimized read-only body/semantic
predicates, not guessed from a hash. External `advisor-touch-before.json` SHA-256
is `9100c2ff383d180d14bbe3f83362c37efc9b51860e4f9570249f673d8ce409df`;
`advisor-touch-semantic-before.json` SHA-256 is
`c3391b332e2de2c85b369fb9ac4bb3bca609a113e7bf0abc7708ea092015c23f`. The normalized predicate SHA-256
`951d65d5a5b24cd8b4b413ce00f0a74955d1d05219a107e1cccf86a46fc9c4fe`
identifies exactly `beginnew.updated_at=now();returnnew;end;`. Snapshot SQL
independently requires both that normalized literal AND the exact raw hash.
Equivalent but unreviewed whitespace/body bytes are refused. The alternate
canonical body is compared byte-for-byte to the body extracted from the pinned
original first statement. No old body is executed to classify it.

Prestate requires `touch_structure_ok=true` and `touch_body_admissible=true`;
`touch_ok` may be false only for the exact reviewed prior body. Poststate requires
`touch_ok=true` and the exact canonical body SHA. A switch between even the two
admissible bodies after preview is still drift and is denied. The v2 schema and
new fields require a fresh snapshot, preview and rehearsal; v1 receipts cannot
be reused or patched by hand. The old 17-statement migration remains untouched.

The four constraints retain their OIDs/predicates and change only validated state.
Exactly their four existing manifest values advance; PostgreSQL also removes the
trailing ` NOT VALID` from their stored constraint definitions. The normalized
whole-manifest digest permits only those two field differences. Other manifest
entries, helper definitions/ACLs, relation metadata/ACLs/RLS, policies, triggers,
schema ACLs and owner memberships are bound and rechecked. Routine relation size,
row-estimate and vacuum horizon metadata are excluded from the fingerprint.

The original source performs initial/final assertions and table validations
outside its temporary role window. No grants are added by this wrapper: the
actual executor must already have sufficient inherited owner authority. If
hosted role shape cannot execute these bytes unchanged, stop; the disposable
replay adapter is not a substitute. The planner rejects additional per-function
settings rather than discarding them to satisfy the migration's exact readback.

The wrapper masks migration exceptions to `advisor_successor_denied`; it does
not return constraint violation rows or raw nested errors. Transport errors and
pre-lock errors still need the parent's existing minimized diagnostic handling.
Statement timeout is 30 seconds, lock timeout five seconds. The parent must fence
out-of-band catalog/role changes during preview/rehearsal/apply/readback; locks
serialize the relevant tables and competing migration insertions, not every
cluster-wide role or function DDL operation.

Rollback before commit restores the transaction, including validated flags,
manifest, ACL/config changes and membership changes. Successful rehearsal proves
that bounded rollback on the tested state. It does **not** prove recovery from a
committed destructive change or lost cluster. No usable external backup/PITR
receipt, statutory compliance, retention/legal/location documents, policy
publication or full G037 closure is established by this successor. Those gates
remain open. After a successful commit, prefer a separately reviewed forward fix;
do not delete ledger history or claim an automatic down migration exists.

## Local verification

```sh
python3 -B -m unittest backend.supabase.tests.test_advisor_successor_plan
TZUDONG_ADVISOR_PG17_TEST=1 python3 -B -m unittest backend.supabase.tests.test_advisor_successor_postgres
```

The opt-in suite creates and removes only its own randomly named network-disabled
PostgreSQL17/pgvector container using a pinned image digest. No ports, DSNs, hosted
credentials or existing DB containers are used. It exercises a non-superuser
postgres executor, forced RLS/owner policies, real G014 catalog projection and
assertion functions, four named NOT VALID constraints, original migration bytes,
empty historical vectors, explicit version insertion, rollback, drift, errors,
repeat application, lock contention and competing applies. Application bodies,
CHECK input rows and historical ledger entries are deliberately synthetic. This
is transition verification, not a restored production database or backup test.

The hosted raw body was not exported. Real PostgreSQL tests use a plainly
synthetic `now()` body and a test-only reviewed-digest surrogate to exercise
actual body replacement, rollback and post-readback. Separate unpatched tests
pin exactly the two production digests and reject other semantically equivalent
bodies. These fixtures are not asserted to be a hosted body or production dump.
