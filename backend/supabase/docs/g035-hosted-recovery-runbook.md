# G035 hosted recovery runbook

## Scope and stop rule

G035 is a fail-closed, local-only capture, restore, and clone rehearsal. It is never authorization to write to the hosted project and does not cover G026 or migration `20260713002500`. Do not use GitHub Actions artifacts, releases, caches, or repositories as a backup destination.

There is no hosted-apply implementation. Production remains human-blocked pending an offline durable destination and key, an explicit physical Storage/blob RPO decision and evidence, an active write freeze, and a separately reviewed executor. No G035 receipt authorizes production application.

Stop when a capture readiness artifact, receipt, commit, or live fingerprint differs; when capture returns a rejected receipt; or when a self-committing migration is ambiguous. Do not retry ambiguous self-committing migrations.

## Key custody and destination

Keep the encryption private key and recovery service definition offline under separate restricted custody. Never place either in a repository, ticket, chat, shell history, CI variable, artifact store, or this runbook. Record only approved fingerprints and receipt hashes in the change record.

Capture ciphertext only to an operator-controlled local encrypted volume. Restore verification only to the local/self-hosted `g035-local` service. A clone is a verification environment, not a production substitute.

## Safe command sequence

Run from the recovery checkout after an operator supplies restricted files through the approved local mechanism. The capture artifact must be the exact current artifact-version-2 G034 evidence: duplicate-free and exact-keyed, receipt-recomputed, source-valid and catalog-checked, with `safeToApply=false`. It may contain only the expected clone/backup/catalog-prerequisite remediation blockers. During the same persistent read-only source connection, G035 compares its ledger and catalog fingerprints to the artifact before dumping and emits a capture-readiness chain binding the artifact hash, preflight receipt ID, current commit, and live fingerprints.

```text
python backend/supabase/scripts/preflight_g034_hosted_migration_closure.py --artifact <local-preflight-artifact>
python backend/supabase/scripts/g035_hosted_recovery.py validate
python backend/supabase/scripts/g035_hosted_recovery.py capture …
python backend/supabase/scripts/g035_hosted_recovery.py restore-verify … --destination-service g035-local
python backend/supabase/scripts/g035_hosted_recovery.py clone-apply …
python backend/supabase/scripts/g035_hosted_recovery.py local-postflight …
```

## Data limits and cleanup

Logical PostgreSQL capture validates database state only. Supabase Auth configuration/state, Storage metadata, and physical Storage/blob contents have separate recovery characteristics; database restore does not prove blobs are recoverable.

After restore verification, remove temporary plaintext, local copied service files, and transient restore containers/volumes using the approved local procedure. Retain only encrypted captures and sanitized receipt/fingerprint records on the approved offline medium.
