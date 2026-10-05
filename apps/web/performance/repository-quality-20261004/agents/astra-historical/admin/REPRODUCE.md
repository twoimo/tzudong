# Read-only reproduction

All commands below run in `/Users/twoimo/.codex/worktrees/promotion-sync-20261004/tzudong` unless noted. Do not fetch/reset/cherry-pick/apply/commit/push. The only permitted writes for this audit are new files under this worker's `admin/` output directory. Historical and active-owner source/evidence are read-only.

```sh
git branch --show-current
git rev-parse HEAD
git status --porcelain=v1 --untracked-files=all
cat AGENTS.md docs/agents/verification.md docs/agents/privacy.md docs/agents/release.md
gh pr view 3114 --repo twoimo/tzudong --json number,state,baseRefOid,headRefOid
# Do not use --json commits (authors/emails). Sanitize API records before persistence.
gh api --paginate --slurp repos/twoimo/tzudong/pulls/2857/commits --jq '[.[][] | {sha, parents: [.parents[].sha], subject: (.commit.message | split("\n")[0])}]'
gh api --paginate --slurp repos/twoimo/tzudong/pulls/2908/commits --jq '[.[][] | {sha, parents: [.parents[].sha], subject: (.commit.message | split("\n")[0])}]'
gh api --paginate --slurp repos/twoimo/tzudong/pulls/2908/files --jq '[.[][] | {filename,sha,status,additions,deletions,changes}]'
git merge-base e5bfd74eda0050c93b9370187d5e4be84bed24e6 adea93042c0bd27f2015ba3200639be9c4b9fa11
git diff --binary 0a8416d42a37a95e686c4d782e1ec73f6a15e37f 8d6b3671325e4a13f85f3e1ed6a297bd8f7a7446 | shasum -a 256
git diff --binary 0ebb898c708dd2c966fd72dd43172a0cf843cf93 adea93042c0bd27f2015ba3200639be9c4b9fa11 | shasum -a 256
git cherry 7a430454cf90a4d9f1ba0ce35ad3ffd5022ceebd 8d6b3671325e4a13f85f3e1ed6a297bd8f7a7446 0a8416d42a37a95e686c4d782e1ec73f6a15e37f
git cherry 7a430454cf90a4d9f1ba0ce35ad3ffd5022ceebd adea93042c0bd27f2015ba3200639be9c4b9fa11 0ebb898c708dd2c966fd72dd43172a0cf843cf93
git log --left-right --cherry-mark --no-merges --format='%m %H %s' 7a430454cf90a4d9f1ba0ce35ad3ffd5022ceebd...adea93042c0bd27f2015ba3200639be9c4b9fa11
# Repeat per exact old/equivalent pair from PATCH-MAPPING.md; compare the first output field.
git show --format= --no-ext-diff 8af06fa19878bcc5fba0448e349b356fb1a13d93 | git patch-id --stable
git show --format= --no-ext-diff ba6bf3c5 | git patch-id --stable
# Show a scoped historical file, not the full large commit body.
git show 0bb61220b1d408a22f0cf81f1cc1e1d31148ada1:apps/web/lib/admin/dashboard-visualization-data.ts
git diff --unified=3 7a430454cf90a4d9f1ba0ce35ad3ffd5022ceebd a60ef70dba0bd32ea44d32218e2c66ef1b5410e1 -- apps/web/lib/admin/admin-module-routing.ts
# Validation only. This command does not apply the patch.
git apply --check /Users/twoimo/.codex/worktrees/marker-memory-lifetime-20261001/tzudong/apps/web/performance/repository-quality-20261004/agents/astra-historical/admin/proposal-01-truthful-top5-proportions.patch
```

Run these already executed focused tests from `apps/web` only if new changes/failures warrant rerun. The recorded baseline has 70 passes and two missing-dependency load errors; do not install or substitute dependencies merely to mask them.

```sh
PATH=/opt/homebrew/opt/node@24/bin:$PATH /Users/twoimo/.bun/bin/bun test ./tests-unit/admin-console-uiux-source.test.ts ./tests-unit/admin-dashboard-widget-order.test.ts ./tests-unit/admin-sidebar-order.test.ts ./tests-unit/admin-guarded-mutation-contract.test.ts ./tests-unit/admin-route-auth-contract.test.ts ./tests-unit/admin-user-management-source.test.ts ./tests-unit/admin-pending-counts-source.test.ts ./tests-unit/youtube-kpi-snapshot-contract.test.ts ./tests-unit/admin-restaurant-refresh-history-source.test.ts
```

Active-owner observations use `git -C /Users/twoimo/.codex/worktrees/pipeline-performance-20261002/tzudong status --porcelain=v1 --untracked-files=all` and source reads only. Do not execute mutating commands, tests that may write there, or read/persist hosted ledger/temp credential contents. The new dirty paths appearing between snapshots are external concurrent work, not this worker's edits.

All old performance files can be recovered by the exact `historical_commit:path` entries in historical-evidence-index.json. Preserve their bytes and provenance; do not rerun measurements, overwrite frozen artifacts, or treat old results as current performance/hosting evidence.
