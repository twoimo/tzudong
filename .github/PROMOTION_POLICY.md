# Trusted promotion policy

`Promotion Path` runs only on `pull_request_target`. Both its workflow definition
and checked-out verifier come from the exact default-branch workflow revision
(`github.workflow_sha`). It never executes a PR head or merge-ref definition.
Every PR event, including a base edit, runs the verifier without a conditional job
skip. The main-first verifier accepts feature and dependency heads into protected
`main`, including ordinary fork contributions. It rejects `develop` and `data`
as code-promotion bases and rejects any `main`, `develop`, or `data` head into
`main`. Other development bases remain usable but do not constitute a release.
Repository and PR source metadata must be present and valid.

## Install the replacement policy once

The existing trusted default-branch policy still enforces the serial path until
this replacement reaches `main`. Do not expect the policy in a PR head to authorize
that PR, and do not change the default branch to select it early.

1. Capture the actual default branch, main/develop/data SHAs, required contexts,
   strict and no-bypass settings, current production identity, and rollback target.
2. Submit the coherent policy and consumer changes to `develop`. Complete the
   applicable exact-head `Release`, `Promotion Path`, `CI`, `Security`, CodeQL,
   and dependency checks before each protected merge.
3. Promote `develop -> data -> main` one final time through normal protected PRs.
   Reconcile changed head/base SHAs before proceeding. The classifiers retain full
   coverage for these installation PRs; no custom success status substitutes for
   execution.
4. Verify `main` is the default and that its saved protection retains the existing
   required contexts, including executed `CI` and `Security`, strict up-to-date
   behavior, and no bypass. Confirm the next normal main-target PR runs the new
   verifier from the exact trusted default-branch workflow revision.
5. Start source and dependency PRs from current `main` and target `main`. Keep
   `data` for its existing data consumers; do not delete branches, publish data,
   alter write freezes, or reconfigure hosted providers as an implicit side effect.

The [transition runbook](../docs/operations/main-first-transition.md) covers
dependent workflows, staged production, provider readback, and rollback. This
source procedure does not claim installation, release, or freeze exit occurred.
Never weaken protection, force-push, use administrator merge bypass, or create a
passing replacement check to complete the transition.
