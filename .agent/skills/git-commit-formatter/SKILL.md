---
name: git-commit-formatter
description: Git commit, branch, and PR workflow conventions. Apply when committing code, creating branches, or managing pull requests via GitHub CLI.
---

# Git & GitHub Workflow

## Git Commit Convention

- Format: `[Tag] message`
- Tags: Add, Fix, Change, Improve, Migrate
- **Write commit messages ONLY in Korean (한국어로만 작성)**
- **CRITICAL: NEVER use `\n` string in commit message. Use actual line breaks or multiple -m flags.**
  - Correct (Newline): `git commit -m "[Tag] 제목
    내용"`
  - Correct (Multiple -m): `git commit -m "[Tag] 제목" -m "본문 내용"`
  - Incorrect: `git commit -m "[Tag] 제목\n내용"`

## Git Branch Convention

- Always create a new branch before developing features
- Branch naming: feat/feature-name, fix/bug-name, hotfix/urgent-fix-name
- Examples: feat/password-reset, fix/login-validation, hotfix/auth-error

## Pull Request Convention (gh pr create)

- Title: [Tag] Concise title (**Strictly in Korean**)
- Body structure (**Strictly in Korean**):
  ```
  ## 개요
  ## 변경 내용
  ## 테스트
  ## 관련 이슈
  ```
- **CRITICAL**: Ensure the body content uses actual newlines, not the `\n` escape sequence.

## Commit Workflow (auto-execute on "커밋해줘" request)

1. **Check Current Branch**: `git branch --show-current`
2. IF current branch is `develop`:
   - **Scenario A (Merged Feature & Ready to Release)**:
     - `git pull origin develop` (Sync latest changes)
     - `gh pr create --base main --head develop`
     - `gh pr merge <PR#> --merge` (Note: DO NOT delete develop branch)
   - **Scenario B (New Changes present on develop)**:
     - 🛑 STOP. Do not commit directly to develop.
     - `git checkout -b feat/<context-based-name>`
     - Go to Step 3.
3. IF current branch is `feat/*`, `fix/*`, `hotfix/*`:
   - `git status` (Check changes)
   - `git add . && git commit -m "[Tag] message"`
   - `git push origin <current-branch>`
   - `gh pr create --base develop --head <current-branch>`
   - `gh pr merge <PR#> --merge --delete-branch` (Note: Automatically delete feature branch after merge)
   - **Continue to merge develop to main**:
     - `git checkout develop && git pull origin develop`
     - `gh pr create --base main --head develop`
     - `gh pr merge <PR#> --merge` (Note: Always keep develop branch)
