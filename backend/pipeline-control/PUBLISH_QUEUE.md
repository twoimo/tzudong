# Admin publication queue consumer

The web admin POST enqueues only. Run the backend consumer from the repository
root with `python -m backend.pipeline_control.publish_queue run`. Install the
pinned `backend/pipeline-control/requirements.txt` first. The consumer polls
requested and explicitly confirmed jobs every five seconds and stops on SIGTERM.
It never auto-confirms a preview.

Set `TZUDONG_PUBLISH_QUEUE_ENABLED=1` and provide `PIPELINE_CONTROL_DSN` for the
local loopback database. Apply the local-only schema migrations through the local
migration procedure. The committed Publication_Set and publish schedule must
carry active operator approval. An unresolved ledger produces a durable failed
queue status without reading or publishing source rows.

`TZUDONG_PUBLICATION_DSN` identifies the destination. For an isolated test use
`TZUDONG_PUBLICATION_DATA_ENV=local_db` with another loopback database. For hosted
operation use `hosting_db`: the exact project, `sslmode=verify-full`,
`TZUDONG_HOSTED_DATA_PLANE_APPROVED=1` and an explicitly cleared
`G037_WRITE_FREEZE` are mandatory. These variables do not establish external
release evidence; leave the current hosted freeze in place until its gates pass.
Supply credentials through the operator's secret manager, never CLI arguments or
committed files.

The consumer prints only the job ID, preview hash, row count, bounded state and
result code. Review the preview and confirm that exact job/hash from a separate
backend terminal with:

```sh
python -m backend.pipeline_control.publish_queue confirm --job-id <job-uuid> --preview-hash <sha256>
```

For one-shot operation, replace `run` with `preview` or `apply`. The 900-second
expiry is measured from the persisted preview time; confirmation does not extend
it. Source values are loaded again and must reproduce the preview hash. The
consumer only selects the two fixed publication tables and approved columns,
bounded to 10,000 rows per table. Larger sets fail closed for an explicit bounded
partition; they are never silently truncated.

Each apply claim commits before any destination mutation. Competing consumers
cannot claim the same request. Completed batches are read back and audited even
when a later batch aborts. The final state and remaining audit/history commit
together. An interrupted `applying`/`readback` job is deliberately not retried:
reconcile destination state and retained receipts before creating a new job.

Agent terminal results use the additive local-only migration
`20260905000100_local_agent_terminal_results.sql`. `PostgresAgentActionStore`
appends one result and reads it back using a transaction-committing scalar
executor. Both reservation and result tables deny service-role UPDATE/DELETE;
`local_analytics.agent_action_state` joins the durable outcome for readers.
A failed terminal write halts the trigger and never returns a successful action.

Local PostgreSQL integration tests create and destroy their own cluster, private
Unix socket and database. They do not use an existing Supabase installation:

```sh
TZUDONG_TEST_POSTGRES_BIN="$(pg_config --bindir)" python -m unittest backend.pipeline_control.test_publish_queue_postgres -v
```
