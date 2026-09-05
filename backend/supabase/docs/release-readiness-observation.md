# Read-only release observation

The collector reads bounded catalog/configuration metadata from the canonical `privacy_retention` schema: policy tuple, ledger count/terminal version, six retention configuration flags, three private-table RLS flags, and aggregate catalog gaps. Raw approval references, user rows and provider diagnostics are excluded. `collect(connection)` is unbound metadata for diagnostics and local regression; it cannot issue a production receipt.

## Production receipt entrypoint

Run the launcher as a **source-file script in isolated Python mode** with the authorized psycopg 3 environment. It never imports the project executor through Python's timestamp-based bytecode cache. It reads the SQL, executor, CA and launcher blobs from an actual Git commit (replacement objects disabled), compares them with the checkout, and directly compiles/executes the captured executor bytes. The SQL bytes executed are those in the same verified bundle.

```text
/path/to/authorized/python -I backend/supabase/scripts/release_readiness_receipt.py --source-sha COMMIT --verify-source-only
/path/to/authorized/python -I backend/supabase/scripts/release_readiness_receipt.py --source-sha COMMIT --credentials-file /outside/checkout/credentials.json --output /outside/checkout/new-receipt.json
```

The credential input must be an owner-only regular JSON file outside the checkout, with exactly `user` and `password` fields. No connection strings, host addresses, CA files or TLS options are accepted. Do not create test credentials to satisfy an operator contract. The output path must be new and outside the checkout; it is written owner-only. Preserve its separately returned file hash out of band.

The launcher removes inherited `PG*` settings before connecting. The verified executor owns a fresh psycopg connection to `db.aqlcofblfxdrjhhdmarw.supabase.co:5432/postgres`, uses `verify-full` and the committed Supabase Root 2021 CA (DER SHA-256 `807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa`), and does not accept an already-connected handle. The CA is copied from the verified bundle into private temporary custody for that connection. Active TLS, the exact endpoint/database and a global peer address are verified before/after collection. Only a hash of the actual peer address is retained. Poolers and arbitrary caller trust anchors are not admitted. The approved CA and hostname validation, rather than caller-supplied connection metadata alone, authenticate the endpoint; this is not an attestation against compromise of Python, Git, the trusted dependency runtime or the host.

Both bound and unbound collection reject non-idle transactions before `BEGIN`. After beginning a fresh repeatable-read, read-only transaction, the collector independently verifies both settings before reading metadata. It rolls back and closes the owned connection on success and failure. An old read-only snapshot cannot be relabeled with a new observation timestamp.

Version-3 receipts bind the captured SQL/executor bytes, launcher source, commit, controlled trust anchor, verified endpoint, peer-address hash and observation. Version-1 and version-2 receipts do not independently establish all these bindings and must not be relabeled or accepted as version 3. Earlier independently retained MCP project-call evidence is separate from the Python receipt contract. No version establishes legal review, lawful retention periods, backup/PITR, full catalog/type parity, provider delivery, release approval or authority to write.

## Regression evidence

```text
TZUDONG_TEST_POSTGRES_BIN=/path/to/postgres/bin python -m unittest backend.supabase.tests.test_release_readiness_observation
```

Tests use a real disposable PostgreSQL cluster to reject an existing stale snapshot and then read a newly committed policy through a fresh connection. A real timestamp/size-matching poisoned `.pyc` is created to verify that the source-file launcher executes the committed source instead. Temporary Git commits verify source rejection. Transport success tests use mocks and are not hosted evidence; they verify owned connection options, pinned CA custody, wrong valid CA rejection, local-peer denial, isolation checks and cleanup. Fixture retention periods are never production recommendations.
