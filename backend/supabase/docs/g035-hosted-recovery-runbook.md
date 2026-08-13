# G035 hosted recovery runbook

## Scope and stop rule

G035 capture, restore, remediation, and clone rehearsal is fail closed and local only. A G035 receipt is recovery evidence, never authorization to write to the hosted project, and does not cover G026 or migration `20260713002500`. Do not use GitHub Actions artifacts, releases, caches, or repositories as a backup destination.

The separate ledger-50 forward executor described below can perform one narrowly bounded database application after all of its gates pass. It does not turn a G035 receipt into approval and it does not remove any release, legal, privacy, or provider-evidence gate.

Stop when a capture readiness artifact, receipt, commit, or live fingerprint differs; when capture returns a rejected receipt; or when a self-committing migration is ambiguous. Do not retry ambiguous self-committing migrations.

## Hosted ledger-50 forward application

### Promotion and source gate

Do not access the hosted database until the complete forward source has moved through serialized pull requests `develop` → `data` → `main`. Every pull request must pass its legitimate checks and branch-protection requirements and receive the approval required by repository policy. A sole operator or repository administrator must stop if that approval cannot legitimately be obtained; never use an administrator bypass, disable protection, or treat authorship or a local test result as approval.

After promotion, create a fresh detached checkout at the exact current `origin/main` commit. Require a clean tree including untracked files, the expected tree hash, the canonical origin URL, and a fresh `ls-remote` readback proving that the same commit is still current `main`. Run capture, rehearsal, workspace preparation, and execution from that source binding. Any source movement, dirty file, branch mismatch, or remote-main mismatch requires a fresh checkout and fresh evidence.

### Fresh local recovery evidence

Create a new encrypted G035 logical capture from that exact source commit on an operator-controlled local encrypted volume. Never reuse an earlier archive or receipt. The Free plan has no managed PITR for this procedure, so the accepted recovery mode is the source-bound encrypted logical capture followed by two independent local restores.

Use `run_g035_dual_restore_rehearsal.py` to perform two independent G035 restores in its single v2 orchestration. The custodian supplies the age identity only through one selectively inherited anonymous pipe, passed as `--identity-fd <read-fd>`; it closes the writer after sending the complete identity. Never pass an identity/key path, key bytes, environment variable, named pipe, or broadly inherited descriptor to the rehearsal or restore child. Retain the canonical `local-dual-restore-rehearsal-v2` receipt and both independently published G035 restore receipts only after the orchestrator proves that its two containers, networks, temporary service files, and plaintext restore material are absent.

At controller admission, the capture receipt, encrypted archive, dual-restore receipt, and both retained restore receipts must be bound to the exact current `main` commit and be at most **3,600 seconds (one hour)** old. Their recorded file identities, hashes, modification times, image identity, runtime-source root, ledger-50 pair hash, catalog fingerprints, independent restore-run IDs, and cleanup proof must all validate. A missing, older, reordered, changed, or still-running resource blocks hosted execution.

The tracked POSIX custody launcher owns pipe creation and the descriptor allowlist. It accepts only an external owner-only `0600` custody config in an owner-only directory. That config contains the identity path so the identity path never enters the launcher child argv or environment. Its bytes are canonical compact ASCII JSON with exactly one key and a trailing newline; the placeholder form is `{"identityPath":"/absolute/offline/age-identity"}`. Never commit this config or the referenced identity. The launcher validates both files with `lstat`, `O_NOFOLLOW`, exact owner/mode/link-count checks, and before/opened/after inode stability before it reads the identity into mutable memory.

Run the launcher itself from the exact authorized commit. It verifies the clean detached checkout, the committed launcher and producer blobs, and the source-pinned final producer SHA-256 before it opens the custody config. A missing placeholder pin, checkout drift, or hash mismatch fails before private material is read. The launcher gives the producer only one selectively inherited anonymous pipe as `--identity-fd`, writes the identity, closes the writer, zeroes its buffer, and stays silent. Use this POSIX command shape:

```sh
AUTHORIZED_COMMIT='<EXACT_40_HEX_RECOVERY_COMMIT>'
CUSTODY_LAUNCHER='backend/supabase/scripts/g035_dual_restore_custody_launcher.py'
git show "$AUTHORIZED_COMMIT:$CUSTODY_LAUNCHER" | <pinned-python> -I -B - \
  --repository-root <clean-detached-checkout> \
  --authorized-final-commit "$AUTHORIZED_COMMIT" \
  --custody-config <external-owner-only-custody-config.json> \
  --capture-receipt <fresh-external-capture-receipt> \
  --archive <fresh-external-encrypted-archive> \
  --destination <fresh-external-dual-restore-directory> \
  --python <pinned-python> --docker <pinned-docker> --age <pinned-age> \
  --pg-restore <pinned-pg-restore>
```

The custody-config placeholder is the only custody path permitted in argv. It is not permission to put the identity path or bytes there. If the checked-in v2 CLI and tracked launcher differ from this anonymous-descriptor contract, stop instead of adapting it with a key path.

### Exact workspace and bounded apply

Create a fresh external owner-only workspace with `prepare_hosted_ledger50_workspace.py prepare`, then verify it. The workspace contains exactly 50 fail-closed predecessor sentinels and these four source-pinned forward migrations, with no other migration, seed, role, or schema input:

1. `20260814010000_hosted_g016_g041_catalog_reconciliation.sql`
2. `20260814010100_hosted_runtime_boundary_convergence.sql`
3. `20260814010200_hosted_public_profile_read_convergence.sql`
4. `20260814010300_hosted_current_profile_mutation.sql`

Use only the source-pinned Supabase CLI **v2.109.1** binary; its exact size and SHA-256 must pass the controller check. Do not substitute a global or newer CLI. Supply the restricted hosted service file and pinned CA only through their external owner-only files. Confirm the exact project reference explicitly, and keep every workspace, receipt, archive, service, and output path outside the repository.

The executor first reads the hosted ledger and admits only an exact prefix of the four forward migrations after the exact 50-entry predecessor ledger. It runs `db push --dry-run` for exactly the remaining suffix, revalidates the source, CLI, workspace, statement contracts, and unchanged remote ledger, and then permits exactly one non-dry-run `db push` subprocess in that invocation. The fixed command surface must never add `--include-all`, migration `repair`, seed application, or roles application.

On success, retain `dry-run-receipt.json` (when a suffix remained) and `apply-receipt.json`. The terminal gate executes both source-pinned fixtures in explicit read-only transactions—`hosted_forward_convergence_readback.sql` and `hosted_profile_convergence.sql`—and records their exact hashes only after the ledger reaches all four forward versions.

On any failure, retain the canonical `failure-receipt.json`, including its stage, original stage, bounded post-failure ledger readback, and `retryAttempted=false`. A timeout, disconnect, CLI error, or partial prefix is not a rollback and is never evidence that nothing committed. Do not retry within the same invocation. Start a fresh invocation only after preserving the failure receipt and performing a new source, recovery-evidence, credential, and remote-ledger readback; the new dry run must plan only the exact remaining suffix. If the remote state is not an admitted prefix, stop.

The terminal already-applied path is readback only: it does not push again. Never use `--include-all`, migration `repair`, seed, roles, a canonical migration-directory push, manual ledger edits, or ad hoc SQL to force convergence.

### Evidence boundary

The resulting receipts establish only bounded technical evidence for the PostgreSQL ledger, catalog, grants/RLS/RPC contracts covered by the migrations, and terminal readbacks. They do not prove legal or privacy compliance, policy publication, Korean legal/privacy-owner review, a location-business filing or non-applicability decision, branch approval, or release certification.

Because the project is on the Free plan, this procedure records `managedPitrAvailable=false`; a local logical capture and two successful database restores are not managed PITR. PostgreSQL evidence also does not prove recovery of physical Storage blobs, Storage objects outside the captured database boundary, or external Supabase Auth/provider configuration. Record those gaps truthfully and do not convert them into a pass.

## Key custody and destination

Keep the encryption private key, offline Ed25519 signing key, and recovery service definitions offline under separate restricted custody. Never place a private key, signing operation, raw URL, quarantine row, or service credential in a repository, ticket, chat, shell history, CI variable, artifact store, or this runbook. Capture and non-restore rehearsal modes consume only restrictive local files. Restore is deliberately unavailable from the GitHub Actions workflow: the tracked POSIX custody launcher above must supply the age identity through one selectively inherited anonymous pipe, never a key path, environment variable, regular file descriptor, or broad handle inheritance. The remediation verifier uses the authorization public key pinned in source; the private signing key remains offline.

Capture ciphertext only to an operator-controlled local encrypted volume. Capture accepts only the source-pinned approved age recipient; restore requires the capture receipt recipient fingerprint to match that pin, without recording private identity material. The restore child accepts exactly one inherited POSIX channel, `--identity-fd <read-fd>`, created and selectively inherited by the tracked launcher. The launcher writes the identity bytes through the anonymous pipe, closes both parent ends, and discloses neither the identity path nor bytes to the child argv, environment, output, or receipt. This tracked launcher has no Windows execution contract; stop on a non-POSIX host. Restore verification and every remediation/clone/postflight operation use only the local/self-hosted `g035-local` service with numeric `127.0.0.1` or `::1`, never hostnames or sockets. A clone is a verification environment, not a production substitute.
The macOS custody rotation invalidates all ciphertext encrypted to the pre-rotation age recipient and all remediation authorizations signed by the pre-rotation authority. They must not be replayed; create fresh ciphertext and authorization under the source-pinned rotated custody.

## Safe command sequence

Run capture from the recovery checkout after the operator supplies restricted files locally. Every stdout-redirected receipt destination is a fresh absolute path outside the checkout; do not overwrite or reuse a receipt path. The capture artifact must be the exact current artifact-version-2 G034 evidence: duplicate-free and exact-keyed, receipt-recomputed, source-valid and catalog-checked, with `safeToApply=false`. It may contain only the expected clone/backup/catalog-prerequisite remediation blockers. During the same persistent read-only source connection, G035 compares its ledger and catalog fingerprints to the artifact before dumping and emits a capture-readiness chain binding the artifact hash, preflight receipt ID, current commit, and live fingerprints.

```sh
AUTHORIZED_COMMIT='<EXACT_40_HEX_RECOVERY_COMMIT>'
BOOTSTRAP='backend/supabase/scripts/g040_isolated_bootstrap.py'
RESTORE_ENTRYPOINT='backend/supabase/scripts/g035_hosted_recovery.py'
run_g035() {
  git show "$AUTHORIZED_COMMIT:$BOOTSTRAP" | <pinned-python> -I -B - \
    --repository-root "$PWD" --authorized-final-commit "$AUTHORIZED_COMMIT" \
    --entrypoint "$RESTORE_ENTRYPOINT" -- "$@"
}
python backend/supabase/scripts/preflight_g034_hosted_migration_closure.py --artifact <local-preflight-artifact>
run_g035 validate
run_g035 capture --destination <existing-encrypted-capture-directory> --service-file <restricted-hosted-service-file> --recipient <encryption-recipient> --g034-artifact <local-preflight-artifact> --pg-dump <pg-dump-command> --encrypt-command <encrypt-command> > <capture-receipt.json>
```

The capture command writes the generated ciphertext file `g035-dump.enc` inside `<existing-encrypted-capture-directory>`. After capture, the only executable restore path in this runbook is the committed dual-restore custody-launcher command under **Fresh local recovery evidence**. Do not add a direct bootstrap `restore-verify` command, reconstruct the removed single-restore custodian placeholder, invoke the restore entrypoint directly, redirect its output, or expose a private-key path. The dual producer publishes its canonical receipts itself and remains silent; failure publishes no accepted dual-restore receipt.

Restore verification preserves the capture-bound hosted `vector` extension schema (`public`) and rejects any other restored layout; it no longer rewrites extension ownership or namespace before G040 lineage observation. The separate legacy `clone-apply` path remains an explicitly transformed local clone: immediately before migration `20260713002000`, its source-pinned local compatibility hook relocates `vector` to `extensions`, where that historical migration expects it. Neither behavior mutates the hosted project.

Review only the inspection receipt's non-sensitive hashes and counts: receipt hash, receipt-chain hashes, catalog/selection/rowset/victim hashes, duplicate-group count, and duplicate-victim count. Do not export, display, or copy raw URLs or rows from the local quarantine.

Create the authorization JSON offline as canonical JSON: UTF-8 bytes exactly equivalent to sorted-key, compact JSON (`json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True)`). It must contain exactly the parser's authorization schema fields and bind the inspection receipt, restore receipt, capture receipt, manifest, repository commit, selection/catalog/rowset/victim hashes, counts, and an operator-generated canonical UUID batch ID. Sign those exact authorization-file bytes with the offline Ed25519 private key; do not reserialize after signing. Placeholder paths only:

```text
<approved-external-offline-signer> --input <canonical-authorization.json> --detached-signature-output <canonical-authorization.json.sig>
run_g035 short-url-remediation-apply --service g035-local --service-file <restricted-local-service-file> --restore-receipt <fresh-external-restore-receipt.json> --inspect-receipt <short-url-remediation-inspect-receipt.json> --authorization <canonical-authorization.json> --authorization-signature <canonical-authorization.json.sig> > <short-url-remediation-apply-receipt.json>
run_g035 short-url-remediation-verify --service g035-local --service-file <restricted-local-service-file> --apply-receipt <short-url-remediation-apply-receipt.json> > <short-url-remediation-verify-receipt.json>
run_g035 clone-apply --service g035-local --service-file <restricted-local-service-file> --restore-receipt <fresh-external-restore-receipt.json> --short-url-remediation-receipt <short-url-remediation-verify-receipt.json> --psql <psql-command> > <clone-apply-receipt.json>
run_g035 local-postflight --service g035-local --service-file <restricted-local-service-file> --clone-receipt <clone-apply-receipt.json> --psql <psql-command> > <local-postflight-receipt.json>
```

The remediation quarantine is lossless local evidence: it retains deleted duplicate rows locally while no raw URLs or rows leave that quarantine. After clone application, the local state is `transformed_local_clone_not_exact_restore`; the exact restore receipt remains the prior truth. Production remains absent.
A repeat of `short-url-remediation-apply` is permitted only with the identical signed binding and batch after committed state; it performs no delete and rejects partial control state, drift, ACL changes, overlap, or a different batch. Postflight independently re-runs the rollback-only clone runtime SQL and compares its catalog and ledger fingerprints to the clone receipt.

## Data limits and cleanup

Logical PostgreSQL capture validates database state only. Supabase Auth configuration/state, Storage metadata, and physical Storage/blob contents have separate recovery characteristics; database restore does not prove blobs are recoverable.

After restore verification, remove temporary plaintext, local copied service files, and transient restore containers/volumes using the approved local procedure. Retain only encrypted captures and sanitized receipt/fingerprint records on the approved offline medium.
