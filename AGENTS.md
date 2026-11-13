# Tzudong

Korean-first restaurant map for places featured in Tzuyang videos.

## Structure

- `apps/web`: Next.js public app and guarded admin console.
- `backend`: crawling, evaluation, media and batch pipelines. Keep long jobs out of request handlers.
- Supabase owns persistence. Keep browser, session-aware server and privileged server-only clients separate.

## Working rules

- Finish the requested outcome and relevant verification. Reuse existing authorization; ask only for a material missing decision or authority. Continue independent work while another part is blocked.
- Start from current `main`; source PRs target protected `main` directly. Do not revive `develop → data → main` source promotion. Preserve `data` consumers, publication flags and GDrive state identities.
- Preserve dirty/untracked work. Prepare changes in an isolated candidate from a fresh head; never reset, stash or clean user work. Parallelize disjoint work and serialize shared changes. Reconcile uncertain writes before retrying.
- Read affected files/callers and relevant guidance only. Prefer purpose-built tools; do not repeat passing checks without new evidence or change global settings as a project fix.
- Local services are on-demand. Preserve Supabase data, credentials, queues, leases and active workers. Inventory ownership and verify recoverable backups before cleanup. A source update does not deploy the app or replace the separately pinned scheduled runtime.
- Handoffs record goal, paths/commit, checks and remaining work. Recheck external state; old receipts are not current proof. Personal memory edits require a request.

## Safety

- Privileged clients stay server-only. Admin handlers call `requireAdmin` first and return fixed safe error codes. Risky admin actions use Preview → Confirm → Apply → Readback → Audit.
- Keep fail-closed behavior and applied migrations immutable. Use `apps/web/lib/privacy/sanitize.ts`; never log or persist credentials, session tokens, personal data, precise location, raw OCR, request bodies or provider diagnostics.
- Local tests do not prove hosted correctness, deployment, legal compliance or full Kiro completion. Never invent approvals, retention periods or receipts. Report missing evidence and the next action accurately.

## Read only for the relevant task

- Tests, toolchain or performance: [verification](docs/agents/verification.md).
- Auth, privacy, location, consent, retention or notifications: [privacy](docs/agents/privacy.md).
- Any Vercel action, hosted DB writes, producer/freeze changes, release/rollback or DNS/security settings: [release](docs/agents/release.md).
- Pipeline architecture/contracts: relevant sections of `backend/ARCHITECTURE.md` and `backend/DATA_CONTRACTS.md`; local service selection: [local modes](backend/pipeline-control/LOCAL_MODES.md).
- Kiro status: only the requested `.kiro/specs/` task IDs and their evidence. Instruction cleanup: the project `tzudong-guidance-audit` skill, not routine feature work.
