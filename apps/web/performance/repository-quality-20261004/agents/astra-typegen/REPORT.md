# Canonical nightly typegen diagnosis — 2026-10-04

## Result and exact scope boundary

Nightly `37197431551`, attempt 1, source `b12fc956de63e1b9d73ac812098107f5b3578903` successfully generated Supabase types, then failed the byte-diff gate. The exact output adds 397 lines, deletes zero, and adds seven storyboard production tables plus ten functions already defined by canonical migrations. It is not a generation-command failure. The later lane aggregate and diagnostics failures are not counted as separate defects here.

The task-owned source remains clean at `7a430454cf90a4d9f1ba0ce35ad3ffd5022ceebd`, branch `codex/local-type-catalog-quality-20261004`, path `/Users/twoimo/.codex/worktrees/review-commit-recovery-20261004/tzudong`.

**Source application is pending a path-scope decision.** The user's write boundary names `apps/web/integrations/supabase/types.ts`, while the actual generated/compared file is `apps/web/integrations/supabase/database.types.ts`. The ready patch changes only the latter. No modification to the handwritten application `types.ts` would repair this gate. No SQL, workflow, guard, generator, package, lockfile, backend layout, application runtime or environment change is needed for the observed diff. This report does not claim the source or nightly is fixed.

The complete minimal patch is `nightly-37197431551-generated.patch`. `git apply --check` passes against the designated source. Applying it only in a disposable file tree changes the comparison with the exact generated output from exit 1 to exit 0. No source commit, push, PR operation or remote workflow operation was performed.

## Consumption and generation contract

- `.github/workflows/nightly-local-regression.yml:901` runs `bun run supabase:gen-types:local`; line 902 compares `integrations/supabase/database.types.ts` with `git diff --exit-code`.
- `apps/web/scripts/run-local-supabase-types.mjs` loads and admits the isolated local stack, then invokes `supabase-gen-types.mjs` using `process.execPath`.
- `apps/web/scripts/local-supabase-runtime.mjs:270` constructs a clean local type-generation environment; line 281 fixes schemas to `public,auth,storage`, and line 282 resolves the project-local CLI. The canonical wrapper currently follows the CLI `--db-url` lane, not its optional loopback postgres-meta branch.
- `apps/web/scripts/supabase-gen-types.mjs:73` defaults output to `integrations/supabase/database.types.ts`, generates with the selected schemas and only normalizes trailing whitespace/newline.
- `apps/web/integrations/supabase/types.ts` is a handwritten application contract with exact-table checks and legacy members. The session-aware server and service-role clients import it. The observed diff does not establish a defect in that file.

## Exact generated output and provenance

The GitHub run log ZIP was fetched into process memory. Only a single validated TypeScript diff, fixed codes and bounded metadata were retained. No raw logs, raw response bodies, row data, credentials or provider diagnostics were written.

`retain-typegen-evidence.py` checks the run SHA and attempt, exact target path, two hunk coordinates and counts, every original context line, absence of deletions, 397 added schema-only lines, and all 17 object names. It reconstructs the whole output from the exact old blob plus the log diff. The reconstructed blob matches the new Git blob prefix printed by the actual failed job.

```text
old Git blob: 413fbd9586b0e55aabb4728ec2d34e33e029a0b4
new Git blob: 09b4a405292cfd705303fe11f0c7bc72f0cdd159
new SHA-256: 36ffd9c0dda9a81eea7f693147fac7a47e677400a69dfcf70ffef815bac18854
```

The failed-run source and current baseline have identical generated-file bytes and identical migration tree `4513ab8c39205e59b84376798724c3f26b1663b7`. The generated file last changed in `b3def8027a1538ab28adde9c39039013929c55a3`, before these storyboard migrations were added.

The native Astra sidecar evaluated the actual manifest generator offline, without database access:

```text
migrationCount: 100
chainSha256: 97bece6f9e28a7f231477aeaba9631e549ee8a25c63ab6ea6492629de95dd27f
canonicalManifestSha256: 4a897f9afb6634f8ce075749b0a8680374fc2e5e4bbb0a005bba14881eecebc5
```

| Canonical ordinal | Migration | SHA-256 |
| --- | --- | --- |
| 97 | `20260918021531_storyboard_mlx_worker.sql` | `3584d659ad253971771bc1a1f49e2f19e837e609e375c22c078673095105a5fa` |
| 98 | `20260920021531_storyboard_historical_restore.sql` | `6cd66d48f9fde8b86d89f089da3a5f4cc15dd85475fa0769e5724d40f68d2b95` |

Both are under `backend/supabase/migrations/` and byte-identical between the failed SHA and current baseline. The seven tables are `projects`, `workers`, `jobs`, `assets`, `events` at migration 97 lines 10, 28, 41, 78, 94, and `revisions`, `restores` at migration 98 lines 6, 18, all with prefix `admin_storyboard_production_`.

The final ten function declarations, all prefixed `storyboard_production_`, are `assert_owner:130`, `final_status:151`, `project_json:167`, `job_json:172`, `snapshot:178`, `auth_worker:189`, `model_available:200` in migration 97, and `error_allowed:60`, `admin:71`, `worker:314` in migration 98. Three declarations in migration 98 replace prior functions; they are not counted twice. This binds the diff to canonical SQL, not an invented catalog or weakened application type.

## Runtime, CLI, model and current source versions

The actual GHA Node setup log reports `v24.6.0`. Bun 1.4 is provided by the task context; the bounded extraction did not independently recognize a Bun-version line. The retained image-preflight artifact reports CLI **2.115.0**, status `verified`, postgres-meta `v0.96.6`, platform `linux/amd64`, digest `sha256:b9edad6fff2d4fb991ecd57837dbe3f21d2efa0f0ccb186f6ccf0e2d57192fed`. These are historical run facts, not current source version assertions.

The current source npm/Bun lock assertions still require **2.117.0**. All four assertions remain unchanged and passed their source tests, as did the 100-source ledger checks. The mounted project-local dependency tree resolves to `/Users/twoimo/.codex/worktrees/marker-memory-release-20261002/tzudong/apps/web/node_modules`; its installed CLI is **2.115.0**. Its actual `dist/supabase.js --version` and `gen types --help` were inspected through Node 24. No install or global CLI/compiler substitution occurred.

Local verification uses `/opt/homebrew/opt/node@24/bin/node`, actual **v24.21.0**, and Bun **1.4.0**. Project-resolved native CLI is **7.0.2** and compatibility CLI/API is **6.0.2**. Resolved manifest paths and hashes are in `runtime-model-metadata.json`.

Persisted session metadata confirms provider `openai`, model `gpt-6-astra`, effort `xhigh` for this worker `01a106b8-3422-7be2-9aa8-61cbf79aa098` and its read-only provenance sidecar `01a106b9-3020-77f2-bb8b-446aa5355a5b`. These records substantiate session selection; no provider wire capture was performed. No model/provider settings were changed.

## Verification

| Check | Result | Evidence limit |
| --- | --- | --- |
| Exact actual-run patch reconstruction | Pass; 2 hunks, +397/-0, Git blob match | Recovered from actual log diff; no fresh DB replay |
| Patch apply in disposable file tree | Pass; before comparison exit 1, after exit 0 | The designated source is still unchanged |
| Strict generated-output fixture, native 7.0.2 | Pass; empty diagnostics | Includes exact table/function coverage, identity restriction, required owner, nullability, composite FK/row args |
| Same fixture, compat 6.0.2 | Pass; empty diagnostics | Same exact source and contract fixture |
| Existing app `typecheck:parity`, Node 24 | Pass; 0 diagnostics, 2,379 logical inputs | Current unchanged source; not a claim of patched-app parity |
| Related Bun unit/source tests | **55 pass, 0 fail; 1,135 assertions; 5 files** | Four existing suites plus actual-output generator transport fixture |
| Toolchain receipt verifier | **Blocked: `TOOLCHAIN_RECEIPT_PATH_INVALID`** | Its receipt requires app-relative paths; the shared dependency realpath is outside this checkout |

The transport fixture feeds the exact recovered TypeScript source over a task-owned loopback HTTP server. It confirms unchanged bytes, default output path, exact schema query and repeat stability, while leaving the separate application type file intact. It is a transport fixture, not a fake database catalog or proof that the canonical CLI lane was rerun. Existing tests also cover partial-response rejection and unchanged previous output.

The receipt failure is separate from the nightly catalog mismatch and does not mean compiler-version checks failed: both actual compiler versions were read back and both compilers executed successfully. The shared dependency symlink was preserved. Do not weaken `relativeReceiptPath` or alter shared dependencies to turn this receipt into a pass.

No heavy build, full test suite, Docker command, hosted database/API write, real Auth/phone operation or paid service was used.

## Parent-owned remaining actions

1. Resolve the explicit filename scope from handwritten `types.ts` to actual generated `database.types.ts`. The ready patch is precisely one generated file, +397/-0; no broader change is proposed.
2. Once that path is authorized, apply the retained patch in the designated source checkout. Recheck HEAD, clean expected state, patch applicability and generated SHA-256 immediately before application. Keep commit/push/PR work with the parent.
3. Run the patched application's normal parity check with the admitted dependency/runtime environment. Do not claim the existing baseline check above is patched-source parity. Retain the four 2.117.0 assertions and ledger 100.
4. The parent owns the next canonical nightly. It must use the selected source revision and the current 2.117.0 lock contract, read back installed CLI version and pinned pg-meta identity, replay all 100 canonical migrations, then run the existing typegen command and diff gate. A zero diff in that actual run is the missing hosted nightly evidence. Unit/browser lanes must run afterward; their previous skips are not passes.
5. If a future generated diff cannot be recovered from logs, preserve only the generated TypeScript source/diff and bounded provenance (run/attempt/SHA, generated blob/SHA-256, schema names, CLI version, image digest, canonical manifest SHA/count). Keep original logs in memory and use a separate validated schema-only retention path if needed. Any workflow/retention change belongs to the parent; do not relax the existing publication allowlist or upload raw diagnostics.

## Current documentation checked

The full requested AGENTS/verification/privacy/release guidance and Supabase skill were read. The skill's official-source lookup, live changelog index, MCP `search_docs`, current generation guide and CLI reference were consulted. The CLI help was compared with the actual installed executable. Official documents are evidence, not permission for upgrades or hosted actions.

- [Generating TypeScript Types](https://supabase.com/docs/guides/api/rest/generating-types): schema introspection is the source of generated types, with explicit project/local/database-URL generation modes.
- [CLI gen types](https://supabase.com/docs/reference/cli/supabase-gen-types).
- [Supabase changelog index](https://supabase.com/changelog.md).
- [CLI 2.117.0 release](https://github.com/supabase/cli/releases/tag/v2.117.0): checked for version-specific changes; no evidence here requires changing the pinned versions to fix these missing SQL objects.
- [TypeScript minimum-version deprecation](https://supabase.com/changelog/47812-deprecation-notice-supabase-supabase-js-will-require-typescript-5-0): future minimum-version guidance is distinct from this generated catalog drift.

The local comparison, source and tests support the diagnosis and prepared patch. They do not establish a fresh catalog replay, hosted nightly success, production deployment or release.
