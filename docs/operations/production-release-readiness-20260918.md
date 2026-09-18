# Production release readiness — storyboard local MLX branch (2026-09-18)

Read with [release.md](../agents/release.md). This records what a production release of
`main` would ship, how the release mechanism works, and which prerequisites are still
unmet. It is not a release receipt: no production deployment was made for it.

## Current state (read-only, 2026-09-18T14:56Z)

| Fact | Evidence |
| --- | --- |
| Production serves `5af1e1f6ac81a483e1e8aed2b05237ca0f62ce6a` | `https://www.tzudong.app/api/health` → `releaseId 5445fa71104b2408962c1c5d369babf3bb778838`, `deploymentId dpl_CpqD2F8weF6vDLUG2AgSfrruMbZa` |
| Exact project | `prj_sau35J5uUtShIQ9OKofRtOVVnTSl` (`twoimos-projects/tzudong`), region `icn1` |
| Protected branch rules on `main` | required checks `Release` + `Promotion Path`, 0 required approvals, `enforce_admins`, conversation resolution, no force pushes |
| Merge and release are separate steps | `apps/web/vercel.json` enables Git deployments for `main`; `apps/web/scripts/vercel-ignore-build.mjs` skips any production build whose `VERCEL_GIT_COMMIT_SHA` differs from `TZUDONG_APPROVED_PRODUCTION_SHA` |
| Why production is 13 days behind `main` | the `main` merge of #2911 (`7554ee3b`) produced a Production deployment that Vercel canceled after 12 s for exactly that reason (`vercel ls tzudong`) |

## Release action

1. Set the authorization to the exact commit to release:
   `gh variable set TZUDONG_APPROVED_PRODUCTION_SHA --repo twoimo/tzudong --body <final main sha>`
2. Trigger a production build of that exact commit — the canceled Production deployment
   from the `main` merge can be redeployed, or a new deployment created for that commit.
3. Read back `/api/health`: `gitSha` must equal the released commit, `deploymentId` must be
   the new deployment, and the deployment must be `Ready` on the `www.tzudong.app` and
   `tzudong.app` aliases.

Setting the variable builds nothing by itself; it only lets the next build of that exact
commit through. Nothing above has been executed.

## Rollback

Promote the currently serving deployment `dpl_CpqD2F8weF6vDLUG2AgSfrruMbZa`
(`5af1e1f6`, aliases `www.tzudong.app`, `tzudong.app`) back to production. No rebuild, no
DNS change, no branch-protection change. `.kiro/specs/crawler-pipeline-operational-readiness/production-rollback-target.v1.json`
retains the earlier target in the same shape.

## Prerequisites still unmet

[release.md](../agents/release.md) holds a production release until current external
evidence proves its list, and `rollback.md` §F adds that the hold is released "only after
the actual hosted catalog/privacy/provider release evidence and current CI are verified".

| Item | Status |
| --- | --- |
| Current CI | `web-admin-ci` has failed on `main` since `67df460d`; the cause is the guidance-contract case in `apps/web/tests-unit/typecheck-benchmark-source.test.ts`, fixed on this branch (`npm run test:unit` 2091 pass / 1 skip / 0 fail, `lint` and `typecheck:native` exit 0) |
| Hosted migrations match the deployed catalog | **Not met** — see below |
| Hosted privacy, retention, provider, legal and operator evidence | Not verified from this checkout; `production-release-continuation-20260905.md` records the same items as open |

### The hosted catalog does not match `main`

`g037-hosted-closure-runbook.md` records the hosted migration ledger as 50 rows terminating
at `20260804000500`. Since the deployed commit, `main` adds
`20260906040116_admin_user_ids_catalog_slice`, `20260906053936_admin_management_group_catalog_slice`,
`20260906064252_g014_pg17_workflow_owner_contract` and
`20260918021531_storyboard_mlx_worker`. None of them appear in
`.github/g034-hosted-migration-closure.v1.json` (closure terminal `20260801000300`) or in
`.github/supabase-migration-release-manifest.v1.json`, which last changed 2026-08-03.
`.github/workflows/supabase-migration-apply.yml` admits only the two `g016_*` ids while
`vars.G037_WRITE_FREEZE == "active"`, and the G037 runbook forbids changing that variable,
so the storyboard tables cannot exist in production yet.

Impact of releasing now: the `admin_storyboard_production_*` tables are referenced only by
`apps/web/app/api/admin/storyboard/production/**`, `apps/web/app/api/storyboard-worker/**`,
`apps/web/lib/admin/storyboard/production-store.ts` and `LocalStoryboardWorkspace.tsx`; no
public route reads them. The admin storyboard workspace would therefore report a bounded
storage error until the migration is applied. Public pages, retained data and the serving
deployment are unaffected, and the previous deployment stays one promote away.

## Unblocking the release

1. Complete the G038 successor path and let the freeze exit on its own terms, then apply
   `20260918021531_storyboard_mlx_worker.sql` through the release-manifest route with the
   hosted `expectedPriorState` and `terminalReadback` actually read from production.
2. Bind the remaining hosted privacy, retention and provider evidence that `release.md`
   lists, with the operator approval each item names.
3. Re-verify CI on the exact commit to release, then perform the release action above and
   retain the `/api/health` readback plus the deployment alias and timestamp receipt.
