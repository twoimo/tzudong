# Requirements: Crawler Pipeline Operational Readiness

## Context

The crawler orchestration feature checklist is complete and its focused tests pass in the existing
project virtual environment. The next gap is reproducibility and operational closure: a clean
checkout must be able to determine why it is ready or blocked without trusting stale checkmarks,
local ignored reports, build caches, hosted assumptions, or secret-bearing diagnostics.

This follow-up remains additive and fail closed. It does not authorize a hosted write, migration
apply, branch-protection bypass, production deployment, DNS mutation, legal-compliance claim, or
fabricated receipt.

## Requirements

### R1. Reproducible readiness audit

1. A repository command shall inspect the completed orchestration task document, required artifacts,
   focused test dependencies, and optionally the focused verification suite.
2. The command shall use the exact Python interpreter that launched it for all child tests.
3. A missing/invalid task document, open task, missing artifact, missing dependency, failed test, or
   timeout shall produce a blocked result from a closed code vocabulary.
4. The machine-readable report shall exclude captured test output, environment values, provider
   diagnostics, database diagnostics, credentials, and free-form errors.
5. The test execution shall be bounded by an operator-configurable timeout with safe limits.

### R2. Deterministic test bootstrap

1. Focused backend test-only dependencies shall be declared separately from runtime/provider
   dependencies with exact versions.
2. Documentation shall use `python3` or an explicitly activated virtual environment consistently.
3. CI/local commands shall not silently skip unavailable test modules or swallow non-zero exits.
4. The readiness audit shall identify missing packages by canonical package name only.

### R3. Evidence provenance

1. Completion checkmarks shall be treated as planning state, not proof of current behavior.
2. Readiness evidence shall bind to a Git tree/commit outside generated crawl-data directories.
3. Ignored local phase reports, Python bytecode, Rust build products, and prior logs shall not count as
   source or current verification evidence.
4. Evidence retention shall preserve only bounded, secret-free metadata.

### R4. Operational phase closure

1. Local pipeline, publication, observability, supply-chain, layout/naming, Rust, and readiness-agent
   phases shall each have explicit entry conditions, executable checks, and exit conditions.
2. Operator-secret absence shall remain an expected fail-closed external precondition, not be worked
   around with placeholders.
3. Public-route, hosted migration, branch-protection, and deployment claims require current external
   readback; local source/tests cannot mark them complete.
4. Rust cutover remains blocked until three distinct matching live parity receipts exist and valid
   performance evidence is retained under canonical paths.
5. The current phase catalog shall partition R1 through R14 exactly once across seven ordered gates;
   the layout/naming gate may remain deliberately unassigned while its deferred decision is explicit.
6. Every phase shall reference the same seven repository verification commands with an independent
   1,800-second ceiling, the same bounded public-route set, one rollback-plan path, and one report path.
7. Condition evidence shall bind a positive boolean, RFC3339 observation time, and exact candidate
   tree fingerprint; external conditions additionally require a non-empty external evidence reference.
8. A rollback plan shall target the exact candidate fingerprint, enumerate affected repository paths,
   cover all seven post-rollback checks, and admit only an exact `git revert --no-edit <commit>` action.
   Reset, stash, clean, checkout, switch, restore, shell deletion, network, and arbitrary commands shall
   fail closed and shall never be executed by validation.
9. Gate evaluation shall stop in entry → rollback → command → route → exit order and use only fixed
   codes with bounded failing identifiers; absent or stale evidence shall never be promoted to pass.
10. Command execution and report creation shall remain explicit opt-ins. Command output shall be
    discarded, and a phase report shall be created once rather than overwritten.
11. The current layout checker shall compare the manifest bidirectionally with cached and non-ignored
    candidate files so a pre-commit candidate cannot hide a newly introduced first- or second-level
    ownership boundary.
12. `backend/pipeline-control` shall remain the sole owner of observability container/configuration
    assets, `backend/pipeline_control` shall remain the importable Python control package, and
    `backend/deploy` shall own deployment ledgers and IaC. The historical nested
    `backend/deploy/pipeline-control` path shall remain absent unless separately approved.
13. No directory move shall be assumed by default. A proposed move may be injected into the read-only
    checker and must prove zero before-path matches, exactly one after-path match, no alias/symlink,
    and no stale workflow, dependency, channel, or compose reference.
14. The rename ledger shall use a closed contract-classification set, exclude public routes, public API
    fields, applied migration objects, RPC names, persistent data paths, and canonical privacy names,
    and prove zero old-path references plus exactly one new definition for each accepted rename.

### R5. Supabase and release safety

1. Applied migrations remain immutable; corrections use new additive migrations created through the
   supported Supabase CLI workflow.
2. Hosted writes retain Preview → Confirm → Apply → Readback → Audit and all existing exact-match
   gates.
3. The management API `logs.all` endpoint shall not be introduced; any existing use must migrate to
   the current `logs` endpoint before its removal date.
4. No source change may claim hosted state, legal approval, production deployment, or receipt
   acceptance without external evidence.
5. Official advisor findings shall be classified by exact object identity, invoker/definer state,
   executable role, and source allowlist without exporting application rows or provider diagnostics.
6. Mutable function paths shall be fixed only across schemas where PUBLIC and Data API roles lack
   CREATE, shall preserve invoker/definer status and existing execution ACL intent, and shall resolve
   the vector type namespace across the admitted hosted and disposable-local layouts.
7. Validating a constraint covered by the immutable G014 catalog manifest shall advance exactly its
   corresponding manifest value in the same transaction, restore temporary role membership, re-enable
   the immutability trigger, and pass the complete catalog assertion before commit.
8. A security-definer view warning may remain only as a named-owner-reviewed bounded exception with
   explicit security barrier, caller identity predicate, FORCE RLS backing relations, and closed SELECT
   grants; local source analysis alone shall not constitute that owner approval. A scoped retain
   decision shall not suppress the Advisor ERROR or count as hosted remediation, general security
   review, legal/privacy approval, or release evidence.
9. A fresh local stack that exposes an application schema through PostgREST shall create only the empty
   namespace before REST readiness, deny PUBLIC/Data API CREATE, and leave tables and service grants to
   the canonical migration chain.
10. Every local migration receipt consumer shall bind the same exact migration-unit count, complete
    prerequisite/migration/closure/platform/seed order, and fail closed on count or source drift.
11. Disposable local stack, migration, closure, seed, SQL-boundary, and receipt success shall prove only
    local compatibility and shall not be treated as hosted apply, advisor remediation, or release evidence.
12. Owner authorization for a plan-gated Auth control shall not be treated as activation. The exact
    project ref, prior value, plan eligibility, single-setting apply, saved-state readback, and bounded
    external receipt shall be verified independently; no paid-plan upgrade may be inferred from a
    setting-level authorization. A documented paid-plan deferral shall preserve the disabled setting
    and require a new named-owner decision before any purchase or activation attempt.
13. A named-owner confirmation that the repository secret `SUPABASE_DB_URL` is current, production,
    and restricted to the owner and approved operators shall close only the credential-provisioning
    prerequisite. Repository-secret metadata must be read without the value, and neither presence nor
    owner attestation shall count as a successful connection, controller execution, hosted apply, or
    release evidence. Every protected read-only controller run requires a separate authorization bound
    to a freshly read exact `main` SHA and must retain only a sanitized external receipt.
14. A bounded controller receipt with status `denied` shall prove only that the admitted mode did not
    complete. When the receipt intentionally omits its internal denial cause, source must not infer an
    invalid credential, a successful connection, or catalog drift from that absence. Exact-SHA source
    validation and uploaded receipt hashes shall remain separately auditable, task completion shall
    remain open, and any diagnostic mode or retry requires a new explicit authorization.
15. A successful `runtime-probe` shall use a repeatable-read, read-only transaction and return status
    `authorization-denied` plus a true `runtime_authorization_denied` field only after the target
    function exists and the current database role lacks EXECUTE. A generic `denied` receipt without
    that field shall leave connection, function-presence, and privilege-denial states unproven.
16. Hosted controller denials shall expose at most a code from a closed source-defined allowlist.
    Provider messages, exception text, endpoints, credentials, SQL, role identities, and row values
    shall never enter receipts. Unknown errors shall collapse to a generic contract-denied code, and
    adding diagnostic codes shall not add a mutation mode or weaken rollback/read-only behavior.
17. A database-owner credential shall not be admitted to the recurring G037 read-only workflow even
    when every controller transaction is read-only. G037 shall use a distinct repository secret and a
    dedicated login with no database ownership, superuser, BYPASSRLS, CREATEROLE, CREATEDB,
    replication, target-mutator EXECUTE, or inherited owner authority; its default transaction mode
    shall be read-only and its read grants shall be limited to the exact production database,
    canonical migration ledger, and required catalog metadata. The workflow and executor must never
    fall back to `SUPABASE_DB_URL`. Provisioning and rotation require external Preview → Confirm →
    Apply → Readback → Audit evidence before any newly authorized retry.
18. The G037 credential role shall be provisioned by an exact hash-bound one-time operator SQL
    source, not by a Supabase migration, because adding credential infrastructure to the canonical
    migration ledger would change the ledger G037 is diagnosing. The source shall create the login
    with a null password, grant only database CONNECT, migration-schema USAGE, and column-level
    SELECT on `version`, `name`, and `statements`, and atomically roll back unless negative role,
    ownership, membership, ACL, read-only-setting, and target-EXECUTE postconditions all pass.
    Password creation, DSN assembly, secret write, hosted execution, and readback remain distinct
    externally approved steps, and no workflow shall execute the provisioning or readback SQL.

### R6. Machine-readable task traceability

1. Every canonical predecessor task ID shall have exactly one traceability entry containing at least
   one repository source path and its applicable verification modules.
2. The map shall classify source, source-contract, local-runtime, hosted Supabase, checkpoint, and
   externally retained proof without treating classification as proof that an external receipt exists.
3. The readiness audit shall fail closed on missing or malformed traceability documents, duplicate,
   missing, or unknown task IDs, unsafe or absent source references, absent test modules, and any
   default artifact or test module omitted from the map.
4. Traceability references shall remain repository-relative and shall reject parent traversal,
   bytecode, caches, generated reports, dependency trees, and build products.
5. The schema and map shall produce a deterministic combined digest while all reported failures
   remain bounded and drawn from closed validation and blocker vocabularies.

### R7. Committed cadence-source agreement

1. The cadence artifact, scheduled GitHub workflow cron, and Mac LaunchAgent calendar and label
   shall agree before either local entrypoint begins pipeline work.
2. The GHA cron shall derive the configured KST start through the fixed UTC+9 conversion, and the
   Mac calendar shall equal its configured KST start exactly.
3. A missing, malformed, duplicate-runner, or divergent source shall halt with a bounded source and
   code and shall not expose YAML, shell, filesystem, or parser diagnostics.
4. The Mac schedule shall preserve a 30-minute buffer after the committed GHA window, run through a
   bash wrapper outside Documents, and shall not add an interval, keep-alive, or replay loop.
5. Real scheduler timing and sleep/wake behavior remain external evidence gates; local source checks
   shall not claim that a scheduled invocation occurred.

### R8. Bounded manifest evidence

1. Manifest step names, skip reasons, final statuses, execution modes, data sinks, and adapter-level
   failures shall be reduced to closed vocabularies before serialization.
2. Reflection evidence shall contain only bounded 11-character video identities, shall be unique
   within and across outcome buckets, and shall drop extra fields and malformed values.
3. Input/output evidence hashes shall be lowercase SHA-256 values with exact provenance or null with
   `unavailable` provenance; secret-shaped non-hashes shall never be copied.
4. The unconditional workflow evidence upload shall include both the current summary and its derived
   health report, without changing scheduler or hosted state.

### R9. Supply-chain contract recovery

1. The historical six-item web Pin_Contract shall be reconstructed as a read-only verifier from the
   current release authorities and shall never rewrite `package.json`, `package-lock.json`, or
   `bun.lock`.
2. A host runtime that is not npm 11.6.2 on Node 24.x shall return `pin_contract_drift` while still
   reporting whether every tree-owned declaration and resolution matches; an absent or escaping
   compiler shall return only `global_compiler_not_admitted` and no receipt.
3. Every Python requirements manifest executed by security audit CI shall use exact `==` pins, and
   every declared hash token shall be a complete lowercase SHA-256 value.
4. Dependabot shall contain the six current dependency units. A seventh Cargo unit is required only
   when an authoritative `backend/rust/**/Cargo.toml` exists; ignored build products shall not trigger
   that unit or count as Rust source.
5. The held Next.js family shall resolve `next`, `@next/bundle-analyzer`, and `eslint-config-next` to
   the admitted 16.2.12 line in the release lock while the `>=16.3.0` holds remain active.
6. Container references owned by crawler orchestration shall use a digest or explicit version tag,
   shall reject floating channel tags, and CI Postgres services shall reuse the repository's existing
   digest pin.
7. Supabase's separately owned local/self-host development compose bundle shall be inventoried but
   shall not be silently reclassified as crawler-owned or changed without a dedicated compatibility
   update and verification.
8. Supply-chain source checks shall run in security CI whenever their manifests, workflows, Docker
   descriptors, lockfiles, verifier, or tests change.
9. Dependency freshness shall enumerate the seven current Dependabot units, target `develop`, keep
   auto-merge disabled, use read-only contents permission, and pin Node 24, npm 11.6.2, Bun 1.4.0,
   and Rust 1.97.0 without changing repository release authorities.
10. Each freshness run shall execute lint, unit, compiler-parity, and build checks with a 30-minute
    per-command ceiling, preserve each result before classification, and fail closed with
    `dependency_check_failed` on failure, timeout, or incomplete attachment.
11. The tooling-selection record shall enumerate exactly twelve categories with two through six
    fixed candidates each, current-tree asset paths, one selected engineering candidate, unresolved
    named-human approval, and null local measurements until real observations exist.
12. Tooling coherence shall be checked before startup eligibility; an unapproved category shall
    return `tooling_approval_missing`, an unmeasured category shall return
    `local_install_unverified`, and neither shall enter the default startup set.
13. Source recovery, fixed image tags, and passing local tests shall not be interpreted as operator
    approval, successful installation, branch protection, deployment, or hosted-state evidence.

### R10. Provenanced Rust recovery and parity

1. Rust source recovery shall require a tracked Git object, a second corroborating commit with the
   same tree, and per-file Git blob, SHA-256, and byte-count provenance; build output and bytecode are
   never source evidence.
2. The recovered workspace shall preserve the exact Cargo manifest, lockfile, Rust 1.97.0 toolchain,
   PyO3 0.29.2, maturin 1.15.0, and proptest 1.11.0 pins and shall test with `--locked` under the exact
   toolchain without changing the machine default.
3. Cross-language parity shall use a fresh isolated extension build. Its artifact identity shall hash
   the compiled extension bytes, never a Python package wrapper, and ambiguous extension discovery
   shall fail closed.
4. Live N=3 eligibility shall rederive the receipt hash from the complete closed evidence field set,
   require distinct job and receipt identities, and keep every admitted attempt in one exact Git and
   frozen-input cohort.
5. A failed, replayed, malformed, incomplete, cross-cohort, or tampered attempt shall reset the
   consecutive count. Python/shim removal remains blocked until three approved live receipts are
   read back and the user separately approves retirement.
6. Successful local unit and synthetic parity checks establish implementation behavior only; they do
   not count as approved live N=3 receipts or authorize a default switch.

### R11. Canonical performance-evidence closure

1. Every retained performance input, raw measurement, scored output, validator output, and artifact
   map shall remain under `apps/web/performance/*`; the superseded `backend/performance/*` split and
   every outside, absolute, aliased, or traversing path shall fail closed.
2. The canonical budget shall bind all 36 approved `(key, surfaceClass, targetId)` tuples and state
   an absolute budget, relative threshold, absolute noise floor, sample minimum, evidence form,
   ownership threshold, freshness window, and confidence margin for each tuple.
3. Scoring and validation shall independently bind the release ID, candidate commit and tree,
   configuration hash, data-profile hash, frozen timestamp, source schemas, budget bytes, and every
   referenced artifact hash.
4. The artifact map shall be canonical, bounded, non-self-referential, and pinned by a SHA-256 value
   supplied out of band before either protected CLI parses it.
5. A zero-admission result is valid non-improvement evidence. It shall not be retried or rewritten
   into a performance claim merely because no candidate exceeded the absolute, noise, relative, or
   confidence gates.
6. G003 has no established measured improvement until real raw and scored artifacts, independent
   validation, a clean frozen-tree cohort, sufficient samples, and the detached artifact-map hash are
   retained and read back. Synthetic fixtures prove the contract only.

### R12. Bounded observability and admin readback

1. The pipeline metric catalog shall contain exactly four lifecycle counters, eight gauges, and one
   step-failure counter. Unknown names shall fail closed, export shall remain off by default, and a
   GitHub Actions process shall reject an opt-in OTLP endpoint.
2. Host-published API, Kafka, Elasticsearch, Loki, OTLP, Prometheus, and Grafana ports shall bind to
   loopback only. Container-internal wildcard listeners do not authorize host wildcard publication.
3. Collector file ingestion shall use a pinned distribution that actually contains the `filelog`
   receiver. Loki delivery shall use Loki 3.x native OTLP/HTTP at the `/otlp` base endpoint and shall
   not depend on the deprecated Collector Loki exporter.
4. Kafka and Elasticsearch destinations shall be restricted to the closed local host sets and local
   data environment; missing, remote, malformed, userinfo, redirect, and non-local targets shall
   return bounded codes.
5. Event, log, and raw-document payloads shall pass through role-specific field allowlists and the
   shared bounded privacy sanitizer before serialization or delivery.
6. Broker failure shall preserve pending outbox work, retry shall keep deterministic identity, and
   acknowledgement shall happen only after a successful send.
7. Discovery of admin orchestration routes shall be non-vacuous. Every discovered handler shall run
   `requireAdmin` before request parsing or upstream work and shall expose only fixed bounded codes
   and admitted HTTP statuses without provider/database/free-form errors.
8. Missing or unreadable current manifest evidence shall remain `UNKNOWN`; pipeline job-API and
   manifest fallback sources shall remain distinguishable and all status responses shall be no-store.
9. Passing local/source tests do not establish hosted telemetry ingestion, dashboard health, alert
   delivery, or production readback.
10. Local Collector readiness shall probe the exact OTLP/HTTP metrics ingestion route and may treat
    only its expected GET `405` response as listener readiness; a non-Collector `4xx`, transport
    error, `5xx`, or unavailable endpoint shall remain not ready.
11. Compose shall escape Grafana's runtime `$NONCE` placeholder as `$$NONCE` so host interpolation
    cannot erase it. The dashboard credential shall remain environment-only and neither value may
    appear in the bounded readiness artifact.

### R13. Deployment descriptors and least-authority operations agent

1. The deployment descriptor catalog shall cover exactly the five declared components, carry only
   external secret-reference names, and render at least two local cluster identifiers with differences
   confined to the closed derived-field set and zero remote apply attempts.
2. Helm and OpenTofu source shall remain local rendering material only. No descriptor validation may
   obtain credentials, contact a cluster, run an apply, or imply that a deployment occurred.
3. Migration readiness shall use only `unresolved` and `external_evidence_confirmed`; the confirmed
   state requires a non-empty external evidence reference, and every committed release gate remains
   unresolved until real evidence is read back.
4. The committed action and rate-limit ledgers shall remain inactive until a named operator records
   approval; an inactive or unreadable ledger shall fail closed without executing an action.
5. Autonomous actions shall be limited to local idempotent effects. `open_github_issue` is an external
   write and shall require a non-empty, bounded, named-human approval reference bound to the exact
   trigger and action even though it is enumerated in the action catalog.
6. Hosted writes, migrations, deployments, rollbacks, branch protection, secret changes, DNS changes,
   and every other high-risk action shall require the same bound approval. Release self-approval and
   authority or data-subject notifications shall remain impossible under every approval state.
7. An executor exception shall fail closed as `agent_action_unverified`, shall not be overwritten by a
   successful verifier response, and shall halt follow-up work for the same trigger without exposing
   exception text.
8. Source/property tests establish only local boundary behavior; they do not authorize GitHub writes,
   hosted remediation, deployment, notification, or any other external mutation.
9. Recovered operational source shall bind every restored file to two corroborating Git objects and
   record current-layout and security transformations separately from byte-exact source entries.

### R14. Fail-closed local publication recovery

1. The admin publication route shall call `requireAdmin` before any queue access, require a trusted
   same-origin mutation, accept only a bounded empty request object, and return no-store responses
   containing only fixed codes and bounded queue fields.
2. The route shall access `local_analytics.publish_jobs` only when an explicit feature flag is active
   and the configured Supabase URL resolves exactly to `localhost`, `127.0.0.1`, or `::1`; hosted,
   malformed, missing, and non-HTTP(S) targets shall return `publish_job_queue_unavailable` before a
   service-role client is created.
3. Queue readback shall validate UUID, status, fixed failure-code, and RFC3339 timestamp fields. A
   malformed database row shall collapse to `publish_job_status_unavailable` and shall never expose
   the row or provider diagnostic.
4. The committed Publication_Set and publish schedule shall each require status `approved`, a
   non-empty named approver, and an RFC3339 approval time before preview or apply. Both ledgers shall
   remain unresolved until a real named operator approval is supplied and read back.
5. A request shall contain each target table and row identity at most once, each row shall contain a
   non-null identity plus at least one published column, and any ambiguity shall fail closed as
   `publication_target_not_admitted` before a hosted callable runs.
6. `public.videos` publication shall explicitly include the non-null `youtube_link` and
   `channel_name` fields required to create a new row, and both admitted tables shall retain their
   identity values during insertion.
7. Publication shall use distinct `pipeline_control.publish_upsert_restaurants` and
   `pipeline_control.publish_upsert_videos` functions. It shall never replace or broaden the
   crawler/evaluation-owned `pipeline_control.batch_upsert_restaurants` contract.
8. The publication SQL adapter shall contain only fixed table/RPC statements, require exact
   ledger-to-plan agreement, derive update CAS expectations from a bounded hosted read, enforce the
   200-row limit, and reduce every database exception to a PublishWorker exception without copying
   diagnostics.
9. Local publication tables shall constrain stages, statuses, result codes, hashes, and counts to
   their bounded domains and shall revoke update/delete on append-only audit records.
10. New migration files and adapter tests are source evidence only. No migration execution, hosted
    read/write, approval, queue activation, deployment, or production-state claim is authorized by
    this recovery.
