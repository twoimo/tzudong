# Protected promotion and staged production

This is preparation for the deployment phase of the
[CI simplification](cicd-simplification.md). It does not establish current provider
settings, a staged build, a production release, or a rollback receipt. Follow the
[release policy](../agents/release.md) and keep source promotion serialized through
`feature -> develop -> data -> main` until its replacement is installed and verified.

## Retired branch synchronization command

`scripts/sync-release-branches.mjs` formerly created independent temporary PRs into
all three branches, used administrator merge bypass, and pushed with force-with-lease.
That execution path is retired. Only `--help` or `-h` alone succeeds; every other
invocation returns a fixed failure before any Git, GitHub, or network operation.
Old flags, including `--dry-run`, `--skip-merge`, and `--allow-dirty`, do not run.

Use normal protected PRs in the current order. Before each merge, verify its exact
head and base, the applicable completed checks, and the promotion path. Reconcile a
changed head or base before continuing. Do not create passing replacement statuses,
use administrator bypass, force-push, or delete the release branches to complete
promotion.

## Establish the release inputs

The source expects the Git-integrated `tzudong` project
`prj_sau35J5uUtShIQ9OKofRtOVVnTSl`, team `team_OUj64KeLxJI3PkEbOaFZnorA`, and root
`apps/web`. Verify those identities against the actual provider before an operation.
An empty project list or a not-found response leaves that identity unverified; it
does not establish that the project was deleted. Continue independent source work
while deployment access is unavailable.

Record the exact reviewed `main` commit and tree after protected promotion. Read the
currently serving production deployment, its Git SHA, immutable URL, and both aliases
(`tzudong.app` and `www.tzudong.app`) from the provider. Confirm live health and rollback
eligibility, then retain that specific deployment as the rollback target. Historical
deployment IDs in older documents are not current rollback inputs.

The existing read-only
[`vercel-rollback-readback.mjs`](../../apps/web/scripts/vercel-rollback-readback.mjs)
validates a supplied deployment ID, URL, `main` SHA, project, team, READY production
state, and both aliases. Its CLI takes `TZUDONG_ROLLBACK_DEPLOYMENT_ID`,
`TZUDONG_ROLLBACK_DEPLOYMENT_URL`, `TZUDONG_ROLLBACK_GIT_REF=main`, and
`TZUDONG_ROLLBACK_GIT_SHA` from the operator environment:

```sh
node apps/web/scripts/vercel-rollback-readback.mjs
```

Use fresh provider values and an already authenticated, scoped transport. The
sanitized identity readback does not itself prove application health, provider
rollback eligibility, or that a rollback was executed. Keep this shared module
unchanged; SQL successor controllers also bind its exact source.

## One staged production and promotion path

1. Preserve Vercel as the app build owner. Verify its actual production branch,
   environment, and domain-assignment settings before selecting the staging mode.
   Do not add a second GitHub deployment workflow alongside the Git integration.
2. The existing build guard reads `TZUDONG_APPROVED_PRODUCTION_SHA` from the **Vercel
   production build environment**. It must exactly equal the reviewed `main` SHA.
   Setting a similarly named GitHub repository variable is not a demonstrated
   bridge to that environment; this repository contains no such synchronization.
   Keep the ignore-build guard enabled.
3. Build that exact commit for the production environment without assigning the
   production domains. Verify the staged deployment's project, Git SHA, production
   target, READY state, and immutable URL, while both live aliases still point to
   the captured rollback target. A preview build is a separate artifact.
4. Run the relevant public and authenticated smoke checks against that staged URL.
   Verify the source SHA and deployment identity returned by the application.
   Use the same tested production deployment for promotion.
5. Let one release owner perform promotion. Immediately before it, recheck the
   selected candidate and current aliases. If another deployment became current,
   reconcile the release instead of overwriting it with stale inputs.
6. After promotion, read back provider READY state, deployment ID and Git SHA,
   both aliases, and live application health/identity. A merge, local build, or
   successful promotion request alone is not this readback.

Vercel supports staged production through disabled automatic domain assignment or
the scoped CLI staging operation `vercel deploy --prod --skip-domain`; select and
verify one supported path for the actual project. Promoting a staged production
build keeps that build, while promoting a preview creates a production rebuild.
See [Vercel staging and promotion](https://vercel.com/docs/deployments/promoting-a-deployment).
These command names describe the release mechanism; this preparation does not run
them or change provider settings.

If validation fails after promotion, use the previously verified eligible production
deployment as the rollback target, then repeat provider, alias, and application
readback. Inspect domain-assignment behavior afterward: Vercel's rollback flow can
disable automatic assignment. Do not silently restore automatic traffic changes or
claim the prior policy survived without reading it back. See
[Vercel Instant Rollback](https://vercel.com/docs/instant-rollback).

## Boundaries before main-only source development

Branch consolidation is a later coordinated change. Its policy must reach `main`
through the current protected path before feature PRs target `main` directly.

| Consumer | Required transition |
| --- | --- |
| `.github/scripts/verify-promotion-path.mjs`, its tests, and `.github/PROMOTION_POLICY.md` | Install the new trusted policy through the serial path; keep exact source identity and protected checks |
| The CI scope, benchmark, and Security classifiers under `.github/scripts/` | Replace the current `develop` scope base deliberately; `main` PRs currently select full checks |
| `.github/dependabot.yml`, `dependency-freshness.yml`, and `verify-dependency-freshness.mjs` | Move the eight update units and their verified target contract together |
| `apps/web/vercel.json` and `vercel-ignore-build.mjs` | Replace the `develop` preview allowlist and verify one production promotion owner |
| `.github/cloudflare/build-settings.json` | Reconcile its `develop` build/deploy lane with the actual Cloudflare integration |
| `ts7-release-evidence.yml` and `verify-final-release-evidence.mjs` | Replace the three-branch tree-equality contract and reconcile any changed domain-assignment policy; retain exact release identity |
| `AGENTS.md` and `docs/agents/release.md` | Update the operating instructions with the installed replacement policy |

Verify the actual GitHub default branch and protection settings as part of that
transition. Before accepting feature PRs directly into `main`, verify that its
saved protection requires the executed `CI` and `Security` results alongside the
other applicable checks. The manual Release Evidence workflow is a verification
consumer, not another deployment owner; do not add deployment mutations to it.

Before retiring `data`, establish whether the opt-in publisher in
`daily-crawler.yml`, the caption importer
`backend/storyboard-agent/scripts/02-video-caption-store-supabase.py`, or
`backend/restaurant-crawling/scripts/kaggle-context-generation-git.ipynb` is still
used. The compute binding change alone does not retire these consumers. Inventory
the actual Mac's running jobs, worktrees, ignored data, and volumes before changing
local services or removing branches. `RUN_DAILY_TARGET_BRANCH=data` also names
GDrive status/staging scope and worker metadata; do not globally replace it with
`main` and move durable upload state accidentally.

The external schema/catalog/privacy/legal evidence gates parked by the operator in
the current release policy are not additional release blockers. Parking them does
not enable product features or bypass an active producer, migration, or write guard.
The protected promotion path, applicable current checks, fresh rollback identity,
and production readback remain necessary.
