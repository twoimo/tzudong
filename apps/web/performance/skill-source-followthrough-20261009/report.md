# Managed skill source followthrough — 2026-10-09

Canonical correction is not complete. No managed cache was edited, and no project override is being reported as a publisher fix.

## Current evidence

- Installed and enabled: Vercel `0.54.1`, Supabase `1.0.0`, both `openai-curated-remote` with `source: remote`. Local package manifests and scoped CLI results agree. Vercel README identifies upstream content baseline `0.54.0`; current upstream manifest is `0.54.1`. No stable Vercel GitHub release resolved (`releases/latest` returned 404); use maintained docs/current source rather than inventing a release tag.
- Supabase upstream latest stable release is `v0.1.16` (2026-09-28). This upstream numbering is not the managed `1.0.0` package version and does not prove a newer directory package exists. Current changelog was fetched; no database operation or upgrade was performed.
- Vercel installed and current upstream env-vars both still contain the test load-order error. Current Next.js docs load environment-specific local files, including the test-specific one; only generic `.env.local` is skipped in test. The existing proposal `docs/operations/proposals/vercel-env-vars-official-correction.md` remains the correction draft.

## Supported paths and limits

The installed CLI `0.159.2` offers plugin add/list/remove and marketplace snapshot upgrade. Its upgrade help explicitly limits the latter to configured Git marketplaces. The current marketplace inventory has no configured Git source for these managed remote packages. `plugin add` is installation, not an established in-place update receipt. Neither it nor uninstall/reinstall was run.

Current Plugin Management tools support search, dependency metadata, permissions and uninstall. The app updater checks the desktop application, not plugin skill packages. No named managed-package update or feedback-submission tool is exposed in this session. Searches and dependency metadata reads succeeded; no grants changed. A desktop-only update button has not been inspected, so its availability is unverified.

Publisher route: OpenAI's published-plugin guide distinguishes MCP updates from skill/metadata updates, which require a new publisher ZIP and publication. Local authored marketplace refresh/restart instructions are not evidence that editing a curated cache is supported.

Feedback route: the installed Vercel README routes upstream content errors to `vercel/vercel-plugin/issues`; packaging issues go to `openai/plugins`. Supabase installed and current feedback guides route skill issues to `supabase/agent-skills/issues` using the supplied issue template; the plugin package is `supabase-community/supabase-plugin`. No Supabase content error was newly established by this narrow route check. No GitHub issue, message or email was sent.

## Concrete remaining action

1. For the known Vercel env-vars error, the Vercel skill maintainer must correct the upstream recipe using the already prepared proposal and Next official load-order evidence.
2. The managed package publisher must publish a corrected skills ZIP; confirm the directory version and installed manifest/skill hashes afterward. Current upstream still has the error, so refreshing it now is not a verified correction.
3. If a supported host UI later offers the corrected package, inspect that exact version and proposed grants/hooks/config scope first. If it needs restart, prepare readback hashes and a restart handoff after ongoing work ends; do not interrupt current tasks. No restart or update was applied in this audit.

References: [Next env load order](https://nextjs.org/docs/app/guides/environment-variables), [OpenAI plugin publication](https://developers.openai.com/plugins/deploy/submission), [OpenAI package sources](https://developers.openai.com/plugins/build/plugins), [Vercel plugin docs](https://vercel.com/docs/agent-resources/vercel-plugin), [Vercel upstream](https://github.com/vercel/vercel-plugin), [Supabase skill feedback](https://github.com/supabase/agent-skills).

## Scope and verification

Only evidence files in this directory were written. Source, managed cache, operator env, model, pins, connector grants, provider accounts, personal memory, DB and deployment were preserved. There were zero paid provider calls, updates, restarts, feedback submissions, commits or pushes. Installed manifest/README/affected skill hashes were rechecked unchanged after the read-only audit. This is current official-source and capability evidence; not runtime compatibility or canonical publication completion.
