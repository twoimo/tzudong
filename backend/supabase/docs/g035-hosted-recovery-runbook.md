# G035 hosted recovery runbook

## Scope and stop rule

G035 is a fail-closed, local-only capture, restore, remediation, and clone rehearsal. It is never authorization to write to the hosted project and does not cover G026 or migration `20260713002500`. Do not use GitHub Actions artifacts, releases, caches, or repositories as a backup destination.

There is no hosted-apply implementation. Production remains human-blocked pending an offline durable destination and key, an explicit physical Storage/blob RPO decision and evidence, an active write freeze, and a separately reviewed executor. No G035 receipt authorizes production application.

Stop when a capture readiness artifact, receipt, commit, or live fingerprint differs; when capture returns a rejected receipt; or when a self-committing migration is ambiguous. Do not retry ambiguous self-committing migrations.

## Key custody and destination

Keep the encryption private key, offline Ed25519 signing key, and recovery service definitions offline under separate restricted custody. Never place a private key, signing operation, raw URL, quarantine row, or service credential in a repository, ticket, chat, shell history, CI variable, artifact store, or this runbook. The workflow consumes only restrictive local files. The remediation verifier uses the authorization public key pinned in source; the private signing key remains offline.

Capture ciphertext only to an operator-controlled local encrypted volume. Restore verification and every remediation/clone/postflight operation use only the local/self-hosted `g035-local` service. A clone is a verification environment, not a production substitute.

## Safe command sequence

Run from the recovery checkout after an operator supplies restricted files through the approved local mechanism. Each `> <...-receipt.json>` destination is a fresh absolute path outside the checkout; do not overwrite or reuse a receipt path. The capture artifact must be the exact current artifact-version-2 G034 evidence: duplicate-free and exact-keyed, receipt-recomputed, source-valid and catalog-checked, with `safeToApply=false`. It may contain only the expected clone/backup/catalog-prerequisite remediation blockers. During the same persistent read-only source connection, G035 compares its ledger and catalog fingerprints to the artifact before dumping and emits a capture-readiness chain binding the artifact hash, preflight receipt ID, current commit, and live fingerprints.

```text
python backend/supabase/scripts/preflight_g034_hosted_migration_closure.py --artifact <local-preflight-artifact>
python backend/supabase/scripts/g035_hosted_recovery.py validate
python backend/supabase/scripts/g035_hosted_recovery.py capture --destination <existing-encrypted-capture-directory> --service-file <restricted-hosted-service-file> --recipient <encryption-recipient> --g034-artifact <local-preflight-artifact> --pg-dump <pg-dump-command> --encrypt-command <encrypt-command> > <capture-receipt.json>
python backend/supabase/scripts/g035_hosted_recovery.py restore-verify --dump <encrypted-capture-file> --capture-receipt <capture-receipt.json> --service-file <restricted-local-service-file> --destination-service g035-local --identity-file <restricted-identity-file> --decrypt-command <decrypt-command> --pg-restore <pg-restore-command> > <restore-verify-receipt.json>
python backend/supabase/scripts/g035_hosted_recovery.py short-url-remediation-inspect --service g035-local --service-file <restricted-local-service-file> --restore-receipt <restore-verify-receipt.json> > <short-url-remediation-inspect-receipt.json>
```

The capture command writes the generated ciphertext file `g035-dump.enc` inside `<existing-encrypted-capture-directory>`.

Review only the inspection receipt's non-sensitive hashes and counts: receipt hash, receipt-chain hashes, catalog/selection/rowset/victim hashes, duplicate-group count, and duplicate-victim count. Do not export, display, or copy raw URLs or rows from the local quarantine.

Create the authorization JSON offline as canonical JSON: UTF-8 bytes exactly equivalent to sorted-key, compact JSON (`json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True)`). It must contain exactly the parser's authorization schema fields and bind the inspection receipt, restore receipt, capture receipt, manifest, repository commit, selection/catalog/rowset/victim hashes, counts, and an operator-generated canonical UUID batch ID. Sign those exact authorization-file bytes with the offline Ed25519 private key; do not reserialize after signing. Placeholder paths only:

```text
openssl pkeyutl -sign -rawin -inkey <offline-ed25519-private-key-path> -in <canonical-authorization.json> -out <canonical-authorization.json.sig>
python backend/supabase/scripts/g035_hosted_recovery.py short-url-remediation-apply --service g035-local --service-file <restricted-local-service-file> --restore-receipt <restore-verify-receipt.json> --inspect-receipt <short-url-remediation-inspect-receipt.json> --authorization <canonical-authorization.json> --authorization-signature <canonical-authorization.json.sig> > <short-url-remediation-apply-receipt.json>
python backend/supabase/scripts/g035_hosted_recovery.py short-url-remediation-verify --service g035-local --service-file <restricted-local-service-file> --apply-receipt <short-url-remediation-apply-receipt.json> > <short-url-remediation-verify-receipt.json>
python backend/supabase/scripts/g035_hosted_recovery.py clone-apply --service g035-local --service-file <restricted-local-service-file> --restore-receipt <restore-verify-receipt.json> --short-url-remediation-receipt <short-url-remediation-verify-receipt.json> --psql <psql-command> > <clone-apply-receipt.json>
python backend/supabase/scripts/g035_hosted_recovery.py local-postflight --service g035-local --service-file <restricted-local-service-file> --clone-receipt <clone-apply-receipt.json> > <local-postflight-receipt.json>
```

The remediation quarantine is lossless local evidence: it retains deleted duplicate rows locally while no raw URLs or rows leave that quarantine. After clone application, the local state is `transformed_local_clone_not_exact_restore`; the exact restore receipt remains the prior truth. Production remains absent.

## Data limits and cleanup

Logical PostgreSQL capture validates database state only. Supabase Auth configuration/state, Storage metadata, and physical Storage/blob contents have separate recovery characteristics; database restore does not prove blobs are recoverable.

After restore verification, remove temporary plaintext, local copied service files, and transient restore containers/volumes using the approved local procedure. Retain only encrypted captures and sanitized receipt/fingerprint records on the approved offline medium.
