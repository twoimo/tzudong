# SQL-standard function-body parser review

This evidence covers only `statementSpans` in `apps/web/scripts/supabase-migration-transaction.mjs`.

PostgreSQL 17 documents an unquoted SQL-language function body as either `RETURN expression` or a `BEGIN ATOMIC ... END` block. PostgreSQL lexical comments separate tokens like whitespace. The parser now follows those two boundaries without changing any returned source bytes:

- `CASE ... END` and nested `CASE` expressions no longer close the enclosing atomic body.
- an identifier ending in `end`, such as `weekend`, no longer closes the body.
- comments may separate `BEGIN` and `ATOMIC`.
- parentheses, quoted strings, dollar strings, nested comments, and meta-command denial keep their existing behavior.

Official references checked on 2026-10-09:

- https://www.postgresql.org/docs/17/sql-createfunction.html
- https://www.postgresql.org/docs/17/sql-syntax-lexical.html
- https://supabase.com/changelog.md

The pinned Supabase CLI v2.109.1 `SplitAndTrim` port remains immutable. It mis-splits all three reviewed edge classes (`CASE ... END`, an `end` identifier suffix, and comment-separated `BEGIN ATOMIC`). The local parser intentionally does not replace that provider vector. Existing reviewed migration sources remain byte-for-byte and vector compatible; a future migration containing the provider limitation still fails closed with `MIGRATION_VECTOR_MISMATCH` until the provider vector contract is explicitly revised.

Verification:

- Bun targeted parser test: 20 passed, 0 failed, 119 assertions.
- Bun parser plus four-stage bundle tests: 31 passed, 0 failed, 271 assertions.
- PostgreSQL 17.6 (`server_version_num=170006`) disposable cluster: four functions created; four semantic assertions passed; the cluster was stopped and deleted.
- Existing reviewed source/vector parity: 4 of 4 migration sources unchanged.
- Seven paired local samples over 100 parser calls each were statistically inconclusive: p50 was 40.736 ms before and 41.195 ms after (+0.459 ms, +1.13%); the paired mean speed change was -3.84% with a bootstrap 95% interval of [-14.38%, +8.87%]. No speed improvement is claimed.

No hosted database, provider, key, or operating state was accessed or changed.
