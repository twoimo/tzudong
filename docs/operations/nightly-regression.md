# Nightly Regression Operations

The nightly regression workflow runs at 03:30 KST (18:30 UTC) and can be started manually from GitHub Actions. It is intentionally separate from crawler, migration, and production operations.

## Required GitHub secrets

- `NIGHTLY_SUPABASE_PROJECT_REF`: project ref for the isolated Supabase test project.
- `NIGHTLY_SUPABASE_URL`: URL for that project; the workflow checks that it contains the configured ref.
- `NIGHTLY_SUPABASE_ANON_KEY`: public client key for the isolated project.
- `NIGHTLY_ADMIN_EMAIL` / `NIGHTLY_ADMIN_PASSWORD`: dedicated non-production test account. The email must identify the nightly account.
- `NIGHTLY_SLACK_WEBHOOK` (optional): failure-only notification endpoint.

Never use production Supabase credentials or a personal admin account. The test project should contain only disposable, seeded data and must be permissioned for read-only regression coverage.
## Local execution

The same isolated account and project checks can be run locally without reading
production credentials. From `apps/web`, create the ignored
`.env.nightly.local` file with these dedicated values, or export the variables
in the shell:

```dotenv
NIGHTLY_SUPABASE_PROJECT_REF=<isolated-project-ref>
NEXT_PUBLIC_SUPABASE_URL=https://<isolated-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<isolated-anon-key>
NIGHTLY_ADMIN_EMAIL=nightly-ci@example.invalid
NIGHTLY_ADMIN_PASSWORD=<dedicated-nightly-password>
```

Run the curated local contract with:

```sh
bun install --frozen-lockfile
bunx playwright install chromium
bun run test:nightly -- --env-file .env.nightly.local
```

The env file is ignored by the repository (`*.env.local`). It must be a
dedicated nightly file; the runner rejects other env-file names, missing
values, a URL that does not contain `NIGHTLY_SUPABASE_PROJECT_REF`, and an
admin email that does not contain `nightly` before starting the app or tests.
The runner starts the app with `NODE_ENV=test` and a nightly-only env guard so
Next.js does not load `.env.local` production values.
Explicit shell variables can be used instead by omitting `--env-file`. Use
`--suite unit` or `--suite e2e` for one lane, and `--validate-only` to check
the contract without starting anything.

The e2e lane starts the existing `bun run dev:playwright` command, waits for
`/api/health`, then runs the exact read-only Playwright allowlist used by
GitHub Actions. The unit lane runs the existing `bun run test:unit` command.
Do not place production values in the nightly file or reuse a personal admin
account.

## Suite contract

The default `all` run executes the unit suite and this explicit Playwright allowlist:

- `tests/smoke.spec.ts`
- `tests/navigation.spec.ts`
- `tests/browser-title.spec.ts`
- `tests/mobile-home-map.spec.ts`

Destructive admin flows, live-provider tests, crawler/batch jobs, migration application, and tests that require production data are excluded. Expanding the allowlist requires a separate review of data mutation, credentials, network dependencies, runtime, and artifact requirements.

## Failure handling

Every lane has a bounded timeout. The e2e lane fails closed if `/api/health` cannot be reached within two minutes. Unit logs, Playwright HTML reports, traces, screenshots, test results, and the app log are uploaded with 14-day retention even when tests fail. The job summary contains only run metadata and lane statuses; it must not contain tokens, passwords, raw provider errors, or database payloads.

The optional Slack notification is best-effort and cannot change the workflow result. GitHub job summary and artifacts are authoritative when notification delivery fails.

## Reruns and flakes

Rerun a failed workflow from the same commit after inspecting the report and health/app logs. Retries are diagnostic, not a pass override. A flaky test may be quarantined only with an owner, a linked issue, evidence, and an expiry date; no quarantine is indefinite. Review duration, retries, false positives, artifact completeness, and alert delivery after two weeks of runs before adding coverage.

## Disable and rollback

Use workflow disable in GitHub for an immediate stop, then revert `.github/workflows/nightly-regression.yml` and this runbook together. Re-enable only after confirming the isolated project identity and dedicated account secrets. Existing PR/push workflows are independent and must remain unchanged.
