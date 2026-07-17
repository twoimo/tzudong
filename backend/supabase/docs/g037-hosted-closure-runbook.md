# G037 hosted migration closure runbook

## Authority, scope, and hard stops

GitHub Actions is read-only for G037. It is dispatch-only from the exact detached SHA of protected `main`, uses the `g037-hosted-closure` concurrency group and protected `production-hosted-migration-closure` environment, and permits only source `validate` plus remote `preflight`, `readback`, `runtime-probe`, and `reconciliation-readback`. `validate` is the default and has no credentials. Never run production execution or any production apply in Actions; Actions has no private signing-key, authorization, recovery, or freeze-evidence path.

The controller binds the current commit to the authoritative G034 manifest: exactly 28 migrations, in its pinned order and hashes. G026 and versions `20260713002500`, `20260713002600`, and `20260713002700` are excluded and must never enter the selected ledger. `public.restaurants_backup` absence is a hard preflight stop. G035 receipts are recovery evidence only; they do not authorize production execution. G036 recovery closure must be bound before local execution.

Do not retry a self-committing migration with an ambiguous commit result. Stop, preserve sanitized receipt hashes, and investigate through provider support and human operators. Do not infer success from a timeout, disconnect, or partial receipt.

## Human-only prerequisites

Before any remote read-only preflight or local production execution, a human must maintain the human-only provider/ingress fence and quiescence: disable or block all application, worker, dashboard, API, direct-SQL, and provider ingress writes; verify no in-flight writers; and confirm the repository variable `G037_WRITE_FREEZE=active` is already set and verified. Operators must keep the freeze active through G038. Do not make any post-G037 claim that live account deletion or retention has resumed.

A human must collect fresh provider evidence for PITR/database recovery, Auth metadata/state recovery, Storage metadata recovery, and Storage/blob recovery RPO. Keep authorization, recovery, RPO, freeze, service, recipient, and signing-key materials in owner-restricted offline evidence/key paths. Backup material, provider exports, credentials, raw URLs, row data, keys, and secrets never go to GitHub repositories, Actions artifacts, caches, logs, arguments, releases, or issues. This procedure has a zero-cost/no-paid-service boundary: use no paid service or new paid backup destination.

Perform and record an offline rollback rehearsal before production execution. Keep only sanitized G036-bound recovery evidence with the closure record.

## Protected sequence

1. On the controlled local host, set and independently verify the repository variable `G037_WRITE_FREEZE=active`. Collect exactly five fresh owner-restricted residual-evidence artifacts: no owner write, no dashboard write, no provider write, no out-of-band write, and producer stop.
2. Run `g037_production_controller.py prepare` from the exact protected source checkout. It validates the source bindings, probes every reachable table lock in an ordinary transaction, rolls that transaction back, and atomically publishes a fresh signed operator assertion outside the repository. It performs no durable database mutation. Use `prepare --help` on the controlled host for the current argument contract.
3. Independently inspect the persisted signed assertion: verify its authorization signature, bounded expiry, current commit/manifest/source-root/terminal-spec bindings, inventory relation and ACL roots, and all five raw evidence hashes.
4. Run `g037_production_controller.py validate` with that exact assertion and the same five artifacts. Stop on any binding, signature, expiry, or evidence mismatch.
5. Run local-only `g037_production_controller.py rehearse` with fresh, outside-repository rehearsal receipt destinations. It performs the exact validated capture, cursor rehearsal, one terminal `apply_cursor`, terminal-root assertion, and managed recovery capture under the active signed capability, then rolls back the outer transaction. It has no commit path. It then opens a new read-only transaction and rejects unless the original inventory relation/ACL roots are restored. Its signed `g037-rehearsal-v1` `terminal-observed-before-rollback` and `rehearsed-rolled-back` artifacts are rehearsal evidence, not production prepared/final authority.
6. Independently verify the recovery archive and both signed rehearsal artifacts, including source/head/freeze/managed roots, terminal roots observed before rollback, and baseline roots observed after rollback. Stop on any mismatch.
7. Only then run local-only `g037_production_controller.py execute`. Execute is the sole commit-capable mode; it reacquires the actual locks and rechecks inventory and ACL roots. No GitHub Actions job may apply or execute this mutation.
8. After execute, ALWAYS run local `g037_production_controller.py reconcile` as the required post-readback gate to verify encrypted archives and live observed terminal roots and publish reconciled final/outcome receipts. Remote `reconciliation-readback` is supplementary only; dispatch it with readback and runtime-probe on the same bound commit while retaining the provider/ingress fence and write freeze through G038.
