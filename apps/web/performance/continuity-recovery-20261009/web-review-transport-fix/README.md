# Web review transport fix evidence

This directory records a local, isolated transport proof for the two real `psql` entry points. It contains no hosted write, provider call, database credential, session material, raw OCR, personal row, cookie, request header, or provider diagnostic.

## Result

- Both runners now pass SQL as `--file=-`, so PostgreSQL 17.6 applies `--single-transaction` to the stdin script.
- The database URI is absent from the child argument vector. The URI is parsed into a scoped libpq environment after inherited `PG*` connection overrides are removed.
- The successor target gate accepts only the exact project direct endpoint or an official shared Supabase pooler hostname with its project-bound user, approved port, database, and TLS mode. URI redirection keys, aliases, malformed escapes, fragments, wrong ports, wrong users, wrong projects, and arbitrary hosts are rejected.
- An exact PostgreSQL 17.6 Unix-socket-only fixture invoked both exported runner entry points. For each runner, `SET LOCAL` and `LOCK TABLE` succeeded inside the wrapper transaction; an injected terminal exception rolled back both a newly created table and a ledger insert; the corresponding success case committed both.

## Evidence boundary

`runtime-proof.json` is local runtime evidence for transport semantics only. It does not prove hosted Supabase state, a deployment, production traffic, the complete five-stage migration, or operating writer stops.

The existing exact-five-stage proof remains frozen evidence from commit `c90544c813a89b077084953e42fb1431a4b1efed`. It must not be rebound to the edited runner sources. A later current-source amendment may link that frozen generator/full-schema proof to this transport proof after source review.

At proof capture, the checked-in successor manifest was intentionally unchanged. Its pinned toolchain hashes did not match the edited parser and runners, so production loading failed closed with `SUCCESSOR_SOURCE_DRIFT`. After all source changes stabilize, a serialized release step may refresh only those toolchain pins and record a separate current-source amendment. The successor remains held regardless of that refresh.

## Remaining admission requirement

Hash-shaped admission fields are structural validation only. Release readiness still requires private, canonical receipt files whose bytes are bound by SHA-256 and whose current readbacks identify the protected source revision, rollback deployment revision and URL, each named writer fence and state, observation time, project identity, and expiry. The controller must re-read those operating facts immediately before execution. Existing reviewers, protected-branch policy, and signing authorities must be reused; this work does not invent a signer, key, reviewer, or external receipt.

## Official contracts used

- PostgreSQL 17 `psql`: <https://www.postgresql.org/docs/17/app-psql.html>
- PostgreSQL 17 libpq environment variables: <https://www.postgresql.org/docs/17/libpq-envars.html>
- PostgreSQL 17 connection strings: <https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-CONNSTRING>
- Supabase database connections: <https://supabase.com/docs/guides/database/connecting-to-postgres>

