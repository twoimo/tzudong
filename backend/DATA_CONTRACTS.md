# Backend Data Contracts

This file summarizes the stable data shapes that connect crawling, evaluation,
Supabase insertion, and web admin consumers. Detailed examples remain in the
pipeline READMEs; this file is the compact change-review checklist.

## Contract principles

- JSONL files are append/read-latest oriented unless a script explicitly says
  otherwise.
- `youtube_link` identifies the source video and must remain present once data
  enters crawling/evaluation outputs.
- Restaurant names cross stages as `origin_name`; web/admin display aliases such
  as `name:approved_name` are consumer-side projections and must not be written
  by the pipeline unless an admin decision owns them.
- `trace_id` is the final transformed-record identity and must be unique within
  a transformed output batch.
- Location success must carry enough evidence to distinguish provider matches
  from heuristic guesses.
- Contract changes must update validators and fixtures before implementation is
  considered complete.

## Stage contracts

Pipeline step identifiers are part of the executable contract:
`enrich`, `gemini_crawling`, `target_selection`, `rule_evaluation`,
`laaj_evaluation`, `transform`, and `supabase_insert`.

| Stage | Producer | Consumer | Stable fields / invariants | Current executable guard |
| --- | --- | --- | --- | --- |
| Gemini crawling output | `restaurant-crawling/scripts/07-gemini-crawling.sh` and related parsers | target selection, validators | `youtube_link`; `restaurants[]`; each restaurant should include `origin_name`, address context, category, review/reasoning text, and Korean-coordinate-compatible `lat`/`lng` when present | `validate_gemini_output` |
| Target selection | `restaurant-evaluation/scripts/09-target-selection.py` | rule evaluation, cross-stage validators | `evaluation_target` is a map keyed by restaurant `origin_name`; target keys should match `restaurants[].origin_name` | `validate_selection` |
| Rule evaluation | `restaurant-evaluation/scripts/10-rule-evaluation.py` | LAAJ/cross validation, transform | `evaluation_results.location_match_TF[]`; successful location matches should include matched/provider names and at least two independent `evidence_families`; non-true matches need `pending_reason` or failed status; `category_validity_TF[]` should be present | `validate_rule_results` |
| LAAJ evaluation | `restaurant-evaluation/scripts/11-laaj-evaluation.sh` | transform, cross validation | `evaluation_results` must include `visit_authenticity`, `rb_inference_score`, `rb_grounding_TF`, `review_faithfulness_score`, and `category_TF`; evaluation families may arrive either as direct arrays or `{values, missing}` wrappers and validators must inspect the `values[]` rows; scores stay within validator ranges and booleans remain booleans | `validate_laaj_results` |
| Transform output | `restaurant-evaluation/scripts/12-transform.py` | Supabase insert, web admin | required fields: `trace_id`, `youtube_link`, `channel_name`, `origin_name`, `source_type`, `lat`, `lng`; nullable `lat`/`lng` is allowed only for explicit non-ready states (`is_missing=true`, `is_notSelected=true`, or `status=pending` + `geocoding_success=false` unresolved geocoding backlog); `trace_id` unique and should change when identity inputs (`youtube_link`, trace-name, review text) change; provider-backed `location_match_TF` true results may promote the trace identity to `matched_name`; `missing` outputs should set `is_missing=true` with `evaluation_results=null`; `notSelection` outputs should set `is_notSelected=true`, `geocoding_false_stage=0`, and leave geocoding payload fields empty; `map_url_crawling` outputs should keep `source_type=map_url_crawling`, `geocoding_success=true`, and preserve `description_map_url`; `evaluation_results` carried when applicable | `validate_transform_output` |
| Supabase insert payload | `restaurant-evaluation/scripts/13-supabase-insert.py` | Supabase tables, web admin/dashboard | preserves source identity, admin/legacy locks, location/evaluation families, and transformed display fields; canonicalizes `youtube_link` short/shorts/embed variants to watch-URL form while preserving `trace_id`, `channel_name`, and `origin_name`; emits web-admin consumer fields such as `categories`, `tzuyang_review`, `road_address`, `jibun_address`, `english_address`, `youtube_meta`, `evaluation_results`, `status`, `is_missing`, `is_not_selected`, `review_count`, and `description_map_url`; `approved_name` stays admin-owned for web `name:approved_name` aliases and is not emitted by pipeline inserts; insert/update policy must not silently overwrite protected admin fields | script tests under `restaurant-evaluation/scripts/tests/` |
| Frame-caption evidence | `restaurant-crawling/scripts/06-frame-caption.py` | insight peak-frame/admin chat evidence | observed JSONL records include `video_id`, `recollect_id`, `start_sec`, `end_sec`, `rank`, `file_names[]`, `frame_count`, `parsed_json`, and `raw_caption`; `frame_count` should match the emitted file list length | `test_frame_caption_observed_contract_fixture` |
| run_daily summary manifest and timing log | `run_daily.sh` + `utils/run_daily_helpers.py` | admin/ops status API, GitHub Actions log review | JSON manifest fields: `generatedAt`, `date`, `finalStatus`, `finalExitCode`, `failedRequiredSteps[]`, `optionalSkips[]`, `downstreamSkips[]`, `stepEvents[]`, `latestLogPath`, `summaryPath`, `noWorkShortCircuit`, `policyMode`, optional `runtime` (`githubRunId`, `githubRunAttempt`, `githubRunUrl`, `githubWorkflow`, `githubSha`, `githubRef`, `githubEventName`, `executionBranch`, `targetBranch`); the admin status API additionally exposes bounded read state as `manifestStatus` (`available`, `missing`, `unreadable`) and reports `finalStatus=UNKNOWN` when current-summary evidence is absent or unreadable; optional `gdriveUpload.operatorMessage` (`severity`, `summary`, `action`) for bounded operator follow-up; each `stepEvents[]` item has `name`, allowlisted `status` (`completed`, `failed`, `optional_skipped`, `downstream_skipped`), optional integer `durationSeconds`, optional `reason`, and optional `upstreamStep`; timing log includes granular Step 3, Step 3.1, Step 4, combined Step 3+4, and frame directory-total metric lines; frame `delta` is total image count after minus before and can be zero/negative if the frame tree is rotated or cleaned during extraction; the GitHub Actions upload step may append `gdriveUpload` after `run_daily.sh` exits | `test_run_daily_regression` manifest/timing assertions |
| pipeline_control jobs/locks/audit | `backend/supabase/migrations/20260817020000_pipeline_control.sql` + `pipeline-api` | admin pipeline BFF, worker claim loop | schema `pipeline_control` on the existing local Supabase Postgres (no overlay Postgres); run status `Queued\|Fetching\|Inserting\|Paused\|Cancelled\|Failed\|Succeeded`; target-level `Idle`; lock key `(target, profile)` with lease+heartbeat; `Paused` holds lease; Idempotency-Key replay vs 409; audit row `actor`, `job_id`, `transition`, `request_id`; Slice 0 adapters are dry-run. Admin pipeline GET reads the pipeline-api FileStore-backed control plane (lock overlay plus a capped allowlisted jobs/failures list); Kafka and ES are not this screen's source. Admin pipeline POST enqueue/pause/resume/cancel mutates the same FileStore control plane through pipeline-api. GET remains a non-mutating snapshot. Persist-on mutate dual-writes jobs+locks+audit in one local transaction while GET stays FileStore and non-mutating even with a local DSN. BFF enqueue defaults dryRun true. dryRun false requires an extra operator live-confirmation gate. Operator POST 2xx is allowlisted BFF-side to PUBLIC_LIST_KEYS (never a public_run passthrough). Persist remains opt-in TZUDONG_PIPELINE_PERSIST. Hosted DSN stays rejected. This screen still does not query Kafka or ES. | `backend.pipeline_control.tests.test_slice0_control_plane` (`OperatorSnapshotTests`, `HttpLoopTests`) |
| GDrive frame upload expected manifest | `.github/workflows/daily-crawler.yml` + `utils/run_daily_helpers.py write-gdrive-upload-expected` | GDrive upload step, upload status/backfill artifacts | `schemaVersion=2`; `runId`; `sourceRoot`; `remoteRoot`; `recentMinutes`; `residualQueuePath`; `expectedCount`; `uploadableCount`; `missingLocalCount`; `stagedShardItemCount`; `items[]` with `relativePath`, `size`, `mtimeEpoch`, `dedupeKey`, `required`, `reason` (`new_frame`, `residual_retry`, `manual_backfill`), `sourceState` (`local`, `missing_local`), queue `state` (`pending_local`, `staged`, `missing_local`, `remote_verified`, `failed_permanent`), optional `stagingShard`, and `remotePath`; candidate selection must include durable residual retries in addition to recent files and must not silently drop missing residual bytes; the workflow restores the residual queue from `GDRIVE_STATUS_PATH/<scope>` on a best-effort basis before selecting candidates, where production uses `main` scope and validation/non-data target branches use a sanitized branch scope | `GDriveUploadContractTests` |
| GDrive frame upload status | `.github/workflows/daily-crawler.yml`, `.github/workflows/gdrive-frame-backfill.yml`, and `utils/run_daily_helpers.py write-gdrive-upload-status` | GitHub Actions summary/artifact, future ops status API, backfill workflow | `schemaVersion=2`; top-level `status` is the single truth (`skipped`, `complete`, `partial`, `backfill_required`, `backfill_complete`, `failed`); legacy `policy` (`required`, `warn`, `backfill_required`) is derived for compatibility and must not conflict with `status`; `uploadMode`; `expectedCount`, `attemptedCount`, `uploadedCount`, `uploadedCountConfidence`, `skippedExistingCount`, `verifiedCount`, `residualCount`, `pendingBacklogCount`, `pendingLocalCount`, `stagedShardItemCount`, `missingLocalCount`, `stagedShardCount`, `maxResidualAttempts`, `backfillThresholdAttempts`; `timeout`; `exitCode`; `completionProof` (`none`, `rclone_exit_zero`, `remote_size_check`, `remote_manifest_check`); `verificationRequired`; `terminalIncomplete`; `operatorMessage` (`severity`, `summary`, `action`); `dedupeKey`; `residualQueuePath`; `notes[]`; invariant: `expectedCount == verifiedCount + skippedExistingCount + residualCount`; terminal `complete`/`backfill_complete` requires `residualCount=0` and strong remote proof (`remote_size_check` or `remote_manifest_check`); `rclone_exit_zero` is delivery evidence only and leaves a verification/backfill backlog | `GDriveUploadContractTests` |
| GDrive frame upload batches/staging | `.github/workflows/daily-crawler.yml`, `.github/workflows/gdrive-frame-backfill.yml`, and `utils/run_daily_helpers.py write-gdrive-upload-batches` / `write-gdrive-staging-shards` | GDrive upload step, backfill workflow, GitHub Actions artifacts | Batch manifests split uploadable local frames by file and byte budgets; per-batch remote proof appends `current-upload-verified-files.txt`; unverified local residual frames are packed into `tar.gz` staging shards plus shard manifests under `backend/log/cron/gdrive-upload-staging/` and copied to `GDRIVE_STATUS_PATH/<scope>/staging/run-<run_id>`; shard cleanup is only safe after corresponding items are `remote_verified`; GitHub artifacts retain staging material if GDrive staging upload is incomplete | `GDriveUploadContractTests` |
| Kafka pipeline event sink | `backend/pipeline_control/events.py` + `docker-compose.kafka.yml` | operator kafka-ui; optional host loopback `127.0.0.1:29092`; no Slice 2 consumer — ES is written by the worker indexer under `TZUDONG_PIPELINE_ES`, not from Kafka | topics `tzudong.pipeline.run.lifecycle.v1`, `tzudong.pipeline.step.progress.v1`, `tzudong.pipeline.record.upserted.v1`; default `TZUDONG_PIPELINE_EVENTS` is unset/`noop`; kafka mode is opt-in and fail-closed; events are losable under broker retention; job/lock/audit truth remains schema `pipeline_control` on local Supabase; pipeline image bakes exactly one pinned `kafka-python` client and stays otherwise copy-only; ES image stays dep-free; host `127.0.0.1:9092` stays unpublished; adapter emits `record.upserted` after live `13-supabase-insert` process exit 0 (possibly zero rows) | `backend.pipeline_control.tests.test_events` |
| Elasticsearch pipeline log/raw store | `backend/pipeline_control/es_index.py` + `docker-compose.elasticsearch.yml` | operator local ES only; never job SoT | indices `pipeline-logs-v1`, `pipeline-raw-v1`; default `TZUDONG_PIPELINE_ES` is unset/`noop`; `es` mode is opt-in and fail-closed; documents are non-authoritative (may exist for Failed runs and be absent for Succeeded runs); adapter emits `record.upserted` into `pipeline-logs-v1` after live `13-supabase-insert` process exit 0 (possibly zero rows); Kafka remains consumer-less; job/lock/audit truth remains schema `pipeline_control` | `backend.pipeline_control.tests.test_es_index` |

## CI/runtime environment contract

`backend/bin/check_env_contract.py` is the fail-closed preflight for GitHub Actions runtime env shape. It reports only env names and boolean presence, never secret values. The `daily` profile requires the canonical GitHub secret set mapped into runtime names (`YOUTUBE_API_KEY_BYEON`, `GEMINI_API_KEY`, Supabase, Naver/NCP, and `RCLONE_CONFIG_BASE64`) and rejects removed repository-secret names such as Gemini OAuth credential blobs and model override envs. The `gdrive-backfill` profile requires only `RCLONE_CONFIG_BASE64`. Workflow preflight steps must run this guard before expensive pipeline work.
The `pipeline-control` profile additionally requires `TZUDONG_DATA_ENV` and
`PIPELINE_CONTROL_DSN` (presence only; never print values). `TZUDONG_DATA_ENV=local_db`
must reject hosted project ref `aqlcofblfxdrjhhdmarw`.

## Admin/ops status contract

Read-only admin ops endpoints may expose status summaries derived from bounded
files or remote APIs. They must:

- require admin authentication,
- return `Cache-Control: no-store` for live status,
- sanitize local paths and never return secret values,
- bound log reading and network probes,
- report stale/unknown states explicitly instead of pretending success.
- prefer the local `run_daily` summary manifest before bounded log-tail fallback,
- keep GitHub Actions and Supabase counter probes disabled by default unless
  explicit `INSIGHT_*_STATUS_ENABLED` env gates are enabled.

Existing status implementation touchpoints:

- `apps/web/app/api/admin/system-status/route.ts`
- `apps/web/lib/admin/system-status/status.ts`
- `apps/web/lib/admin/system-status/runtime.ts`

## Change checklist

Before changing a field that crosses a stage boundary:

1. Update this file and the relevant pipeline README.
2. Update the matching validator or fixture test.
3. Run the affected Python unit tests.
4. If web admin reads the field, add or update a TypeScript fixture/unit test.
5. If stored Supabase data is affected, document the migration/backfill or
   dual-read/defaulting behavior.
