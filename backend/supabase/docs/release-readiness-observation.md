# Read-only release observation

`release_readiness_observation.sql` collects only bounded catalog and configuration metadata. It uses the canonical `privacy_retention` schema, not historical pre-move `public` table names. Run it in a read-only transaction through an already authorized project connection. The Python `collect(connection)` helper starts a repeatable-read, read-only transaction before its first query and always rolls back and closes the supplied connection.

The output contains the currently effective published policy tuple (only a boolean for the approval reference), ledger count/terminal version, six workflow-related retention-class configuration flags, three private-table RLS/FORCE-RLS flags, and aggregate counts of unvalidated public constraints and non-extension public functions with mutable search paths. Audit classes must match the audit resolver's data-class/event trigger contract; operational notifications require complete configuration without imposing that audit-only trigger contract.

`validate(observation)` rejects unknown fields, duplicate identities, non-boolean flags, invalid types, inconsistent empty-ledger metadata, and a write-enabled transaction. `collect(connection)` returns **unbound metadata**, including for local regression databases. It cannot establish hosted provenance. `receipt(connection, source_sha=...)` instead owns collection on that same connection and issues a version-2 receipt only when the active psycopg 3 connection uses the exact project-specific direct endpoint `db.aqlcofblfxdrjhhdmarw.supabase.co`, database `postgres`, port 5432, active TLS, and `sslmode=verify-full`. Poolers, local/staging endpoints and caller-provided project labels are not accepted. This does not create credentials or broaden connection authorization.

Before querying, the receipt helper resolves a real Git commit and compares both its SQL and executor blobs with the SQL captured for execution and the loaded executor bytes. Git replacement objects are disabled. It executes the captured SQL bytes, rather than reopening a possibly changed file, and checks the connection identity again after the snapshot. Source/target rejection still rolls back and closes the connection. The returned metadata retains only a bounded endpoint identity, SQL/executor hashes, source revision and observation; it does not retain connection strings, roles, certificate paths or other connection parameters. Preserve the receipt outside the checkout with its hash recorded separately.

Version-1 receipts accepted raw observations and caller-provided source/project labels and therefore do not independently prove target or source provenance. Do not promote such receipts to version 2 by editing fields; collect fresh evidence through the verified connection path. Existing separately retained MCP project-call evidence remains distinct from this Python receipt contract.

A populated approval reference is not proof that the referenced approval exists or is valid. These observations do not establish named legal review, lawful retention periods, backup/PITR coverage, generated-type/catalog parity, complete RLS correctness, provider delivery, release approval, or authority to write. Do not activate all disabled classes: some may not apply to this service. Investigate the actual affected workflow and approved configuration first. No credentials, user rows, raw approval references or provider diagnostics are collected.

Local regression:

```text
TZUDONG_TEST_POSTGRES_BIN=/path/to/postgres/bin python -m unittest backend.supabase.tests.test_release_readiness_observation
```

The fixture uses an isolated temporary Unix-socket PostgreSQL cluster and never connects to a hosted database. Fixture retention periods are test data, not production recommendations.

Transport success tests use explicit mocks and real temporary Git commit objects. They validate admission and denial behavior, not a hosted TLS connection. A real local PostgreSQL test proves that a local observation cannot receive a production receipt.
