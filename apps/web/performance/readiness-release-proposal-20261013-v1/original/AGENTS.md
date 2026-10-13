# Tzudong agent guidance

Tzudong is a Korean-first restaurant map for places featured in Tzuyang videos. `apps/web` owns the Next.js public app and guarded admin console; `backend` owns crawlers, evaluation, media and batch work. Keep long-running work out of route handlers.

Supabase is the persistence boundary. Clients: browser `apps/web/integrations/supabase/client.ts`, session-aware server `apps/web/lib/supabase/server.ts`, privileged server-only `apps/web/lib/supabase/service-role.ts`.

## Work and completion

- Implement the requested result, choose reasonable local details, fix affected failures, and verify the result without repeated permission checks. Reuse explicit authorization for the same scope. Ask only when a material decision or action is still unauthorized; prepare a concrete reviewable result first and explain the exact reason for the question.
- Identify the requested outcome and observable completion criteria. Finish when the change works, relevant checks pass, and remaining dependencies are accurately reported. Do not expand into unrelated cleanup or repeat passing suites without new evidence.
- Parallelize independent work with disjoint ownership; serialize shared edits and dependent mutations. Status questions steer ongoing work rather than cancel it. After interruption, inspect actual process, Git and external state before resuming; never repeat an uncertain external write blindly.
- Preserve dirty/untracked user work. Use an isolated candidate from a fresh head; never reset, stash or clean either worktree. Keep source promotion serialized through `develop -> data -> main` under branch protection.

## Load context when needed

Start with the affected files and callers. Use scoped `rg` searches; read linked guidance only when the task meets its trigger. Already-read unchanged guidance need not be loaded again. Do not preload all documentation, Kiro receipts, skills, or historical transcripts.

| Trigger | Read |
| --- | --- |
| Choosing tests, toolchain/release-package changes, performance work | [verification](docs/agents/verification.md) |
| Auth, privacy, personal data, location, consent, deletion/retention or notifications | [privacy](docs/agents/privacy.md) |
| Any Vercel action (including inspection), hosted DB writes, producer/freeze changes, protected promotion, release/rollback, DNS/security settings | [release](docs/agents/release.md) |
| Pipeline architecture or data contracts | Relevant sections of `backend/ARCHITECTURE.md` or `backend/DATA_CONTRACTS.md` |
| Kiro completion or operational evidence | Requested spec's task IDs and their referenced receipts under `.kiro/specs/` |

## Skills, tools and continuity

- Use a skill when explicitly named or its concrete workflow fits the task; a database noun in copy is not a database operation. For project-owned skills, state the actual input/action and nearby exclusions in the description. Respect higher-priority host-required skill triggers; this file cannot disable them.
- Prefer an available purpose-built tool/CLI for the requested operation. Discover only relevant capabilities. Verify a tool's actual version/interface after an error; do not repeatedly retry an unchanged failure, expose credentials, or alter global plugins/settings as a project fix.
- Keep brief task handoffs with the goal, decisions, changed paths/commit, checks, remaining work and any spent external operation. Use prior notes to locate evidence; recheck mutable hosted state before acting. Never save secrets or treat old approval/readback as a new execution receipt. Persistent personal memory changes require the user's explicit request.
- Use the targeted guidance-audit skill for a requested instruction/skill audit, not for every feature or bug fix. Evaluate changes against realistic tasks; record measured results separately from hoped-for token or speed improvements.

## Boundaries that always apply

Privileged clients stay server-only. Admin handlers call `requireAdmin` before work and return bounded fixed codes without exposing provider or database errors. Risky admin flows use Preview → Confirm → Apply → Readback → Audit. Never log/persist credentials, session tokens, personal data, precise device location, raw OCR, request bodies or provider diagnostics; use `apps/web/lib/privacy/sanitize.ts`.

Keep fail-closed behavior and applied migrations immutable. Never invent retention periods, legal approvals or external receipts. Local code/tests do not prove hosted correctness, legal compliance, deployment or full Kiro completion. Complete independent local work while an external dependency remains blocked; report the exact missing evidence and next action. Details live in the triggered guides above.
