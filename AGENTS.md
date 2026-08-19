# Repository Guidelines

## Product and architecture

Tzudong is a Korean-first restaurant-map product for places featured in Tzuyang videos.

- `apps/web` is the Next.js 16 public app and guarded `/admin` console.
- `backend` owns crawling, evaluation, media work, batch operations, and Supabase preparation. Do not move long-running crawler, ffmpeg, Gemini bulk, GDrive, or batch insert work into route handlers.
- Supabase is the persistence boundary. Browser code uses `apps/web/integrations/supabase/client.ts`; session-aware server code uses `apps/web/lib/supabase/server.ts`; privileged server-only code uses `apps/web/lib/supabase/service-role.ts`.
- Admin API handlers must call `requireAdmin` before work, return bounded fixed-code responses, and never expose provider or database errors.
- Risky admin flows follow Preview → Confirm → Apply → Readback → Audit.

## Commands

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

## Privacy and communications boundaries

G010/G013/G014 source safeguards reduce risk but do not certify statutory compliance, policy publication, filing, deployment, or legal approval.

- Canonical privacy objects are `privacy_policy_versions`, `privacy_onboarding_challenges`, `privacy_age_profiles`, `privacy_guardian_verifications`, `privacy_consent_events`, the derived `privacy_consent_state` view, and append-only `privacy_audit_events`.
- Canonical RPCs include `get_current_privacy_policy_version`, `create_privacy_onboarding_challenge`, `confirm_privacy_onboarding`, `submit_privacy_consent`, and `record_privacy_guardian_verification`. Do not add fallback aliases.
- Account creation is challenge-bound to the exact published policy version, locale, content hash, and operator approval readback. Unsupported under-14 registration stays blocked until a verified guardian workflow is deployed and read back; do not collect a date of birth, guardian contact, or resident registration number as a workaround.
- Ordinary marketing consent is purpose- and channel-specific. Advertising between 21:00 and 08:00 requires the separate `night_marketing` decision for the same channel. Transactional notifications must not silently become advertising.
- `apps/web/lib/privacy/sanitize.ts` is the shared privacy assertion/redaction boundary. Never log or persist passwords, credentials, cookies, session/onboarding tokens, email addresses, phone numbers, resident registration numbers, precise location, raw OCR, arbitrary request bodies, provider diagnostics, or free-form errors.
- Device location requires a just-in-time disclosure, remains memory-only, and must stop its watcher on cancellation/unmount. Stored restaurant/business coordinates are a separate contract.
- Account deletion and retention operations remain fail closed: recent reauthentication, exact typed confirmation, stable preview hash, readback, append-only minimized audit, legal-hold/last-admin checks, session revocation, database cleanup, and Auth deletion last.
- Retention periods and legal bases come only from active operator-approved classes. Code must not invent periods. Applied Supabase migrations are immutable; add a new migration for a correction.
- Privacy incident handling records bounded detection/decision/notice/receipt state under one operation ID. A named human determines and performs any authority or subject notification; source code must not claim that a filing was submitted or accepted.

## Release gates and recovery discipline

The dirty original worktree is immutable. Work only in an isolated recovery candidate; never reset, stash, or clean either worktree. Content patches start from a fresh head and move as serialized PRs `develop -> data -> main`, subject to external approval and branch protection.

A production release remains blocked until current external evidence proves all of the following:

- the exact policy version/hash/locale/effective/published tuple is published, approved, and deployed;
- retention classes have named operator approval, legal basis, trigger, period, activation, and hosted backup/PITR evidence;
- hosted production migrations, RLS/grants, RPC readback, generated Supabase types, catalog, key-management, and operator-access evidence match the deployed catalog;
- marketing delivery uses an approved HTTPS provider with production secrets and internal capability controls;
- location-business filing or documented non-applicability is externally confirmed;
- under-14 support, if enabled, uses an externally verified guardian provider;
- incident notices have named human approval and immutable submission/receipt evidence; and
- Korean legal/privacy-owner review is recorded.

Before any Vercel action, verify the exact Git-integrated `tzudong` project. Do not use a stale `web` project or mutate DNS. A release or rollback needs external approval, branch-protection evidence, a rollback plan, and deployment readback receipt. This source tree makes no claim that a merge or deployment occurred.

Do not fabricate these receipts, weaken fail-closed behavior, bypass branch protection, commit credentials, or claim that local tests prove legal compliance or hosted production state.

## Testing conventions

- `apps/web/tests-unit` contains Bun unit and source-contract tests; copy, route wiring, security, and order changes often require paired assertions.
- `apps/web/tests` contains Playwright public/admin/responsive coverage. Evidence must exclude cookies, headers, local storage, raw admin body/table content, and Supabase payloads.
- Verify observable branches, error paths, idempotency, and readback—not defaults or tautologies.
- Keep unexpected worktree changes as user work. Never reset, stash, clean, commit, push, or delete them unless explicitly authorized.

## Cursor Cloud specific instructions

The Cloud Agent environment lives in `.cursor/` (`environment.json` + `scripts/`). `install.sh` pins Node 24, Bun, Docker engine, and Docker Compose `v2.39.4` (the exact version `local-stack.py` requires) and runs `bun install`; `start.sh` brings up the local Docker daemon and the 14-service Supabase stack + migrations + seed; `dev.sh` runs `bun run dev`.

- The runtime injects an `/exec-daemon` node (v22) at the front of `PATH`. Resolve the repo's Node 24 by sourcing `.cursor/scripts/lib.sh` and calling `tzudong_activate_toolchain`; it also exports `TZUDONG_NODE24_EXECUTABLE`, which `bun run test:unit` needs (under Bun `process.execPath` is not Node, so the Linux PID-namespace supervisor test fails without it).
- The local Docker daemon listens on a user-owned socket (`~/.docker/run/docker.sock`, context `tzudong-local`); `local-stack.py` rejects the default socket. Inter-container connectivity in this nested VM requires `net.bridge.bridge-nf-call-iptables=0` (set by `start.sh`).
- The local dev path intentionally serves an **offline Naver map stub** (`NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME=1` forces `NEXT_PUBLIC_NAVER_MAPS_SCRIPT_URL=/__local/naver-maps.js`), so real map tiles never render. To render real Naver tiles with the local seeded data, set the public `NEXT_PUBLIC_NAVER_CLIENT_ID` (Naver Cloud ncpKeyId) and run `.cursor/scripts/dev-realmap.sh` (stop the default `web-dev` terminal first; both use port 8080). The ncpKeyId's Naver console "Web service URL" allowlist must include `http://127.0.0.1:8080` and `http://localhost:8080`, or Naver returns 401.
