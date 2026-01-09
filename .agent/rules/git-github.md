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
1. git status - check changes
2. git add . && git commit -m "[Tag] message"
3. git push origin <current-branch>
4. If current branch is develop:
   - gh pr create --base main --head develop
   - gh pr merge <PR#> --merge (auto-merge)
5. If current branch is feat/*, fix/*, hotfix/*:
   - gh pr create --base develop --head <current-branch>
   - gh pr merge <PR#> --merge (auto-merge to develop)