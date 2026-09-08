# Select verification by impact

Choose checks for the affected behavior, its callers and credible failure paths. Expand when a shared contract changes or a failure reveals wider impact. Passing relevant checks ends local verification unless a new change or unresolved risk justifies more. Required CI/release checks remain required; do not rerun all suites after every edit.

| Change | First useful verification | Broaden when |
| --- | --- | --- |
| Guidance/docs only | Resolve local links, compare preserved requirements, inspect diff; validate skill metadata if changed | Runnable examples, configuration or CI behavior changed |
| Copy/style/component | Existing affected Bun assertions, if any; inspect rendered states when appearance changes. Do not add wording-only tests | Shared components, navigation or accessibility behavior changed |
| TS/route/auth/data shape | Related unit/source contracts, targeted ESLint, `npm run typecheck:parity` | Shared entrypoints/build config require build; user flow needs focused Playwright |
| Python crawler/validator | Affected unittest modules and data-contract cases | Orchestration or shared contracts affect the broader daily flow |
| SQL/RLS/grants/RPC | Exact-version isolated database checks of permissions, failures, idempotency and rollback/readback | Migration/replay contracts require canonical replay and protected CI |
| Performance claim | Canonical retained measurements, scorer, validator and detached artifact-map hash | Claim spans further environments or observation windows |

Do not add tests that merely assert this document's wording. Fix concrete failures and rerun affected checks; record missing prerequisites without inventing credentials. A check skipped for absent prerequisites is not a pass.

## Available commands and toolchain

These are available commands, not an unconditional checklist.

From `apps/web`, Bun remains supported for day-to-day install, development, lint, and unit-test flows:

```text
bun install
bun run dev
bun run lint
bun run test:unit
npm run typecheck:parity
npm run typecheck:benchmark
npm run build
npx playwright test
```

The web runtime is Node 24.x. npm 11.6.2, `package.json`, and `package-lock.json` are the release package authority; reconcile `bun.lock` with them rather than treating it as release authority. The native TypeScript CLI is the exact `@typescript/native` alias at `7.0.2`; the stable API/compatibility bridge is TypeScript `6.0.2`. Use the explicit `npm run typecheck:parity` and `npm run typecheck:benchmark` scripts for compiler parity and benchmark evidence. Never substitute a global compiler.

Performance evidence belongs only under canonical `apps/web/performance/*` inputs, scorer/validator outputs, and an artifact map whose SHA is recorded out of band. Every performance report must state absolute, relative, and noise budgets; retain frozen-tree evidence; and treat zero admitted slices as a valid result. No current G003 measured improvement is established without retained raw and scored artifacts.

Backend checks from the repository root:

```text
python -m unittest backend.utils.tests.test_run_daily_regression
python -m unittest backend.pipeline.test_validators_unittest
python -m unittest backend.pipeline.test_data_contracts_unittest
python backend/bin/check_env_contract.py --profile daily
```

The environment-contract check is expected to fail closed when required operator secrets are absent; never add fake values to make it pass.

## Evidence conventions

- `apps/web/tests-unit` contains Bun unit and source-contract tests; copy, route wiring, security, and order changes often require paired assertions.
- `apps/web/tests` contains Playwright public/admin/responsive coverage. Evidence must exclude cookies, headers, local storage, raw admin body/table content, and Supabase payloads.
- Verify observable branches, error paths, idempotency, and readback—not defaults or tautologies.
- Keep unexpected worktree changes as user work. Never reset, stash, clean, commit, push, or delete them unless explicitly authorized.
