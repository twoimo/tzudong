# Tzudong agent guidance audit — 2026-09-08

## Sources and scope

Reviewed the [post and full article](https://x.com/xUkeei/status/2096829795116134884),
its [cover image](https://x.com/xUkeei/article/2096829795116134884/media/2096829423995736064),
and the author's two visible follow-ups. The article's five recommendations and the
cover's five labels are mapped below. The author's reported token savings and later
[usage increase](https://x.com/xUkeei/status/2096983961004331351) are anecdotal;
no model-performance or product-bug claim is adopted here.

Official references checked: [Astra instruction guidance](https://developers.openai.com/api/docs/guides/latest-model),
[AGENTS discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md),
and [skill descriptions and progressive disclosure](https://learn.chatgpt.com/docs/build-skills).

Base: `535ff5e27c2e7c27f385e862a824a58d0cc30b92`, a fresh `origin/main` on 2026-09-08.
The existing dirty original and Kiro recovery candidates were preserved. This change
adjusts project guidance, not app behavior, production state or model configuration.

## Inventory and findings

The tracked project had one `AGENTS.md`, no project `SKILL.md`, no nested agent
instructions, and no tracked Claude/Copilot/Cursor instruction files or Kiro steering
rules. `.cursor/environment.json` contains local startup commands and ports, not
agent prompts; its contracts do not need alteration for this request. Historical
handoffs and Kiro evidence are reference data, not unconditional startup instructions.

The existing AGENTS file did not literally demand reading every document or running
every test after every edit. Its undifferentiated command list and always-loaded
specialized privacy/release detail could nevertheless lead to unnecessary work.
The correction makes scope explicit rather than claiming a nonexistent rule was removed.

## Recommendation coverage

| Source item | Project application |
| --- | --- |
| Article 1: conditional reading | Short root router; privacy, release and verification details load on explicit task triggers. |
| Article 2: proportional tests | Impact table selects relevant checks; successful checks end local verification unless new evidence warrants expansion. Required CI remains required. |
| Article 3: precise skills | New `tzudong-guidance-audit` description targets instruction audits and excludes routine code/SQL/deploy work. No existing project skills required rewriting. |
| Article 4: autonomy and completion | Local work continues through relevant validation; reuse same-scope authorization; ask only for a material missing decision or authority. |
| Article 5: configuration audit | This inventory, preserved-requirement comparison, source mapping and reusable narrow audit skill. |
| Cover: goals | Root requires the requested observable outcome and completion criteria. |
| Cover: context | Scoped searches and conditional references; no blanket receipt/transcript loading. |
| Cover: tools/integrations | Discover the relevant tool and actual interface; stop unchanged failing retries. Do not rewrite shared tools as a project shortcut. |
| Cover: memory | Brief handoffs with decisions/checks/remaining work; reverify mutable state; no secret retention or unsolicited personal-memory edits. |
| Cover: evaluation loop | Realistic contrasting request review and measured instruction-byte comparison; no recursive audit or invented runtime improvement. |

The article's example asks for approval at every external API call. For this project,
read-only diagnosis and already-authorized actions do not need redundant approval.
Actual unauthorized mutations and evidence-dependent production operations keep their
specific boundaries. Missing legal documents cannot be converted to approvals.

## Retained constraints and host limits

Original commands/toolchain, privacy rules, release gates and test-evidence conventions
were moved verbatim into `docs/agents/verification.md`, `privacy.md` and `release.md`.
The root retains data-handling, immutable-worktree, protected promotion, admin and
fail-closed boundaries, and the exact browser/server/service-role client paths.

Host-injected mandatory skill triggers and global system/developer instructions remain
higher priority. Repository guidance cannot remove their context cost or change a
running session's startup prompt. No shared plugin cache, global skill, model setting,
credential or personal memory was edited. A new session opened in this candidate can
load its root instructions; no automatic reload of another checkout is claimed.

## Validation

- Four original detailed sections are preserved verbatim in their conditional guides.
- Local Markdown links and referenced architecture/client files resolve.
- The skill metadata validator passed; no scaffold placeholders remain.
- `git diff --check` passed.
- Root instructions changed from 7,325 to 4,744 UTF-8 bytes: 35.2% smaller. This is
  entrypoint size, not measured token/latency savings. Conditional guides add detail
  only when selected, and the new skill has its own small discovery metadata cost.
- Application tests, DB operations and deployment were unnecessary for this guidance-only change.

An independent read-only review exercised five contrasting requests: copy-only edits,
auth/onboarding SQL, authorized provider reads, deployment without legal evidence,
and a guidance audit. It identified and prompted fixes for Vercel read routing,
ignored skill delivery, and read-only audit semantics. The Supabase client mapping
was restored during the parallel parent pass. Universal sensitive logging and database
error boundaries are explicit. Static/scenario review does not prove future model
behavior or eliminate hosted Kiro blockers.
