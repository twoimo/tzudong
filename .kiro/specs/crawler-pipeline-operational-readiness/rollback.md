# Candidate Rollback Notes

These notes describe narrow inverse patches for the isolated candidate. They do not authorize a reset, checkout, force push, production mutation, or deletion of the original worktree's files.

## A. Readiness audit, specification, and CI job

- Remove only the new operational-readiness specification and `backend/pipeline_control/readiness.py`, its CLI, tests, and `backend/test-requirements.txt`.
- Remove only the matching documentation and `orchestration-readiness` workflow additions.
- Restore the previous security-workflow source assertions that counted four checkout actions.
- Re-run the backend focused suite and `bun test apps/web/tests-unit/security-workflow-source.test.ts`.

## B. Shared hosted-new-video runner restoration

- Invert only the `hosted-pending-apply` dependency setup and shared-runner invocation in `daily-crawler.yml`.
- Invert only the matching source-contract and env-preflight marker assertions.
- Re-run `backend.utils.tests.test_run_daily_regression` and `backend.utils.tests.test_env_contract_preflight_ordering`.
- Do not execute a hosted apply as part of rollback verification.

## C. Dependency advisory closure

- Remove only the exact `browserslist` override and restore the prior lockfile records if a reviewed replacement fix supersedes it.
- Keep `package.json`, `package-lock.json`, and `bun.lock` mutually consistent.
- Re-run the dual-toolchain lock parity test, `npm ls browserslist --all`, and `npm audit --audit-level=moderate`.
- Do not use an automatic audit fix.

## D. Merge-regression recovery

- Treat the guardian route, Supabase type generator, Playwright port, admin import, and desktop panel assertion as independent inverse patches.
- Any guardian rollback must retain the under-14 fail-closed policy unless approved external provider deployment and readback evidence exists.
- Any type-generator rollback must preserve loopback-only postgres-meta validation and bounded fixed error classification.
- Re-run the focused seven-file Bun suite, ESLint, TypeScript parity, and production build after an inverse patch.

## E. Optional local reconciliation evidence

- Revert only the conditional skip around the recovery reconciliation class if the exact operator-retained manifest is restored to the checkout.
- Never generate a substitute manifest from ignored crawl/evaluation data.
- Re-run `backend.pipeline.test_data_contracts_unittest`; the complete reconciliation checks must execute when the manifest exists.

## F. Controlled source promotion and production hold

- Current reviewed rollback target: `dpl_8fR6mDqD3SeBY6MXxFJ4iTvgh9fv`, Git SHA `29e432f7d96d98e6d09ba9237f05d6812ceb956b`, exact project `prj_sau35J5uUtShIQ9OKofRtOVVnTSl`. See `production-rollback-target.v1.json` for the independently retained immutable-ID receipt hash. This is a prepared target, not an executed rollback.
- `apps/web/vercel.json` holds automatic main deployments while protected source promotion and G037 readback proceed. The ignored-build command independently enforces the same configuration. Develop previews remain enabled.
- Release this hold only after the actual hosted catalog/privacy/provider release evidence and current CI are verified. Submit the explicit main configuration change through the protected PR path, then verify the new deployment, aliases, and HTTP behavior. Never pause the live Vercel project or change DNS to implement the hold.
- The two temporarily disabled scheduled workflows may be enabled after the promoted main definitions contain the active-write-freeze gates. Keep `G037_WRITE_FREEZE=active` until its existing successor/recovery exit conditions are proved. Public-repository data publication remains explicitly opt-in.
- If source promotion must be reversed, use a new reviewed inverse PR and keep the current live deployment and workflow hold intact while revalidating the candidate.
