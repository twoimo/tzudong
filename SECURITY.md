# Security Policy

Tzudong Map is a public repository for a map-first restaurant discovery product, an admin review console, and AI-assisted storyboard tooling. Security reports are handled privately first so public users, data, credentials, and deployment infrastructure are not exposed during triage.

## Supported versions

| Version / branch | Status |
| --- | --- |
| `main` | Supported |
| Latest GitHub release | Supported |
| Older tags and feature branches | Best-effort only |

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** flow from the repository Security tab when available. If that is not available for your account, open a minimal public issue that says a private security report is needed, but do **not** include exploit details, secrets, tokens, database rows, screenshots with private data, or proof-of-concept payloads in the public issue.

Please include privately:

- Affected surface: public map, `/admin`, API route, Supabase/RLS, backend pipeline, storyboard/AI provider flow, or dependency chain.
- Impact and exploitability.
- Minimal reproduction steps.
- Any affected commit, release, route, or command.
- Whether credentials, personal data, Supabase service-role access, provider API keys, or stored user content may be exposed.

## Scope

Security-sensitive areas include:

- Authentication, admin authorization, bypass tokens, and session middleware.
- Supabase Row Level Security, service-role boundaries, RPCs, and migration contracts.
- Public API routes and guarded `/api/admin/**` handlers.
- File, URL, media, OCR, storyboard, and AI-provider inputs that could trigger SSRF, path traversal, prompt/data leakage, credential exposure, or excessive provider spend.
- Dependency and supply-chain vulnerabilities that are reachable in production or development workflows.

## Out of scope

- Vulnerabilities that require already-compromised administrator credentials unless they expose a broader privilege boundary.
- Automated scanner output without a reachable impact explanation.
- Social engineering, physical attacks, spam, or denial-of-service tests against production services.
- Reports that require exposing secrets or destructive testing.

## Response expectations

This project is maintained on a best-effort basis. Valid reports are triaged by severity, fixed in the supported branch, and disclosed through a commit, release note, or advisory when appropriate. There is currently no paid bug bounty program.

## Safe testing rules

Do not access, modify, delete, or exfiltrate data that does not belong to you. Do not run destructive tests, high-volume scans, credential stuffing, or provider-cost amplification. Use local reproduction where possible. Load testing requires authorization, bounded non-production scope, explicit stop conditions, rollback planning, and readback receipts.
## Package and compiler authority

Node 24.x is the web runtime. Bun remains supported for day-to-day install and unit flows, but npm 11.6.2, `package.json`, and `package-lock.json` are the release package authority; reconcile `bun.lock` with them. The native TypeScript CLI is the exact `@typescript/native` alias at `7.0.2`, with TypeScript `6.0.2` as the stable API/compatibility bridge. Use the explicit parity and benchmark package scripts, never a global compiler.

## Personal-data and communications controls

G010/G013/G014 source safeguards treat personal-data and advertising operations as fail-closed security boundaries:

- Account creation is bound to a short-lived, signed onboarding challenge and the exact published policy version, locale, content hash, effective time, publication time, and operator approval readback.
- Unsupported under-14 registration is blocked before account creation. A date of birth, guardian contact, or resident registration number must not be collected as a fallback; resident registration numbers are prohibited unless a separately verified statutory basis and approved design are introduced.
- Ordinary marketing consent is purpose- and channel-specific. Advertising between 21:00 and 08:00 requires a separate `night_marketing` grant for the same channel.
- Logs, audit records, responses, and evidence must not contain passwords, credentials, cookies, session/onboarding tokens, email addresses, phone numbers, resident registration numbers, precise location, raw OCR, arbitrary bodies, provider diagnostics, or free-form errors. Use the shared bounded sanitizer and fixed codes/count-only metadata.
- Privileged privacy RPCs stay behind fixed `search_path`, explicit grants, RLS, `requireAdmin`, or a scheduler-only capability as appropriate. Browser/session credentials are rejected by the internal retention route.
- Account deletion requires recent reauthentication, a stable preview hash, exact typed confirmation, last-admin and legal-hold checks, readback, minimized append-only audit, authoritative session revocation, database cleanup, and Auth deletion last.
- Retention and legal-hold work uses active operator-approved classes only. Application code cannot invent a period or legal basis, and holds cannot silently expand purpose.
- Incident records use bounded structured fields and one operation ID across confirmed, applied, and readback events. A named human owns any authority or affected-person notice and its external submission/receipt evidence.

## Privacy incident reporting

Report suspected personal-data exposure through the private vulnerability channel above. Include only the minimum route, time, fixed category/status, affected-count range, and safe reproduction information. Do not attach live credentials, personal data, raw database rows, precise coordinates, raw OCR, or provider payloads.

## External production evidence

Source safeguards do not prove statutory compliance, policy publication, a government filing, production deployment, legal approval, or hosted-state correctness. Release remains blocked pending external evidence of:

- exact policy publication/version/hash/locale/effective/published tuple and Korean legal/privacy-owner review;
- location-business filing or documented non-applicability;
- guardian/provider approval before enabling under-14 support;
- named human incident submission and receipt;
- operator-approved retention classes, legal basis, trigger, period, activation, hosted backup/PITR, and operator evidence;
- approved HTTPS marketing provider, production secrets, and internal capability controls; and
- hosted production migration, RLS/grant, RPC, generated type, catalog, key-management, and operator-access readback.

The dirty original worktree remains immutable; use an isolated recovery candidate and never reset, stash, or clean. Serialized fresh-head content-patch PRs follow `develop -> data -> main` under external approval and branch protection. Before any Vercel action, verify the exact Git-integrated `tzudong` project; do not use a stale `web` project or mutate DNS. A release or rollback needs approval, branch-protection evidence, rollback planning, and deployment readback receipt. No merge or deployment is claimed here.
