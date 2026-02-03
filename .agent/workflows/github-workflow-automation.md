---
description: Git commit, branch, and PR workflow conventions. Apply ONLY when explicitly requested causing a commit, branch creation, or PR.
---

# Git & GitHub Workflow

## When to Use This Skill (CRITICAL)

- **Explicit Request ONLY**: Activate this skill **ONLY** when the user explicitly asks to "commit", "create PR", "deploy", or "release".
- **No Auto-Trigger**: Do NOT activate this skill automatically in subsequent turns.
- **One-off Action**: Perform the git action once and then stop.

## Git Commit Convention

- Format: `[Tag] message`
- **Language: Write commit messages ONLY in Korean (한국어로만 작성)**
- **CRITICAL: NEVER use `\n` string in commit message. Use actual line breaks or multiple -m flags.**

### Tags (Required)

| Tag       | Description                                      | Equivalent Type |
|-----------|--------------------------------------------------|-----------------|
| `Add`     | New feature (새로운 기능 추가)                   | `feat`          |
| `Fix`     | Bug fix (버그 수정)                              | `fix`           |
| `Change`  | Logic or implementation change (기능/로직 변경)  | `refactor`      |
| `Improve` | Refactoring, performance, cleanup (개선/최적화)  | `perf`, `style` |
| `Migrate` | Database migration, dep updates (마이그레이션)   | `chore`         |

*(Note: Use one of the above Tags starting with a capital letter, inside brackets)*

### Examples

- `[Add] 소셜 로그인 기능 추가`
- `[Fix] 마커 클러스터링 오류 수정`
- `[Improve] 랭킹 페이지 조회 성능 최적화`

## Git Branch Convention

- Format: `<type>/<kebab-case-description>`
- Types: `feat`, `fix`, `hotfix`, `chore`, `refactor`
  - `feat`: New features (corresponds to `[Add]`)
  - `fix`: Bug fixes (corresponds to `[Fix]`)
  - `chore`: Maintenance (corresponds to `[Migrate]`)
- Examples:
  - `feat/login-page`
  - `fix/map-zoom-bug`

## Pull Request Convention (gh pr create)

- **Title**: `[Tag] message` (Same as commit message)
- **Body Template** (Strictly in Korean):
  > **⚠️ Windows/PowerShell Warning**: Do NOT use literal `\n` in the `--body` argument. It will print as `\n` text in the PR.
  > - **Option 1 (Recommended)**: Write the body to a file (e.g., `pr_body.md`) and use `--body-file pr_body.md`.
  > - **Option 2 (PowerShell)**: Use `` `n `` for newlines inside the string (e.g. `"Line 1`nLine 2"`).

  ```markdown
  ## 개요
  (변경 사항에 대한 간략한 설명)

  ## 변경 내용
  - (구체적인 변경 항목)

  ## 테스트
  - (테스트 방법 및 결과)

  ## 관련 이슈
  (Closes #IssueNumber)
  ```

## Commit Workflow (Execute ONLY on explicit request)

1. **Check Current Branch**: `git branch --show-current`
2. **Branching Strategy**:
   - **Scenario A: Feature/Fix Work (Standard)**
     - Create/Switch to `feat/<name>`, `fix/<name>`, or `chore/<name>`.
     - **Target**: `develop`
   - **Scenario B: Direct Work on Develop (Fast Release)**
     - IF user is already on `develop` AND indicates direct work: **Stay on `develop`**.
     - **Target**: `main`

3. **Committing**:
   - `git status`
   - `git add .`
   - `git commit -m "[Tag] message"`
     - *CRITICAL*: NEVER use `\n` string in commit message. Use actual line breaks or multiple `-m` flags if body is needed.
   - `git push origin <current-branch>`

4. **Creating PR & Merging**:
   - **IF Current Branch is `develop`**:
     - **Goal**: Release to Production.
     - **Action**:
       - Create a temporary body file with UTF-8 encoding (PowerShell safe):
         - `Set-Content -Path body.md -Value "..." -Encoding UTF8`
       - `gh pr create --base main --head develop --title "[Release] <Message>" --body-file body.md`
       - `gh pr merge <PR#> --merge` (Do NOT delete develop)
       - `rm body.md`
   
   - **IF Current Branch is NOT `develop` (e.g. `feat/...`, `fix/...`, `chore/...`, `refactor/...`, etc.)**:
     - **Goal**: Merge to Development.
     - **Action**:
       - Create a temporary body file with UTF-8 encoding (PowerShell safe):
         - `Set-Content -Path body.md -Value "..." -Encoding UTF8`
       - `gh pr create --base develop --head <current-branch> --title "[Tag] <Message>" --body-file body.md`
       - `gh pr merge <PR#> --merge --delete-branch`
       - `rm body.md`
       - *(Optional)*: If the user asked to "deploy" or "release" after this merge, proceed to **Scenario B** (develop -> main).