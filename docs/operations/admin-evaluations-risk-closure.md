# Admin evaluations smoke + runtime hygiene closure

This document closes the non-code operator lane from `.omx/plans/ralplan-admin-supabase-overwrite-risk-closure.md`:

- live-smoke preflight and evidence contract
- tracked runtime dirt handling for future `omx team` launches
- explicit disposition for the preserved prelaunch stashes

## Canonical preflight

Run the new helper before a live admin smoke or before launching a follow-up OMX team:

```bash
backend/bin/check_admin_review_closure.sh
```

The helper checks four things in one place:

1. public smoke prerequisites (`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
2. live admin session material (`INSIGHTS_CHAT_ADMIN_COOKIE`, `INSIGHTS_CHAT_ADMIN_COOKIE_FILE`, `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD`, or `apps/web/tests/.auth/admin.json`)
3. tracked runtime dirt in `.omg/state/*.json` and `backend/.sync_trigger`
4. `omx-team-prelaunch-*` stash contents, classified as runtime-only vs mixed

A non-zero exit means the lane is not release-ready yet.

## 2026-04-10 snapshot

Observed from the team worker environment plus the leader checkout referenced by `OMX_TEAM_LEADER_CWD`:

- public smoke prerequisites are present via the leader checkout `.env.local`
- no live admin session material is available in this worker environment
- the leader checkout started with tracked runtime dirt in `.omg/state/learn-watch.json`, `.omg/state/quota-watch.json`, and `backend/.sync_trigger`; that dirt was restored during this lane, and the helper now reports a clean inspection checkout
- the two preserved prelaunch stashes are not equivalent:
  - `stash@{0}` / `omx-team-prelaunch-20260410-risk-closure` is **runtime-only**
  - `stash@{1}` / `omx-team-prelaunch-20260410-admin-supabase-overwrite` is **mixed** (runtime dirt + `backend/data/no_transcript_link/no_transcript_permanent.json` + `backend/restaurant-crawling/data/video_cache/8kE5Uq_YV08.webm`)

That means the hygiene lane can clean the currently tracked runtime files, but a real live smoke is still blocked until an admin session is injected.

## Explicit stash disposition

| Stash | Classification | Disposition |
| --- | --- | --- |
| `stash@{0}` / `omx-team-prelaunch-20260410-risk-closure` | runtime-only | Safe to drop after confirming nobody needs the timestamp-only runtime state. Do **not** apply it as part of feature work. |
| `stash@{1}` / `omx-team-prelaunch-20260410-admin-supabase-overwrite` | mixed | Keep quarantined for the owning data/operator lane. Do **not** apply it during admin-review risk closure because it mixes runtime dirt with unrelated data/cache changes. |

## Runtime dirt cleanup

If the helper reports tracked runtime dirt, clear only the known runtime files:

```bash
git restore --source=HEAD -- \
  .omg/state/learn-watch.json \
  .omg/state/quota-watch.json \
  backend/.sync_trigger
```

This intentionally avoids `transforms.jsonl`, crawl artifacts, or any other data-sync surfaces.

## Live smoke handoff

A real smoke still needs an admin-authenticated session. Once one of the supported auth inputs exists, run:

```bash
node apps/web/scripts/admin-evaluations-smoke.mjs \
  --base-url "$BASE_URL" \
  --storage-state "$STATE_PATH" \
  --fixture .omx/fixtures/admin-evaluations-smoke.json
```

Capture before/after DB read-back for each target action:

- quick approve
- quick delete
- quick restore
- edit-save / edit-approve
- missing-restaurant merge/register
- DB-conflict merge/hold

Required evidence per action:

- row id and relevant `trace_id`
- before snapshot from `restaurants`
- UI action taken
- after snapshot proving expected `status`, `updated_by_admin_id`, and preserved/refreshed fields

## Why this lane stays narrow

This closure intentionally does **not** change:

- `.gitignore`
- `transforms.jsonl` / file-sync strategy
- unrelated data stashes or cache policy

The goal is only to make the smoke/hygiene status explicit, repeatable, and safe for the next operator.
