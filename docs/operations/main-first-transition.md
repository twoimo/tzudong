# Main-first source transition

This change separates source review from deployment and legacy data publication.
After activation, short-lived feature and dependency branches target protected
`main`. Vercel builds only the exact approved production commit; one operator
promotes the verified staged deployment. `data` remains available to existing
data consumers and is no longer an intermediate source-release branch.

This document describes source behavior and the installation procedure. Its
presence in a candidate checkout does not establish a protected merge, saved
provider settings, production deployment, or local Mac cleanup.

## Resulting source contracts

| Area | Contract in this candidate |
| --- | --- |
| Trusted PR admission | `Promotion Path` runs from the exact default-branch workflow revision on every `pull_request_target` event; feature/dependency heads may target `main`; legacy release heads and `develop`/`data` code-promotion bases are rejected |
| Main PR CI | Complete, source-bound diff selects relevant web jobs; uncertain scope expands to full proof; a checkout mismatch fails |
| Main PR Security | Existing path policy selects all seven security jobs together; no workflow path filter can omit the stable result |
| Required result jobs | `CI` and `Security` retain fixed dependency accounting and fail on missing, failed, cancelled, or unexpectedly skipped selected work |
| Post-merge and periodic checks | CI, Release, Security, CodeQL, and path-scoped Pipeline Process Boundaries/CodeQL Swift push checks use `main`; full relevant post-merge scope and existing scheduled/manual/nightly checks remain |
| Dependencies | All eight Dependabot units, Freshness PR trigger, and verified target contract use `main`; three holds and exact-commit/race checks remain |
| Optional feature previews | Explicit one-level `preview/<name>` branches may build; ordinary feature/dependency branches remain disabled; `develop` stays allowed for the final installation |
| Production | `main` only, exact `TZUDONG_APPROVED_PRODUCTION_SHA`, manual production-domain assignment, staged validation, one promotion owner, and live readback |
| Release evidence | Exact current-main commit and tree at initial and terminal verification and check publication; all existing auth, receipt, rollback, and provider contracts remain |
| Cloudflare governance | Reviewed desired branch and both runner arguments become `main`; actual Workers Builds changes and readback are separate, pending operations |
| Data compatibility | Existing optional data publisher, caption importer, Kaggle consumer, freeze guards, and GDrive scopes remain unchanged |

Formal release evidence still requires its provider preview and production
identities to refer to `main` at the exact reviewed release SHA. A feature preview
from `preview/<name>` is useful for review but cannot replace that release proof.
The main-first policy removes equality with stale `develop` and `data` trees; it
does not relax exact source identity or manufacture an evidence receipt.

## Install once through the existing protected path

1. Read the actual default branch, main/develop/data refs, saved protections and
   required context identities. Record the currently serving production and an
   eligible rollback deployment. Keep user work isolated and active write guards
   unchanged. Resolve any overlapping open PRs before serial promotion.
2. Submit this coherent policy and consumer change from a fresh `develop` base to
   `develop`. The trusted policy still comes from old `main`, so feature-to-main
   is not yet available. Do not alter the default branch to select candidate code.
3. Complete the exact-head remote checks and merge normally. Open `develop -> data`,
   then `data -> main`, checking current head/base identities and all applicable
   `Release`, `Promotion Path`, `CI`, `Security`, CodeQL, and dependency results
   before each merge. The classifiers deliberately retain full proof for these
   final installation PRs. No force push, admin bypass, or custom passing status
   is part of this sequence.
4. Read back `main` as the default and its saved strict/no-bypass protection.
   Preserve all existing required contexts and their application identities;
   specifically verify the executed `CI` and `Security` results are required
   alongside `Release` and `Promotion Path`. A source edit cannot activate or
   prove a repository setting. If settings cannot be read, report that fact.
5. Verify main post-merge CI, Release, Security, and CodeQL against the actual
   merged source. On the next legitimate main-target PR, verify the new trusted
   `Promotion Path` uses the exact default-branch workflow revision. Confirm the
   expected scope and stable results before merging it. Do not create empty PRs
   merely to produce a green signal.
6. Start new feature and dependency work from current `main`. Confirm Dependabot's
   default-branch configuration and Freshness target agree. Reconcile any older
   dependency PR against its new exact base/head rather than reusing stale evidence.
   Existing dependency holds and no-auto-merge behavior remain.

Installation is complete only after the actual source and saved-setting readbacks.
Local tests below establish candidate behavior; they cannot supply that evidence.
Keep the old branch refs during this change. Their deletion is neither necessary
for direct main development nor authorized by this source patch.

## Apply the provider alignment separately

Vercel remains the app build owner. Verify the exact project, `main` production
branch, manual domain assignment, and approved SHA environment value. Build and
test the exact production candidate before assigning domains; retain the current
eligible rollback target and read back both aliases and live application identity
after promotion. Follow [staged production](staged-production-transition.md).
A main merge does not authorize an arbitrary source SHA through the build guard.

The Cloudflare source settings are a desired configuration, not a deployment API.
After the policy reaches `main`, read the existing `tzudong-ci-governance` trigger
and keep its current settings as rollback input. Change the production branch and
both `--branch` arguments to `main` together on that same trigger. Preserve root
directory, preview disablement, pinned tools, credentials, deadlines, and budgets.
Read back the settings, then verify a native main build and the exact commit,
tree, build ID, receipt, and artifact checksum from its public endpoints. A stale
successful Worker response is insufficient. If provider access is unavailable,
record this alignment as pending; do not claim the JSON changed the provider.
The old explicitly configured develop runner can continue until this alignment;
it does not replace main's required GitHub checks. See
[Cloudflare governance](cloudflare-ci.md) for the prior provider record.

## Keep data and local runtime changes separate

Do not delete or retarget `data` in this phase. The opt-in publisher in
`daily-crawler.yml` still binds its own exact data base when enabled. The caption
importer and Kaggle notebook still read `data`. `RUN_DAILY_TARGET_BRANCH=data`
also identifies GDrive status/staging scope and worker metadata; changing that
string globally would change durable state identity. The
[compute/data binding](daily-compute-data-binding.md) keeps compute on the protected
default branch without forcing legacy publication. No repository variable,
producer freeze, publication flag, GDrive path, or consumer retirement is implied.

The source already provides [on-demand pipeline modes](../../backend/pipeline-control/LOCAL_MODES.md).
Applying them to the actual Mac requires a live connection and a measured inventory
of containers, Compose ownership, restart policies, ports, bind mounts, persistent
volumes, active jobs, local worktrees, and ignored datasets. Before stopping a
worker, verify its queue/outbox/lease state and recovery path. Confirm telemetry
exporters stop or redirect before stopping their collector. Stop only identified
project services, retain volumes and source work, then verify restart and the
required web/crawler flows. The web development runner still needs verified local
Supabase Auth, REST, Storage, Realtime, and Functions. This source transition does
not claim a Docker-free development environment or measured Mac resource savings.

## Verification and rollback

Run the affected Promotion Path, scope/aggregate, workflow wiring, dependency,
Vercel guard, and final-evidence tests. Include negative cases for legacy bases,
wrong checked-out SHAs, moved main commit/tree, missing results, nonmanual domain
assignment, disabled previews, and dependency base/head races. Documentation and
Cloudflare settings must agree with the pending provider operation.

If the installation stops before `main`, keep the current trusted serial policy
and current serving deployment. Complete or revert the candidate through normal
protected PRs; do not partially activate a direct-main workflow. After activation,
revert source through a normal feature-to-main PR with the currently installed
policy and checks. A rollback that restores the old policy must restore its
consumer contracts coherently and account for any open main-target PRs before it
merges. Restore provider settings only from the captured configuration, verify
them, and keep production rollback independent from source rollback. Required
checks remain satisfiable and enforced throughout.
