# Tzudong

Korean-first restaurant map for places featured in Tzuyang videos.

## Structure
- `apps/web`: Next.js public app and guarded admin console.
- `backend`: crawlers, evaluation, media and batch pipelines. Keep long jobs out of request handlers.
- Register new first-/second-level directories in `backend/layout-manifest.v1.json`.
- Supabase owns persistence; separate browser, session-aware server and privileged server-only clients.

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

## Read when relevant
- Tests, toolchain, performance: [verification](docs/agents/verification.md).
- Auth, privacy, location, consent, retention, notifications: [privacy](docs/agents/privacy.md).
- Any Vercel action, hosted DB writes, producer/freeze changes, release/rollback, DNS/security: [release](docs/agents/release.md).
- Pipeline: relevant sections of `backend/ARCHITECTURE.md`, `backend/DATA_CONTRACTS.md`; services: [local modes](backend/pipeline-control/LOCAL_MODES.md).
- Kiro status: requested `.kiro/specs/` task IDs and evidence only. Instruction cleanup: `tzudong-guidance-audit`, not routine feature work.
