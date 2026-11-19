# Admin console and storyboard production release

This change keeps the 15 admin module IDs and legacy routes. UI fixture checks do not establish hosted readiness. Publication follows the installed main-first PR policy, the exact approved production SHA guard, and manual domain promotion described in `docs/agents/release.md`.

## Dependency remediation

- Three Next.js alerts originated from a historical performance fixture, not the deployed application dependency. Its original package bytes are retained as `fixture-inputs/package-manifest.snapshot`, with the detached artifact map unchanged. `scripts/verify-overseas-map-startup-evidence.mjs` verifies that evidence and separately reports source drift. It rejects a reintroduced executable fixture manifest.
- The backend uses the explicitly named, MIT-preserving `@tzudong/deepmerge` local fork because no patched upstream release was available. Source, deterministic tarball, provenance and exploit/compatibility tests are under `backend/vendor` and `backend/bin/tests/deepmerge-security.test.mjs`. This is a local fork, not an upstream release. A clean advisory scan is not independent security proof for a newly named package.
- Re-read Dependabot on the protected default branch after merge. Local fixes and a passed Security workflow do not by themselves close remote alerts.

## Hosted SQL sequence

The observed pre-OpenAI schema still required the existing Gemini execution migration. Neither old source nor the legacy shared release manifest is changed. The separate `.github/storyboard-migration-release-manifest.v1.json` admits exactly these transitions:

1. `storyboard_gemini_execution_v1`: original SQL SHA-256 `84d351dead86ef90040b6949fe4a6dc93eb91a783c1b7a78531c7f564ea4ff4e`.
2. `storyboard_openai_execution`: SQL SHA-256 `e2cf79eb435de2b760a3cc218371dafbe64a3344e41bdb9034437e2d2ae6f4a3`.

The manifest binds function-definition hashes, constraints, RLS/force-RLS, active job count and RPC privileges to exact prior and terminal states. Both stages require zero active jobs. The caller locks the project/job tables before checking the prior state, inside the same transaction as SQL and ledger insertion. A mismatch rolls back; an uncertain write is reconciled read-only rather than blindly replayed.

`apps/web/scripts/storyboard-production-successor.mjs` uses the existing atomic executor without changing its frozen source contract. The exact project is `aqlcofblfxdrjhhdmarw`, via its session pooler on port 5432. Verify-full TLS is pinned to the repository's approved CA. Source, manifest and CA symlink/hash checks fail closed. No management-token fallback is permitted.

Supply `SUPABASE_DB_URL` privately and a separately verified `STORYBOARD_RELEASE_MANIFEST_SHA256`. Do not put database credentials in command arguments, output, Git, or UI. From the repository root:

```sh
node apps/web/scripts/storyboard-production-successor.mjs --migration-id storyboard_gemini_execution_v1 --mode dry-run
node apps/web/scripts/storyboard-production-successor.mjs --migration-id storyboard_openai_execution --mode dry-run
# Only after protected merge and explicit hosted authority:
node apps/web/scripts/storyboard-production-successor.mjs --migration-id storyboard_gemini_execution_v1 --mode apply
node apps/web/scripts/storyboard-production-successor.mjs --migration-id storyboard_gemini_execution_v1 --mode verify-terminal-state
node apps/web/scripts/storyboard-production-successor.mjs --migration-id storyboard_openai_execution --mode apply
node apps/web/scripts/storyboard-production-successor.mjs --migration-id storyboard_openai_execution --mode verify-terminal-state
```

The Gemini terminal state is intentionally superseded by OpenAI. Verify the Gemini stage before advancing, then use the OpenAI terminal contract and both original ledger vectors for final evidence. Do not replay Gemini against the final OpenAI state.

## Local checks and rollout

```sh
node --test backend/bin/tests/deepmerge-security.test.mjs
node --test apps/web/scripts/__tests__/verify-overseas-map-startup-evidence.test.mjs
python3 backend/supabase/tests/storyboard_openai_execution_integration.py
python3 backend/supabase/tests/storyboard_release_manifest_integration.py
cd apps/web && bun test tests-unit/storyboard-production-successor.test.ts tests-unit/supabase-migration-apply-source.test.ts tests-unit/supabase-migration-transaction.test.ts
```

The isolated PostgreSQL rehearsal has no network, published ports or persistent volumes. It exercises both successful ledgered transitions and prior/terminal mismatch rollback. Its PostgreSQL 17.11 image is not represented as the hosted PostgreSQL 17.6 server; exact metadata preimages must also match the live target.

Before promotion, save current deployment/alias IDs and the actual rollback SHA; build only the protected merged Git SHA with `TZUDONG_APPROVED_PRODUCTION_SHA` matching it and keep automatic custom-domain assignment off. Apply and read back the admitted SQL, then promote the same verified staged production deployment. Confirm Vercel SHA, both production aliases, `/api/health`, authenticated admin reads and public-page behavior.

A frontend deployment does not provision or prove a continuously running provider worker. Keep OpenAI keys on the outbound worker, never in the browser or repository. Worker health, model calls and recurring paid execution are distinct acceptance stages; do not consume additional paid calls beyond the operator's explicit budget.
