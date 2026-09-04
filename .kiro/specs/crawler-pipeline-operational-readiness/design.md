# Design: Crawler Pipeline Operational Readiness

## Decision summary

The follow-up starts with an executable readiness preflight rather than another prose-only phase
report. The preflight is pure/read-only until `--run-tests` is requested, and even then it launches
only the focused unittest modules with the current interpreter. It does not load `.env`, connect to
Supabase, start containers, publish artifacts, or mutate hosted/local data.

## Components

### `backend/pipeline_control/readiness.py`

- Parses Kiro task markers and counts complete/open/optional work.
- Validates the versioned traceability schema and its closed map contract without adding a runtime
  schema-library dependency.
- Detects duplicate, missing, and unknown task IDs and unmapped default artifacts/test modules.
- Rejects unsafe, ignored/build-output, absent, and repository-escaping evidence references.
- Checks a closed list of required implementation and workflow artifacts.
- Probes test dependency importability without importing provider code.
- Runs a closed focused test-module list under `sys.executable`.
- Reduces all outcomes to bounded fields and closed blocker codes.
- Never returns subprocess stdout/stderr.

### `backend/bin/check_crawler_orchestration_readiness.py`

- Human-readable mode for operators.
- `--json` mode for CI and retained evidence.
- `--run-tests` opt-in for execution after static preflight succeeds.
- Timeout range of 1–1800 seconds.
- Exit 0 only for `Ready`; all blocked states exit non-zero.

### `backend/test-requirements.txt`

- Exact test-only pins for Hypothesis and PyYAML.
- Kept separate from crawler, agent, and pipeline-control runtime manifests.

### Traceability schema and map

- `traceability.schema.json` defines closed top-level/entry keys, task/module grammars, unique arrays,
  and the evidence vocabularies.
- `traceability.map.json` contains exactly one entry for each of the 71 predecessor task IDs.
- `implementationPaths` identify current tracked source contracts; `verificationModules` identify
  executable proof; `externalEvidenceTypes` only classify required operator readback.
- A listed external type never changes a local result into a claim that the receipt exists.
- The readiness report binds both files into `traceabilitySha256` and reports bounded orphan lists.

### Committed cadence-source reconciliation

- `schedule.validate_cadence_sources` compares the configured GHA UTC cron, its fixed UTC+9 KST
  derivation, the workflow's only scheduled cron, the Mac calendar, and the LaunchAgent label.
- `schedule.inspect_committed_cadence_sources` reads only the three committed source files and
  reduces missing, malformed, or divergent input to a closed error code and fixed source name.
- Both `worker.main` and the shared Mac hosted-new-video entrypoint run this check before pipeline
  work; the Mac entrypoint also runs the hosted-pending-apply environment profile after loading the
  operator's local backend environment.
- The repaired installer generates one 05:15 KST calendar event through a bash wrapper under
  `~/Library/Application Support/tzudong` and writes logs under `~/Library/Logs/tzudong`.
- No installer was executed by this source change. Installed schedule and wake/coalescing behavior
  remain external readback items.

### Manifest evidence normalization

- The writer derives step names from the committed graph and skip reasons from its generated closed
  vocabulary; unknown values become `unknown_step` or `skip_reason_invalid`.
- Operator summaries admit only the fixed final-status, execution-mode, and data-sink vocabularies.
- Reflection normalization admits only 11-character video IDs, caps each outcome bucket at 100, and
  removes duplicates across `applied`, `skippedAlreadyPresent`, and `unresolved` in that order.
- Frozen input/output values are emitted only when they are exact lowercase SHA-256 strings;
  malformed or secret-shaped values become null with `unavailable` provenance.
- The always-running evidence upload retains both `current-summary.json` and
  `current-health.json`; this source contract does not claim that any hosted artifact was uploaded.

### Supply-chain contract recovery

- `apps/web/scripts/verify-pin-contract.mjs` restores the historical six-item contract as a
  read-only, bounded JSON check. It distinguishes repository declaration/resolution agreement from
  the host's actual Node/npm versions and never performs lock reconciliation itself.
- `backend.utils.tests.test_supply_chain_contract` checks exact audited Python requirements, the
  TypeScript aliases and release authority, the conditional Dependabot unit set, the held Next.js
  family, and crawler-owned container reference policy.
- Current dependency units are the root GitHub Actions unit, two npm units, three pip units, and the
  authoritative recovered Cargo workspace. Ignored `backend/rust/target` output is not source.
- Crawler-owned local service images may use explicit version tags; the scheduled CI Postgres
  service uses the same immutable digest already admitted by the admin CI workflow. Floating channel
  tags are rejected.
- The Supabase compose tree is a separately owned local/self-host development bundle. Its two bare
  MinIO references are recorded as dedicated follow-up work instead of being hidden by the crawler
  check or changed without a Supabase compatibility review.
- Security CI directly runs the supply-chain source-contract module and includes all governing
  manifests, lockfiles, Docker descriptors, verifier, and test paths in its trigger set.
- `.github/workflows/dependency-freshness.yml` is a read-only weekly/manual evaluator. It pins Node
  24, npm 11.6.2, and Bun 1.4.0, verifies the exact Rust 1.97.0 toolchain declaration, records all
  four bounded command outcomes, uploads the bounded receipt even on failure, and never merges or
  rewrites a candidate.
- `apps/web/scripts/verify-dependency-freshness.mjs` owns the seven-unit inventory, the four held
  dependency decisions, four fixed failure codes, major-bump splitting, verification
  classification, and privacy-safe receipt serialization. Its pipeline-control unit stays at the
  single owned `backend/pipeline-control` path.
- `backend/deploy/tooling-selection.v1.json` preserves the twelve-category engineering comparison
  while leaving every operator approval and every real macOS measurement unresolved. The current
  OTel candidate uses the contrib image required by the recovered `filelog` receiver.
- `backend/bin/tooling_gate.py` validates category cardinality, fixed references, candidate identity,
  and every current asset path before it evaluates startup. The null default runner records no
  fabricated observation; the present record is coherent but yields an empty startup set with
  `tooling_approval_missing`.

### Provenanced Rust recovery

- `rust-source-provenance.v1.json` binds 36 recovered files to commit
  `880bf06d375dbc6ebe8dcf108419c3f455048a97`, a second identical Rust tree in commit
  `2d7a8f6ed5fe9e14d8f5046f45a4ea2d45fb725c`, each Git blob, each SHA-256, and each byte count.
- `rust-candidate-provenance.v1.json` separately binds all 36 current candidate files after two
  declared transformations: Rust 1.97.0 formatting on 11 Rust files and root MIT-license metadata
  alignment on the workspace manifest. The original source manifest remains byte-exact evidence for
  the authoritative commit instead of being silently rewritten to match the candidate.
- `backend.utils.tests.test_rust_source_recovery` rehashes source bytes directly from the
  authoritative Git object and candidate bytes from the worktree, requires the declared transform
  paths to equal the exact changed set, rejects unsafe or generated paths, verifies the five-member
  workspace and toolchain/dependency pins, requires checksums on registry lock entries, and confirms
  the migration ledger remains Python-default at zero live matches.
- Restored control modules include the implementation selector, shared ledger validator, parity
  harness, and performance-evidence validator. Their focused unit/property suites are source-level
  checks and never mutate the migration ledger.
- Cargo tests run with `rustup run 1.97.0 cargo ... --locked`; the unqualified Homebrew 1.97.1 test
  run is diagnostic only and is not the qualifying toolchain result.
- Cross-language validation builds `tzudong-validators` with maturin 1.15.0 in a newly created
  temporary Python 3.14 virtual environment. The passing eight success and four error properties do
  not count toward live N=3.
- `compute_artifact_id` resolves a maturin package wrapper to exactly one native-extension sibling
  and hashes that binary. It rejects missing or ambiguous extension artifacts so evidence cannot bind
  to mutable `__init__.py` wrapper bytes.
- `is_live_evidence_eligible` recomputes the receipt hash over every closed evidence field except the
  receipt itself. The existing ledger then enforces distinct job/receipt identities, exact cohort
  continuity, per-attempt readback validation, and the three-result threshold before shim deletion.
- Security CI installs Rust 1.97.0 explicitly, checks formatting, runs the locked 61-test Cargo
  workspace, builds the extension in a fresh virtual environment with maturin 1.15.0, and runs all
  12 success/error parity properties. A build failure cannot degrade into a skip-only success.

### Canonical performance-evidence closure

- The three canonical inputs are `performance-budgets.v1.json`, `backlog-raw.schema.json`, and
  `backlog-scored.schema.json` under `apps/web/performance/`. The filename retains its historical
  name while the embedded, self-hashed budget contract is version 2 and contains 36 closed rows.
- The protected scorer and independent validator bind a release, candidate commit/tree, config hash,
  data-profile hash, frozen timestamp, independently pinned schemas/budget, raw input, health receipt,
  measurement receipts, manifests, scored output, and detached scored hash.
- The trusted artifact map cannot list itself. Its exact canonical bytes are pinned through the
  out-of-band `--artifact-map-sha256` argument before map parsing, closing the self-attestation loop.
- The restored backend claim gate now accepts only canonical `apps/web/performance/*` evidence paths,
  exact known backend budget values, a non-empty raw artifact set, 40-character frozen Git identities,
  a 64-character artifact-map hash, and an explicit `established: true` result.
- The 29-case web governance suite exercises deterministic scorer/validator agreement, zero through
  four eligible rows, exact absolute/noise/relative boundaries, health precedence, map and digest
  substitutions, duplicate-key and canonical-byte rejection, symlink/path escape rejection, and
  direct plus aggregate size limits. The 49-case backend unit/property suite covers canonical path
  confinement, exact backend-budget parity, frozen-tree checks, claim gating, and noise judgments.
- These passing fixture suites establish source behavior only. No real G003 raw/scored artifact,
  clean frozen-tree measurement cohort, or externally retained artifact-map digest exists in this
  candidate, so no measured improvement is claimed.

### Bounded observability and admin readback

- `metrics.v1.json` and `metrics.py` freeze 13 runtime names as four lifecycle counters, eight
  gauges, and one step-failure counter. Local snapshots remain available with export off; GHA
  rejects an opt-in OTLP endpoint so a scheduled job cannot silently exfiltrate telemetry.
- Compose publishes API 8091, Kafka 29092/UI 8088, Elasticsearch 9200, Loki 3100, OTLP 4318,
  Prometheus 9090, and Grafana 3001 through `127.0.0.1`. Wildcard listeners exist only inside the
  containers. The collector reads only the repository-owned bounded log directory and keeps the
  pre-existing OTLP-to-Prometheus metrics pipeline while adding filelog-to-Loki delivery. The
  pinned contrib Collector is required because the core image lacks `filelog`; log delivery uses
  `otlphttp/loki` with base endpoint `http://loki:3100/otlp`, allowing the Collector to append
  `/v1/logs` and avoiding the deprecated Loki exporter.
- Kafka bootstrap and Elasticsearch URL admission use closed local host sets and require
  `TZUDONG_DATA_ENV=local_db`. Role-specific event/log/raw allowlists run the shared bounded privacy
  sanitizer before serialization. Elasticsearch redirects and userinfo tricks fail closed.
- The transactional outbox retains work after broker failure, supports stale-claim retry, and
  acknowledges only after successful delivery. Deterministic document IDs make replay idempotent.
- The admin orchestration source test discovers route handlers rather than trusting a fixed one-file
  list, then verifies authorization order, short-circuiting, bounded status/code shapes, safe caught
  error mapping, and absence of provider/database response details.
- The system-status tests distinguish live job API, manifest fallback, and no-source results; missing
  and unreadable manifests remain `UNKNOWN` and cannot render healthy. These tests make no claim that
  a hosted collector, dashboard, or alert path received data.
- The live one-run starter probes the Collector's exact `/v1/metrics` OTLP/HTTP route. Because a GET
  against that ingestion-only route intentionally returns 405, only that service/status pair is a
  ready listener signal; the ordinary Prometheus, Grafana, and Loki health routes still require
  non-error responses. Grafana's CSP template uses Compose `$$NONCE` escaping and a live container
  readback confirms the runtime receives literal `$NONCE` instead of an empty host substitution.

### Deployment descriptors and least-authority operations agent

- The recovered descriptor set contains a five-component catalog, one Helm chart, and one OpenTofu
  module. The checker scans the catalog and seven descriptor files for secret literals before it
  permits a local render; a finding suppresses all render output. Two local cluster identifiers share
  one base definition and may differ only in `namespace`, `releaseName`, `clusterLabel`, and `fullname`.
- `migration-readiness.v1.json` keeps backup, PITR, and all eight release gates unresolved. The pure
  evidence-state helper cannot produce `external_evidence_confirmed` without a non-empty reference.
- The committed action and rate ledgers deliberately carry null approvers and unresolved status, so
  `build_agent_from_files` cannot activate an agent from repository state alone.
- Five catalog actions are local and idempotent. `open_github_issue` is retained as a known action but
  reclassified as external; runtime classification requires a named approval reference bound to the
  exact trigger/action pair. No GitHub write is made by the source tests or this recovery.
- Executor failure is terminal for the trigger and uses only the fixed `agent_action_unverified` code;
  the verifier is not invoked after a thrown executor. Never-performed notification/self-approval
  classes remain denied even with a syntactically valid approval.
- The restored source is corroborated by identical blobs in commits
  `880bf06d375dbc6ebe8dcf108419c3f455048a97` and
  `2d7a8f6ed5fe9e14d8f5046f45a4ea2d45fb725c`; current-layout and least-authority changes are recorded
  separately rather than represented as byte-exact source recovery.
- `operational-recovery-provenance.v1.json` binds 50 source-to-candidate file pairs plus the new
  migration-readiness source-contract test. Its regression test rehashes both Git objects and every
  candidate byte, requires the declared transformation union to equal the actual changed/path-mapped
  set, and rejects the obsolete `backend/deploy/pipeline-control` candidate directory.

### Fail-closed local publication recovery

- The admin route remains a queue/status boundary. Authentication precedes all work, POST additionally
  requires same-origin proof and a bounded empty object, and every response is `no-store`. A separate
  `TZUDONG_PUBLISH_QUEUE_ENABLED=1` gate is necessary but not sufficient: the parsed Supabase URL must
  also name an exact loopback host before the service-role client can be constructed.
- The generated local Supabase stack exposes `local_analytics` through its local PostgREST schema list;
  SQL explicitly revokes schema/table/sequence access from PUBLIC, anon, and authenticated and grants
  the queue capability only to service_role. No hosted PostgREST configuration is changed.
- The committed Publication_Set and schedule are structurally complete but deliberately unresolved.
  Preview and apply independently require a named approver and RFC3339 time; tests use explicit
  candidate-only approved fixtures and never mutate the ledgers.
- Publication projection rejects an unknown table/column, null or repeated identity, repeated table,
  and identity-only row. Marker-bearing local fixtures are removed before admission and hashing.
- `public.videos` includes `youtube_link` and `channel_name` in addition to the eight public-insight
  fields because the mirrored schema makes both fields non-null on insert. Video CAS now binds
  `id,updated_at`; restaurant CAS binds `id,trace_id,updated_at`.
- The follow-on migration creates publication-only restaurant and video functions. Both retain the
  supplied identity on insert, restrict dynamic columns server-side, cap calls at 200 rows, perform
  compare-and-set updates, return readback, and revoke Data API execution. The existing crawler RPC
  is neither created nor replaced by this migration.
- `publication_adapter.py` is inert until given SQL executor callables by a separately authorized
  Backend_Runtime. It contains fixed statements for the two admitted tables, pre-reads only published
  and CAS fields, builds insert/update operations, and maps primary database codes to empty bounded
  exceptions. It never reads a DSN, obtains credentials, or opens a connection on import.
- `local_analytics` queue/history/audit DDL constrains state, result codes, hash shape, and nonnegative
  counts. Audit events remain append-only. A namespace-only startup bridge now creates the empty
  namespace before PostgREST readiness, with `postgres` ownership and no PUBLIC/Data API CREATE; the
  canonical migration still owns all tables and service grants. The migrations were exercised only in
  a disposable isolated local stack, have not been applied to hosted Supabase, and the queue feature
  flag remains off by default.

### Current-input phase gates

- `backend/deploy/phase-gates.v1.json` replaces the parked runners' duplicated embedded phase
  definitions. It partitions current R1–R14 exactly once across seven ordered gates; P5 carries no
  requirement because the rejected layout migration remains an explicit decision gate rather than a
  recovered current requirement.
- Every phase uses the repository's seven canonical verification commands with 1,800-second command
  ceilings and the same six bounded public routes. P2 approval/migration/apply receipts, P3 real
  telemetry delivery, P4 tooling and repository settings, P5 layout approval, P6 N=3/performance/
  retirement, and P7 release evidence remain external conditions.
- Evidence records must carry `satisfied=true`, an RFC3339 observation time, and the exact SHA-256
  candidate-tree fingerprint. External records also require a bounded receipt reference. The
  fingerprint binds HEAD, its binary working diff, and every non-ignored untracked file, so a bare
  commit SHA cannot hide candidate changes.
- The generic evaluator advances only through entry, rollback, commands, public routes, and exit in
  that order. Missing, false, malformed, stale-tree, or over-5-second evidence returns one fixed code
  and bounded identifiers; no captured command, route body, provider diagnostic, or evidence payload
  is serialized.
- Rollback validation never executes a plan. It permits only an exact `git revert --no-edit` of a
  40-hex commit in the bound candidate, rejects reset/stash/clean/checkout/switch/restore and deletion
  tools, and requires the exact seven-command post-rollback set.
- The seven `run_pN_gate.py` files are thin identifiers over the shared evaluator. By default they
  neither run verification nor write a report and therefore return a truthful entry-evidence block.
  `--run-verification` and `--write-report` are separate explicit opt-ins; reports use create-once
  semantics and command stdout/stderr is discarded.

### Current-layout and rename verification

- Seven parked layout/naming files are recovered against the present tree instead of reviving their
  rejected `backend/pipeline-control` → `backend/deploy/pipeline-control` migration. The historical
  nested collector path remains absent; the current collector stays under the existing hyphenated
  operational-asset directory.
- `layout-manifest.v1.json` now declares 28 in-scope first/second-level candidate directories. It
  distinguishes `backend/pipeline-control` operational assets, `backend/pipeline_control` importable
  Python, `backend/deploy` ledgers/IaC, and `backend/rust` source. Build/performance and local-log
  outputs remain explicitly untracked classifications.
- The layout checker enumerates `git ls-files --cached --others --exclude-standard`, so uncommitted
  candidate paths are visible without admitting ignored build output. Its default move list is empty;
  generic proposed-move validation stays injectable and read-only. Compose reference checks cover
  both the retained operational tree and the deployment-ledger tree.
- The rename checker validates the existing five first-party corrections, rejects public/persistent/
  canonical-privacy scope, requires no old path and exactly one new path, and accepts injected target
  test results without invoking an external system. A property-test generator was corrected so a
  leading-underscore Next.js private segment is not mislabeled as a public route.
- The security workflow runs both unit suites, both property suites, and a source contract. These are
  local source assertions only; P5 still requires a later named-owner decision and commit-bound prior
  phase evidence before it can close.

## Report shape

```json
{
  "schemaVersion": 1,
  "generatedAt": "UTC timestamp",
  "status": "Ready | Blocked",
  "blockerCodes": [],
  "source": {"gitHeadSha": "40 hex chars", "workingTreeClean": true},
  "spec": {},
  "traceability": {
    "valid": true,
    "complete": true,
    "taskCount": 71,
    "mappedTaskCount": 71,
    "traceabilitySha256": "64 hex chars"
  },
  "artifacts": {"artifactSetSha256": "64 hex chars"},
  "dependencies": {},
  "testPlan": {"moduleCount": 22, "execution": {}}
}
```

No field accepts arbitrary captured diagnostics. Missing items are repository-relative paths or
canonical dependency names; task labels are count- and length-bounded.

## Phased continuation

1. Establish reproducible verification and dependency bootstrap.
2. Reconcile interpreter/documentation/CI command drift.
3. Re-run and close source-only orchestration contracts.
4. Separate locally provable gates from operator-secret/hosted evidence gates.
5. Reconstruct Rust source only from an authoritative source; never from build products alone.
6. Collect N=3 live parity and performance evidence only through approved operations.
7. Prepare serialized `develop -> data -> main` changes and external release readback.

## Current Supabase compatibility note

The 2026-09-03 changelog review found no platform breaking change requiring a schema edit for this
audit. Relevant watch items remain the self-hosted Envoy default, ignored extension-version pins, and
the Management API `logs.all` removal on 2026-09-23. A separate official Security Advisor review did
identify one bounded owner-mediated view exception, four project-owned staged constraints, 26 invoker
functions with mutable paths, and 19 intentional source-allowlisted SECURITY DEFINER execution
findings. `advisor-classification.v1.json` records the object-level classification without claiming
broader acceptance. Named owner 최연우 approved retaining only the current
`public.privacy_consent_state` owner bridge. The classification keeps the Advisor ERROR visible and
explicitly excludes hosted apply, legal/privacy review, general production security certification,
and release readiness; the task transcript is not represented as an immutable receipt. The new
additive advisor migration recovers one hosted-only trigger function, fixes all 26
paths behind trusted-schema CREATE preconditions, validates the four constraints, and advances exactly
four G014 manifest values while restoring its immutability trigger. A fresh isolated local stack passed
the 88-unit migration chain, 48-function closure/smoke, four rollback SQL boundaries, and a complete
five-marker receipt. No hosted migration, view redesign, advisor closure, legal/privacy approval, or
release approval is claimed.

### Current Auth leaked-password protection gate

- On 2026-09-04, named owner 최연우 authorized enabling leaked-password protection only for hosted
  project ref `aqlcofblfxdrjhhdmarw`; the authorization did not include a paid-plan purchase or any
  other Auth change.
- A dashboard preflight matched the exact project ref and read the setting as disabled. The project
  was on the Free plan, while the dashboard and current Supabase password-security documentation mark
  leaked-password protection as available only on Pro and above.
- The ineligible-plan preflight stopped before clicking or saving, so zero settings changed and the
  final value remained disabled. Authorization is recorded separately from activation and readback.
- Named owner 최연우 subsequently deferred the paid-plan upgrade. The bounded
  `auth-hardening-decision.v1.json` record preserves that decision without payment data and does not
  claim activation or an immutable hosted receipt.
- The current task transcript is the authorization, preflight, and deferral evidence boundary.
  Activation remains disabled and cannot resume until a new named-owner plan decision, exact-setting
  apply, reload readback, and sanitized external receipt all succeed.

### Current hosted database access confirmation

- On 2026-09-04, named owner 최연우 confirmed that the GitHub repository secret named
  `SUPABASE_DB_URL` is the current production database credential for exact hosted project ref
  `aqlcofblfxdrjhhdmarw` and is restricted to the owner and approved operators.
- A read-only GitHub metadata query independently confirmed that the repository secret exists and was
  last updated at `2026-08-27T17:55:52Z`; the secret value was neither requested nor returned.
- The same preflight observed remote `refs/heads/main` at
  `3d7557f6307c9f6696018324e559bff6e57afbce` and confirmed that the G037 protected controller workflow
  exists at that revision. This is an observation only and expires if `main` moves.
- `hosted-db-access-decision.v1.json` separates the named-owner attestation from repository metadata.
  Neither side proves that the credential connects successfully or authorizes a controller run.
- Task 7.36 is therefore complete, while task 7.37 remains open. Each `preflight`, `readback`,
  `runtime-probe`, or `reconciliation-readback` execution still needs a separate approval for a freshly
  read exact `main` SHA and an externally retained sanitized receipt.

### First exact-revision G037 preflight attempt

- Named owner 최연우 separately authorized only `preflight` at exact remote `main` SHA
  `3d7557f6307c9f6696018324e559bff6e57afbce`. Immediately before dispatch, the remote SHA, active
  workflow, and repository-secret name were read back without retrieving the secret value.
- GitHub Actions run `33838590366` matched event `workflow_dispatch`, branch `main`, and the authorized
  SHA. Source validation, detached-SHA verification, hash-locked dependency installation, sanitized
  receipt upload, and temporary receipt removal all succeeded.
- The source-validation receipt was `valid`, but the `preflight` receipt was `denied` with
  `ambiguous_commit=false`; the remote-readonly job therefore ended with exit code 2. The controller's
  allowlisted receipt deliberately exposes no internal denial reason.
- This result does not prove that the credential is invalid, that a connection succeeded, or that a
  catalog/ledger mismatch occurred. The only safe classification is
  `not_exposed_by_bounded_receipt`; no automatic retry is allowed.
- `g037-preflight-attempt.v1.json` records run, job, artifact, receipt, and file hashes without copying
  the external receipts or any credential into the repository. Task 7.37 remains open, and a separate
  exact-revision approval is required before a diagnostic `runtime-probe` or another `preflight`.

### First exact-revision G037 runtime probe

- Named owner 최연우 separately authorized only `runtime-probe` at the same exact remote `main` SHA.
  The remote SHA, active workflow, repository-secret name, current changelog, and exact read-only probe
  source were revalidated immediately before dispatch.
- GitHub Actions run `33839536300` matched `workflow_dispatch`, `main`, and the authorized SHA. Its
  source-validation receipt was `valid`, while its runtime-probe receipt was `denied` with
  `ambiguous_commit=false`; failure-path receipt upload and temporary cleanup both succeeded.
- A successful runtime probe would return status `authorization-denied` and the boolean
  `runtime_authorization_denied=true` only after connecting, resolving the exact terminal mutator, and
  confirming the current database role lacks EXECUTE. This receipt contains neither field.
- Database connection, terminal-mutator presence, and execute-privilege denial therefore all remain
  unproven. It would be unsafe to select credential failure, function absence, or excessive privilege
  as the cause from this receipt, and the consumed authorization cannot be reused.
- `g037-runtime-probe-attempt.v1.json` binds the external run, jobs, artifacts, receipt hashes, and file
  hashes without repository credential or receipt copies. The local recovery candidate additionally
  introduces a closed, non-sensitive denial-code vocabulary so a future merged revision can identify
  the failed phase without exposing provider diagnostics.

### G037 owner-credential separation

- Named owner 최연우 subsequently confirmed that the current `SUPABASE_DB_URL` database role has
  owner privileges. This confirmation records only the privilege class; no connection value or role
  name is stored.
- That fact does not identify which phase denied the prior runtime probe, because connection and
  function-presence remain unproven. It does establish an independent least-privilege blocker: the
  owner-capable credential must not be reused for future recurring G037 read-only diagnostics.
- The recovery candidate changes only G037 to `SUPABASE_G037_READONLY_DB_URL`; migration workflows
  retain their existing secret boundary. There is no fallback between the two names.
- `g037-readonly-credential-contract.v1.json` requires a dedicated non-owner login, read-only default
  transactions, no role-creation/database-creation/replication/BYPASSRLS authority, no target-mutator
  EXECUTE, and only the migration-ledger/catalog read scope needed by the controller.
- The new role and secret do not yet exist. Their external Preview → Confirm → Apply → Readback →
  Audit sequence, exact grants, metadata readback, and a newly authorized controller run remain open;
  no hosted role, grant, password, repository secret, or workflow dispatch is changed in this slice.
- Named owner 최연우 approved the exact preview artifact SHA-256
  `59489e04a707651c11b403d0c72831fe63573b2c27ef212e306042bf3dad82d9` and the external
  credential-custody procedure. That approval does not authorize production SQL execution, role
  creation, password configuration, repository-secret mutation, or workflow dispatch; each remains
  false in the machine gates until its separately evidenced step is completed.
- A later one-time authorization for v1 was consumed. Its postcondition rejected the zero-dimensional
  empty ACL substitute before commit; bounded readback proved the role remains absent and the ledger
  remains at 50 rows with terminal version `20260804000500`. The fixed source code is
  `acl_array_dimension_postcondition_denied`; raw provider diagnostics are not retained.
- The v1 preview, approval, and SQL files remain immutable historical evidence and are never retried.
  Corrected v2 replaces only the three empty ACL substitutions with strict NULL ACL expansion. Its
  preview SHA-256 is `9351623d80b179e46b335e65a6fd67faf86485783fa7e5e1117022cef4261fb3`;
  named owner 최연우 approved that exact preview and both corrected SQL digests. The separately
  authorized v2 execution was consumed once and its generic role postcondition denied commit.
  Immediate readback again proves role absence and the unchanged 50-row terminal ledger.
- Every declared condition passes against a disposable PostgreSQL 17.11 reproduction, while bounded
  hosted reads also exclude PUBLIC target-function EXECUTE and database/public-schema CREATE. The
  remaining condition is therefore not guessed. Diagnostic preview SHA-256
  `8280b2848fbdcd7209affcf8eeb4aa539afe460defdacb97fc5552b84db7693b` binds a rollback-only transient
  reproduction and 17 fixed result codes. Named owner 최연우 approved that exact preview and diagnostic
  SQL digest. The approval is review-only: a separate one-time diagnostic execution authorization is
  still required, and neither the approval nor a later diagnostic can persist the role or authorize
  provisioning.
  Named owner 최연우 then granted the separate one-time authorization. All six preconditions passed;
  the exact diagnostic was consumed once and returned fixed code `g037_diag_memberships_not_zero`.
  Immediate readback proves the transient role is absent and the ledger remains at 50 rows with
  terminal version `20260804000500`. This establishes only that the zero-membership postcondition
  differs in hosted production; direction, count, adjacent role identity, and effective privilege
  remain unresolved. A new membership-only rollback diagnostic is therefore separately previewed.
  It emits only 18 fixed codes for bounded direction, cardinality, privilege category, and PostgreSQL
  17 membership options, never a role name, and requires new preview approval plus new one-time
  execution authorization.
  Named owner 최연우 approved the exact membership-diagnostic preview and SQL digests. That approval
  was review-only and was recorded separately from the spent v1 diagnostic authorization and attempt.
  Named owner 최연우 then granted a fresh one-time execution authorization. All six preconditions
  passed, the authorization was consumed once, and the diagnostic returned only fixed code
  `g037_membership_diag_has_elevated_member`. Code priority proves that the transient role is not a
  member of another role, has exactly one member, and that member satisfies the diagnostic's elevated
  predicate; it does not prove the member identity, grantor, login flag, or admin/set/inherit options.
  Three identical bounded readbacks were needed only to parse the connector safety wrapper; the
  diagnostic itself was not retried. Final readback proves role absence and the unchanged 50-row
  ledger terminating at `20260804000500`.
- PostgreSQL 17 documents that a non-superuser `CREATEROLE` creator automatically receives the created
  role with ADMIN true, SET false, and INHERIT false through a bootstrap-superuser grant. That is a
  hypothesis consistent with, but not proved by, the hosted fixed code. Creator-membership preview v3
  SHA-256 `25b85850bbaef428915d88606276785777213b70c8828d3dc6006ab59ae84a2f`
  binds rollback-only SQL SHA-256
  `9df2ba5db3e7a527d49df00025f15504fb29003fb543e6c3a735dc5d92a43e4b`. It checks only that exact
  invariant without emitting role names. Disposable PostgreSQL 17.11 under a database-owner,
  non-superuser `CREATEROLE` executor returns `g037_creator_diag_creator_admin_only` and leaves the
  role absent. Named owner 최연우 approved the exact preview and SQL digests. That approval is
  review-only and is bound to the consumed membership-diagnostic attempt and authorization; a fresh,
  separate one-time production execution authorization was then granted. All six preconditions
  passed, the exact diagnostic was consumed once, and fixed code
  `g037_creator_diag_creator_admin_only` proved the observable automatic-creator shape: zero parent
  memberships, exactly one current-user member, non-superuser `CREATEROLE`, a superuser grantor,
  ADMIN true, SET false, and INHERIT false. Member and grantor identities remain unrecorded. One
  bounded readback proves the transient role absent and the ledger unchanged at 50 rows terminating
  at `20260804000500`; the diagnostic and authorization cannot be reused.
- Corrected provisioning preview v3 SHA-256
  `bf1913e5b0cfffaad856e4080939d21e7d11d60fee4f2c333c92c3c9ca219ff9` binds provisioning SQL
  `77542865f044f10c8d6d86f99ba015ef3419a3dfacf5e4ad9c44cc8848d6c4a8`, readback SQL
  `8a225381a61ff1c752bcdee89722d16e9173a1aadda0fbcc35707cb9cbdeae09`, and controller source
  `188095df7df30edbe890d3cb0df9b1d69f59b7942dd449ae5f0b7b8fad5e89b0`. It preserves all role
  flags, grants, and transaction boundaries, replacing only the impossible zero-membership
  condition with the production-proven safe inbound creator-admin shape. Controller admission also
  uses strict NULL column-ACL expansion. Disposable PostgreSQL 17.11 commits the v3 provisioning and
  returns exact bounded readback with target EXECUTE denied and zero owned objects. Named owner
  최연우 approved all four exact hashes; approval artifact SHA-256
  `1547c6532e786f4a9767e546da0f2b43c55c488cd4266272d6eb3877b4899581` is review-only and binds the
  consumed creator-diagnostic authorization and attempt. A later separate one-time apply
  authorization remains required; no production provisioning, role creation, credential, secret,
  dispatch, migration, or release is authorized.
- Apply-authorization request v3 SHA-256
  `a983a4f6ca843a3dc8d5ea9991d6bb2c66de5670ddbca0c1d96ed13f17abd9ef` binds the exact review
  approval and four reviewed sources to one requested provisioning execution plus one bounded
  readback. The request is not authorization: no named-owner execution authority or authorization
  artifact exists, and password, credential, secret, controller, workflow, ledger, migration,
  release, and deployment actions remain excluded. Both machine decisions record the request hash
  while retaining the separate production-apply authorization blocker.
- Named owner 최연우 confirmed that the immediately preceding hash-bound request is approved.
  Apply-authorization v3 SHA-256
  `0bf534d0db55f220d25fdbf9a9e727c3b665b32f7d5ea6ca9989d70f3fe20adb` binds request SHA-256
  `a983a4f6ca843a3dc8d5ea9991d6bb2c66de5670ddbca0c1d96ed13f17abd9ef` and provisioning SQL
  SHA-256 `77542865f044f10c8d6d86f99ba015ef3419a3dfacf5e4ad9c44cc8848d6c4a8`. It permits exactly one
  production provisioning execution and one bounded readback after every exact precondition passes.
  The execution count is not yet consumed; no hosted state has changed, and password, credential,
  secret, controller, workflow, ledger, migration, release, and deployment actions remain denied.
- The authorization was consumed before database mutation under operation
  `d983a200-adc4-4c15-8521-f63e278bcc6b`; consumption artifact SHA-256 is
  `f9400c39d77d404f89536e101e2d4eb521df88d7b054d2559adceae4cf6db3ef`. Exact precheck matched the
  active healthy project, PostgreSQL 17, database `postgres`, absent role, 50-row ledger ending at
  `20260804000500`, and target function. Provisioning v3 executed once without retry, then exact
  readback v3 executed once and proved every role flag, five settings, three bounded grants, the
  creator-admin membership shape, target EXECUTE denial, and zero ownership. Attempt artifact
  SHA-256 `01a0c3ff861ecce1d2693a461ae989fbc7e6b2fa7bef4a7a64a9ef5c8cbba261` records fixed code
  `g037_readonly_role_provisioned`. The role exists with `PASSWORD NULL`; no password, credential,
  repository secret, dedicated-role connection, controller dispatch, migration, or release is
  authorized or claimed.
- Credential-custody preview v1 SHA-256
  `43f50049495a0324491fa8fafc9e359e68e3f6bb0430c1c01a42af28c59cd113` is a review-only protocol.
  It binds dedicated-connection readback SQL SHA-256
  `c927d42c6729d5516fc89921cc4cc5d7b84e8af9173b17f7c7403b2977834f28` and the already-proved
  role state. The five ordered stages are external password-manager generation, interactive
  non-echoing `psql` password assignment, one bounded dedicated-role connection readback, one
  `SUPABASE_G037_READONLY_DB_URL` write through secret UI or standard input, and metadata-only
  readback. The preview approves none of those actions: password assignment/connection and the
  later repository-secret mutation require separate fresh named-owner authorizations.
- The connection readback is mutation-free and returns fixed booleans only. It proves the exact
  database and PostgreSQL major version, dedicated identity, active/default read-only settings,
  timeouts/search path, bounded grants, exact ledger boundary, and target-mutator EXECUTE denial.
  A failed or ambiguous password assignment, failed dedicated connection, or false readback boolean
  blocks the secret write. Credential values, endpoints, role/custodian identity, provider output,
  and SQL rows remain outside repository evidence.
- Current PostgreSQL 17 documentation confirms that `\password` encrypts the new password before
  sending it and keeps cleartext out of command history and server logs; libpq documents
  `PGSERVICEFILE` as the external service-file override. Current Supabase connection documentation
  states that direct endpoints require IPv6 unless an IPv4 add-on is already active and recommends
  SSL. The ceremony therefore requires pre-proved direct reachability, `sslmode=verify-full` with an
  external server root certificate, and `password_encryption=scram-sha-256`; it never silently
  falls back to a pooler or purchases/enables an add-on.
- One credential-free current-workspace-host preflight resolved an IPv6 address but could not reach
  TCP 5432. Sanitized attempt SHA-256
  `17d265b605258140f697f67caef17f3a028a16b521267d037ae85ccf48b71047` records only those booleans,
  fixed code `g037_direct_endpoint_tcp_unreachable`, and the absence of authentication, SQL, and
  persistent change. It does not establish a provider outage or firewall cause. Password and secret
  work remain blocked until an approved controlled host proves direct reachability or the owner
  separately reviews a connection-scope change.
- Named owner 최연우's subsequent broad approval statement is applied to the exact credential
  preview that had already been presented, not to unseen future artifacts. Review-approval SHA-256
  `46eea3b0f168775771f11b7909b8174fc8b3450ceb0fe23869ed28c2b744e3a8` preserves the failed-network
  evidence and does not waive direct reachability or authorize password, connection, Secret,
  controller, migration, or release actions. This keeps Preview → Confirm → Apply ordering intact.
- Password-assignment request SHA-256
  `7b3602efed38f21d68b2015c8788baa19dabebb7da9d5e30b4d845be7a8bab7f` is non-authorizing and
  requests at most one externally generated credential, one interactive password assignment, and
  one exact dedicated-connection readback. It is blocked because the approved controlled host,
  fresh direct reachability, external custodian/password manager, libpq custody, psql 17, SCRAM,
  `verify-full`, and terminal-safety evidence are not all present. No execution authorization may be
  created until every mandatory precondition is true.
- Fixed-target probe SHA-256
  `4fed6b4228fbc18db800ddcf543caa74babb3ac8b722aa91da1e3a34112702db` accepts only `validate` or
  `probe`, has no credential or arbitrary host/port input, caps IPv6 attempts at four and each TCP
  attempt at three seconds, and emits one fixed JSON object without addresses or errors. Controlled-
  host evidence request SHA-256
  `9055ed5533a1008300cba6bc666ddaeff6503d87ce6d81ae93f1c94fef8f103c` requires exactly one run from
  a different owner-approved host and accepts only `g037_direct_endpoint_ready` with IPv6 DNS and
  TCP 5432 true and all credential/database/state-change booleans false. The only operator command
  is `python3 backend/supabase/scripts/g037_direct_endpoint_network_preflight.py probe`; only its
  canonical JSON line may be returned.
- Session-pooler alternative preview v1 SHA-256
  `cdf4bd8f9c05eb2fd789228cdfffa563cf8b5dbf7e68f940b1c9689db8d8214e` is a separate review-only
  scope proposal. Current Supabase documentation identifies shared Supavisor session mode on port
  5432 as the IPv4-only alternative to direct connections; transaction mode on 6543 is excluded.
  A read-only project observation matched production ref `aqlcofblfxdrjhhdmarw`, region
  `ap-southeast-1`, active state, and PostgreSQL 17, but returned neither the exact pooler hostname
  nor username. Those fields must come from metadata-only Dashboard Connect readback and must not be
  guessed from the region. Direct remains the selected contract, the existing different-host IPv6
  evidence request remains valid, and the IPv4 add-on stays deferred.
- The proposed pooler path retains `sslmode=verify-full`, external certificate/password custody, the
  same dedicated read-only login, and every current-user/grant/ledger/target-denial admission. Owner
  or `postgres` credentials are forbidden. Exact preview approval, provider metadata, a separately
  reviewed fixed-target network probe, explicit contract amendment, password/readback authorization,
  Secret authorization, and exact-revision dispatch authorization remain distinct future steps. None
  is approved, selected, or executed by this preview.
- Metadata-readback request SHA-256
  `f8101542b4f10bc8acaeb1bd657f7d5c0c1add9fbf30ccd456523255db9bcc22` prepares a single
  metadata-only Dashboard Connect inspection but remains blocked on approval of the exact alternative
  preview. It permits only the exact production project, Session pooler method, region/host/port/
  database/username-suffix/certificate-availability checks, with no clipboard, screenshot, DSN,
  password, token, cookie, browser-storage, authentication, SQL, or network-probe capture. A sanitized
  future receipt may contain only hashes, fixed codes, booleans, and bounded counts; exact hostname
  and username may enter only a separately reviewed fixed probe source, never the receipt.
- Project mismatch, missing Session pooler, ambiguous metadata, or unexpected credential display
  fails closed and authorizes neither retry nor direct-path, add-on, password, Secret, or dispatch
  escalation. Both machine gates record the request as present but blocked and unconsumed.
- Offline metadata-receipt verifier SHA-256
  `0b3dff6e278b48695d0672e637b582c7edb8970156af92c5fe64b8395eeadba2` and receipt-contract
  SHA-256 `746a6c80cffd188ece7c39eb540216470154f1f09286d3e887a3836b7427fd81`
  prebuild the bounded evidence boundary without authorizing the inspection. The verifier accepts only
  a canonical single-line, at-most-8-KiB, owner-only regular file at an absolute non-symlink path. It
  requires the exact preview/request hashes, UUIDv4, UTC timestamp, two nonzero SHA-256 digests, ten
  positive metadata checks, and nine negative action checks.
- `validate` is source-only; `verify` is offline and read-only. Missing/added fields, noncanonical JSON,
  permissive custody, source drift, or any false assertion collapses to one fixed denial without raw
  receipt, exception, endpoint, username, or credential output. Only a complete success emits the
  receipt SHA-256 alongside fixed negative action booleans. No external receipt is yet present or
  verified, and neither pooler selection nor any later execution is authorized.
- Preview-approval request SHA-256
  `2fbe7bbb5bd8b461c12d7d7cf723e8be9c040bc8eb90a6c321fb3ac8422c5804` targets only preview v1.
  Its exact requested statement is `최연우, G037 session-pooler alternative preview v1
  cdf4bd8f9c05eb2fd789228cdfffa563cf8b5dbf7e68f940b1c9689db8d8214e 검토 승인`. An unqualified
  affirmation or the earlier standing statement cannot substitute for the exact name, version, and
  digest. The three successor sources are hash-bound only to prevent ambiguity and are explicitly
  not approved by this request.
- Even receipt of the requested statement would establish review approval only. It would not select
  a pooler, abandon direct transport, authorize Dashboard inspection, validate a receipt, build or run
  a network probe, amend the credential contract, or authorize password, Secret, workflow, migration,
  release, or deployment action. The request and both central gates keep all such values false.
- Approval-contract SHA-256
  `856d361821b28ae319eff627a40a57f5e32e4ba268b5978a220a8e22b9620566` defines, but does not create,
  the future review record. Only the exact current-task user message may be evidence; it must postdate
  the preview and request. Assistant text, a local/generated statement, inferred identity, and earlier
  standing intent are explicitly inadmissible.
- A future approval record must bind both exact hashes, record 최연우 and the exact statement plus its
  transcript boundary, keep all execution counts zero, and leave successor artifacts unapproved. Its
  only effect is to establish design/documentation review and allow the metadata request to be
  presented next. Both central gates still record no statement, approval artifact, review approval,
  metadata authority, or external authority.
- Named owner 최연우 supplied the exact requested statement after all three reviewed artifacts.
  Approval artifact SHA-256
  `50d9c3b69fe5ecd2024378c67141a7f41081434ecaec3a7ed1da0783b3ef9279` binds preview, request, and
  approval-contract hashes and records the current-task evidence boundary. It uses neither the prior
  standing approval nor assistant/generated evidence.
- The approval establishes only review of the alternative design and official-documentation
  interpretation, and permits presenting the metadata request next. Direct transport remains
  available, the session pooler is not selected, and metadata read/receipt, probe, contract amendment,
  password, database, Secret, controller/workflow, migration, release, and deployment authority all
  remain false with zero approved execution counts.
- Named owner 최연우 then authorized one metadata-only production Dashboard Connect read bound to
  request SHA-256 `f8101542b4f10bc8acaeb1bd657f7d5c0c1add9fbf30ccd456523255db9bcc22`.
  Authorization artifact SHA-256
  `240b24087110c8e88c7859f3370f3fba21aa1bf6af4032410fefc99a7226a54f` permits one read and one
  sanitized fixed-field readback only. It excludes screenshots, clipboard, DSN/password/credential,
  storage or header inspection, database authentication, SQL, network probe, provider mutation, and
  every later execution. The receipt verifier's offline validation returned the fixed valid code.
- The one-read budget was consumed when the exact production Dashboard URL was opened. Consumption
  artifact SHA-256 `d203751ccd74cbb14297a56139f71de412b2ef5eff11876e32176f98bb6664e5`
  records one approved and one consumed attempt, no retry, and zero remaining reads. The artifact was
  recorded after the browser stop rather than before the read; this sequencing limitation is explicit
  and is not rewritten as a stronger claim.
- The accessibility-tree operation exposed unapproved project-overview fields before the exact
  Session pooler metadata was isolated, and a non-Session connection control was activated. The
  browser attempt stopped immediately. Attempt SHA-256
  `6e5915d6d4f2e96f4aa07ade8e10277b6daab382370dec8c85649f797c1d036b` records fixed denial code
  `g037_session_pooler_metadata_scope_boundary_violated` without reproducing provider UI text.
  No screenshot, clipboard, raw DSN, password, browser storage, header, database authentication, SQL,
  network probe, or persistent provider mutation occurred.
- No success receipt exists, no exact pooler metadata is present, and the session pooler remains
  unselected. The spent authorization cannot be retried. A fresh request must predeclare a selector-
  bounded plan that observes only the exact Connect dialog controls and individual labeled metadata
  nodes; that request requires a fresh named-owner authorization before any attachment or read.
- Control-map request SHA-256
  `48366c5e157a186a6c19647a70da40d027c01a70e83ba0e3b6087ec5679fca7f` reduces the next proposed
  action to control-only discovery: one exact production Dashboard open, two interactive button/
  combobox snapshots inside the Connect dialog, and one exact `Direct Connection string` entry click.
  It may identify exactly one `Session pooler` control but may not click it or read any project,
  organization, metadata value, textbox/input, code/pre, definition value, page, main, whole-dialog,
  connection-string, password, certificate, storage, header, or provider-response content.
- The control map may retain only fixed codes, booleans, bounded action/control counts, and a control-
  shape digest; raw trees, control names, and locator references are excluded from the receipt.
  Verifier SHA-256 `f5b641d76d33ed8343751dabb634f90737c898b4a44f70f95d2f63c27f601764`
  and receipt-contract SHA-256
  `c696287a0246849ef774aa256eb27a982d4303c06e0fd9ed73a3f3a004e5d1f1` enforce one open, two
  snapshots, one click, exact positive controls, all prohibited actions false, canonical owner-only
  custody, and fixed output. Both are offline and authorize no browser action.
- The control-map request remains blocked on a fresh exact named-owner authorization. A successful
  control map would permit preparing—but not executing—a later selector-bounded metadata v2 request.
  It does not authorize pooler selection, metadata values, network probe, password/credential work,
  repository Secret mutation, controller/workflow dispatch, migration, release, or deployment.
- Named owner 최연우 authorized the exact v1 control-only request once. Authorization SHA-256
  `3cfe7a899473aea6c31c2a50d1e644db4147c1e03fb3bf10f6118c759ed0f2a6` was consumed before the
  external operation in artifact SHA-256
  `61979c28e596a55a0dcf4fc21b54c518b8ebe9996139892cf80819e25da21748`. A local non-interactive
  argument syntax failure occurred before browser open; the same operation then submitted an async-
  IIFE program, but the REPL did not expose its asynchronous completion.
- Whether the single Dashboard open completed was ambiguous, so it was conservatively consumed and
  no further browser command was issued. Attempt SHA-256
  `9bcf5eec76211f11113172b08a1133a67a9824d77874212d6a57c0254dce669c` records fixed code
  `g037_session_pooler_control_map_async_completion_ambiguous`. No snapshot or click completion,
  raw tree, metadata, credential, DSN, screenshot, clipboard, storage/header access, database
  authentication, SQL, network probe, provider mutation, or success receipt is claimed. V1 cannot
  be retried.
- A browser-free local REPL preflight subsequently returned fixed signal
  `g037_aside_top_level_await_valid`. Single-line browser source SHA-256
  `a07dd10e07c0cd0a1db050230206b6e5ebfd4402c172556d1a159b571e3044bc` passes Node syntax checking,
  uses top-level `await`, accepts no dynamic code or external input, and emits only canonical fixed-
  field observation or denial JSON. It retains the exact control-only selector and action ceilings.
- Control-map v2 request SHA-256
  `e74e85936b4d44776ffacf878a65604c03e91ac03b91f4416090ed5efecd0a08` binds the spent v1 evidence
  and exact browser source. Receipt verifier v2 SHA-256
  `7b6be03f1ac15ee93f5b10ddf33d070382e5eb9939f7bab30857f71ce8a631eb` and contract SHA-256
  `15150608fcb788f847b8053f6fe61522717759206b6c5e405093bf81635bea1c` additionally bind the
  observation and control-shape digests, exact action counts, and every negative action field.
- Authorization-request SHA-256
  `d4259300e49459be899c4c35a06818e45cee814b02af6b0008a5dd234e3da900` requires a fresh named-owner
  statement containing all reviewed hashes. Until received, v2 execution, metadata-value read,
  pooler selection, network probe, password/credential work, Secret mutation, controller/workflow,
  migration, release, and deployment remain unauthorized. Any future syntax, transport, or ambiguous
  completion consumes its authorization and allows no retry.
- Named owner 최연우 supplied the exact v2 statement. Authorization SHA-256
  `62b222c88728c0b993359dd472e36aa7fcfa715bceaac3dd6e1675f76c09e069` was consumed before browser
  execution in artifact SHA-256
  `27cbf11111867f223acfd92fb72675c4f105dffebb64a1d115ac68fdb8c7659f`. The reviewed source ran
  exactly once and returned canonical denial observation SHA-256
  `422180f6518a408b11cb1155438826db884b5513c1d8c35a6919051f37ef1114`: one Dashboard open, zero
  completed control snapshots, zero clicks, no metadata value read, and no persistent provider
  change. The transport automatically emitted a tab-title envelope containing project or
  organization labels; no raw title is retained in repository evidence. Attempt SHA-256
  `f624f78125c1c3938053569fa27e2d547aa3796f17d621f7707f8eb47580aad5` records fixed code
  `g037_session_pooler_control_map_v2_denied`. No success receipt exists, the authorization cannot
  be reused, and metadata-value construction remains blocked.
- Local-only follow-up did not perform another provider read and does not claim an exact v2 failure
  cause. It confirmed from installed Aside guidance that selector-scoped interactive snapshots are
  supported, then isolated the two observable weaknesses: the first restricted snapshot had no
  readiness wait, and automatic transport output was not filtered. One-line v3 browser source
  SHA-256 `6dbf2915400970b6de301a2f9aed5c0736d23bc7572d8a6ec7e8e4ced3a5d96e` adds only bounded waits on
  the same allowed selector plus fixed denial stage codes. Stdout filter SHA-256
  `f826640d6004d9baec9870130180fc189e75aa83b982dd14d4b44be8e1082855` accepts at most 32 KiB,
  discards automatic transport lines without retention, and emits exactly one canonical v3
  observation or exits non-zero.
- Control-map v3 request SHA-256
  `e0e33500d568d911412c0b0faf4fe2ecf732185655c128f25c6ae6d45c72e9b0`, offline receipt verifier
  SHA-256 `7c9d5033ea0e581df8e133310e8f8f923aa5313f8c8e84753bad4c3f6ed5c942`, and receipt contract
  SHA-256 `1336c656acd8abb1bdf4e51a157400160e87a28bde4bd159e40fe7e36e172daa` bind the spent v2 attempt,
  exact source, exact filter, ready stage, counts, safety booleans, and digests. Authorization-request
  SHA-256 `3469f4f434627c1e49a7b8e9e5765c50e4d82548c6c40a6c014d1de5a57759d8` requires one fresh exact
  named-owner statement. These artifacts authorize no external action by themselves.
- The exact provisioning preview is an owner-run SQL source outside `migrations/`. It creates
  `tzudong_g037_readonly` with `PASSWORD NULL`, a one-connection ceiling, no inheritance or elevated
  role flags, five fixed session defaults, and only CONNECT plus migration-ledger column reads. This
  placement is deliberate: recording credential infrastructure in `schema_migrations` would alter
  the very exact ledger G037 is intended to diagnose.
- The provisioning transaction checks absence before creation and verifies flags, settings, zero
  parent memberships, the exact single inbound creator-admin shape, zero owned objects, no
  unexpected direct ACL/default grants, no effective database or public-schema CREATE, and no
  EXECUTE on the exact account-deletion mutator before commit. A
  separate mutation-free readback emits only fixed booleans and bounded counts. Neither SQL file is
  referenced by an executable workflow.
- Every connected G037 mode performs the same 33-field role admission before its existing read-only
  work. A wrong, drifted, owner-capable, unexpectedly granted, or write-enabled credential collapses
  to the fixed `readonly_role_contract_denied` receipt code without role or provider detail.
