# Changelog

Product-facing history for Tzudong Map. Newer entries first.

Promotion path is `develop -> data -> main`. SHAs below are `origin/main` merge commits unless noted. This file does not claim legal compliance, hosted apply of approved restaurants, or that a Mac was running.

Korean: [CHANGELOG.ko.md](CHANGELOG.ko.md).

---

## 2026-08-26 — v1.2.5

GitHub Release `v1.2.5` on `origin/main` (pipeline + nightly closure work since `v1.2.4`).

## 2026-08-25 — Hosted new-video pipeline

**Main tip:** `64d669f6e1a3`  
**Production (Vercel `tzudong`):** `64d669f6e1` succeeded at 2026-08-25 19:43 KST.  
**Live app:** https://tzudong.app

### Added

- Daily `hosted-pending-apply` evaluates at most one Tzuyang YouTube ID that hosted restaurants do not already have, then pending-inserts only (`run_hosted_new_video_pipeline.py`).
- Mac LaunchAgent `dev.tzudong.hosted-new-video` (local 05:00) uses the same entry as GitHub Actions. Install: `backend/bin/install_mac_hosted_pipeline_launchd.sh`.
- Admin crawler panel falls back to the latest `main` Crawler run when `127.0.0.1:8091` is unreachable.

### Changed

- Lite scheduled Crawler no longer hard-fails the job on Gemini auth (exit 43) or a missing/non-zero worker `exit_code`.
- `hosted-pending-apply` no longer needs `daily-compute` to succeed.
- Transcript-context (local OpenAI) is optional; chunk/eval continue if it is down.
- LAAJ keeps absolute evaluation paths, continues on Node Gemini API without Gemini CLI, and accepts `--video-id`.
- 09/10 accept `--video-id` and rewrite stale selection/rule files for that ID.
- `run_hosted_new_video_pipeline.py` self-bootstraps the local/Mac runtime: it loads `backend/.env(.local)` (existing environment wins) and admits the repo-local `.venv` via `PYTHON_CMD`/`PYTHONPATH`, so the launchd wrapper needs no hand-edited env wiring. It never widens `PATH` or touches approval state.
- LAAJ skips videos whose rule evaluation produced no `rule_results` file (no `evaluation_target`), instead of dying on the missing-file read; summary reports the new `rule 미대상` count.

### Fixed

- Production build: close `readGithubCrawlerSnapshot` before `GET` in `apps/web/app/api/admin/pipeline/route.ts` (#2735).
- Hosted evaluate: install crawler PyYAML + `backend` `npm ci` on the apply job (#2732–#2739).
- Preview write path `backend/log/cron/` created before apply.
- Nightly local publication verifier/builder ledger count 78 → 82 to match `backend/supabase/migrations` (issue #2592).

### Operations (not in git)

- GitHub Actions variable `TZUDONG_HOSTED_DATA_PLANE_APPROVED=1`.
- Secret `GEMINI_API_KEY` set to AI Studio free-tier key `tzudong-gemini-free` (project `tzudong-free-zero`). Values are not recorded here.

### Still not automatic

- Map publication stays a human approve. `PIPELINE_HOSTED_APPLY_ENABLED` stays off.
- Meatcreator, frame extract, visual-location, and multi-video GHA are not in this daily job.
- A Mac that is asleep misses 05:00; GitHub 04:00 KST remains the unattended schedule.
- Latest Crawler `32838239191` on `64d669f6`: `pipeline=ok`, `evaluate_exit=1`, `applyCandidateCount=0`. Discovery works; a new pending row is not guaranteed until 09/10 see the new chunk file.

### Main merges this day (`develop -> data -> main` unless hotfix)

| KST | PR | SHA | Title |
| --- | --- | --- | --- |
| 19:43-class | #2754 | `64d669f6` | unify Mac and GHA hosted new-video pipeline |
| ~19:15 | #2751 | `2f5aa570` | LAAJ `--video-id` only |
| ~19:05 | #2748 | `6ab3e113` | LAAJ continues without Gemini CLI |
| ~18:55 | #2745 | `4ccc0595` | LAAJ absolute evaluation path |
| 18:48 | #2742 | `a3d68630` | optional transcript context |
| 18:18 | #2739 | `fb2e4821` | Node deps on evaluate job |
| 18:15 | #2735 | `07505d4f` | pipeline route brace (main hotfix) |
| 18:03 | #2734 | `01857a3a` | PyYAML on evaluate job |
| 17:08 | #2731 | `5edccbf2` | evaluate one new YouTube ID + admin GitHub fallback |
| 15:50 | #2728 | `e7ee55e4` | create apply preview directory |
| 15:45 | #2725 | `ce34b0e0` | lite compute stays green; apply independent |
| 15:37 | #2722 | `a18354ec` | hosted pending-apply job |

Earlier same-day feature PRs on the path: #2720 / #2723 / #2726 / #2729 / #2732 / #2737 / #2740 / #2743 / #2746 / #2749 / #2752.

---

## How to add an entry

1. Put new work under `## YYYY-MM-DD — short title` (or `## Unreleased`).
2. Use Added / Changed / Fixed / Operations / Still not automatic.
3. Record `origin/main` SHA and Production deploy SHA separately when they differ.
4. Mirror the same date block in [CHANGELOG.ko.md](CHANGELOG.ko.md).
5. Do not paste secrets, cookies, or provider error bodies.
