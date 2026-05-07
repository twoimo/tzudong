# tzudong large Codex sessions — archive handoff

Reactivation prompt:

> We are continuing tzudong work from this handoff after old Codex sessions were archived. Read this document, inspect `/home/twoimo/src/tzudong`, verify current branch/status/tests, then continue from live repo evidence rather than old chat context.

## Scope

Large Codex sessions found by the 2026-05-05 keep-codex-fast details scan included multiple tzudong/admin/mobile/insights themes. This handoff protects the continuity of those themes before archive.

## Candidate themes protected

- Mobile/tablet/desktop review-page UX and stamp/report flows.
- Admin `/insights` chatbot architecture/planning work.
- Mobile admin review list tab swipe UX.
- Admin insight redesign work.
- BMAD-inspired planning/methodology exploration related to tzudong.

## Current known repo anchor

- Repo root: `/home/twoimo/src/tzudong`
- Current app path: `/home/twoimo/src/tzudong/apps/web`
- Branch at handoff time: `main`

## What to verify before continuing

1. Run `git status --short` and confirm no unrelated dirty files are overwritten.
2. Inspect current docs/tests before assuming an old chat decision is still valid.
3. Prefer live product code and current `.omx/wiki` pages over old chat memory.
4. For mobile/admin UX, verify with targeted tests and browser/device smoke checks when possible.
5. For Supabase/admin changes, use live/official state only when credentials and production authority are available.

## Safe next steps after archive

1. Search repo docs and `.omx/wiki` for the specific feature name.
2. Reconstruct state from current code, tests, and recent git history.
3. If old session details are still needed, restore only the relevant archived session rather than all archived sessions.
4. Continue in a fresh Codex thread using this handoff plus current repo inspection.

## Do not do

- Do not treat the old chat title as proof that work was completed.
- Do not reapply broad UX/admin changes without current tests or screenshots.
- Do not mutate production/Supabase state unless explicitly authorized.
