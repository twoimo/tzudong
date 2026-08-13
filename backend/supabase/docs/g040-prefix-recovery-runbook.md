# G040 prefix recovery runbook

## GitHub Actions boundary

`g040-prefix-recovery.yml` is a zero-cost, read-only source-validation workflow. It is dispatch-only from the exact detached SHA of protected `main`, has read-only repository permission, and exposes only `validate`. It invokes `g040_recovery_source.verify_recovery_source` for that exact source and emits a bounded canonical receipt containing only schema, status, and the runtime source-root hash. The receipt contains no raw refs, URLs, DSNs, credentials, keys, signatures, SQL, rows, migration vectors, or authority material.

GitHub Actions must never run `diagnose`, `readback`, `prepare`, `finalize`, or `execute`, import a production mutation credential, authority private key, restrictive service file, raw DSN, encrypted capture, authorization, or signature, use a service container, paid runner, paid service, hosted mutation, or production rehearsal. `diagnose` and `readback` require local restrictive service and custody artifacts, so they remain local-only alongside `prepare`, `finalize`, and `execute`. The workflow does not establish live database state or authorize any recovery action.

## Local operator-only recovery

`diagnose`, `readback`, G037 `prepare`, G037 `finalize`, G040 authority `verify`, and `execute` are local operator-only modes outside GitHub. Start from the exact protected-main source checkout; a branch, detached copy with an unverified commit, or changed working tree blocks the operation. An external custodian, not this repository, must activate and continuously maintain the producer stop for the entire attempt. No repository command activates that stop; old freeze and old authority must never be reused.

Before any commit-capable action, create a fresh encrypted capture under restricted local custody and complete two independent free local PostgreSQL 17.6 clone rehearsals. Each rehearsal must start from the fresh capture, use separate local clone environments, verify the exact protected-main source and target bindings, and preserve only sanitized receipt hashes outside the repository. A clone rehearsal is evidence only and is never a hosted or production rehearsal.

`observe-reference` is clone-only and rollback-only: after restoration it requires a direct non-superuser `postgres` session with `CREATEROLE` and `postgres` database ownership to mirror the hosted execution identity. In one local transaction it proves FULL → exact source-controlled reverse 00400 → ABSENT → pinned forward 00400 → recreated FULL, then rolls back and proves the original FULL state. It neither grants local custody nor switches roles, and it never commits. The reverse 00400 vector is prohibited in hosted production and must never be used against a hosted database.

G040 preserves the hosted `vector` extension in `public` on both restored clones. Its executable G014 vectors replace exactly eight source-pinned `extensions.vector` identity literals (four in `20260713002000`, four in `20260713002400`) with `public.vector`; any missing or additional occurrence blocks compilation. The same transform changes exactly three G014 policy predicates: the creator check and both effective/PUBLIC EXECUTE checks accept `supabase_admin` only for a `public` function that has an exact extension-membership dependency on the `public`-schema `vector` extension owned by `supabase_admin`. This bounded provider exception is required because hosted PostgreSQL does not let `postgres` revoke privileges from provider-owned extension functions; unrelated provider-owned functions and unrelated broad grants remain rejected. This compatibility vector is identical in both clone branches and hosted execution, while canonical migration bytes remain unchanged in ledger evidence.

**Validation phases.** Run source-only G040 `validate-source` through the isolated bootstrap before any live operation; its receipt is not database, producer-stop, lineage, or authorization proof. G040 authority `verify` is the no-database pre-execute authority gate. It fixed-key verifies the exact G040 destructive authorization and bindings. One-shot G040 `execute` reopens and revalidates the exact finalized G037 assertion, all five evidence files, and every G040 custody and authorization input before mutation, then revalidates live inventory and transaction-scoped locks.

**External producer stop and evidence.** There is no `g037_write_freeze.py freeze` command. Before G037 `prepare`, an external custodian must activate and keep active the producer stop, assign a fresh attempt-unique `freeze_id`, and create five distinct restrictive regular-file evidence artifacts outside the checkout. Pass them as `--evidence-producer-stop`, `--evidence-no-owner-write`, `--evidence-no-dashboard-write`, `--evidence-no-provider-write`, and `--evidence-no-out-of-band-write`. Each status must be true, each exact SHA-256 must match the signed assertion, and each observation must be at most 900 seconds old. Missing, permissive, symlinked, aliased, stale, or hash-mismatched artifacts block. `producer_stop` must identify the account-deletion `dispatch` and privacy-retention `retain` jobs, prove their repository/environment freeze guard was active before environment/secrets admission, and prove neither was in flight at observation.

**Prepare, offline sign, finalize, authorization ordering.** `prepare` is a rolled-back lockability preflight, not an external freeze or maintained table lock. It writes the exact canonical unsigned operator-assertion request to a fresh restrictive outside-checkout path. The offline authorization custodian verifies the request schema, digest, identifiers, evidence, and expiry, signs those exact bytes with the fixed authorization-domain key outside the repository, and returns only a detached signature file under restrictive custody. `finalize` fixed-key verifies the exact canonical request, detached signature, custody, freshness, and current evidence before writing the final signed assertion. It has no private-key argument.

```sh
# All placeholders are absolute restrictive paths outside the checkout.
AUTHORIZED_COMMIT='<EXACT_40_HEX_PROTECTED_MAIN_SHA>'
git show "$AUTHORIZED_COMMIT":backend/supabase/scripts/g040_isolated_bootstrap.py | python3 -I -B - \
  --repository-root "$PWD" --authorized-final-commit "$AUTHORIZED_COMMIT" \
  --entrypoint backend/supabase/scripts/g037_production_controller.py -- prepare \
  --origin '<EXACT_HTTPS_SUPABASE_ORIGIN>' --freeze-id '<FRESH_FREEZE_ID>' \
  --operator-assertion-request '<FRESH_UNSIGNED_REQUEST>' \
  --service-file '<SERVICE_FILE>' --service-name g040-production --pgpass-file '<PGPASS_FILE>' --expiry-seconds 600 \
  --evidence-producer-stop '<PRODUCER_STOP>' --evidence-no-owner-write '<NO_OWNER_WRITE>' \
  --evidence-no-dashboard-write '<NO_DASHBOARD_WRITE>' --evidence-no-provider-write '<NO_PROVIDER_WRITE>' \
  --evidence-no-out-of-band-write '<NO_OUT_OF_BAND_WRITE>'

# Offline signing occurs outside repository tooling. Then:
git show "$AUTHORIZED_COMMIT":backend/supabase/scripts/g040_isolated_bootstrap.py | python3 -I -B - \
  --repository-root "$PWD" --authorized-final-commit "$AUTHORIZED_COMMIT" \
  --entrypoint backend/supabase/scripts/g037_production_controller.py -- finalize \
  --origin '<EXACT_HTTPS_SUPABASE_ORIGIN>' --freeze-id '<FRESH_FREEZE_ID>' \
  --operator-assertion-request '<FRESH_UNSIGNED_REQUEST>' \
  --operator-assertion-signature '<DETACHED_SIGNATURE>' --operator-assertion '<FRESH_FINAL_ASSERTION>' \
  --evidence-producer-stop '<PRODUCER_STOP>' --evidence-no-owner-write '<NO_OWNER_WRITE>' \
  --evidence-no-dashboard-write '<NO_DASHBOARD_WRITE>' --evidence-no-provider-write '<NO_PROVIDER_WRITE>' \
  --evidence-no-out-of-band-write '<NO_OUT_OF_BAND_WRITE>'
```

After finalization, construct destructive authorization from the exact final assertion hash and its source, target, capture, classification/vector, lineage/reference, relation-root, and ACL-root bindings. Offline-sign that canonical authorization, fixed-key verify it with the G040 authority, then permit one `execute` only while the assertion and evidence remain fresh. The transaction-scoped table fence exists only within `execute`; it is acquired and rechecked there. Keep the external producer stop active through capture, both clone rehearsals, execution, cleanup, and review.

The G040 artifact handoff is exact: controller `prepare` writes the canonical bindings-only object accepted directly by `g040_recovery_authorization.py --bindings`; operators do not extract, add, or rename fields. Before building authority, an administrator must pre-provision the owner-restricted one-shot journal at `C:\ProgramData\TzudongRecovery\g040-attempt-journal` on Windows or `/var/lib/tzudong-recovery/g040-attempt-journal` on POSIX. The controller never creates or chmods this directory and never derives it from `HOME`.

Run the complete local sequence through the isolated exact-commit bootstrap. Every output placeholder below is a fresh absolute restrictive path outside the checkout; every input is the exact prior-stage artifact. UUIDs are fresh attempt-specific values. The G037 finalized freeze assertion is passed byte-for-byte without adding a newline.

```sh
BOOTSTRAP='backend/supabase/scripts/g040_isolated_bootstrap.py'
CONTROLLER='backend/supabase/scripts/g040_production_controller.py'
AUTHORITY='backend/supabase/scripts/g040_recovery_authorization.py'

git show "$AUTHORIZED_COMMIT:$BOOTSTRAP" | python3 -I -B - \
  --repository-root "$PWD" --authorized-final-commit "$AUTHORIZED_COMMIT" \
  --entrypoint "$CONTROLLER" -- validate-source \
  --repository-root "$PWD" --source-commit "$AUTHORIZED_COMMIT" --source-receipt "$SOURCE_RECEIPT"

git show "$AUTHORIZED_COMMIT:$BOOTSTRAP" | python3 -I -B - \
  --repository-root "$PWD" --authorized-final-commit "$AUTHORIZED_COMMIT" \
  --entrypoint "$CONTROLLER" -- diagnose \
  --repository-root "$PWD" --source-commit "$AUTHORIZED_COMMIT" \
  --target-fingerprint "$TARGET_FINGERPRINT" --reference "$REFERENCE" \
  --service-file "$SERVICE_FILE" --service-name g040-production \
  --nonce-dir "$NONCE_DIR" --observation-receipt "$OBSERVATION"

git show "$AUTHORIZED_COMMIT:$BOOTSTRAP" | python3 -I -B - \
  --repository-root "$PWD" --authorized-final-commit "$AUTHORIZED_COMMIT" \
  --entrypoint "$CONTROLLER" -- production-backup \
  --repository-root "$PWD" --source-commit "$AUTHORIZED_COMMIT" \
  --target-fingerprint "$TARGET_FINGERPRINT" --reference "$REFERENCE" \
  --observation "$OBSERVATION" --destination "$BACKUP_DIRECTORY" \
  --capture-receipt "$CAPTURE_RECEIPT" --service-file "$SERVICE_FILE" \
  --recipient "$AGE_RECIPIENT" --g034-artifact "$G034_ARTIFACT" \
  --encrypt-command "$AGE_BINARY" --freeze-assertion "$FINAL_FREEZE_ASSERTION" \
  --freeze-evidence "$PRODUCER_STOP" --freeze-evidence "$NO_OWNER_WRITE" \
  --freeze-evidence "$NO_DASHBOARD_WRITE" --freeze-evidence "$NO_PROVIDER_WRITE" \
  --freeze-evidence "$NO_OUT_OF_BAND_WRITE" --output "$PRODUCTION_BACKUP"

git show "$AUTHORIZED_COMMIT:$BOOTSTRAP" | python3 -I -B - \
  --repository-root "$PWD" --authorized-final-commit "$AUTHORIZED_COMMIT" \
  --entrypoint "$CONTROLLER" -- prepare \
  --repository-root "$PWD" --source-commit "$AUTHORIZED_COMMIT" \
  --target-fingerprint "$TARGET_FINGERPRINT" --reference "$REFERENCE" \
  --observation "$OBSERVATION" --custody "$AGGREGATE_CUSTODY" \
  --authority-template "$AUTHORITY_BINDINGS"

git show "$AUTHORIZED_COMMIT:$BOOTSTRAP" | python3 -I -B - \
  --repository-root "$PWD" --authorized-final-commit "$AUTHORIZED_COMMIT" \
  --entrypoint "$AUTHORITY" -- build-request \
  --repository-root "$PWD" --bindings "$AUTHORITY_BINDINGS" \
  --authorization-id "$AUTHORIZATION_ID" --attempt-id "$ATTEMPT_ID" \
  --valid-seconds 600 --output "$AUTHORIZATION_REQUEST"
```

The offline authorization custodian verifies the exact request bytes, target/source/freeze/capture/rehearsal/terminal bindings, journal identifiers, and expiry; signs those exact bytes with the fixed G040 destructive-authorization key; and returns only `$AUTHORIZATION_SIGNATURE` under restrictive custody. The runtime receives no private key or signing command. Fixed-key verification must succeed before execute:

```sh
git show "$AUTHORIZED_COMMIT:$BOOTSTRAP" | python3 -I -B - \
  --repository-root "$PWD" --authorized-final-commit "$AUTHORIZED_COMMIT" \
  --entrypoint "$AUTHORITY" -- verify \
  --repository-root "$PWD" --bindings "$AUTHORITY_BINDINGS" \
  --authorization "$AUTHORIZATION_REQUEST" --signature "$AUTHORIZATION_SIGNATURE"

git show "$AUTHORIZED_COMMIT:$BOOTSTRAP" | python3 -I -B - \
  --repository-root "$PWD" --authorized-final-commit "$AUTHORIZED_COMMIT" \
  --entrypoint "$CONTROLLER" -- execute \
  --repository-root "$PWD" --source-commit "$AUTHORIZED_COMMIT" \
  --target-fingerprint "$TARGET_FINGERPRINT" --reference "$REFERENCE" \
  --service-file "$SERVICE_FILE" --service-name g040-production \
  --observation "$OBSERVATION" --custody "$AGGREGATE_CUSTODY" \
  --authorization "$AUTHORIZATION_REQUEST" --authorization-signature "$AUTHORIZATION_SIGNATURE" \
  --prepared-receipt "$PREPARED_RECEIPT" --final-receipt "$FINAL_RECEIPT" \
  --proof-receipt "$PROOF_RECEIPT" --backup-receipt "$PRODUCTION_BACKUP" \
  --capture-receipt "$CAPTURE_RECEIPT" --archive "$ENCRYPTED_ARCHIVE" \
  --freeze-assertion "$FINAL_FREEZE_ASSERTION" \
  --freeze-evidence "$PRODUCER_STOP" --freeze-evidence "$NO_OWNER_WRITE" \
  --freeze-evidence "$NO_DASHBOARD_WRITE" --freeze-evidence "$NO_PROVIDER_WRITE" \
  --freeze-evidence "$NO_OUT_OF_BAND_WRITE"
```

A nonzero execute result, timeout, disconnect, rollback failure, missing final receipt, or `commit_ambiguous_readback_only` is never retried. Preserve the producer stop, journal marker, authorization, prepared receipt, archive, capture, observation, reference, and custody artifacts unchanged. Use only historical non-mutating readback with fresh proof/final destinations to resolve the committed state:

```sh
git show "$AUTHORIZED_COMMIT:$BOOTSTRAP" | python3 -I -B - \
  --repository-root "$PWD" --authorized-final-commit "$AUTHORIZED_COMMIT" \
  --entrypoint "$CONTROLLER" -- readback \
  --repository-root "$PWD" --source-commit "$AUTHORIZED_COMMIT" \
  --target-fingerprint "$TARGET_FINGERPRINT" --reference "$REFERENCE" \
  --service-file "$SERVICE_FILE" --service-name g040-production \
  --observation "$OBSERVATION" --custody "$AGGREGATE_CUSTODY" \
  --authorization "$AUTHORIZATION_REQUEST" --authorization-signature "$AUTHORIZATION_SIGNATURE" \
  --prepared-receipt "$PREPARED_RECEIPT" --final-receipt "$READBACK_FINAL_RECEIPT" \
  --proof-receipt "$READBACK_PROOF_RECEIPT"
```

Readback is historical evidence only: it cannot authorize mutation, recreate a missing marker, or consume a second attempt. Retain the fixed journal marker and external producer stop until the signed terminal readback and proof receipts have been independently verified.

**Custody and failed attempts.** Every service, pgpass, recipient, allowlist, evidence, receipt, archive/destination, assertion request, assertion, authorization, and detached signature output path is absolute, restrictive, and outside the checkout. Inputs are stable regular files; published outputs are fresh and collision-free. Signing keys remain wholly inside the offline custodian and only detached signature output crosses that boundary. No raw secret, key, authorization, signature, or private-key path/bytes appears in argv, environment, checkout, logs, artifacts, caches, tickets, or chat. On any capture, publication, or verification failure, preserve the producer stop, identity-safely clean failed outputs, and invalidate the failed `freeze_id`, evidence, request, assertion, capture, and authorization. Begin a fresh attempt with fresh evidence; do not restart writers merely to mint a new freeze. On rollback failure, commit ambiguity, or committed-unfinalized state, do not retry execution; preserve the stop for reconciliation/manual review.
**G035 exact restore key custody.** The offline custodian launches the exact-commit isolated bootstrap with selective inheritance: it creates an anonymous pipe containing the age identity, selectively inherits only its read end into the bootstrap process, writes the complete identity bytes, and closes the writer immediately so age observes EOF. Private-key paths and bytes remain solely in offline custodian memory and never enter child argv, environment, output, or receipts. On POSIX pass the inherited read descriptor as canonical decimal `--identity-fd 3`; on Windows pass the inherited anonymous-pipe HANDLE as canonical decimal `--identity-handle 1234`. The restore runner duplicates and closes the inherited original, then supplies the owned stream only as age stdin. It accepts neither an identity-file option nor stdout receipt redirection.
```sh
RESTORE_ENTRYPOINT='backend/supabase/scripts/g035_hosted_recovery.py'
git show "$AUTHORIZED_COMMIT:$BOOTSTRAP" | <approved-selective-inheritance-custodian> --identity-fd 3 --close-writer-after-write -- python3 -I -B - \
  --repository-root "$PWD" --authorized-final-commit "$AUTHORIZED_COMMIT" \
  --entrypoint "$RESTORE_ENTRYPOINT" -- restore-verify \
  --dump "$ENCRYPTED_ARCHIVE" --capture-receipt "$CAPTURE_RECEIPT" \
  --restore-receipt "$RESTORE_RECEIPT" --service-file "$LOCAL_SERVICE_FILE" \
  --destination-service g035-local --identity-fd 3 --decrypt-command "$AGE_BINARY"
```
On Windows the approved custodian uses an explicit handle allowlist and substitutes `--identity-handle <canonical-inherited-handle>` in both the custodian channel selector and restore argv. `$RESTORE_RECEIPT` is an absolute, fresh, restrictive path outside the checkout and is published no-clobber by the restore runner; successful restore emits no receipt on stdout. Preserve the archive and capture on a rejected restore or receipt-publication failure.

**Hosted classification and execution.** After source/reference validation, local `diagnose` accepts only exact `UNAPPLIED` or `FULL_ESCAPED`; `FULL_ESCAPED` is an expected classification and selects adoption rather than replaying escaped 00400 work. Any partial or ambiguous classification blocks. After fresh rehearsal, custody, assertion, authorization, and freeze revalidation, the authorized recovery remains one transaction/one commit. A timeout, disconnect, rollback failure, or uncertain outcome is never automatic success and must not be retried.

## Offline clone-lineage attestation

A G035 capture/restore receipt is self-hashed inventory only; it cannot promote itself into clone lineage. Before `bind-restore`, an external offline custodian must attest the exact canonical G040 lineage document and provide its detached signature from restrictive custody outside this checkout. The runner accepts the document and signature only from outside-repository paths and verifies them only with the fixed clone-lineage public key (`de810d6b46b4032803f0a28d8febf9f574738df86ff3dd0a90e703c680018c28`).

The canonical document binds the stable capture and restore receipt bytes, encrypted archive bytes and size, G035 source and manifest hashes, clone nonce, connected local PostgreSQL identity, Docker container/image/loopback endpoint proof, and a fresh lifetime of at most 900 seconds. `bind-restore` independently reconstructs every field, requires byte-for-byte canonical equality and fixed-key verification, and hashes the input artifacts before and after verification to reject replacement. The controller-signed clone binding retains restrictive external attestation and signature paths as well as their hashes; before every observation and promotion it reopens those stable files and revalidates canonical bytes, exact expected body, fixed clone-lineage public-key signature, freshness, hashes, and replacement checks. A controller receipt cannot promote forged lineage hashes or substitute lineage files.

This clone-lineage key is neither the offline destructive-authorization key nor the online controller receipt key. The controller runtime never receives the clone-lineage private key, its path, or a signing command; failed, expired, malformed, substituted, or wrong-key attestations block the bind.
The service file is a restrictive regular file outside the repository. Before and after every clone connection, the runner reopens it through custody, compares its bytes and file identity, and rejects replacement. The effective libpq peer must report exactly `127.0.0.1` and the parsed service port; that port must also exactly match the Docker loopback proof. Repository-resident, permissive, replaced, or mismatched-peer service files block the rehearsal.
`prepare` only proves lockability in a transaction that is rolled back and writes an unsigned bounded assertion request; it neither activates nor maintains the external producer stop or table locks. Only `execute` holds the table fence, revalidates inventory, performs the selected vector, writes the ledger state, and commits once. A rollback or uncertain outcome blocks automatic retry and requires fresh operator review, capture, rehearsal, request/finalization, and one-shot authorization.

## Fixed post-commit readback

Immediately after the single commit, run the fixed local `readback` from the same exact protected-main source and retain the sanitized final receipt under restricted custody. Readback must confirm the committed terminal ledger, catalog, data, and authorization bindings. GitHub source validation cannot replace the required fixed local post-commit readback.

The terminal data root is read through the permanent, aggregate-only `privacy_retention.g040_terminal_data_probe()` capability. Recovery creates it from the source-pinned projection before removing the temporary workflow-owner membership, transfers it to `privacy_workflow_owner`, fixes an empty search path, and grants execution only to `postgres`. Clone rehearsal, execute, and post-commit readback all reject a missing overload, an extra overload, owner or `SECURITY DEFINER` drift, search-path drift, or any broader function ACL before accepting the data root. The capability returns only counts, booleans, and SHA-256 projections; it never returns retained rows or identifiers and does not weaken forced RLS or retain workflow-owner membership.
