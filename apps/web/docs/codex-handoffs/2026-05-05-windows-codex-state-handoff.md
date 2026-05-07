# Windows Codex state — archive/prune handoff

Reactivation prompt:

> We are continuing Windows-side Codex maintenance from this handoff. Verify `/mnt/c/Users/twoimo/.codex` current state, run report-only first, and do not mutate config or sessions without backup.

## Scope

The 2026-05-05 read-only scan found a separate Windows Codex home at `/mnt/c/Users/twoimo/.codex`.

## Findings at handoff time

- Total size: about 2.9G.
- Sessions: about 2.8G.
- Old-session candidates: 5, tiny total size.
- Config prune candidates: 6.
- Logs: effectively 0M.

## Recommendation

This Windows Codex home is not the first cleanup priority. The main active bloat is WSL Codex sessions/logs and WSL `/tmp`.

If cleaning Windows Codex later:

1. Run report-only again with `--codex-home /mnt/c/Users/twoimo/.codex`.
2. Back up before pruning config.
3. Do not touch `auth.json` or credentials.
4. Apply only if the Windows Codex app/session is closed or an explicit wait flow is used.
