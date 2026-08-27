# Requirements Document

## Introduction

Tzudong's crawler pipeline currently runs across three cooperating actors: a scheduled GitHub Actions workflow that performs lightweight compute and produces evidence, a Mac LaunchAgent that performs heavy compute and reflects results into the hosted database, and hosted Supabase as the persistence boundary. Today these actors run on separate schedules and gates that were assembled incrementally.

This feature formalizes and hardens that arrangement into one coherent, scheduled, reliable orchestration. The goal is a regular daily cadence in which the GitHub Actions lite compute, the Mac heavy compute plus hosted reflection, and hosted Supabase persistence are staggered correctly across time zones, back each other up idempotently, gate every hosted write fail-closed, expose whether each day's run succeeded, recover gracefully from missed or degraded runs, and never place crawl data or secrets in the public repository.

These requirements describe observable behavior only. They do not authorize weakening any fail-closed control, do not change branch-protection or approval flows, and do not assert hosted production state or legal compliance. Implementation details (specific cron expressions, file layouts, argument names) are reserved for the design phase.

## Glossary

- **Orchestration**: The overall coordinated daily operation of the three runners and the persistence boundary, treated as one scheduled system.
- **GHA_Runner**: The scheduled GitHub Actions workflow (`daily-crawler.yml`) that executes the crawler pipeline in compute-only lite mode against a throwaway loopback database and publishes a data-only evidence artifact.
- **Mac_Runner**: The Mac LaunchAgent (`dev.tzudong.hosted-new-video`) that runs `run_hosted_new_video_pipeline.py` from the workspace to perform heavy compute and reflect eligible results into hosted Supabase.
- **Hosted_Store**: The hosted Supabase project that serves as the persistence boundary for production data.
- **Pipeline_Worker**: The Python claim-loop entry point (`backend.pipeline_control.worker`) that executes the numbered-script graph and writes a run manifest.
- **Hosted_Apply_Gate**: The fail-closed classifier (`admit_pipeline_supabase_boundary`) that determines whether a run may write to Hosted_Store based on execution mode, compute profile, approval flags, and exact project-reference match.
- **Env_Contract_Check**: The environment-contract validator (`check_env_contract.py`) that verifies required operator secrets are present for a named profile and fails closed when they are absent.
- **Run_Manifest**: The machine-readable summary written by Pipeline_Worker (`current-summary.json`) recording final status, step events, execution mode, data sink, and evidence hashes for a run.
- **Evidence_Artifact**: The data-only artifact published by GHA_Runner containing run outputs and manifests, excluding secrets and repository-committed crawl data.
- **Lite_Profile**: The compute profile (`lite_gha`) in which heavy steps (frames, OCR, chunk-multimodal, visual location, map-URL) are skipped.
- **Heavy_Profile**: The compute profile (`heavy_local`) in which heavy steps run on the Mac.
- **Cadence_Window**: A named daily time slot (expressed in KST) assigned to a runner within the coherent schedule.
- **KST**: Korea Standard Time (UTC+9), the reference time zone for the operational schedule.
- **Operator**: The human maintainer who provisions secrets, approves hosted data-plane operations, and reviews run health.

## Requirements

### Requirement 1: Coherent staggered daily schedule

**User Story:** As an Operator, I want the three runners assigned to distinct, ordered daily time windows, so that lite compute, heavy compute, hosted reflection, and backups run in a dependable sequence without contention.

#### Acceptance Criteria

1. THE Orchestration SHALL assign GHA_Runner and Mac_Runner to distinct Cadence_Windows expressed in KST (UTC+9) such that no two Cadence_Windows overlap and every pair of consecutive Cadence_Windows is separated by a buffer of at least 30 minutes.
2. THE Orchestration SHALL order the Cadence_Windows so that GHA_Runner's compute-and-evidence window ends at least 30 minutes before Mac_Runner's heavy-compute-and-hosted-reflection window begins on the same KST calendar day.
3. WHERE a scheduled runner defines its trigger time in UTC, THE Orchestration SHALL document the KST equivalent by applying the fixed UTC+9 offset with no daylight-saving adjustment.
4. WHEN GHA_Runner is triggered on its schedule, THE GHA_Runner SHALL begin execution within 5 minutes of the UTC time that corresponds to its assigned KST Cadence_Window.
5. THE Orchestration SHALL record the assigned KST Cadence_Window start time and end time for each runner in a persisted Operator-readable configuration artifact.
6. IF the configured Cadence_Windows overlap, violate the required minimum 30-minute buffer, or violate the required ordering in which GHA_Runner's window precedes Mac_Runner's window, THEN THE Orchestration SHALL reject the schedule, refrain from triggering any runner under the invalid configuration, and record an error indication identifying the conflicting Cadence_Windows.
7. IF a runner's execution extends beyond the end of its assigned Cadence_Window, THEN THE Orchestration SHALL record a window-overrun indication for that runner while preserving the assigned Cadence_Windows of the other runners.

### Requirement 2: Lite versus heavy compute separation

**User Story:** As an Operator, I want lightweight compute on GitHub Actions and heavy compute on the Mac, so that resource-intensive media and model work runs where it is provisioned and cheap compute runs in the hosted runner.

#### Acceptance Criteria

1. WHEN GHA_Runner executes the pipeline under Lite_Profile (lite_gha), THE GHA_Runner SHALL execute only the lite steps and SHALL skip every heavy step (frames extraction, OCR, chunk-multimodal Gemini, visual location, and map-URL crawling).
2. WHEN Mac_Runner executes the pipeline under Heavy_Profile (heavy_local), THE Mac_Runner SHALL execute the heavy steps (frames extraction, OCR, chunk-multimodal Gemini, visual location, and map-URL crawling) on the local workspace.
3. WHERE Pipeline_Worker resolves the compute profile as Heavy_Profile, THE Pipeline_Worker SHALL evaluate the heavy-local runtime readiness check and SHALL execute a heavy step only when that check returns ready.
4. IF the resolved compute profile is Heavy_Profile and the heavy-local runtime readiness check returns not ready because one or more required local heavy runtime prerequisites are absent, THEN THE Pipeline_Worker SHALL halt before executing any heavy step, SHALL leave all heavy-step outputs unmodified, and SHALL report a bounded heavy-runtime-missing condition to the caller.
5. IF GHA_Runner running under Lite_Profile encounters a request to execute a heavy step, THEN THE GHA_Runner SHALL skip that step without executing it and SHALL record a bounded skipped-heavy-step indication for that step.
6. IF Pipeline_Worker cannot resolve the compute profile to exactly one of Lite_Profile or Heavy_Profile, THEN THE Pipeline_Worker SHALL halt before executing any heavy step and SHALL report a bounded profile-unresolved condition without executing heavy steps.

### Requirement 3: Fail-closed hosted-write gating

**User Story:** As an Operator, I want every hosted database write to pass an explicit fail-closed gate, so that data never reaches Hosted_Store without live mode, approval, and an exact project match.

#### Acceptance Criteria

1. WHEN a run is initiated and before any network-capable database client is instantiated, THE Hosted_Apply_Gate SHALL classify the data sink as exactly one of Hosted_Store, loopback-only, or artifact-only.
2. IF the classified sink is Hosted_Store AND one or more of the following four conditions is absent — (a) live execution mode is active, (b) the hosted-apply enablement flag is set, (c) the approved-environment flag equals the exact string "1", (d) the configured project reference is a byte-for-byte exact match to "https://<project_ref>.supabase.co" — THEN THE Hosted_Apply_Gate SHALL reject the hosted write, and the run SHALL terminate without instantiating a network-capable database client and without writing any record to Hosted_Store.
3. IF the configured hosted project reference differs from the expected "https://<project_ref>.supabase.co" value by any character, letter case, scheme, subdomain, path, or query difference (that is, it is not an exact full-string match), THEN THE Hosted_Apply_Gate SHALL treat the project-reference match condition as absent and SHALL reject the hosted write.
4. WHERE the compute profile is Lite_Profile, local_db, or artifact_only, THE Hosted_Apply_Gate SHALL restrict the admitted sink to a loopback-only or artifact-only target and SHALL NOT admit Hosted_Store under any condition.
5. WHEN Mac_Runner performs a hosted reflection, THE Mac_Runner SHALL complete a dry-run preview of the intended writes before any live hosted write occurs within the same run.
6. THE Mac_Runner SHALL NOT enable the hosted-apply enablement flag automatically during any scheduled or unattended run, and enablement SHALL require an explicit Operator action.
7. IF the Hosted_Apply_Gate rejects a hosted write, THEN THE Pipeline_Worker SHALL record a single bounded rejection reason drawn from a predefined fixed-code enumerated set in the Run_Manifest, and SHALL NOT include provider identifiers, database error text, connection strings, or free-form diagnostic detail.

### Requirement 4: Idempotent mutual backup between runners

**User Story:** As an Operator, I want GitHub Actions and the Mac to be able to reflect the same eligible results without duplication, so that either runner can cover for the other on a given day.

#### Acceptance Criteria

1. WHEN a runner classifies a candidate as already present on Hosted_Store by its stable candidate identity, THE runner SHALL skip that candidate and SHALL NOT create a duplicate record.
2. WHEN the same eligible candidate set is reflected two or more times within the same KST calendar day, THE Hosted_Store SHALL hold exactly one record per candidate identity, identical to the state produced by a single successful reflection.
3. WHERE both GHA_Runner's hosted-apply path and Mac_Runner run on the same KST calendar day, THE Orchestration SHALL treat any one runner's successful reflection of a candidate as sufficient for that candidate and SHALL NOT require the other runner to reflect it again.
4. WHEN a runner completes a hosted reflection, THE runner SHALL record, per candidate identity, whether it was newly applied or skipped as already present, with the two sets being mutually exclusive and together covering every candidate in the processed set.
5. WHILE GHA_Runner and Mac_Runner concurrently attempt to reflect the same candidate identity, THE Orchestration SHALL ensure at most one record is created for that identity and SHALL cause the losing attempt to classify the candidate as already present and skip it.
6. IF a runner cannot determine whether a candidate is already present on Hosted_Store, THEN THE runner SHALL skip applying that candidate, SHALL NOT create a record for it, and SHALL record the candidate as unresolved with an indication that classification failed.
7. IF a runner terminates before completing reflection of its candidate set, THEN THE Hosted_Store SHALL retain all candidates already applied as present, THE runner SHALL NOT roll back those applied records, and any subsequent run SHALL classify those retained candidates as already present and skip them.

### Requirement 5: Run health and observability

**User Story:** As an Operator, I want to see whether today's run succeeded and what it did, so that I can confirm the pipeline is healthy without inspecting raw logs.

#### Acceptance Criteria

1. WHEN Pipeline_Worker finishes a run, THE Pipeline_Worker SHALL write a Run_Manifest to a fixed known location recording final status, execution mode, data sink, compute profile, evidence sha256, and per-step outcomes.
2. THE Run_Manifest SHALL record the run date and the generation timestamp as UTC values in a fixed timestamp format.
3. WHEN GHA_Runner completes a scheduled run, THE GHA_Runner SHALL publish an Evidence_Artifact that includes the Run_Manifest.
4. WHERE a step is skipped, THE Run_Manifest SHALL record the skipped step with a skip reason drawn from a fixed vocabulary that distinguishes an optional-step skip from a downstream skip caused by an upstream required-step failure.
5. THE Run_Manifest SHALL record final status using a fixed status vocabulary containing exactly the values Succeeded and Failed, such that success and failure are mutually exclusive.
6. IF a run fails, THEN THE Run_Manifest SHALL identify each failed required step by its fixed step identifier and a bounded outcome indicator, excluding raw provider errors and stack traces.
7. IF the Run_Manifest generation date is earlier than the current UTC date, OR no Run_Manifest exists for the current UTC date, THEN THE GHA_Runner SHALL treat the current run as not-Succeeded (fail closed) and SHALL NOT report a stale or absent manifest as a healthy run.
8. THE Run_Manifest SHALL provide an Operator-readable summary, bounded to a fixed maximum length, that states the final status, execution mode, data sink, and count of failed required steps without requiring raw log inspection.
9. THE Run_Manifest SHALL exclude secrets, credentials, session or onboarding tokens, and raw provider diagnostics from every recorded field, including step outcomes and skip reasons.

### Requirement 6: Failure handling and recovery

**User Story:** As an Operator, I want the pipeline to degrade gracefully and recover from missed or interrupted runs, so that a single bad day does not require manual reconstruction.

#### Acceptance Criteria

1. IF Mac_Runner misses its scheduled Cadence_Window because the host was asleep or powered off, THEN THE Mac_Runner SHALL execute the missed run exactly once at the next wake or power-on event, and SHALL NOT execute one catch-up run per missed Cadence_Window.
2. IF two or more consecutive Cadence_Windows are missed before the host wakes, THEN THE Mac_Runner SHALL coalesce them into the single next-wake run and SHALL record an audit entry indicating the count of missed windows without exposing provider or database diagnostics.
3. IF a heavy upload reaches its soft time budget before all shards complete, THEN THE Mac_Runner SHALL stop starting new shard uploads, stage every remaining shard to the residual backlog for the backfill workflow, record the residual backlog count, and complete the run with a non-failure status rather than aborting.
4. WHEN a subsequent run or the backfill workflow starts and finds a non-empty residual backlog from a prior run, THE runner SHALL attempt to process the staged shards using idempotent reflection before starting new pipeline work.
5. WHEN a run or the backfill workflow starts and finds an empty residual backlog and no newly scheduled work, THE runner SHALL short-circuit, record a zero-work outcome in the audit trail, and exit with a non-failure status without contacting hosted upload targets.
6. IF a residual backlog shard fails to process across a bounded maximum of 3 backfill attempts, THEN THE backfill workflow SHALL retain the shard in the residual backlog, mark it as attempt-exhausted, record an audit entry indicating exhaustion, and continue processing the remaining shards rather than blocking the workflow.
7. IF GHA_Runner's lite compute records a non-zero adapter status, THEN THE GHA_Runner SHALL still publish the Evidence_Artifact for that run and SHALL record the non-zero adapter status in the published evidence.
8. IF GHA_Runner cannot deploy its lite compute environment or exceeds an external GHA resource or rate limit before adapter work completes, THEN THE GHA_Runner SHALL publish the Evidence_Artifact recording the degraded outcome and SHALL NOT report the run as a clean success.
9. WHILE a run is retried after a prior partial completion, THE Orchestration SHALL rely on the idempotent reflection behavior so that retries do not create duplicate hosted records.
10. IF a required operator secret is absent at run start, THEN THE runner SHALL fail closed before executing any pipeline work and SHALL NOT stage, upload, or publish partial results.

### Requirement 7: Environment-contract and secret readiness preconditions

**User Story:** As an Operator, I want each runner to verify its required secrets before doing work, so that runs fail early and clearly when configuration is incomplete.

#### Acceptance Criteria

1. WHEN a runner starts a scheduled run, THE runner SHALL select the environment-contract profile mapped to that runner (one of: daily, pipeline-control, hosted-pending-apply, gdrive-backfill) and SHALL validate the environment contract for that profile before executing any pipeline step.
2. IF the Env_Contract_Check reports one or more missing required secrets for the applicable profile, THEN THE runner SHALL halt before executing any pipeline step, SHALL terminate with a non-zero exit status, and SHALL report each missing secret by canonical name only.
3. THE Env_Contract_Check SHALL report the contract as not satisfied when a required secret is bound only to a placeholder or fabricated value, and SHALL NOT treat such a value as satisfying the required-secret condition.
4. IF a forbidden legacy environment name is present, THEN THE Env_Contract_Check SHALL report the contract as not satisfied, and THE runner SHALL halt before executing any pipeline step and terminate with a non-zero exit status.
5. THE Env_Contract_Check SHALL report only secret names and presence status, and SHALL NOT emit, log, or persist any secret value.
6. WHERE an allowed alias is defined for a required secret in the applicable profile, THE Env_Contract_Check SHALL evaluate that required secret as present when either its canonical name or any of its allowed aliases is bound to a non-empty value.
7. WHEN the Env_Contract_Check completes, THE Env_Contract_Check SHALL emit a machine-readable report that enumerates each required and optional secret name, its presence status, and the overall satisfied or not-satisfied result.

### Requirement 8: No crawl data or secrets in the public repository

**User Story:** As an Operator, I want crawl datasets and secrets kept out of the public GitHub repository, so that private data and credentials are never exposed through source control.

#### Acceptance Criteria

1. THE Orchestration SHALL confine crawl and evaluation datasets exclusively to Hosted_Store and the local Mac workspace, and SHALL NOT copy or transmit them to any other persistence destination.
2. THE Orchestration SHALL NOT commit crawl or evaluation datasets to any branch of the public repository.
3. THE Orchestration SHALL keep the data-branch publication path disabled by default, requiring no Operator action to remain disabled.
4. WHERE the Operator-controlled publish enablement flag is set to its exact enabled value, THE Orchestration SHALL permit the data-branch publication path; in all other flag states (unset, empty, or any value other than the enabled value), THE Orchestration SHALL keep the path disabled.
5. WHEN the Orchestration produces an Evidence_Artifact, THE Orchestration SHALL exclude all secrets, credentials, session tokens, cookies, and repository-committed crawl data from that artifact.
6. IF an Evidence_Artifact would otherwise contain a secret, credential, or repository-committed crawl dataset, THEN THE Orchestration SHALL redact or omit that content before the artifact is persisted, and SHALL retain the remaining non-sensitive artifact content.
7. THE Orchestration SHALL maintain a repository ignore configuration that excludes from source control all crawl and evaluation data directories, all newline-delimited JSON dataset files, environment files, OAuth credential files, session files, cookie files, and provider credential directories.
8. IF a commit or publication attempt would introduce any crawl dataset, evaluation dataset, or secret-bearing file into the public repository, THEN THE Orchestration SHALL block the attempt, leave the repository history unchanged, and surface an indication that the attempt was rejected for containing excluded content.

### Requirement 9: Governance-consistent change and reflection boundaries

**User Story:** As an Operator, I want the orchestration to respect the established backend-ownership and branch-protection boundaries, so that hardening the pipeline does not bypass existing controls.

#### Acceptance Criteria

1. THE Orchestration SHALL execute all long-running crawler, media/ffmpeg, model-bulk (Gemini), backup/GDrive, and batch-insert work exclusively in the backend runners, and IF such work is invoked, THEN THE Orchestration SHALL NOT run it within web route handlers.
2. WHERE a scheduled workflow's runtime behavior is changed, THE Orchestration SHALL require the change to be merged to the default branch only through the protected serialized branch flow develop -> data -> main under branch protection, and IF the change has not traversed that flow, THEN THE Orchestration SHALL NOT treat the change as active.
3. THE Orchestration SHALL NOT generate, record, or return approval, release, or deployment evidence for hosted operations that has not been produced by the external approval and deployment process.
4. THE Orchestration SHALL NOT disable, relax, or bypass any fail-closed control as a means of completing a run, and IF a fail-closed control blocks a run, THEN THE Orchestration SHALL halt that run and surface a bounded blocked-status result.
5. WHEN the scheduled orchestration workflow executes on GitHub Actions, THE Orchestration SHALL run only the workflow definition present on the default branch, and IF a workflow definition exists only on a non-default branch, THEN THE Orchestration SHALL NOT execute it.
6. WHEN a web admin API handler exposes an orchestration operation, THE Orchestration SHALL require successful requireAdmin authorization before performing any work, SHALL return responses limited to a predefined fixed set of bounded status codes, and SHALL NOT include provider or database error details in any response.
7. IF an applied Supabase migration must be corrected, THEN THE Orchestration SHALL require a new additive migration and SHALL NOT modify, delete, or overwrite any already-applied migration.
