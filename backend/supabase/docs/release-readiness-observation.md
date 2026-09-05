# Read-only release observation

`release_readiness_observation.sql` collects only bounded catalog and configuration metadata. It uses the canonical `privacy_retention` schema, not historical pre-move `public` table names. Run it in a read-only transaction through an already authorized project connection. The Python `collect(connection)` helper starts a repeatable-read, read-only transaction before its first query and always rolls back and closes the supplied connection.

The output contains the currently effective published policy tuple (only a boolean for the approval reference), ledger count/terminal version, six workflow-related retention-class configuration flags, three private-table RLS/FORCE-RLS flags, and aggregate counts of unvalidated public constraints and non-extension public functions with mutable search paths. Audit classes must match the audit resolver's data-class/event trigger contract; operational notifications require complete configuration without imposing that audit-only trigger contract.

`validate(observation)` rejects unknown fields, duplicate identities, non-boolean flags, invalid types, inconsistent empty-ledger metadata, and a write-enabled transaction. `receipt(...)` binds the SQL hash, source revision, project and observation with a canonical SHA-256. The source revision must identify the exact reviewed SQL used for collection. Preserve the returned receipt outside the checkout with its hash recorded separately.

A populated approval reference is not proof that the referenced approval exists or is valid. These observations do not establish named legal review, lawful retention periods, backup/PITR coverage, generated-type/catalog parity, complete RLS correctness, provider delivery, release approval, or authority to write. Do not activate all disabled classes: some may not apply to this service. Investigate the actual affected workflow and approved configuration first. No credentials, user rows, raw approval references or provider diagnostics are collected.

Local regression:

```text
TZUDONG_TEST_POSTGRES_BIN=/path/to/postgres/bin python -m unittest backend.supabase.tests.test_release_readiness_observation
```

The fixture uses an isolated temporary Unix-socket PostgreSQL cluster and never connects to a hosted database. Fixture retention periods are test data, not production recommendations.
