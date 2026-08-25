# Codex local-state maintenance handoff — 2026-05-18

Reactivation prompt:

```text
We are continuing from this handoff. Read this document first, inspect the current repo state, verify what still applies, and continue from the next steps without assuming the old chat context is available.
```

## Repo / path / branch

- Repo path: `/home/twoimo/src/tzudong`
- Branch: verify with `git branch --show-current` before continuing.
- Important boundary: this repo already had unrelated dirty frontend files before this handoff was created. Do not reset or overwrite them as part of Codex local-state maintenance.

## Current goal

Run `$keep-codex-fast` safely for local Codex state maintenance: inspect first, preserve continuity, back up before any archive/apply, and avoid deleting sessions/logs/worktrees.

## Completed

- Loaded `$keep-codex-fast` skill instructions.
- Ran report-only maintenance scan.
- Found the original report run failed on an offline or unavailable Drive mount path: `/mnt/h/My Drive/99_LLM Wiki` raised `OSError: [Errno 19] No such device` while checking stale config project paths.
- Re-ran report with an in-memory `Path.exists` guard to confirm the intended summary.
- Patched `/home/twoimo/.codex/skills/keep-codex-fast/scripts/keep_codex_fast.py` to treat `Path.exists()` `OSError` as `False` via `path_exists()`.
- Backed up the original script before editing:
  `/home/twoimo/.codex/skills/keep-codex-fast/scripts/keep_codex_fast.py.bak-20260518-182622`
- Verified the patched script completes in report-only mode without the in-memory guard.
- Ran `--backup-only`; it created metadata backups without archiving/moving state.

## Verification evidence

Report-only after patch:

```text
requested_mode report
effective_mode report
mode_safety read_only=true privacy=pseudonymous
extended_paths 0
old_session_candidates 321
old_session_candidate_gb 1.198
config_prune_candidates 1
worktree_candidates 0
logs_mb 930.0
size_sessions_gb 4.716
size_archived_sessions_gb 3.576
size_archived_logs_gb 0.908
done
```

Backup-only after patch:

```text
backup_root /home/twoimo/Documents/Codex/codex-backups/keep-codex-fast-20260518-182729
requested_mode backup-only
effective_mode backup-only
mode_safety backup_only=true archives=false state_writes=false
backed_up config.toml
backed_up history.jsonl
backed_up memories
backed_up skills
backed_up plugins
done
```

## Files touched or investigated

- Modified: `/home/twoimo/.codex/skills/keep-codex-fast/scripts/keep_codex_fast.py`
- Backup created: `/home/twoimo/.codex/skills/keep-codex-fast/scripts/keep_codex_fast.py.bak-20260518-182622`
- Backup-only output: `/home/twoimo/Documents/Codex/codex-backups/keep-codex-fast-20260518-182729`
- Added handoff: `docs/archive/handoffs/codex/2026-05-18-keep-codex-fast.md`

## Known warnings / blockers

- Full `--apply` should not run while Codex is active. The script detects running Codex processes and skips apply unless Codex is closed or `--wait-for-codex-exit` is intentionally used.
- Backup folders can contain private local Codex metadata. Keep them local and do not publish/share without review.
- Large active session candidates are pseudonymous in normal output. Use `--details` only if raw local paths/thread IDs are required for diagnosis.

## Next steps

1. If there are important old active repo chats, create handoff docs for them before archiving.
2. Close Codex/OMX sessions that write to `~/.codex` before manual apply.
3. Run:
   `python3 /home/twoimo/.codex/skills/keep-codex-fast/scripts/keep_codex_fast.py --apply --archive-older-than-days 10 --worktree-older-than-days 7`
4. Verify immediately after apply with:
   `python3 /home/twoimo/.codex/skills/keep-codex-fast/scripts/keep_codex_fast.py`
5. Confirm sessions/logs were archived rather than deleted, and keep backup path recorded.
6. Optionally create a recurring report-only reminder; never automate mutating maintenance.
