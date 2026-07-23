# G038 account-deletion successor runtime proof

## Status and authority boundary

This is a source-only operator contract for a later, separately approved runtime proof. It does not authorize a deployment, a hosted run, a credential change, a worker start, or a production mutation. The fixed predecessor report is `85f6b1e6e34e3311bbffd7146232ca41d6393bdd43688d4ebd7b230bdf929114`, the predecessor commit is `664cee04a4f239d6cf8fe2eebab8de9c8404b316`, and the target fingerprint is `defdf3cc65753b4b4dcaa321b16b4347278239ae08e41f19a2d98fec9f3a0331`. The controller must separately supply the exact 40-hex protected-main commit containing G038; an abbreviated or preselected candidate commit is not authority.

`backend/supabase/scripts/g038_runtime_proof.py` is domain-separated from G034, G037, and G040 recovery authority. It does not change their contracts and does not import a recovery controller. Migration `20260713002500` and every G026 reconstruction path are excluded.

`g038_runtime_proof.py` is an abstract fail-closed acceptance contract, not an executable hosted adapter. The exact `02600`/`02700` deployed surface cannot honestly provide its isolated negative-reauth suite, pre-worker bound storage inventory, post-Auth status authority, or split retention confirm/finalize receipts without an additional migration and separately deployed routes. Because this successor is immutably limited to `02600` and `02700`, no operator may invoke, simulate, or claim completion of the runtime proof from this source. The protected migration rehearsal and 40→42 hosted closure may proceed only through their independent controller gates; the runtime-proof goal remains blocked until a separately approved successor contract changes that migration/API scope. Adapter constants, mocks, private SQL, service-role credentials, and inferred server facts are not substitutes.

## Mandatory human credential gate

A named human must create and designate one disposable account through the normal user path. The account must be self-owned, non-admin, not the last admin, and contain no valuable or third-party data. The human, not automation, must control its email and fresh password credential and must attest the designation in a separately signed opaque binding. The binding may be verified by the injected verifier only; the orchestrator accepts no UUID, email, lookup expression, list result, or queue result as a substitute.

The human must obtain a normal fresh-password AMR session immediately before the proof window. Passwords, access or refresh tokens, cookies, authorization headers, proof identifiers, signing keys, and signature bytes must never be placed in a command line, log, report, fixture, screenshot, or result. A credential, session, or signature presented through chat is an immediate stop.

## Admission checklist

All items are required before any injected adapter may be called:

1. The signed opaque binding verifies under the separately controlled authorization key and exactly binds the predecessor report, predecessor commit, protected-main source commit, target fingerprint, terminal readback, and freeze assertion.
2. The binding is unexpired, lasts no more than 15 minutes, and asserts disposable, self-owned, non-admin, no non-test subject selection, and continuously stopped scheduled workers.
3. The exact bound account has zero storage objects. Nonzero storage is not supported by G038. An exact per-object binding could be a future contract, but there is no fallback now.
4. The bound retention class-code hash, raw class code held only inside the adapter call, cutoff, and operation-binding hash all match. The runtime result receives only the class-code hash.
5. The G037/G040 write-freeze evidence remains continuous from admission through the final durable signature. Account-deletion and privacy-retention scheduled workflows remain stopped with no in-flight work.
6. The selected environment and all endpoints have been approved for this one proof. There is no paid service purchase, paid-provider call, DNS change, deployment, secret rotation, project relink, or hosted automation mutation in this procedure.

## Injected APIs

`build_runtime_proof` requires keyword-only `signed_opaque_binding`, `expected_source_commit`, `now`, `verifier`, `continuity`, `account_deletion`, `retention`, and `signer`. It returns the sanitized `g038-runtime-proof-v1` payload only after the signer confirms durable publication of the exact canonical bytes before the controller continuity expiry and runtime deadline.

The verifier exposes only `verify_subject_binding(bytes) -> VerifiedSubjectBinding`. The controller-owned continuity callback exposes `confirm_fresh_continuity(expected_freeze_assertion_sha256=..., deadline_unix=...) -> ControllerContinuityReceipt`. The deletion adapter exposes bounded methods for `fresh_password_session`, `preview_self_delete`, `issue_reauth_proof`, four negative reauthentication probes, `delete_self`, `list_bound_storage`, `drive_bound_phase`, and `read_bound_status`. The retention adapter exposes only `preview_bound`, `confirm_bound`, and `finalize_bound`. Every effect method receives the orchestrator deadline.

Adapters must be narrowly implemented against normal deployed surfaces. They must not implement or call claim-next, list-and-pick, oldest-first, random selection, unbound queue claiming, admin deletion, or service-role proof issuance. `SelfDeleteRequest` is the exact seven-field body: `userId`, `proofId`, `requestId`, `previewHash`, `confirmationText`, `idempotencyKey`, and `sourceManifestHash`. No eighth field or omitted field is allowed.

The normal route authenticates the bearer and checks the current owner before it performs its replay readback. Consequently, replay evidence is admissible only while Auth still contains the subject: after the first `DELETE` has completed database cleanup and returned `in_progress` / `DB_READBACK_PASSED`, but before any worker phase, especially `auth`, is driven. Both replay receipts must attest `pre_auth_db_cleanup_complete`, successful route authentication, and Auth-subject presence. A same-key request must return the unchanged bounded counts; a request differing only in its key must prove `IDEMPOTENCY_KEY_MISMATCH`. Never attempt either replay after the Auth phase. Final completion evidence comes only from the exact owner-bound status readback after the three bound worker phases; it is not a post-deletion `DELETE` replay.

## Bound execution order

1. Verify the opaque signed binding and its admitted freeze assertion.
2. Establish the bound subject's fresh-password AMR session.
3. Preview self-deletion for that same bound subject and issue the normal reauthentication proof.
4. Prove fail-closed denial for wrong session, wrong user, expiry, and consumed/replayed proof. Each probe uses an isolated proof; it must not consume or weaken the proof used for the designated deletion.
5. Submit the exact seven-field self `DELETE`. Require the route's post-database-cleanup, pre-Auth state: `in_progress` / `DB_READBACK_PASSED`, unchanged bounded nonnegative counts, route authentication true, and Auth-subject presence true.
6. While that same pre-Auth state is current, repeat the identical seven-field request with the same idempotency key and require the same state and counts. Then submit the bound mismatch probe, changing only the idempotency key, and require `IDEMPOTENCY_KEY_MISMATCH`. Both probes must finish before any worker phase.
7. List storage only for the bound request. Stop unless the count is exactly zero.
8. Drive exactly `session`, `storage`, then `auth` for the bound request. Even an empty storage phase must verify absence. A receipt that indicates a queue claim or another subject is a denial.
9. Use the exact owner-bound status/readback surface, not `DELETE`, to require durable `APPLIED`, reason `APPLIED`, unchanged bounded counts, database/storage/sessions/auth readbacks all true, no storage receipt references, and one bounded auth receipt reference.
10. Preview only the signed retention class and cutoff. Stop unless eligible, held, and scanned are each exactly zero. Only after that zero preview may the adapter confirm and finalize the same bound operation.
11. Require retention `APPLIED`, reason `APPLIED`, and all four readbacks: `expectedCountMatched`, `databaseSourceAbsent`, `storageProviderAbsent`, and `noActiveHoldMutated`.
12. As the final callback before payload construction and signing, the controller must freshly recheck continuous freeze, scheduled-worker stop, and absence of in-flight work. The receipt binds the original freeze assertion, a 64-hex worker-state digest, observation/expiry times, and all three true assertions; its independently recomputed canonical evidence digest is placed in the signed body. It must be observed during this run, expire within 30 seconds, and expire no later than the runtime/binding deadline.
13. Canonicalize the complete sanitized body exactly once as ASCII JSON with `ensure_ascii=True`, lexicographically sorted keys, and separators `(",", ":")`. Pass exactly those bytes—not a mapping and not an expanded envelope—to `sign_and_store(canonical_payload, deadline_unix=...)`. Independently SHA-256 those same bytes and require the signer's digest to match. Require durable publication at or after the continuity observation and strictly before its expiry, and no later than the publication deadline.

## Protected local dual-clone invocation

The dual-clone adapter is local-only evidence generation. Run it only from the protected commit's `backend/supabase/scripts` directory, through the isolated bootstrap, with the exact protected-main root and the full authorized 40-hex final commit:

```text
python -I g038_isolated_bootstrap.py --repository-root <exact-main-root> --authorized-final-commit <sha> --entrypoint backend/supabase/scripts/g038_local_clone_adapter.py -- --source-root <exact-main-root> --run-root <private-empty-run-root> --source-receipt <private-source-validation-receipt> --source-attestation-bundle <private-source-attestation-bundle> --gh-path <absolute-pinned-darwin-gh-2.96.0> --archive <private-capture-archive> --capture-receipt <private-capture-receipt> --backup-receipt <private-backup-receipt> --predecessor-report <private-predecessor-report> --predecessor-final-receipt <private-predecessor-final-receipt> --predecessor-readback-receipt <private-predecessor-readback-receipt> --freeze-receipt <private-freeze-receipt> --output <new-private-evidence-path> --identity-fd-1 3 --identity-fd-2 4 --clone-signing-key-fd 5 --deadline-epoch <absolute-unix-deadline> --docker /usr/local/bin/docker --git /usr/bin/git --age /opt/homebrew/bin/age --pg-restore /opt/homebrew/opt/postgresql@17/bin/pg_restore
```

A private launcher must create three distinct anonymous one-shot pipes, place their read ends at inherited descriptors 3, 4, and 5, and use its subprocess equivalent of `pass_fds=(3,4,5)`. It writes exactly one clone-1 restore identity to descriptor 3, one independently issued clone-2 restore identity to descriptor 4, and one clone receipt signing key to descriptor 5; it then closes every write end. Never use files, environment variables, command-line values, reused pipe identities, terminal input, or repository paths for these secrets. The adapter duplicates each read end as non-inheritable and closes the inherited descriptor before consuming it.

The admitted Darwin tool profile is exact: Docker `29.6.2` (`Docker version 29.6.2, build dfc4efb1e2`, executable SHA-256 `eade1c3a5dda47534dc776f2f534c99cc94cfcf9ce07c4bf09e98258d13e7d7a`), Apple Git `2.50.1` (`git version 2.50.1 (Apple Git-155)`, SHA-256 `179301dcb41ea78accc3fa0048a7e6f6710d891945a751a34addd622020c1818`), age `v1.3.1` (SHA-256 `f52e5ee772e1c0e3c6be5bf837b469a40346df3515db9a1b41230376fdff6a76`), and Homebrew `pg_restore` 17.10 (SHA-256 `6dc5fa5b2d2dfff6ae9919162f50cede4408475f1caf05e3da8e960354f60115`). Resolved executables must be root- or operator-owned and not group/world writable. Docker must use a local `unix://` context; `DOCKER_HOST`, `DOCKER_CONTEXT`, TCP/SSH endpoints, hosted databases, hosted storage, hosted automation, and every network/production mutation are prohibited.

The source root and every admitted source byte come from the authorized commit. The archive, capture receipt, backup receipt, predecessor report, predecessor final receipt, predecessor terminal readback receipt, continuous freeze receipt, identities, signing key, run root, and evidence destination remain private and outside the repository. Only migrations `20260713002600` and `20260713002700` may be compiled or applied, and only inside the two labelled disposable local clones. The adapter requires both predecessor final and predecessor readback receipts and rejects mixed starting roots, different capture lineage, unpinned tools/images, remote Docker, or any excluded `20260713002500` / G026 source.

The adapter always attempts to remove both labelled clone containers, their labelled networks, generated service files, restore receipts, and all pipe descriptors, on success or failure. A cleanup error or any surviving labelled resource invalidates the run and no evidence is admissible. The output path must not already exist; publish it atomically only after both clones independently attest the same terminal roots, rollback/apply separation, custody continuity, and successful cleanup, and after the dedicated clone key signs the canonical receipt. Preserve the signed sanitized receipt plus external source/authorization/freeze/predecessor evidence in the approved private evidence store. Do not preserve service files, endpoints, raw identities, keys, archives, private paths, container metadata, or clone volumes in the repository. GitHub remains source-only: do not add clone execution, Docker, secrets, artifact upload, or hosted access to its workflow.

## Non-authorizing production controller recovery sequence

This section records operator recovery mechanics only. It does not grant approval, create an authorization, permit hosted access, or permit a production mutation. Before starting, establish private custody outside the checkout: the canonical one-shot journal directory is `/var/lib/tzudong-recovery/g038-successor-attempt-journal`, the fixed controller receipt key is `~/.g038-successor/g038-receipt-signing-key.pem`, and every input/output parent directory must be operator- or root-owned, restrictive, non-symlinked, and outside the repository. Journal markers and receipts are create-once files. Never copy a key, service file, endpoint, credential, authorization payload, signature, archive identity, or private path into source control, shell history, logs, or chat.

Run every controller mode from the protected commit's `backend/supabase/scripts` directory. The `--` after the bootstrap options is one required dispatch separator in these templates; do not repeat it or place another separator among the controller arguments.

Dispatch the source-only workflow on protected `main`; never fabricate or regenerate its receipt locally:

```text
<operator-gh> workflow run .github/workflows/g038-account-deletion-successor.yml \
  --repo twoimo/tzudong \
  --ref main \
  -f commit_sha=<full-40-hex-protected-main-commit>
<operator-gh> run list \
  --repo twoimo/tzudong \
  --workflow .github/workflows/g038-account-deletion-successor.yml \
  --branch main \
  --commit <full-40-hex-protected-main-commit> \
  --event workflow_dispatch \
  --limit 2 \
  --json databaseId,event,headBranch,headSha,status,conclusion,workflowName
<operator-gh> run watch <exact-run-id> --repo twoimo/tzudong --exit-status
<operator-gh> run view <exact-run-id> --repo twoimo/tzudong \
  --json conclusion,event,headBranch,headSha,workflowName
<operator-gh> run download <exact-run-id> --repo twoimo/tzudong \
  --name g038-account-deletion-successor-source-receipt \
  --dir <new-empty-private-source-artifact-directory>
```

Stop unless the filtered run list contains exactly one row; use only that row's `databaseId` as `<exact-run-id>`. Stop unless the watched and viewed run has `conclusion: success`, `event: workflow_dispatch`, `headBranch: main`, the exact protected-main `headSha`, and the exact G038 source-validation workflow name. The downloaded artifact must contain the exact `receipt.json` and exact attestation bundle generated by that successful run. Keep both owner-only and outside the repository. The operational verifier is the owner-owned, mode `0700`, non-symlink Darwin GitHub CLI 2.96.0 executable outside the repository with SHA-256 `02d2d4a85241c6a8c0b77ebb1ec76fc723caf7fb128e00915b306b968847cba1`. Every controller mode below performs offline verification equivalent to `gh attestation verify <receipt> --bundle <bundle> --repo twoimo/tzudong --signer-workflow github.com/twoimo/tzudong/.github/workflows/g038-account-deletion-successor.yml --source-ref refs/heads/main --source-digest <full-40-hex-protected-main-commit> --deny-self-hosted-runners --format json`; no network fetch, caller-supplied digest, or optional bundle is admissible.

Observe the locked service read-only:

```text
python -I g038_isolated_bootstrap.py \
  --repository-root <exact-main-root> \
  --authorized-final-commit <full-40-hex-protected-main-commit> \
  --entrypoint backend/supabase/scripts/g038_production_controller.py -- \
  observe \
  --repository-root <exact-main-root> \
  --source-commit <full-40-hex-protected-main-commit> \
  --source-receipt <private-source-validation-receipt> \
  --source-attestation-bundle <private-source-attestation-bundle> \
  --gh-path <absolute-pinned-darwin-gh-2.96.0> \
  --predecessor-report <private-predecessor-report> \
  --predecessor-final-receipt <private-predecessor-final-receipt> \
  --predecessor-readback-receipt <private-predecessor-readback-receipt> \
  --service-file <restricted-locked-service-file> \
  --service-name <locked-production-service-name> \
  --observation-receipt <new-private-observation-receipt>
```

Capture the production backup while the freeze remains continuous:

```text
python -I g038_isolated_bootstrap.py \
  --repository-root <exact-main-root> \
  --authorized-final-commit <full-40-hex-protected-main-commit> \
  --entrypoint backend/supabase/scripts/g038_production_controller.py -- \
  production-backup \
  --repository-root <exact-main-root> \
  --source-commit <full-40-hex-protected-main-commit> \
  --source-receipt <private-source-validation-receipt> \
  --source-attestation-bundle <private-source-attestation-bundle> \
  --gh-path <absolute-pinned-darwin-gh-2.96.0> \
  --predecessor-report <private-predecessor-report> \
  --predecessor-final-receipt <private-predecessor-final-receipt> \
  --predecessor-readback-receipt <private-predecessor-readback-receipt> \
  --observation <private-observation-receipt> \
  --freeze-assertion <private-current-freeze-assertion> \
  --destination <private-empty-backup-directory> \
  --capture-receipt <new-private-capture-receipt> \
  --archive <private-empty-backup-directory>/g035-dump.enc \
  --service-file <restricted-locked-service-file> \
  --recipient <approved-age-recipient> \
  --g034-artifact <private-g034-artifact> \
  --pg-dump <absolute-pinned-postgresql-17.10-pg-dump> \
  --encrypt-executable <absolute-pinned-age-1.3.1> \
  --output <new-private-backup-receipt>
```

After the dual-clone run has succeeded, prepare the exact authority bindings without production mutation:

```text
python -I g038_isolated_bootstrap.py \
  --repository-root <exact-main-root> \
  --authorized-final-commit <full-40-hex-protected-main-commit> \
  --entrypoint backend/supabase/scripts/g038_production_controller.py -- \
  prepare \
  --repository-root <exact-main-root> \
  --source-commit <full-40-hex-protected-main-commit> \
  --source-receipt <private-source-validation-receipt> \
  --source-attestation-bundle <private-source-attestation-bundle> \
  --gh-path <absolute-pinned-darwin-gh-2.96.0> \
  --predecessor-report <private-predecessor-report> \
  --predecessor-final-receipt <private-predecessor-final-receipt> \
  --predecessor-readback-receipt <private-predecessor-readback-receipt> \
  --observation <private-observation-receipt> \
  --freeze-assertion <private-current-freeze-assertion> \
  --backup-receipt <private-backup-receipt> \
  --capture-receipt <private-capture-receipt> \
  --archive <private-encrypted-archive> \
  --dual-clone-receipt <private-dual-clone-receipt> \
  --disposable-runtime-subject-sha256 <64-hex-runtime-subject-hash> \
  --disposable-runtime-proof-contract-sha256 <64-hex-runtime-proof-contract-hash> \
  --authority-template <new-private-authority-bindings>
```

The operator may build the one-shot request from that unchanged template, then must transfer the request to the separately controlled authorizer for detached signing:

```text
python -I g038_successor_authorization.py build-request \
  --repository-root <exact-main-root> \
  --bindings <private-authority-bindings> \
  --authorization-id <unique-authorization-id> \
  --attempt-id <unique-attempt-id> \
  --valid-seconds 600 \
  --output <new-private-authorization-request>
```

After the independent authorizer returns the unchanged authorization and detached signature, verify the handoff against the same bindings:

```text
python -I g038_successor_authorization.py verify \
  --repository-root <exact-main-root> \
  --bindings <private-authority-bindings> \
  --authorization <private-authorization-request> \
  --signature <private-detached-authorization-signature>
```

The freeze assertion is the immutable signed chain anchor, not live continuity proof. Before the human stop, independently provision a read-only freeze monitor outside the checkout. It owns no mutation API, hosted credential exposed to this workflow, or private key in source; it signs with the existing fixed G038 freeze-domain key and exposes only a restrictive owner-only AF_UNIX socket in an owner-only directory. For every request it must reject duplicate challenges, observe production anew, and return exact canonical signed evidence mirroring the challenge, checkpoint, request/deadline, source/runtime/target/freeze roots, authorization/attempt/prepared/executor hashes, state hash, and parent evidence hash. It also supplies its monotonic continuity epoch, observation/expiry, exact five zero/stopped residual-channel observations, three true continuity assertions, and the derived worker-state hash. Observations must follow the request, be no more than five seconds old, expire within thirty seconds, and expire by the request deadline.

**HUMAN STOP BEFORE EXECUTE:** a designated human must inspect the retained source, observation, freeze, backup, capture, dual-clone, template, and successful authorization-verification evidence; confirm the exact service, commit, one-shot attempt, and unexpired authorization; and explicitly approve this mutation. Automation, successful `prepare`, successful `verify`, or possession of the authorization is not approval. Without that explicit human decision, stop here.

Only after that stop is released, execute exactly once:

```text
python -I g038_isolated_bootstrap.py \
  --repository-root <exact-main-root> \
  --authorized-final-commit <full-40-hex-protected-main-commit> \
  --entrypoint backend/supabase/scripts/g038_production_controller.py -- \
  execute \
  --repository-root <exact-main-root> \
  --source-commit <full-40-hex-protected-main-commit> \
  --source-receipt <private-source-validation-receipt> \
  --source-attestation-bundle <private-source-attestation-bundle> \
  --gh-path <absolute-pinned-darwin-gh-2.96.0> \
  --predecessor-report <private-predecessor-report> \
  --predecessor-final-receipt <private-predecessor-final-receipt> \
  --predecessor-readback-receipt <private-predecessor-readback-receipt> \
  --observation <private-observation-receipt> \
  --freeze-assertion <private-current-freeze-assertion> \
  --backup-receipt <private-backup-receipt> \
  --capture-receipt <private-capture-receipt> \
  --archive <private-encrypted-archive> \
  --dual-clone-receipt <private-dual-clone-receipt> \
  --disposable-runtime-subject-sha256 <64-hex-runtime-subject-hash> \
  --disposable-runtime-proof-contract-sha256 <64-hex-runtime-proof-contract-hash> \
  --service-file <restricted-locked-service-file> \
  --service-name <locked-production-service-name> \
  --authorization <private-authorization-request> \
  --authorization-signature <private-detached-authorization-signature> \
  --freeze-monitor-socket <owner-only-external-monitor-socket> \
  --precommit-checkpoint-receipt <new-private-precommit-checkpoint-receipt> \
  --postcommit-checkpoint-receipt <new-private-postcommit-checkpoint-receipt> \
  --prepared-receipt <new-private-prepared-receipt> \
  --final-receipt <new-private-execute-final-receipt>
```

Perform the mandatory historical readback with a distinct final-receipt path:

```text
python -I g038_isolated_bootstrap.py \
  --repository-root <exact-main-root> \
  --authorized-final-commit <full-40-hex-protected-main-commit> \
  --entrypoint backend/supabase/scripts/g038_production_controller.py -- \
  readback \
  --repository-root <exact-main-root> \
  --source-commit <full-40-hex-protected-main-commit> \
  --source-receipt <private-source-validation-receipt> \
  --source-attestation-bundle <private-source-attestation-bundle> \
  --gh-path <absolute-pinned-darwin-gh-2.96.0> \
  --service-file <restricted-locked-service-file> \
  --service-name <locked-production-service-name> \
  --authorization <private-authorization-request> \
  --authorization-signature <private-detached-authorization-signature> \
  --freeze-monitor-socket <owner-only-external-monitor-socket> \
  --continuity-parent-receipt <private-precommit-or-postcommit-checkpoint-receipt> \
  --historical-checkpoint-receipt <new-private-historical-checkpoint-receipt> \
  --prepared-receipt <private-prepared-receipt> \
  --final-receipt <new-private-historical-readback-final-receipt>
```

The exact controller order is:

1. Dispatch the protected-main source-validation workflow for the exact full commit, require its successful conclusion and exact protected-main metadata, then download and retain its canonical unsigned source-validation receipt and exact GitHub Sigstore/SLSA attestation bundle. Do not run `g038_production_controller.py validate-source` locally.
2. Run `observe` read-only against the named locked production service, supplying all three fixed predecessor artifacts. Require exact predecessor state (`40` rows and predecessor roots), and retain the signed observation receipt.
3. While the continuous freeze still attests stopped account-deletion/privacy-retention workers and no in-flight work, run `production-backup`. Retain its signed backup receipt, signed capture receipt, and encrypted archive in the approved private evidence store. Do not continue on an expired or discontinuous freeze.
4. Restore that captured production archive into two genuinely separate disposable local clones and run the protected dual-clone procedure above. This is a real restore-and-apply rehearsal, not a mocked, empty, or synthesized receipt. Both clones must independently start at the predecessor roots and finish at the same exact 42-row terminal roots; cleanup must succeed. Retain only the signed sanitized dual-clone receipt and the approved external evidence.
5. Run `prepare` with the observation, current freeze assertion, backup/capture/archive, real dual-clone receipt, predecessor artifacts, and the two opaque runtime hashes. It writes a fresh canonical authority template outside the checkout and performs no production mutation.
6. Transfer that exact template to the independent authorizer. Only an external, explicit, unexpired one-shot authorization and detached signature for those exact bindings may be returned. Preparing, documenting, or possessing the template is not authorization. Do not inspect, rewrite, broaden, or reuse the authorization.
7. Run `execute` exactly once with the unchanged material, locked service identity, external authorization/signature, monitor socket, and fresh prepared/final/precommit/postcommit receipt paths. The controller preflights every output before connecting; revalidates source, backup, clone, authorization, journal custody, and live target; durably publishes prepared intent; creates the one-shot journal marker; binds the database transaction; applies only migrations `20260713002600` and `20260713002700`; then obtains and create-once persists `precommit` with the static freeze root as parent immediately before its single commit. Only after terminal readback may it obtain `postcommit-terminal-readback`, parented by the raw precommit receipt SHA-256, and publish terminal evidence.
8. Regardless of a successful execute report, run the separate `readback` mode as mandatory historical verification. Supply the same source receipt, attestation bundle, pinned `gh` executable, commit, service identity, authorization/signature, prepared receipt, monitor socket, a retained `precommit` or `postcommit-terminal-readback` continuity parent, and new historical checkpoint/final paths. Historical readback re-verifies the offline attestation and the parent's fixed-key signature and exact authorization, attempt, prepared, source, runtime, target, static-freeze, executor, and terminal-state bindings; performs terminal readback; then obtains `historical-terminal-readback`, parented by the raw retained receipt SHA-256. It does not mint authority or perform mutation.

Maintain freeze continuity with fresh external monitor checkpoints through completion of mandatory historical readback; rereading the static freeze assertion is never live proof. Stop when any continuity, custody, freshness, challenge, parent, residual-channel, source, predecessor, archive, clone, authorization, service identity, journal, or terminal-root check fails. Every checkpoint path is create-once, owner-only, and outside the repository. Retain the source-validation, predecessor, observation, static freeze anchor, backup, capture, encrypted archive, sanitized dual-clone, authority template, external authorization/signature, prepared-intent, one-shot journal, checkpoint, execute final, and historical-readback receipts under the approved private retention policy. Keep monitor credentials/private keys, mutation APIs, restore identities, service files, raw endpoints, temporary clone material, and plaintext archive content out of retained source artifacts.

A commit error has an unknowable outcome. On `commit_ambiguous_readback_only`, retain the precommit receipt and do not roll back, rerun `execute`, consume another attempt, replace the journal marker, or retry the migration; use only historical `readback` with the original authorization, prepared receipt, marker, and retained precommit checkpoint as its continuity parent. A postcommit denial is equally ambiguous; retain both checkpoints if present and use the latest valid precommit/postcommit parent.
## Result handling

The sanitized result contains only fixed schemas/status/reason codes, exact source custody hashes, bounded counts, booleans, cutoff, and hashes of the request binding, class code, retention operation, storage receipt set, auth receipt reference, and audit ID. It contains no UUID, email, raw class code, object locator or name, provider URL, credential, session/proof token, password, key, raw receipt reference, or signature bytes. Do not print adapter values or caught provider exceptions. A provider exception becomes only `ADAPTER_FAILURE`.

There is no embedded `receipt_sha256` field: embedding a digest of a smaller body and then signing an expanded object is prohibited. The detached signer receipt is the only place the SHA-256 of the exact canonical signed bytes appears.

The result is not proof of legal compliance, deployment, a production release, or completion of any unrelated account deletion or retention run. Keep the detached signature and authorization evidence in the approved evidence store; do not paste them into the source tree.

## Mandatory stops

Stop without retrying or selecting a replacement when any of these occurs:

- the human designation, non-admin/self-owned status, exact protected-main commit, target, terminal readback, freeze assertion, signature, expiry, or custody binding is missing or mismatched;
- the fresh session lacks a current password AMR, or any wrong-session/user/expired/replayed denial is absent;
- any adapter observes or selects an unbound subject, uses a queue claim, or scheduled workers are running or in flight;
- storage object count is nonzero or any object/provider binding would be required;
- the first deletion result is not the authenticated post-database-cleanup/pre-Auth state, either replay is attempted after a worker phase, same-key state/counts drift, different-key mismatch is not denied, final owner status is not durable `APPLIED`, or any of four deletion readbacks is false;
- retention eligible, held, or scanned is nonzero before confirm, or any retention readback is false;
- fresh controller continuity is absent, stale, longer than 30 seconds, mismatched, expired, or reports a running worker/in-flight job;
- the signer receives anything except the one canonical byte string, returns a different digest, publishes at/after continuity expiry or after the deadline, is not durable, or a secret/raw identifier would enter output;
- the procedure would require a paid service, hosted automation mutation, deployment, secret use outside the human credential gate, or alteration of G034/G037/G040 authority.

After a stop, preserve the minimized fixed reason code and obtain a new human-approved binding. Never broaden the subject, claim a queue item, reuse an expired proof, or downgrade a readback to continue.
