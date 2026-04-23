# Backend Data Contracts

This file summarizes the stable data shapes that connect crawling, evaluation,
Supabase insertion, and web admin consumers. Detailed examples remain in the
pipeline READMEs; this file is the compact change-review checklist.

## Contract principles

- JSONL files are append/read-latest oriented unless a script explicitly says
  otherwise.
- `youtube_link` identifies the source video and must remain present once data
  enters crawling/evaluation outputs.
- Restaurant names cross stages as `origin_name` until transform output, where
  the final display field is `name`.
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
| LAAJ evaluation | `restaurant-evaluation/scripts/11-laaj-evaluation.sh` | transform, cross validation | `evaluation_results` must include `visit_authenticity`, `rb_inference_score`, `rb_grounding_TF`, `review_faithfulness_score`, and `category_TF`; scores stay within validator ranges and booleans remain booleans | `validate_laaj_results` |
| Transform output | `restaurant-evaluation/scripts/12-transform.py` | Supabase insert, web admin | required fields: `trace_id`, `youtube_link`, `channel_name`, `name`, `source_type`, `lat`, `lng`; `trace_id` unique; `evaluation_results` carried when applicable | `validate_transform_output` |
| Supabase insert payload | `restaurant-evaluation/scripts/13-supabase-insert.py` | Supabase tables, web admin/dashboard | preserves source identity, admin/legacy locks, location/evaluation families, and transformed display fields; insert/update policy must not silently overwrite protected admin fields | script tests under `restaurant-evaluation/scripts/tests/` |
| Frame-caption evidence | `restaurant-crawling/scripts/06-frame-caption.py` | insight peak-frame/admin chat evidence | observed JSONL records include `video_id`, `recollect_id`, `start_sec`, `end_sec`, `rank`, `file_names[]`, `frame_count`, `parsed_json`, and `raw_caption`; `frame_count` should match the emitted file list length | `test_frame_caption_observed_contract_fixture` |
| run_daily summary manifest | `run_daily.sh` + `utils/run_daily_helpers.py` | admin/ops status API | JSON manifest fields: `generatedAt`, `date`, `finalStatus`, `finalExitCode`, `failedRequiredSteps[]`, `optionalSkips[]`, `downstreamSkips[]`, `latestLogPath`, `summaryPath`, `noWorkShortCircuit`, `policyMode` | `test_run_daily_regression` manifest assertions |

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

- `apps/web/app/api/admin/insight/system-status/route.ts`
- `apps/web/lib/insight/chat-system-status.ts`
- `apps/web/lib/insight/chat-system-status-runtime.ts`

## Change checklist

Before changing a field that crosses a stage boundary:

1. Update this file and the relevant pipeline README.
2. Update the matching validator or fixture test.
3. Run the affected Python unit tests.
4. If web admin reads the field, add or update a TypeScript fixture/unit test.
5. If stored Supabase data is affected, document the migration/backfill or
   dual-read/defaulting behavior.
