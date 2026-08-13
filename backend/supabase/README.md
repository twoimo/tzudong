# Tzudong local Supabase

This directory contains Tzudong's pinned, local-only 14-service Supabase stack.
For the repository-owned lifecycle, migration, seed, receipt, schema-type, and
nightly commands, use [the nightly operations runbook](../../docs/operations/nightly-regression.md).

The generic files below came from the upstream self-hosted Compose distribution,
but `docker compose up` by itself is not the supported Tzudong entry point.
`scripts/local-stack.py` binds the project to the repository path, generates
owner-only credentials, rejects remote Docker contexts and cloud URLs, and
checks every service before admission. The stack is for local development and
synthetic regression fixtures; it is not a production deployment or a hosted
data backup.

`scripts/local-seed.sql` includes a deterministic privacy-policy and age-profile
fixture solely so the synthetic nightly administrator can exercise protected
local routes. Its `operator_approval_ref` is explicitly marked
`LOCAL_TEST_ONLY:NOT_PRODUCTION`; the row is not hosted publication evidence,
operator or legal approval, a production consent record, or permission to copy
the fixture into any hosted environment. Local readback proves only that this
disposable fixture has the exact source-bound shape expected by the regression
stack.

The seed also includes one deterministic YouTube channel KPI snapshot whose
title and `source` are marked `LOCAL_TEST_ONLY:NOT_PRODUCTION`. It exists only
to exercise the local no-provider-key fallback; it is not a successful YouTube
API fetch, hosted analytics evidence, or a production channel measurement.

The admin restaurant map-overlay write path remains a service-role-only,
`SECURITY DEFINER` RPC. Its owner has no `auth` schema access: the function
checks the bounded PostgREST JWT role claims through `pg_catalog` settings and
has only the overlay/audit table operations its body needs. Existing guarded
server preview/read routes retain direct `service_role` SELECT on the overlay
table; direct service mutations and all direct audit-table access remain
revoked, while `anon` and `authenticated` have no direct overlay access. The
local behavior probe performs an apply and identical idempotent replay inside a
transaction that is rolled back, so it creates no persistent hosted or local
operator evidence.

Public nickname and avatar reads remain behind the bounded
`read_public_profile_summaries`, `read_public_profile_leaderboard`, and
`read_public_profile_leaderboard_page` RPCs.
They expose no email, role, login, or arbitrary profile columns; direct
`profiles` reads stay revoked for browser roles. Summary requests admit 1–100
distinct non-null UUIDs and preserve input order. The leaderboard admits only
`all` or `monthly`, caps results at 100, uses the Asia/Seoul calendar-month
boundary, and breaks equal scores by user UUID. The page RPC admits only a
paired non-negative finite numeric score and UUID cursor, then continues
strictly after that score/UUID tuple. The local SQL probes verify multiple
pages, ties, zero-review inclusion, malformed cursor denial,
anon/authenticated access, and service-role/direct-table denial inside rolled
back transactions; they are not hosted migration or deployment evidence.

`local-inputs/functions/naver-geocode/index.ts` is the deterministic local-only
replacement for the hosted Naver geocoder. It returns only coordinates for the
two synthetic seeded restaurants, never reads provider credentials, and never
makes a provider or other network request. The repository lifecycle stages it
beside the `main` Edge Function in a read-only volume and admits the functions
service only after both endpoints pass their bounded readiness probes. This
fixture is not evidence that the hosted Naver integration is configured or
operational.

The manifest-bound local Kong input is the browser CORS boundary for Auth,
PostgREST, Storage, and Edge Functions. It admits only the development and
nightly app origins `http://127.0.0.1:8080`, `http://localhost:8080`,
`http://127.0.0.1:18080`, and `http://localhost:18080`, uses a bounded
per-service method/header set, and never uses a wildcard origin. Auth preserves
GoTrue's credentialed-response contract only for those four exact origins;
PostgREST, Storage, and Edge Functions explicitly disallow credentialed CORS.
The Naver fixture itself emits no CORS policy so it cannot disagree with the
gateway. Stack readiness proves each admitted origin through
both `127.0.0.1` and `localhost` gateway targets, proves an unlisted origin gets
no allow-origin header, and checks the actual response headers. Realtime does
not use HTTP CORS; its project-scoped tenant alias and `/socket` upstream are
admitted only after a real Phoenix channel joins and receives its own bounded
ephemeral broadcast. These are local development controls, not hosted CORS or
Realtime deployment evidence.

The local Storage container uses a separate, generated owner-role token held in
its owner-only `stack.env`. Its internal completion transaction runs as
`supabase_storage_admin`, the owner of the private Storage relations, while the
ordinary `service_role` token used by the web and Data API remains unchanged
and retains G014's direct `storage.objects` revocation. The raw
`STORAGE_SERVICE_KEY` name is never forwarded to an application child process.
The strict local development wrapper selectively maps its value to
`SUPABASE_STORAGE_SERVER_KEY` only in a local Next server process for
server-side Storage calls, including the server started by the local nightly
runner. Both names are excluded from browser/public variables and the
Playwright child environment; the token is also excluded from Kong, receipts,
and publication artifacts. Authenticated browser writes still pass their
existing bucket, own-UUID path, MIME, and size checks before Storage performs
its internal completion work; this local boundary is not hosted configuration
or production access evidence.

# Upstream self-hosted Supabase notes

This is the official Docker Compose setup for self-hosted Supabase. It provides a complete stack with all Supabase services running locally or on your infrastructure.

## Getting Started

Follow the detailed setup guide in our documentation: [Self-Hosting with Docker](https://supabase.com/docs/guides/self-hosting/docker)

The guide covers:
- Prerequisites (Git and Docker)
- Initial setup and configuration
- Securing your installation
- Accessing services
- Updating your instance

## What's Included

This Docker Compose configuration includes the following services:

- **[Studio](https://github.com/supabase/supabase/tree/master/apps/studio)** - A dashboard for managing your self-hosted Supabase project
- **[Kong](https://github.com/Kong/kong)** - Kong API gateway
- **[Auth](https://github.com/supabase/auth)** - JWT-based authentication API for user sign-ups, logins, and session management
- **[PostgREST](https://github.com/PostgREST/postgrest)** - Web server that turns your PostgreSQL database directly into a RESTful API
- **[Realtime](https://github.com/supabase/realtime)** - Elixir server that listens to PostgreSQL database changes and broadcasts them over websockets
- **[Storage](https://github.com/supabase/storage)** - RESTful API for managing files in S3, with Postgres handling permissions
- **[imgproxy](https://github.com/imgproxy/imgproxy)** - Fast and secure image processing server
- **[postgres-meta](https://github.com/supabase/postgres-meta)** - RESTful API for managing Postgres (fetch tables, add roles, run queries)
- **[PostgreSQL](https://github.com/supabase/postgres)** - Object-relational database with over 30 years of active development
- **[Edge Runtime](https://github.com/supabase/edge-runtime)** - Web server based on Deno runtime for running JavaScript, TypeScript, and WASM services
- **[Logflare](https://github.com/Logflare/logflare)** - Log management and event analytics platform
- **[Vector](https://github.com/vectordotdev/vector)** - High-performance observability data pipeline for logs
- **[Supavisor](https://github.com/supabase/supavisor)** - Supabase's Postgres connection pooler

## Documentation

- **[Documentation](https://supabase.com/docs/guides/self-hosting/docker)** - Setup and configuration guides
- **[CHANGELOG.md](./CHANGELOG.md)** - Track recent updates and changes to services
- **[versions.md](./versions.md)** - Complete history of Docker image versions for rollback reference

## Updates

To update your self-hosted Supabase instance:

1. Review [CHANGELOG.md](./CHANGELOG.md) for breaking changes
2. Check [versions.md](./versions.md) for new image versions
3. Update `docker-compose.yml` if there are configuration changes
4. Pull the latest images: `docker compose pull`
5. Stop services: `docker compose down`
6. Start services with new configuration: `docker compose up -d`

**Note:** Consider to always backup your database before updating.

## Community & Support

For troubleshooting common issues, see:
- [GitHub Discussions](https://github.com/orgs/supabase/discussions?discussions_q=is%3Aopen+label%3Aself-hosted) - Questions, feature requests, and workarounds
- [GitHub Issues](https://github.com/supabase/supabase/issues?q=is%3Aissue%20state%3Aopen%20label%3Aself-hosted) - Known issues
- [Documentation](https://supabase.com/docs/guides/self-hosting) - Setup and configuration guides

Self-hosted Supabase is community-supported. Get help and connect with other users:

- [Discord](https://discord.supabase.com) - Real-time chat and community support
- [Reddit](https://www.reddit.com/r/Supabase/) - Official Supabase subreddit

Share your self-hosting experience:

- [GitHub Discussions](https://github.com/orgs/supabase/discussions/39820) - "Self-hosting: What's working (and what's not)?"

## Important Notes

### Security

⚠️ **The default configuration is not secure for production use.**

Before deploying to production, you must:
- Update all default passwords and secrets in the `.env` file
- Generate new JWT secrets
- Review and update CORS settings
- Consider setting up a secure proxy in front of self-hosted Supabase
- Review and adjust network security configuration (ACLs, etc.)
- Set up proper backup procedures

See the [security section](https://supabase.com/docs/guides/self-hosting/docker#configuring-and-securing-supabase) in the documentation.

## License

This repository is licensed under the Apache 2.0 License. See the main [Supabase repository](https://github.com/supabase/supabase) for details.
