# Restaurant evidence recovery

The review policy, source intake and recovery worker are separate. An enabled
review policy does not prove that new videos arrive or that held rows have been
processed. The admin status panel shows pending/held counts and the latest
restaurant input time; unavailable reads are not reported as an empty backlog.

## Review and recovery

New inputs follow the existing pending classifier. A held crawler row can be
selected through **근거 보강·처리 이력**. The server binds the current restaurant,
video, policy version and source hashes before Preview → Confirm → Request.
Admin/user authored rows, duplicates and outstanding or uncertain work remain
protected. A request does not reset status to pending.

The existing hosted pipeline's `--review-automation --evidence-recovery` mode
consumes at most one queued recovery before legacy rechecks and new videos.
All three share the existing `--limit` of one to three videos. Unknown results
reserve their slot. A one-slot recovery run does not start another recheck.
The flag neither creates a schedule nor enables a disabled workflow.

The worker defaults to metadata-only observation:

```sh
python3 backend/bin/run_restaurant_evidence_recovery.py --next --channel tzuyang
python3 backend/bin/run_restaurant_evidence_recovery.py --job-id JOB_UUID --channel tzuyang
```

Only an admitted, explicitly queued job may be run with `--allow-worker-write`.
Use Node 24 and a persistent private `--state-dir`. Preserve that directory
across executions. Never delete a journal to retry a job; reconcile the original
job and token through the read path. Do not print or upload journal contents.

Existing caches must match the claimed recollect references. A missing source
may be acquired once into private scratch. Fresh packets retain their actual
local versions, acquisition time and hashes separately from the original claim
references. They are not stamped with an old claimed version. Existing source
files and permanent no-transcript lists are preserved.

After source/rule validation, at most one existing Gemini judgment is dispatched
per claim. No model fallback or second recommendation is added. Successful work
creates a draft only. The admin sees the proposed address, identity, coordinates,
categories and evaluation grounds before a separate result-bound preview and
confirmation. Apply preserves the source fields and held status; ordinary
guarded approval must validate the saved row again.

## Failure and cleanup

Missing local data, unavailable providers, rate limits, version conflicts and
uncertain outcomes do not prove that the restaurant cannot be recovered. They
must not trigger deletion. Loading the evaluation page performs no cleanup.
Known source failures and unknown paid outcomes remain distinct in the ledger.

If evidence establishes that a row should leave active review, use the existing
guarded `restaurant.delete` flow with its specific reason, current-source
preview, confirmation, readback and audit. This is a status change preserving
the original; a failed recovery receipt is not cleanup authorization. A negative
evaluation or a completion-cache hit alone does not certify exhaustive evidence
acquisition. No automatic terminal-cleanup predicate is introduced here.

## Operating admission

The `daily-compute` job keeps its `G037_WRITE_FREEZE == cleared` condition.
The separate `hosted-pending-apply` job retains its exact default-branch,
protected-ref and `TZUDONG_HOSTED_DATA_PLANE_APPROVED == 1` admission. Re-enabling
a manually disabled workflow and altering any producer freeze are separate
operations. This change does not perform either operation or raise the budget.

Verify schema/RPC ownership and grants on the target PostgreSQL version, the
original-source and result hashes, the admin operation receipts, and the final
restaurant state independently. Local tests, public video metadata and a source
acquisition proof do not prove hosted approval or deployment.
