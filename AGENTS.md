# Tzudong

Korean-first restaurant map for places featured in Tzuyang videos.

## Structure
- `apps/web`: Next.js public app and guarded admin console.
- `backend`: crawlers, evaluation, media and batch pipelines. Keep long jobs out of request handlers.
- Register new first-/second-level directories in `backend/layout-manifest.v1.json`.
- Supabase owns persistence; separate browser (`apps/web/integrations/supabase/client.ts`), session-aware server (`apps/web/lib/supabase/server.ts`) and privileged server-only (`apps/web/lib/supabase/service-role.ts`) clients. Migrations live in `backend/supabase/migrations`.

## Commands
Web, from `apps/web` (Node 24.x; npm 11.6.2 and `package-lock.json` are release authority, Bun is fine day to day):

```sh
bun run dev                          # local dev server, port 3000
bun run lint                         # ESLint, zero warnings
bun run test:unit                    # all Bun tests in tests-unit/
bun test tests-unit/<name>.test.ts   # one unit test file
npm run typecheck:parity             # pinned native and compat compilers; never a global tsc
npm run build
npx playwright test tests/<name>.spec.ts
```

Backend, from the repository root: `python3 -m unittest backend.pipeline.test_validators_unittest` (and the other modules in [verification](docs/agents/verification.md)). `python3 backend/bin/check_env_contract.py --profile daily` fails closed without operator secrets; never fake them.

## Work
- Finish the authorized outcome and relevant checks. Reuse approval; ask only for a material missing decision or authority. Continue independent work when one part is blocked.
- Start from current `main`; submit source PRs directly to protected `main`. Preserve `data` consumers, publication flags, GDrive identities and the separately pinned scheduled runtime.
- Preserve dirty/untracked work in place; use an isolated candidate. Never reset, stash or clean user work. Parallelize disjoint work, serialize shared writes, and reconcile uncertain operations before retrying.
- Read affected files/callers and only relevant guidance. Use purpose-built tools; do not repeat passing checks without new evidence or change global settings as a project fix.
- Local services are on-demand. Preserve data, credentials, queues, leases and active workers; verify ownership and recoverable backups before cleanup.
- Handoffs state goal, paths/commit, checks and remaining work. Recheck external state; old receipts and local tests do not prove deployment, hosted correctness, legal compliance or full Kiro completion. Personal memory edits require a request.

## Safety
- Privileged clients stay server-only. Admin handlers call `requireAdmin` first and return fixed safe codes. Risky actions use Preview → Confirm → Apply → Readback → Audit.
- Preserve fail-closed behavior and immutable applied migrations. Use `apps/web/lib/privacy/sanitize.ts`; never log/persist credentials, tokens, personal data, precise location, raw OCR, request bodies or provider diagnostics.
- Never invent approvals, retention periods or receipts. Report missing evidence and the next action accurately.

## Rules and what enforces them
Each rule replaces a repeated mistake. Add a row when a correction recurs, and enforce it in code where possible.

| Rule | Enforced by |
| --- | --- |
| No tracked Python module or package takes a stdlib name (`queue.py` broke `unittest discover`). | `test_no_tracked_python_module_shadows_the_standard_library` in `backend/utils/tests/test_layout_naming_source_recovery.py` |
| Keep guidance in `AGENTS.md`. No `CLAUDE.md` or `CLAUDE.local.md` at the root or in `apps/web`, because Claude Code then stops reading `AGENTS.md`. | `test_no_tracked_claude_md_hides_agents_md` in `backend/utils/tests/test_layout_naming_source_recovery.py` |
| After you edit a file that the platform-modernization reconciliation pins, run its generator and commit the manifest. Do not edit hashes by hand. | `backend/bin/build_platform_modernization_reconciliation.py --check` names each drifted entry and the command; `test_platform_modernization_reconciliation` runs it in CI |
| A test fails when its behavior breaks. Do not branch on real repository state to accept either outcome. | Review. A known gap uses `test.failing` with a reason, a start date, an expiry and the pending decision; Bun fails the marker once the behavior returns |
| Do not re-pin a successor manifest or change its `launchPolicy.state` to turn a test green. The operator decides. | Review. `apps/web/tests-unit/admin-record-sql-successor.test.ts` holds the open case until 2026-12-16 |

## Read when relevant
- Tests, toolchain, performance: [verification](docs/agents/verification.md).
- Auth, privacy, location, consent, retention, notifications: [privacy](docs/agents/privacy.md).
- Any Vercel action, hosted DB writes, producer/freeze changes, release/rollback, DNS/security: [release](docs/agents/release.md).
- Pipeline: relevant sections of `backend/ARCHITECTURE.md`, `backend/DATA_CONTRACTS.md`; services: [local modes](backend/pipeline-control/LOCAL_MODES.md).
- Kiro status: requested `.kiro/specs/` task IDs and evidence only. Instruction cleanup: `tzudong-guidance-audit`, not routine feature work.
