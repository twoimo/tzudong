# Backend Architecture Boundaries

This document records the project boundary decisions for the backend pipeline.
It is intentionally conservative: keep the current fit-for-purpose languages,
make the seams explicit, and move only testable responsibilities across seams.

## Decision summary

1. Do **not** unify the whole backend into one programming language.
2. Do **not** migrate the long-running backend batch pipeline into Next.js
   request/response APIs.
3. Use Next.js Route Handlers only for authenticated, bounded admin/ops APIs.
4. Keep `run_daily.sh` as the cron/CI entrypoint, but make it thinner over time.
5. Treat data contracts between crawling, evaluation, Supabase, and web admin as
   first-class interfaces.
6. Do not rewrite crawling/evaluation internals with Paperclip or another
   workflow framework without explicit approval; evaluate such tools only as an
   outer control-plane seam.

## Language and runtime ownership

| Boundary | Owns | Should not own |
| --- | --- | --- |
| Python | Crawling/evaluation data transforms, validation, manifest parsing, skip/no-op policy, failure aggregation, media/image preprocessing helpers | Browser automation SDK glue that already depends on Node-only packages |
| Node/JS/MJS | Gemini SDK usage, Puppeteer/browser automation, `ffmpeg-static`/media helpers where Node packages are already the integration point | Whole-pipeline orchestration policy or durable batch state |
| Shell | Cron/CI entrypoint, environment loading, runtime path setup, invoking the main pipeline, preserving exit codes | Complex branching policy, manifest construction, data-contract validation |
| Next.js Route Handlers | Authenticated admin/ops/status/read-only APIs with bounded latency and sanitized output | Daily crawler execution, ffmpeg processing, Gemini bulk evaluation, long Supabase inserts, GDrive bulk uploads |
| SQL/Supabase | Migrations, RPCs, database constraints, data persistence semantics | Runtime orchestration or file-system batch state |

## Batch versus API boundary

The daily pipeline remains a backend batch workflow. It may be launched by cron,
GitHub Actions, or another batch/control-plane runner, but not by a normal
admin HTTP request.

Good Next.js admin/ops API candidates:

- latest `run_daily` log timestamp and freshness
- last known success/failure state
- failed-step summary derived from bounded logs/manifests
- Supabase counts for inserted/evaluated records
- GitHub Actions latest run status or link, when credentials and rate limits are
  clearly handled

Do not put these behind request/response Route Handlers:

- full daily crawler execution
- video download, frame extraction, or ffmpeg processing
- Gemini bulk crawling/evaluation
- long Supabase batch inserts
- GDrive bulk upload/sync

If a manual trigger is needed later, prefer a two-step control-plane design:
record an authenticated trigger request, then let a batch runner claim and
execute it asynchronously.

## `run_daily.sh` thinning policy

`run_daily.sh` remains the stable entrypoint while responsibilities move out of
Shell in small, reversible slices.

Keep in Shell:

- source `.env` and runtime path defaults
- choose the Python runtime
- initialize logs and call the pipeline entrypoint
- propagate final exit code

Move to Python helpers over time:

- file discovery and freshness checks
- skip/no-op decisions
- required/optional step policy
- manifest writing and reading
- failed/skipped step aggregation
- human-readable summary construction

Every move must preserve the current fail-closed behavior and be covered by
`backend/utils/tests/test_run_daily_regression.py` or an equivalent focused
stdlib `unittest`.

## Data-contract boundary

The critical interface is:

`restaurant-crawling` → `restaurant-evaluation` → Supabase insert payload → web
admin/dashboard consumers.

Contract changes must be treated as cross-boundary changes. A safe change needs:

1. contract documentation update,
2. fixture or validator update,
3. regression test update,
4. explicit migration/defaulting plan when stored data or web consumers can see
   both old and new shapes.

The initial contract baseline lives in `DATA_CONTRACTS.md` and the executable
validator baseline lives under `backend/pipeline/*test*_unittest.py`.

## No-go list without a separate plan

- replacing Python crawling/evaluation internals with a new workflow framework
- converting `run_daily.sh` into a large Node or Next.js handler
- adding mutating admin ops endpoints that execute long-running work inline
- exposing raw secret values, local absolute sensitive paths, or full logs via
  admin status APIs
- removing existing fail-closed regression tests to make refactors pass

## Follow-up implementation order

1. Keep this boundary document and `DATA_CONTRACTS.md` current.
2. Add or extend read-only admin status APIs only where output can be bounded and
   sanitized.
3. Extract one `run_daily.sh` responsibility at a time into Python and lock each
   extraction with focused tests.
4. Add TypeScript fixture tests for web-admin assumptions when backend fields
   become dashboard-visible.
