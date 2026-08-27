# Implementation Plan: Crawler Pipeline Orchestration

## Overview

This plan hardens an existing three-actor crawler pipeline (GHA lite compute + evidence, Mac heavy
compute + hosted reflection, hosted Supabase persistence) into one coherent, scheduled, observable
orchestration. Work is **additive**: new pure-logic modules, additive Run_Manifest fields, a new
additive Supabase migration, and extensive test coverage (Python `hypothesis` property tests plus
backend `unittest` and `apps/web` source-contract tests). No task rebuilds the pipeline or weakens a
fail-closed control.

Convention notes carried through every task:
- The hosted-apply latch `PIPELINE_HOSTED_APPLY_ENABLED` stays a compile-time `False` constant; no
  task enables it via environment.
- Any change to protected-branch workflow behavior (`daily-crawler.yml`, `gdrive-frame-backfill.yml`)
  is authored in-repo but lands only through the serialized `develop -> data -> main` PR flow under
  branch protection — never a direct push.
- Applied Supabase migrations are immutable; corrections and new constraints are new additive
  migration files.
- Property tests use `hypothesis` with `@settings(max_examples=100)` (minimum), one test per
  property, each tagged `# Feature: crawler-pipeline-orchestration, Property {n}: {text}`, runnable
  via `python -m unittest`. Do not implement a PBT framework from scratch.

## Tasks

- [x] 1. Cadence schedule config and validation (R1)
  - [x] 1.1 Create the committed cadence configuration artifact
    - Create `backend/pipeline_control/cadence.schedule.json` with `schemaVersion`, `timezone`,
      `utcOffsetMinutes` (540), `minBufferMinutes` (30), and per-runner windows (GHA_Runner
      `lite_gha` + `utcCron` + workflow path; Mac_Runner `heavy_local` + `launchdCalendar` + agent)
    - Encode non-overlapping KST windows that satisfy the >=30-minute buffer and GHA-before-Mac
      ordering (e.g. GHA end 04:45, Mac start 05:15), reconciled against the real cron/launchd times
    - Contains no secrets; Operator-readable
    - _Requirements: 1.5_

  - [x] 1.2 Implement `schedule.py` with cadence validation and KST offset helper
    - Create `backend/pipeline_control/schedule.py`
    - Implement a pure `validate_cadence(config)` returning
      `{ "ok": bool, "errorCode": str|null, "conflictingWindows": [str,...] }` with `errorCode` from
      the closed set `{ null, "windows_overlap", "buffer_too_small", "order_violation", "window_shape_invalid" }`
    - Reject overlapping windows, sub-buffer gaps, and GHA-after-Mac ordering; identify the
      conflicting windows
    - Implement a fixed UTC+9 (540 minute) KST derivation helper with no daylight-saving adjustment
    - _Requirements: 1.1, 1.2, 1.3, 1.6_

  - [x] 1.3 Wire cadence validation as a fail-closed preflight
    - Invoke `validate_cadence` in the worker/entrypoint preflight so no runner is triggered under an
      invalid config; on rejection, halt and surface the bounded `errorCode` and conflicting windows
    - _Requirements: 1.6_

  - [x]* 1.4 Write property test for schedule non-overlap and buffer
    - **Property 1: Valid schedule implies non-overlap and buffer**
    - **Validates: Requirements 1.1, 1.6**
    - Place in `backend/pipeline_control/test_schedule_pbt.py`

  - [x]* 1.5 Write property test for GHA-before-Mac ordering
    - **Property 2: Valid schedule preserves GHA-before-Mac ordering**
    - **Validates: Requirements 1.2, 1.6**

  - [x]* 1.6 Write property test for KST offset round-trip
    - **Property 3: KST derivation round-trips with a fixed UTC+9 offset**
    - **Validates: Requirements 1.3**

  - [x]* 1.7 Write unit test for cadence config schema presence
    - Assert the committed `cadence.schedule.json` parses, carries both runner windows, and encodes
      valid non-overlapping windows
    - _Requirements: 1.5_

- [x] 2. Run_Manifest additive fields and health/staleness (R5, R1.7, R6.2)
  - [x] 2.1 Add additive Run_Manifest fields in the manifest writer
    - Extend `worker.write_run_manifest` / `backend/pipeline_control/manifest.py` with bounded,
      secret-free fields: `hostedGateRejectionCode` (enum|null), `operatorSummary` (<= fixed max),
      `windowStart`/`windowEnd` (KST HH:MM|null), `windowOverrun` (bool), `missedWindowCount` (int>=0),
      and the `reflection` accounting object placeholder
    - Keep UTC `generatedAt` (`%Y-%m-%dT%H:%M:%SZ`) and `date` (`%Y-%m-%d`); pin the OK<->Succeeded /
      ERROR<->Failed status vocabulary as mutually exclusive
    - Derive `operatorSummary` from final status, execution mode, data sink, and failed-required-step
      count; record failed required steps by fixed canonical id only
    - Derive `windowStart`/`windowEnd`/`windowOverrun` from the cadence config and actual completion
    - _Requirements: 5.1, 5.2, 5.5, 5.6, 5.8, 5.9, 1.7_

  - [x] 2.2 Implement `health.py` staleness check and missed-window derivation
    - Create `backend/pipeline_control/health.py`
    - Implement `run_is_healthy(...)` returning not-Succeeded (fail closed) when the manifest `date`
      is earlier than the current UTC date or no manifest exists for today; only a today-dated
      Succeeded manifest is healthy
    - Implement missed-window count derivation from the last-successful manifest date vs current UTC
      date, recorded without provider/DB diagnostics
    - _Requirements: 5.7, 6.2_

  - [x]* 2.3 Write property test for UTC manifest timestamp format
    - **Property 16: Manifest timestamps are UTC in a fixed format**
    - **Validates: Requirements 5.2**
    - Place in `backend/pipeline_control/test_manifest_pbt.py`

  - [x]* 2.4 Write property test for fixed-vocabulary skip reasons
    - **Property 17: Skipped steps carry a fixed-vocabulary reason**
    - **Validates: Requirements 5.4**

  - [x]* 2.5 Write property test for exclusive final status
    - **Property 18: Final status is Succeeded exclusive-or Failed**
    - **Validates: Requirements 5.5**

  - [x]* 2.6 Write property test for bounded failed-step identification
    - **Property 19: Failed runs identify failed required steps by bounded id only**
    - **Validates: Requirements 5.6**

  - [x]* 2.7 Write property test for stale/absent manifest health
    - **Property 20: Stale or absent manifest is not healthy**
    - **Validates: Requirements 5.7**
    - Place in `backend/pipeline_control/test_health_pbt.py`

  - [x]* 2.8 Write property test for bounded, complete operator summary
    - **Property 21: Operator summary is bounded and complete**
    - **Validates: Requirements 5.8**

  - [x]* 2.9 Write property test for manifest secret exclusion
    - **Property 22: Manifest excludes secrets and diagnostics**
    - **Validates: Requirements 5.9**

  - [x]* 2.10 Write property test for coalesced missed-window count
    - **Property 23: Missed-window count reflects the coalesced gap**
    - **Validates: Requirements 6.2**

  - [x]* 2.11 Write unit test for manifest presence and fields at the fixed path
    - Assert a representative run writes `current-summary.json` at the fixed location with the
      required fields
    - _Requirements: 5.1_

- [x] 3. Checkpoint - schedule, manifest, health
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Hosted-gate rejection-code enumeration mapping (R3)
  - [x] 4.1 Define the closed hosted-gate rejection-code enumeration and manifest mapping
    - Add the closed set `{ sink_not_admitted, loopback_required, hosted_apply_disabled,
      not_live_mode, approval_flag_absent, project_ref_mismatch, config_invalid }`
    - Map the gate's internal `SupabaseRestConfigurationError` conditions onto this enumeration at the
      manifest layer, recording exactly one `hostedGateRejectionCode` per rejection with no
      provider/DB text
    - Ensure `process_one` writes a `Failed` manifest with the bounded code on rejection; keep the
      `PIPELINE_HOSTED_APPLY_ENABLED` compile-time `False` latch unchanged
    - _Requirements: 3.7, 9.4_

  - [x]* 4.2 Write property test for single-target sink classification before any client
    - **Property 7: Sink is classified as exactly one target before any client**
    - **Validates: Requirements 3.1**
    - Place in `backend/utils/tests/test_supabase_boundary_pbt.py`

  - [x]* 4.3 Write property test for all-four hosted-write conditions
    - **Property 8: Hosted write requires all four conditions**
    - **Validates: Requirements 3.2**

  - [x]* 4.4 Write property test for project-reference mismatch handling
    - **Property 9: Any project-reference difference is treated as a mismatch**
    - **Validates: Requirements 3.3**

  - [x]* 4.5 Write property test for lite/local/artifact never admitting Hosted_Store
    - **Property 10: Lite, local, and artifact profiles never admit Hosted_Store**
    - **Validates: Requirements 3.4**

  - [x]* 4.6 Write property test for single bounded rejection code
    - **Property 11: Gate rejection records a single bounded fixed code**
    - **Validates: Requirements 3.7, 9.4**

  - [x]* 4.7 Write unit test for Mac dry-run-preview-precedes-live and no-auto-enable
    - Assert the Mac entrypoint runs a dry-run preview before any live write and never auto-enables
      the hosted-apply latch during unattended runs
    - _Requirements: 3.5, 3.6_

- [x] 5. Idempotent reflection accounting and concurrency constraint (R4)
  - [x] 5.1 Add a new additive Supabase migration for the unique candidate-identity constraint
    - Create a NEW additive migration enforcing a unique constraint on the stable candidate identity
      at the Hosted_Store insert boundary so a losing concurrent writer observes a conflict
    - Do not modify, delete, or overwrite any already-applied migration
    - _Requirements: 4.5, 9.7_

  - [x] 5.2 Implement per-candidate reflection accounting in the Mac apply path
    - In the hosted apply path (`apply_hosted_pending_candidates.py`), classify each processed
      candidate into mutually-exclusive `applied` / `skippedAlreadyPresent` / `unresolved` sets whose
      union equals the processed set, using stable candidate identity (never raw payloads)
    - Skip candidates already present (insert-if-absent); skip unresolved candidates without creating
      a record; never roll back applied records on partial termination
    - Emit the `reflection` object into the Run_Manifest
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6, 4.7_

  - [x]* 5.3 Write property test for idempotent reflection
    - **Property 12: Reflection is idempotent**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.7**
    - Place in `backend/pipeline_control/test_reflection_pbt.py` using an in-memory insert-if-absent
      model (mocked hosted I/O, no live Supabase)

  - [x]* 5.4 Write property test for reflection accounting partition
    - **Property 13: Reflection accounting partitions the processed set**
    - **Validates: Requirements 4.4**

  - [x]* 5.5 Write property test for concurrent single-record creation
    - **Property 14: Concurrent reflection creates at most one record**
    - **Validates: Requirements 4.5**

  - [x]* 5.6 Write property test for unresolved-candidate skip
    - **Property 15: Unresolved candidates are skipped without a record**
    - **Validates: Requirements 4.6**

- [x] 6. Checkpoint - hosted gate and reflection
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Env-contract placeholder rejection and preflight ordering (R7)
  - [x] 7.1 Add placeholder/fabricated-value rejection to the env-contract check
    - Extend `_present` semantics in `backend/bin/check_env_contract.py` so a required secret bound
      to a known placeholder/fabricated marker is treated as absent (bounded denylist; never log the
      value)
    - Preserve names+presence-only reporting, alias satisfaction, forbidden-name detection, and
      fail-closed non-zero exit
    - _Requirements: 7.3, 7.5_

  - [x]* 7.2 Write property test for missing-secret halt
    - **Property 28: Missing required secret halts before any work**
    - **Validates: Requirements 7.2, 6.10**
    - Place in `backend/utils/tests/test_env_contract_pbt.py`

  - [x]* 7.3 Write property test for placeholder rejection
    - **Property 29: Placeholder values do not satisfy a required secret**
    - **Validates: Requirements 7.3**

  - [x]* 7.4 Write property test for forbidden legacy names
    - **Property 30: Forbidden legacy names fail the contract**
    - **Validates: Requirements 7.4**

  - [x]* 7.5 Write property test for no-secret-value emission
    - **Property 31: Env-contract report never emits a secret value**
    - **Validates: Requirements 7.5**

  - [x]* 7.6 Write property test for alias satisfaction
    - **Property 32: An allowed alias satisfies its required secret**
    - **Validates: Requirements 7.6**

  - [x]* 7.7 Write source-contract test for runner->profile preflight ordering
    - Assert each runner validates its mapped env-contract profile (daily, pipeline-control,
      hosted-pending-apply, gdrive-backfill) and exits 0 before any pipeline step; assert the `--json`
      report schema enumerates each secret name, presence, and overall result
    - _Requirements: 7.1, 7.7_

- [x] 8. Lite vs heavy compute separation pins (R2)
  - [x]* 8.1 Write property test for lite profile skipping every heavy step
    - **Property 4: Lite profile never runs a heavy step**
    - **Validates: Requirements 2.1, 2.5**
    - Place in `backend/pipeline_control/test_profiles_pbt.py`

  - [x]* 8.2 Write property test for heavy-readiness gating
    - **Property 5: Heavy readiness gates every heavy step**
    - **Validates: Requirements 2.3, 2.4**

  - [x]* 8.3 Write property test for unresolvable-profile halt
    - **Property 6: Unresolvable profile halts before heavy work**
    - **Validates: Requirements 2.6**

  - [x]* 8.4 Write source-contract test pinning heavy-step capability set and skip policy
    - Assert `STEP_SPECS` heavy steps carry `heavy_compute`/`skip_when_lite` and that
      `skip_reason_for_step` returns the bounded optional skip under `lite_gha`
    - _Requirements: 2.1, 2.2, 2.5_

- [x] 9. Publish gate, redaction, ignore config, commit guard (R8)
  - [x]* 9.1 Write property test for data-branch publish flag exactness
    - **Property 33: Data-branch publish is enabled only by the exact flag value**
    - **Validates: Requirements 8.3, 8.4**
    - Place in `backend/pipeline_control/test_publish_gate_pbt.py`

  - [x]* 9.2 Write property test for evidence artifact redaction
    - **Property 34: Evidence artifacts exclude and redact sensitive content**
    - **Validates: Requirements 8.5, 8.6**

  - [x]* 9.3 Write property test for ignore-configuration coverage
    - **Property 35: Ignore configuration covers every forbidden path category**
    - **Validates: Requirements 8.7**

  - [x]* 9.4 Write property test for commit-guard rejection of non-manifest data/secret paths
    - **Property 36: Commit guard blocks non-manifest data or secret paths**
    - **Validates: Requirements 8.1, 8.2, 8.8**

  - [x]* 9.5 Write source-contract test for .gitignore forbidden-path patterns
    - Assert `.gitignore` excludes data dirs, `**/*.jsonl`, env files, OAuth/session/cookie files,
      and provider credential dirs
    - _Requirements: 8.2, 8.7_

- [x] 10. Failure handling and backfill planner coverage (R6)
  - [x]* 10.1 Write property test for soft-timeout staging remainder
    - **Property 24: Soft-timeout staging captures exactly the unverified remainder**
    - **Validates: Requirements 6.3**
    - Place in `backend/utils/tests/test_backfill_planner_pbt.py`

  - [x]* 10.2 Write property test for backfill-before-new-work
    - **Property 25: Backfill processes staged shards before new work**
    - **Validates: Requirements 6.4**

  - [x]* 10.3 Write property test for empty-backlog short-circuit
    - **Property 26: Empty backlog short-circuits without contacting hosted targets**
    - **Validates: Requirements 6.5**

  - [x]* 10.4 Write property test for attempt-exhausted shard retention
    - **Property 27: Attempt-exhausted shards are retained without blocking others**
    - **Validates: Requirements 6.6**

  - [x]* 10.5 Write source-contract test for GHA degradation evidence publication
    - Assert the lite path publishes evidence and records the non-zero adapter exit while not
      reporting a clean success; assert env preflight fails closed before work
    - _Requirements: 6.7, 6.8, 6.10_

- [x] 11. Governance-boundary source-contract tests (R9)
  - [x]* 11.1 Write source-contract test for backend-only long-running work
    - Assert web route handlers do not import crawler/ffmpeg/Gemini-bulk/GDrive/batch-insert modules
    - _Requirements: 9.1_

  - [x]* 11.2 Write source-contract test for admin orchestration handler guarantees
    - Assert any admin orchestration handler calls `requireAdmin` first and returns bounded fixed
      codes without provider/DB detail (`apps/web/tests-unit`, via `bun run test:unit`)
    - _Requirements: 9.6_

  - [x]* 11.3 Write source-contract test for default-branch-only workflow execution
    - Assert GHA jobs guard on `github.ref_name == default_branch && github.ref_protected` and the
      upload path list includes `current-summary.json`
    - _Requirements: 9.5, 5.3_

  - [x]* 11.4 Write source-contract test for applied-migration immutability
    - Assert already-applied Supabase migration files are unchanged and the R4 constraint is a new
      additive file
    - _Requirements: 9.7_

- [x] 12. Wire cadence/health/manifest into the runner preflight and evidence path
  - [x] 12.1 Integrate cadence validation, health/staleness, and additive manifest fields end to end
    - Ensure the worker preflight runs cadence validation and env-contract before steps, the manifest
      writer emits all additive fields, and the health check governs stale/absent-manifest reporting
    - Author (but do not push) any `daily-crawler.yml` evidence-path wiring change so
      `current-summary.json` and the health outcome are published; note it lands via the serialized
      `develop -> data -> main` PR flow under branch protection
    - _Requirements: 1.6, 5.1, 5.3, 5.7, 9.2, 9.5_

  - [x]* 12.2 Write integration test for the end-to-end lite run manifest and health outcome
    - Drive a representative lite run and assert manifest fields, health classification, and evidence
      contents (secret-free)
    - _Requirements: 5.1, 5.7, 8.5_

- [x] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (tests) and can be skipped for a faster path; core
  implementation tasks are never optional.
- Each task references specific sub-requirements for traceability; property test tasks cite the exact
  design property number and text they encode.
- Property tests use Python `hypothesis` (`@settings(max_examples=100)` minimum), one test per
  property, tagged with the required feature/property comment, runnable via `python -m unittest`.
- No task enables the `PIPELINE_HOSTED_APPLY_ENABLED` latch, weakens any fail-closed control, or
  pushes directly to a protected branch; workflow behavior changes land via the serialized PR flow.
- The R4 concurrency constraint is a NEW additive migration; applied migrations remain immutable.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "5.1", "7.1"] },
    { "id": 1, "tasks": ["1.3", "1.4", "1.5", "1.6", "1.7", "2.1", "7.2", "7.3", "7.4", "7.5", "7.6", "7.7", "8.1", "8.2", "8.3", "8.4", "9.1", "9.2", "9.3", "9.4", "9.5", "10.1", "10.2", "10.3", "10.4", "10.5", "11.1", "11.2", "11.3", "11.4"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "2.8", "2.9", "2.10", "2.11", "4.1"] },
    { "id": 3, "tasks": ["4.2", "4.3", "4.4", "4.5", "4.6", "4.7", "5.2"] },
    { "id": 4, "tasks": ["5.3", "5.4", "5.5", "5.6"] },
    { "id": 5, "tasks": ["12.1"] },
    { "id": 6, "tasks": ["12.2"] }
  ]
}
```
