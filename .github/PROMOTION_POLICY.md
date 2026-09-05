# Trusted promotion policy

`Promotion Path` runs only on `pull_request_target`. Both its workflow definition
and checked-out verifier come from the exact default-branch workflow revision
(`github.workflow_sha`). It never executes a PR head or merge-ref definition.
Every PR event, including a base edit, runs the verifier without a conditional job
skip. The verifier permits feature → develop → data → main and rejects shortcuts.

The initial main revision predates this workflow. Installation therefore uses a
bounded repository-metadata transition rather than a PR-defined success check:

1. Retain exact main/develop/data refs, default branch, branch protections, active
   write freeze, scheduler guards and Vercel's explicit main production branch.
2. Temporarily select the already protected and reviewed develop branch as the
   repository default. Do not change refs, protection, credentials or DNS.
3. Trigger a normal PR event and verify an actual `pull_request_target` run from
   that protected workflow revision. A skipped or PR-defined check is insufficient.
4. Merge reviewed changes through develop → data → main using the existing
   required checks and normal protected PRs. Keep write-producing schedules held.
5. Restore main as the default immediately after its trusted workflow is installed,
   then independently verify the default, protections, target-event execution and
   production-branch identity. Restore the prior default if installation is stopped.

The current owner has authorized the recovery task. Each metadata transition and
merge still needs its actual external readback; this document is a procedure, not
a claim that installation, release or freeze exit has occurred. Never create a
custom passing status to substitute for policy execution.
