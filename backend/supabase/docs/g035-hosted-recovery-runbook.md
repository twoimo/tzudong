# G035 hosted recovery runbook

## Scope and stop rule

G035 is a fail-closed, local-only capture, restore, remediation, and clone rehearsal. It is never authorization to write to the hosted project and does not cover G026 or migration `20260713002500`. Do not use GitHub Actions artifacts, releases, caches, or repositories as a backup destination.

There is no hosted-apply implementation. Production remains human-blocked pending an offline durable destination and key, an explicit physical Storage/blob RPO decision and evidence, an active write freeze, and a separately reviewed executor. No G035 receipt authorizes production application.

Stop when a capture readiness artifact, receipt, commit, or live fingerprint differs; when capture returns a rejected receipt; or when a self-committing migration is ambiguous. Do not retry ambiguous self-committing migrations.

## Key custody and destination

Keep the encryption private key, offline Ed25519 signing key, and recovery service definitions offline under separate restricted custody. Never place a private key, signing operation, raw URL, quarantine row, or service credential in a repository, ticket, chat, shell history, CI variable, artifact store, or this runbook. Capture and non-restore rehearsal modes consume only restrictive local files. Restore is deliberately unavailable from the GitHub Actions workflow: an approved external local custodian must supply the age identity through one selectively inherited anonymous pipe, never a key path, environment variable, regular file descriptor, or broad handle inheritance. The remediation verifier uses the authorization public key pinned in source; the private signing key remains offline.

Capture ciphertext only to an operator-controlled local encrypted volume. Capture accepts only the source-pinned approved age recipient; restore requires the capture receipt recipient fingerprint to match that pin, without recording private identity material. The restore child accepts exactly one inherited channel: `--identity-fd <read-fd>` on POSIX or `--identity-handle <read-handle>` on Windows. The parent custodian must create an anonymous pipe, selectively inherit only its read end, write the identity bytes through the pipe, close both parent ends, and disclose neither the identity path nor bytes to the child argv, environment, output, or receipt. Restore verification and every remediation/clone/postflight operation use only the local/self-hosted `g035-local` service with numeric `127.0.0.1` or `::1`, never hostnames or sockets. A clone is a verification environment, not a production substitute.
The macOS custody rotation invalidates all ciphertext encrypted to the pre-rotation age recipient and all remediation authorizations signed by the pre-rotation authority. They must not be replayed; create fresh ciphertext and authorization under the source-pinned rotated custody.

## Safe command sequence

Run from the recovery checkout after an operator supplies restricted files through the approved local mechanism. Every stdout-redirected receipt destination and the source-published restore receipt destination is a fresh absolute path outside the checkout; do not overwrite or reuse a receipt path. The capture artifact must be the exact current artifact-version-2 G034 evidence: duplicate-free and exact-keyed, receipt-recomputed, source-valid and catalog-checked, with `safeToApply=false`. It may contain only the expected clone/backup/catalog-prerequisite remediation blockers. During the same persistent read-only source connection, G035 compares its ledger and catalog fingerprints to the artifact before dumping and emits a capture-readiness chain binding the artifact hash, preflight receipt ID, current commit, and live fingerprints.

```sh
AUTHORIZED_COMMIT='<EXACT_40_HEX_RECOVERY_COMMIT>'
BOOTSTRAP='backend/supabase/scripts/g040_isolated_bootstrap.py'
RESTORE_ENTRYPOINT='backend/supabase/scripts/g035_hosted_recovery.py'
run_g035() {
  git show "$AUTHORIZED_COMMIT:$BOOTSTRAP" | python3 -I - \
    --repository-root "$PWD" --authorized-final-commit "$AUTHORIZED_COMMIT" \
    --entrypoint "$RESTORE_ENTRYPOINT" -- "$@"
}
python backend/supabase/scripts/preflight_g034_hosted_migration_closure.py --artifact <local-preflight-artifact>
run_g035 validate
run_g035 capture --destination <existing-encrypted-capture-directory> --service-file <restricted-hosted-service-file> --recipient <encryption-recipient> --g034-artifact <local-preflight-artifact> --pg-dump <pg-dump-command> --encrypt-command <encrypt-command> > <capture-receipt.json>
git show "$AUTHORIZED_COMMIT:$BOOTSTRAP" | <approved-selective-inheritance-custodian> --identity-fd 3 --close-writer-after-write -- python3 -I - \
  --repository-root "$PWD" --authorized-final-commit "$AUTHORIZED_COMMIT" \
  --entrypoint "$RESTORE_ENTRYPOINT" -- restore-verify \
  --dump <encrypted-capture-file> --capture-receipt <capture-receipt.json> \
  --restore-receipt <fresh-external-restore-receipt.json> --service-file <restricted-local-service-file> \
  --destination-service g035-local --identity-fd 3 --decrypt-command <decrypt-command> --pg-restore <pg-restore-command>
run_g035 short-url-remediation-inspect --service g035-local --service-file <restricted-local-service-file> --restore-receipt <fresh-external-restore-receipt.json> > <short-url-remediation-inspect-receipt.json>
```

The capture command writes the generated ciphertext file `g035-dump.enc` inside `<existing-encrypted-capture-directory>`. The restore lines show the POSIX bootstrap child argv. The approved custodian writes the complete identity bytes and closes its writer immediately so age observes EOF. On Windows it uses an explicit handle allowlist and substitutes `--identity-handle <canonical-inherited-handle>` in both the custodian selector and restore argv. Do not invoke the restore entrypoint directly, redirect its stdout, or expose a private-key path in either process. A successful child publishes canonical receipt bytes itself to `--restore-receipt` and remains silent; failure publishes nothing.

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
