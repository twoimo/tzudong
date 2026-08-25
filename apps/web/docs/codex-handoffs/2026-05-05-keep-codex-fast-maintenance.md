# Codex maintenance handoff — keep-codex-fast

Reactivation prompt:

> We are continuing from this handoff. Read this document first, inspect the current repo and local Codex state, verify what still applies, and continue from the next steps without assuming the old chat context is available.

## Repo / path / branch

- Working path: `/home/twoimo/src/tzudong/apps/web`
- Repo root: `/home/twoimo/src/tzudong`
- Branch at handoff time: `main`
- Date: 2026-05-05

## Current goal

Safely reduce Codex local-state drag and identify disk-space pressure without losing important chat continuity.

The user wants `$keep-codex-fast` performed correctly, including handoff summaries before any archive/apply step.

## What was already done

Only read-only diagnostics were performed. No archive, backup, deletion, move, config rewrite, or cleanup apply has been executed.

### Commands already run

```bash
python3 /home/twoimo/.codex/skills/keep-codex-fast/scripts/keep_codex_fast.py
python3 /home/twoimo/.codex/skills/keep-codex-fast/scripts/keep_codex_fast.py --help
python3 /home/twoimo/.codex/skills/keep-codex-fast/scripts/keep_codex_fast.py --codex-home /mnt/c/Users/twoimo/.codex

df -hT
ls -la /mnt
du -xhd1 / 2>/dev/null | sort -h

du -xhd1 /mnt/c 2>/dev/null | sort -h
du -xhd1 /home/twoimo 2>/dev/null | sort -h
du -xhd1 /tmp 2>/dev/null | sort -h | tail -30

du -sh /home/twoimo/.codex /mnt/c/Users/twoimo/.codex '/mnt/c/Users/twoimo/내 드라이브/99_LLM Wiki/.codex'
du -sh /home/twoimo/.codex/* 2>/dev/null | sort -h | tail -40
du -sh /mnt/c/Users/twoimo/.codex/* 2>/dev/null | sort -h | tail -30

powershell.exe -NoProfile -Command 'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID,VolumeName,@{Name="SizeGB";Expression={[math]::Round($_.Size/1GB,1)}},@{Name="FreeGB";Expression={[math]::Round($_.FreeSpace/1GB,1)}} | Format-Table -AutoSize'
```

## Key findings

### Disk / drive pressure

- WSL root `/`: 251G total, 49G used, 190G free.
- Windows `C:`: 897.8G total, about 39.9G free.
- Google Drive `H:`: 897.8G total, about 37.9G free.
- C/H are both tight enough that moving archive to Google Drive may not immediately free local disk if Drive keeps files offline-cached locally.

### Active WSL Codex home: `/home/twoimo/.codex`

- Total size: about 6.2G.
- `sessions`: about 4.8G.
- `logs_2.sqlite`: about 941M.
- `log`: about 452M.
- Read-only report found:
  - `old_session_candidates`: 4036.
  - `old_session_candidate_gb`: 3.572.
  - largest pseudonymous active sessions: 86.6M, 83.2M, 79.1M, 75.0M, 61.4M, etc.
  - `extended_paths`: 0.
  - `config_prune_candidates`: 0.
  - `worktree_candidates`: 0.

### Windows Codex home: `/mnt/c/Users/twoimo/.codex`

- Total size: about 2.9G.
- `sessions`: about 2.8G.
- Read-only report found:
  - `old_session_candidates`: 5.
  - `old_session_candidate_gb`: 0.001.
  - `config_prune_candidates`: 6.
  - `logs_mb`: 0.0.

### Other discovered Codex state

- `/mnt/c/Users/twoimo/내 드라이브/99_LLM Wiki/.codex`: about 56K.

### WSL large non-Codex areas

- `/home/twoimo/.cache`: about 12G.
- `/tmp`: about 12G.
- `/home/twoimo/src`: about 4.8G.
- `/home/twoimo/.npm`: about 3.3G.
- `/home/twoimo/.local`: about 2.4G.
- `/tmp` has several old-looking `tzudong-*` and `gdrive-*` temporary work folders, including `/tmp/tzudong-next5-wt` around 1.6G.

## Constraints / safety rules

- First keep-codex-fast run must remain report-only; that has been satisfied.
- Do not permanently delete sessions, logs, worktrees, memories, skills, plugins, or automations.
- Back up before applying changes.
- If Codex is running, default to report-only. Apply only after Codex is closed or with explicit `--wait-for-codex-exit` flow.
- Do not print raw thread IDs, titles, or sensitive paths unless user asks for `--details`.
- Do not move active `.codex` itself to Google Drive.
- Google Drive is acceptable only as a destination for old archive/backup artifacts, with privacy caution.
- Backup/archive folders may contain private local Codex metadata; keep them private.

## Open decisions

1. Whether to run detailed session listing with `--details` to identify specific important sessions.
2. Which old/large Codex sessions should get individual repo-specific handoff docs before archive.
3. Whether Google Drive should be used for long-term backup/archive storage, and which exact path to use.
4. Whether `/tmp` cleanup should be archive-first, direct delete for clearly disposable temp folders, or left untouched.
5. Whether to apply maintenance only for WSL Codex home, Windows Codex home, or both.

## Recommended next steps

1. Create handoff docs for any active/important repo chats the user may continue.
2. If needed, run a privacy-sensitive details pass only after user accepts seeing raw session identifiers/titles/paths:
   ```bash
   python3 /home/twoimo/.codex/skills/keep-codex-fast/scripts/keep_codex_fast.py --details
   ```
3. Decide backup/archive destination. Suggested long-term Google Drive folder:
   ```text
   H:\Codex Backups\keep-codex-fast\
   ```
   WSL view may be available as `/mnt/h/...`; verify before use.
4. Before applying, either close Codex or use the supported wait flow:
   ```bash
   python3 /home/twoimo/.codex/skills/keep-codex-fast/scripts/keep_codex_fast.py --apply --archive-older-than-days 10 --worktree-older-than-days 7 --wait-for-codex-exit
   ```
5. Verify after apply with report-only:
   ```bash
   python3 /home/twoimo/.codex/skills/keep-codex-fast/scripts/keep_codex_fast.py
   ```
6. Separately inspect `/tmp` candidates before any deletion. Prioritize obvious old worktree/temp folders and avoid killing or deleting active work.

## Known risks / notes

- Local archive improves active Codex state size but does not reduce total disk usage if archive stays on the same filesystem.
- Google Drive backup may still consume C drive space depending on Drive offline-cache settings.
- Running broad `du` over `/mnt/c` through WSL can be slow and may skip permission-protected Windows areas.
- Some C-drive top-level size probes through WSL were incomplete due to permission/9p behavior; PowerShell drive summary was used for overall drive totals.


## Update: 1-3 follow-up completed

Completed after the initial report-only scan:

1. Ran privacy-sensitive details scans for WSL and Windows Codex homes to identify large session themes. Raw thread IDs are not repeated in handoff docs.
2. Created additional handoff documents:
   - `apps/web/docs/codex-handoffs/2026-05-05-important-codex-sessions-before-archive.md`
   - `apps/web/docs/codex-handoffs/2026-05-05-tzudong-large-session-handoff.md`
   - `apps/web/docs/codex-handoffs/2026-05-05-llm-wiki-large-session-handoff.md`
   - `apps/web/docs/codex-handoffs/2026-05-05-windows-codex-state-handoff.md`
3. Confirmed and created Google Drive private holding folder for later archive/backup artifacts:
   - Windows path: `H:\My Drive\Codex Backups\keep-codex-fast\2026-05-05`
   - Created marker: `README-KEEP-PRIVATE.txt`

Important: no Codex archive/apply/cleanup has been run yet.

## Update: remaining safe work completed / apply deferred

Additional work completed on 2026-05-05:

- Created backup-only metadata snapshots while Codex was still running:
  - `/home/twoimo/Documents/Codex/codex-backups/keep-codex-fast-wsl-20260505T231542`
  - `/home/twoimo/Documents/Codex/codex-backups/keep-codex-fast-windows-20260505T231542`
- Copied those backups and handoff docs to Google Drive private holding folder:
  - `H:\My Drive\Codex Backups\keep-codex-fast\2026-05-05`
- Archived and removed inactive `/tmp` candidates after validating tarballs:
  - `/tmp/gdrive-backfill-25315519599`
  - `/tmp/local-gdrive-backfill-main`
  - `/tmp/scrapling-test-venv`
- Local tmp archive:
  - `/home/twoimo/Documents/Codex/codex-backups/tmp-archives-20260505T231840`
- Copied tmp archive to Google Drive holding folder.
- `/tmp` reduced to about 7.9M after cleanup.

The actual Codex session/log archive apply has not run yet because active Codex CLI processes were detected. A tmux deferred runner is waiting for Codex to exit:

- tmux session: `keep-codex-fast-apply-20260505`
- deferred script: `/home/twoimo/Documents/Codex/codex-backups/keep-codex-fast-deferred-apply-20260505.sh`
- current log: `/home/twoimo/Documents/Codex/codex-backups/keep-codex-fast-deferred-apply-20260505T232136.log`

When all Codex CLI processes exit, the deferred runner will:

1. Run WSL Codex `--apply` with backup root under `~/Documents/Codex/codex-backups/`.
2. Run Windows Codex `--apply --codex-home /mnt/c/Users/twoimo/.codex` with backup root under `~/Documents/Codex/codex-backups/`.
3. Run report-only verification for both homes.
4. Copy apply reports and backup roots to `H:\My Drive\Codex Backups\keep-codex-fast\2026-05-05`.

Important: local archived sessions/logs are not deleted by the script. They remain restorable under `.codex/archived_*` unless manually moved later with a restore-plan update.
