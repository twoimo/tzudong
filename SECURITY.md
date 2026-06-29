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

Do not access, modify, delete, or exfiltrate data that does not belong to you. Do not run destructive tests, high-volume scans, credential stuffing, or provider-cost amplification. Use local reproduction where possible.
