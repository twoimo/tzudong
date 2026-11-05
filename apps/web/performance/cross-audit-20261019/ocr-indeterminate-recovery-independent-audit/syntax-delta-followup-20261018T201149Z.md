# Recovery 108 raw syntax delta follow-up

Observation boundary: `2026-10-18T20:11:49Z`  
Repository HEAD: `cfba8fbbf532c0337c8443c719e5b0d7bf9baf48`  
Mode: read-only byte and manifest continuity review. No tests, database, app, provider, browser, network, Git, or shared-source mutation was performed.

## Historical failure preserved

The previous raw migration at SHA-256 `c2c93eb5c605ae9191961b2eda2c37ed2ce285f4982cdd389b90fba0cb9c47c9` was not valid source. PostgreSQL 15 and PostgreSQL 17 independently stopped while parsing statement 27 at the unparenthesized PL/pgSQL boolean `OR CASE ... END`. This is a real historical source defect and is not retroactively closed by the earlier source-only audit. The local PG15 failure receipt remains at `apps/web/performance/cross-audit-20261019/ocr-indeterminate-recovery-db-verification/initial-pg15-parser-failure.json`; the prior source snapshot remains immutable under `catalog-replay-108-candidate-20261018T195753Z/source-tree`.

New PostgreSQL execution proof for the corrected source is still in progress and is not claimed here.

## Exact raw-source delta

The immutable prior source snapshot is 62,723 bytes and hashes to `c2c93eb5c605ae9191961b2eda2c37ed2ce285f4982cdd389b90fba0cb9c47c9`. The current source is 62,725 bytes and hashes to `abc1cb12005e84ad49e40e04c35ab388289772938ba4ccc8882c58a6c61687ed`.

The unified byte-source diff contains exactly these two inserted characters and no other line change:

```diff
-    OR CASE WHEN pg_catalog.jsonb_typeof(p_model_policy) = 'array' THEN
+    OR (CASE WHEN pg_catalog.jsonb_typeof(p_model_policy) = 'array' THEN
...
-    END
+    END)
```

This only groups the existing CASE boolean expression so PL/pgSQL parses the surrounding `IF ... OR (...)`. It does not change the model-policy conditions, recovery state transitions, binding fields, leases, locks, privileges, or caller contracts reviewed in the prior final candidate audit.

## Manifest continuity

The manifest changed only in the content-derived identity fields:

| Field | Previous | Current |
| --- | --- | --- |
| migration SHA-256 | `c2c93eb5c605ae9191961b2eda2c37ed2ce285f4982cdd389b90fba0cb9c47c9` | `abc1cb12005e84ad49e40e04c35ab388289772938ba4ccc8882c58a6c61687ed` |
| statement count | `77` | `77` |
| statement vector | `4653fc0b8abb888aa292de90f3b1890f6559651784fccf996203441c598ca7c7` | `f15589b33081288f7df1efa53e7701a89188668f9c6c9c3fea630e1d3ace0183` |
| migration identity root | `000bcd37da2a678ac81ef9f64c9aad9b6edc704f3fa6ee2233dba1f25790c320` | `5dcbc3b5d34817302bebc6bbf28ec16b6fdf416cd52d38cf8c9068614f2e1931` |
| predecessor identity root | `cd04aebfc1efcc5588486adf3b7ba47fc5b5b76e39a9c23e316768f2919d9e` | unchanged |
| target identity root | `6022f66550a66cf7e402b3dc731338ab5e8dfeef56dcccdeee1e138526311f79` | `dd1dfb6c3a4c80cc1863322b7cf36d902195756ae8ef396064b270b1cfb717c0` |

The current manifest hashes to `fec7a54c676a758e9e6d68ed565a958ebe66c5f25c399ec64f9a7ab67064179f` and contains the current migration SHA, vector, migration identity root and target identity root exactly.

The compiler remains byte-identical at `740d03fd882fb8f74d89615ea3fe2279f67eee7cc98d507587148ba106f058ac`. The SQL fixture remains byte-identical at `095128056aa744abec6daf42d062cc2d2026673f18f7efb88855f580b47a4940`. The application, workflow and TypeScript source hashes remain the same as the `2026-10-18T19:59:54Z` final candidate audit.

## Finding continuity

All source-level decisions from `final-candidate-audit-20261018T195954Z.md` remain unchanged because the corrected bytes only make the already-reviewed validation expression parsable. No new bypass, lock-order change, policy change, privilege change or data-lifecycle change was introduced by this delta.

The current decision is therefore:

- Historical raw SHA `c2c93eb5...`: rejected as a reproduced PostgreSQL 15/17 parser failure.
- Current raw SHA `abc1cb12...`: two-byte parser correction and internally coherent source/manifest identity update; prior source findings remain valid.
- Corrected-source PostgreSQL behavior: unverified by this audit and pending the separately owned PG15/17 proof.
