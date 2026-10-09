# Admin-record successor admission-custody amendment

Status: source contract passed; the operating launch remains held.

The successor previously accepted hash-shaped admission fields without reading the referenced evidence. The controller now requires the admission and all eleven adjacent five-stage receipt files to be regular, non-symlink, mode-`0600` files outside the repository. Each receipt must be canonical JSON (`JSON.stringify` after recursively sorting object keys, followed by one newline), and the SHA-256 of those exact bytes must equal the admission field.

## Private file set

All files live in one private mode-`0700` directory. The admission filename may be chosen by the operator; the receipt names are fixed.

- `source-receipt.json`: project, purpose, manifest hash, protected revision, source root and freshness window.
- `protected-main-receipt.json`: the same common binding plus `origin`, `refs/heads/main`, canonical repository URL and the exact protected revision.
- `rehearsal-receipt.json`: the common binding plus `passed: true`, PostgreSQL 17 server version, source/suffix roots and a SHA-256 of canonical admission stage states.
- `rollback-readback-receipt.json`: the common binding plus an exact HTTPS Vercel deployment URL, deployment SHA and `state: "ready"`.
- Seven `writer-fence-<name>.json` files: one for every manifest fence, binding the exact fence name and required state. The current names are `adminRecordMutationsHold`, `g037WriteFreeze`, `automaticReviewer`, `browserRpc`, `directSql`, `dashboard` and `providerIngress`.

Every five-stage receipt has the exact common fields `schemaVersion`, `id`, `kind`, `projectRef`, `purpose`, `manifestSha256`, `sourceRevision`, `observedAt` and `expiresAt`. Extra or missing fields fail closed. `observedAt` must be within the admission window, and every receipt expiry must equal the admission expiry.

The forward successor also requires `operating-readback-receipt.json` beside its private admission. Its exact canonical bytes bind the forward manifest, project, protected revision, freshness window and the complete `priorState`; `operatingReadbackSha256` is the SHA-256 of those bytes. The existing live read-only database preflight remains mandatory and must equal that same prior state immediately before apply.

The executable fixture in `apps/web/tests-unit/admin-record-sql-successor.test.ts` is the canonical construction example. It writes all eleven receipt byte strings, calculates their hashes, writes the private admission last and validates the complete set. Tampered bytes, a recomputed hash over the wrong project or revision, changed stage/prior state, a wrong rollback state and a recomputed hash over the wrong fence state all fail.

## Checkout and protected source

The default runner now checks, before journal creation or database transport:

1. the launch policy is `ready` (the tracked manifest remains `held`);
2. the private admission and all receipt bytes validate;
3. the actual checkout is clean, detached and at `admission.sourceRevision`; and
4. a fresh `git remote get-url origin` plus `git ls-remote --exit-code --refs origin refs/heads/main` equals the same repository/ref/revision binding.

The real-Git fixture uses a disposable bare remote. It proves that a local-only commit cannot substitute for the remote `main`, and separately observes attached, detached-clean and detached-dirty checkout states. This is fixture evidence. The live read-only observation at capture time found protected `main` at `f31904e6dca2d9b608259cf150c5d0894db0928e`; the candidate itself was attached and dirty, so it was not launch-ready.

The five-stage manifest changed, so the held forward manifest now pins its new byte hash and the new successor script hash. Earlier PostgreSQL/runtime proof files remain byte-for-byte unchanged and are bound by their existing hashes in `proof.json`. No hosted database access, provider call, launch/hold/env change, commit or push occurred. No key, signature or second-reviewer mechanism was added.

## Final M5 source binding

The final M5 source is `backend/supabase/migrations/20261009091342_admin_record_private_verification_cleanup.sql`: 13,185 bytes, SHA-256 `b596b200e52c6813a4cfa1b0a2818625f067864549e8854f3497afdcdab706da`. The source-pinned Supabase CLI v2.109.1 G037 parser produced 13 statements and statement-vector SHA-256 `c7b5ae6c7c64b00a31658bbf42165dd9e25ac41f794a1149c62d47f39cf33f4d`. The resulting five-stage source root is `15da876acc3c544fef42ca3fe00c9a260c490d683a7d33593b53aac881f273f3`; the forward manifest pins the final five-stage manifest SHA-256 `02b6c26ea482b3c1689fb7538f47c53b00ade0fa0023dfb596007b556a9e0f26`.

`m5-g037-vector.json` is the raw canonical G037 output for that exact source. Its SHA-256 is `1c4572f2af24040418543078b0a206e178cde7fb6b7937b889f3b8f4a7803dec`.

The frozen PostgreSQL runtime receipts listed in `proof.json` are retained only as historical evidence for their earlier source set. They were not edited and do not establish runtime correctness for this final M5. Exact final-M5 PostgreSQL runtime verification is owned by `finish_five_stage_evidence` and is not claimed by this amendment.

## Final forward and runtime binding

The final forward source is `backend/supabase/migrations/20261009101645_admin_user_management_rpc_forward.sql`: 40,392 bytes, SHA-256 `2067538f89c9f90d28e784672c7a1288306ba22d5ae92b087c8692503da9b1ae`. The same pinned G037 parser produced 2 statements and vector SHA-256 `b8eb5902bb5996cffa5cca2f564c1c1c29593dd0a345f2ffbcaca2f86e3f7a3a`. `forward-g037-vector.json` is the exact raw output, SHA-256 `bfb2d653bb6d4a93564b45e5702c038280473f564f2c1b5704fefa8d3287c5ee`.

The final forward manifest is SHA-256 `12cb67ed7e30acc7238370f0ad054bbef3d235b85982545e2ba028a7570d3f99`. The PostgreSQL 15 replay verifier and local replay contract are bound as `edf65e557363d16f7c3fcf1359fe880999e275924fcf57d46abd2edb956d9c53` and `e6e44d085ac93232121ca0b5bad44270ac591c9a802cbd93b829601a572779cf` respectively.

Exact synthetic PostgreSQL 17.6 replay, rollback and the 26-job pagination path are recorded in `five-plus-admin-user-rpc-forward-m5-pagination-amendment-20261009`: proof SHA-256 `0c8e2cb0530ac09910bdcec0cd1e0b923dcc130800d5879ea8134aa1d45197b7`, artifact-map SHA-256 `80c3712876f25d84ee6839ffb14aa9f271cb48080397dfa0a0448936c3c43e9c`. This closes the final-source local runtime boundary; it remains synthetic/local evidence and does not prove an operating launch or hosted write.

## Broad frozen-closure baseline comparison

The earlier broad command ran exactly these modules: `backend.supabase.tests.test_local_replay_contract`, `backend.supabase.tests.test_local_publication_verifier` and `backend.supabase.tests.test_local_function_runtime_contract`. Its 81 tests reported 2 failures and 37 errors.

Three representative cases were then run unchanged both in the current candidate and in the existing clean detached checkout at `4908c5c4a3db30c1d86965c1ac144471f8872858`:

- `LocalPublicationVerifierTests.test_publication_uses_the_current_126_unit_manifest`: `129 != 126` in both.
- `LocalFunctionRuntimeContractTests.test_frozen_source_closure_candidate_receipt_is_exact`: `107 != 48` in both.
- `LocalPublicationVerifierTests.test_accepts_only_the_exact_healthy_sanitized_bundle`: `receipt_ledger_state` in both.

Each representative run produced `failures=2, errors=1`. This proves those observed broad-suite failures predate the successor admission changes; it does not relax or update any frozen gate. Raw output is preserved as `broad-audit-representative-current.log` and `broad-audit-representative-head4908.log`.
