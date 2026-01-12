---
trigger: model_decision
description: Git 커밋/브랜치/PR 작업 시 적용: 커밋 태그 형식, 브랜치 네이밍, PR 본문 구조
---

Git Commit Convention:
- Format: [Tag] message
- Tags: Add, Fix, Change, Improve, Migrate
- Write commit messages in Korean

Git Branch Convention:
- Always create a new branch before developing features
- Branch naming: feat/feature-name, fix/bug-name, hotfix/urgent-fix-name
- Examples: feat/password-reset, fix/login-validation, hotfix/auth-error

Pull Request Convention (gh pr create):
- Title: [Tag] Concise title (in Korean)
- Body structure:
  ## 개요
  ## 변경 내용
  ## 테스트
  ## 관련 이슈

Commit Workflow (auto-execute on "커밋해줘" request):
1. **Check Current Branch**: `git branch --show-current`
2. IF current branch is `develop`:
   - **Scenario A (Merged Feature & Ready to Release)**:
     - `git pull origin develop` (Sync latest changes)
     - `gh pr create --base main --head develop`
     - `gh pr merge <PR#> --merge`
   - **Scenario B (New Changes present on develop)**:
     - 🛑 STOP. Do not commit directly to develop.
     - `git checkout -b feat/<context-based-name>`
     - Go to step 3.
3. IF current branch is `feat/*`, `fix/*`, `hotfix/*`:
   - `git status` (Check changes)
   - `git add . && git commit -m "[Tag] message"`
   - `git push origin <current-branch>`
   - `gh pr create --base develop --head <current-branch>`
   - `gh pr merge <PR#> --merge` (Auto-merge to develop)
