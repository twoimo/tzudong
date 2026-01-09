---
trigger: model_decision
description: Git 커밋/브랜치/PR 작업 시 적용: 커밋 태그 형식, 브랜치 네이밍, PR 본문 구조
---

Git Commit Convention:
- Format: [커밋 태그] 내용
- Tags: Add(기능 추가), Fix(버그 수정), Change(변경), Improve(개선), Migrate(마이그레이션)
- Write commit messages in Korean

Git Branch Convention:
- Always create a new branch before developing features
- Branch naming: feat/feature-name, fix/bug-name, hotfix/urgent-fix-name
- After completion, create PR to merge into main or develop
- Examples: feat/password-reset, fix/login-validation, hotfix/auth-error

Pull Request Convention (gh pr create):
- Title: [Commit Tag] Concise title (in Korean)
- Body structure:
  ## 개요
  Brief description of changes

  ## 변경 내용
  - Change 1
  - Change 2

  ## 테스트
  - Test method or results

  ## 관련 이슈
  - #issue-number (if applicable)