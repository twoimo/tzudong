# Fresh operating schema: isolated PG17 readiness

The current ledger-80 schema was read through libpq with `verify-full` TLS 1.3. Schema, the three structural G014 contract tables, roles/memberships, extensions, attributes and selected platform settings were bound to one exported repeatable-read snapshot. No user rows or hosted migration ledger rows were copied. Private snapshot SQL and role data remain outside Git; the report retains bytes and hashes.

## Verified local result

The exact pending three source migrations passed against a restored PG17.6 clone using the pinned Supabase image. Their hashes remained unchanged. The baseline has the newly registered public leaderboard RPC, and the test checks its body, result, owner, ACL and allowlist before/after the new migrations.

- 37 role attributes/configurations and 29 grantor-specific memberships checked against the fresh source.
- All 11 extension versions, schemas and owners checked; the strict test initially rejected two incorrect owners.
- Declared clone-only projections: eight argument OID rows, seven dropped-column physical positions and one exact Boolean associativity definition. Literal/nonexpression preimages and all 27 three-valued Boolean cases were checked.
- Four G014 assertions passed after reconstruction, after the normal-runtime restart and after migration replay.
- The metadata manifest remains 1,963 rows; immutable trigger stays active. Assertion body/owner/ACL/config checks use both directions.
- Nine private table/role permission rows passed. All three private tables retain RLS; anon/authenticated have no SELECT/INSERT/UPDATE/DELETE access.
- Source-role migration execution preserved memberships, immutable manifest and the public leaderboard; both temporary registration helpers were removed in the applying session.
- Transaction rollback preserved the complete tracked state and schema hash: `86483b07893d0869029dbd04bcc92f7c3d5491152ce02eedaa6630f91a00a0d0` before and after.

These are fixed contract checks and deterministic fault/rollback observations. They are not independent statistical samples, so a 95% confidence interval or operating performance improvement is not inferred.

## Preparation failures and restoration method

The original helper exported schema and metadata separately and did not execute all its JavaScript preimage checks when reusing a SQL substring. New helpers verify the full snapshot manifest, actual image/container ownership and preimages before preparation, and preserve all failed attempts.

The first role bootstrap encountered reserved engine roles. Those 15 roles are now verified against the pinned engine rather than altered. A strict later check caught `SET FROM CURRENT` normalizing a timeout's stored unit representation; the raw setting was restored without relaxing role comparison.

The ordinary image delegates extension creation through supautils. Two extension owners therefore differed from the operating schema even when creating under the intended role; tests rejected the mismatch. Source platform settings were first matched, but that alone did not correct the creation behavior. Official supautils tests also describe delegation for a superuser.

Restoration uses a **temporary bootstrap container** with extension delegation disabled. The schema/contract snapshot is restored, all logical ownership and contract checks pass, then its owned named data volume is moved to a new container with the same pinned image and the normal source platform settings. The full source extension whitelist and selected settings are checked for exact equality before any migration replay. No operating setting or privilege was changed. The bootstrap configuration is not used as the migration execution environment.

## Current production reference and remaining gates

The Vercel project ID, `twoimo/tzudong`, main branch, production target and live aliases were verified. Current production is `f31904e6dca2d9b608259cf150c5d0894db0928e`, deployment `dpl_HXG5n1x3k4E2PBA4Vf4pEvXcqfye`, READY. This is a verified reference, not a release performed by this task.

The current production source predates the retirement of non-Gemini RAG/legacy execution paths. It must not be treated as a policy-safe storyboard rollback without a reviewed feature hold or compatibility patch.

Remaining before operating application: valid-user synthetic flows in this complete schema, a fresh operating preflight immediately before apply, policy-safe rollback, protected promotion/CI and actual deployed service verification. Storage provider admission is a separate unresolved operating dependency. No operating DB migration, deployment, billed inference or full-goal completion is claimed here.

## Valid action flow contradiction

The subsequent full-schema synthetic action fixture failed with SQLSTATE 42501. The first denied nested helper was `public.is_user_admin(uuid)` while the caller was the existing `privacy_workflow_owner` definer approval routine. A transaction-local grant to that owner passed all four G014 assertions, but the flow then failed on `public.canonicalize_youtube_link(text)`. Both probes rolled back. These findings contradict functional readiness despite the preceding structural/ACL/rollback passes. Operating application is not ready. Audit the precise owner-only helper dependency set and test it without exposing an arbitrary-user administrator oracle to public/authenticated/service Data API roles.
