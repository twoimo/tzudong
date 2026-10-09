# Snapshot-specific operational SQL receipts

These two files retain the exact version, filename and SQL bytes recorded during
the 2026-10-04 hosted recovery. They are outside `migrations/` because their gates
require specific historical ledger states (76 and 77 rows), rather than a fresh
schema. Moving them does not alter hosted history or authorize another execution.

`manifest.json` binds the original and current paths, source bytes, actual CLI
statement and statement-array hashes to the retained 78-row hosted readback.
That historical JSON and its original artifact map remain unchanged. Run
`python3 -m backend.supabase.scripts.operational_sql_receipts` from the repository
root to verify the archive without database access.

`g014_owner_recovery_plan.py` reads these archived sources when reconstructing
the separately gated historical stages. Their original caller, role, ledger,
catalog and cleanup checks are unchanged. The completed hosted state is not an
admitted input for rerunning them. Do not repair the ledger or make SQL aliases.

PG15 uses the independently registered, hash-bound catalog verifiers in
`local_replay_contract.py`. The canonical replay invokes them separately after
the fresh migration chain, reads back their proofs, and records hosted execution
and hosted ledger admission as false. This does not insert an applied migration
receipt or prove a hosted operation.
