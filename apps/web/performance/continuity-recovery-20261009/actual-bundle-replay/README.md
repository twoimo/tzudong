# Actual four-migration bundle replay

Status: passed on an isolated, image-pinned PostgreSQL 17.6 cluster with network mode `none` and no published ports.

The replay reconstructed the canonical full-schema snapshot after exact byte/hash, role and membership admission. It then cloned two disposable databases with the same three-row local synthetic ledger prefix. The terminal-mismatch database ran the current four source migrations through `supabase-migration-bundle.mjs`, failed at the expected final readback with `P0001 / MIGRATION_TERMINAL_READBACK_FAILED`, and retained the exact preimage schema, roles, metadata and zero target ledger rows. The success database committed the exact four source/vector rows, retained the three-row prefix, passed all four G014 assertions, and preserved legacy function metadata plus role membership.

The post-commit synthetic checks covered six guarded admin-record flows and five manual-preview/tick cases. Both fixture groups rolled back exactly. The source, mismatch and success databases, container, volume and temporary patched bootstrap scripts were removed.

This is local synthetic full-schema evidence. It is not a hosted apply, deployment receipt, operating database readback, production preimage, user-flow proof or legal/compliance evidence. Snapshot metadata reports 80 hosted ledger rows, but none were copied; the replay prefix was generated locally and is labeled accordingly.

`attempt-1` preserves the bounded first-run failure. It stopped at `BOOTSTRAP_PLATFORM_SETTINGS_DRIFT`, after which all owned resources were removed. The successful run used the canonical two-phase runtime contract: extension delegation disabled during reconstruction, then the same owned volume restarted with source runtime settings before replay.
