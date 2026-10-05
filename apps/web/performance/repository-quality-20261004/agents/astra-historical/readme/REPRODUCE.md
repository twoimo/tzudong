# README 문서 patch 재현

아래는 읽기 전용 명령이다. dependency 설치, 서버/DB 시작, branch 변경, commit, 원격 쓰기를 포함하지 않는다. 지정 branch/HEAD가 달라졌다면 결과를 기존 readback과 동일하다고 간주하지 않는다.

```bash
cd /Users/twoimo/.codex/worktrees/promotion-sync-20261004/tzudong
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short

# GitHub 공개 PR 메타데이터 및 정확한 old diff: remote read only
gh pr view 2903 --json number,state,baseRefName,baseRefOid,headRefName,headRefOid,files
gh pr view 3114 --json number,state,baseRefName,baseRefOid,headRefName,headRefOid
gh pr diff 2903 --color never

# direct main-base 관계: 이름을 근거로 다른 remote main 상태를 추정하지 않음
git show --no-patch --format='%H%n%P%n%s' da096e04baf979ac35531172c7a1de95090aa649
git merge-base 67df460dee73f90b93eee203ebcbe7bd9976cb03 da096e04baf979ac35531172c7a1de95090aa649
git diff --full-index --no-ext-diff 67df460dee73f90b93eee203ebcbe7bd9976cb03 da096e04baf979ac35531172c7a1de95090aa649 -- README.md

# 문서/로컬 파일 검증: 출력만 생성하며 source나 remote를 변경하지 않음
python3 /Users/twoimo/.codex/worktrees/marker-memory-lifetime-20261001/tzudong/apps/web/performance/repository-quality-20261004/agents/astra-historical/readme/validate-readme.py /Users/twoimo/.codex/worktrees/promotion-sync-20261004/tzudong
git diff --check -- README.md README.ko.md
git diff --numstat -- README.md README.ko.md
git apply --reverse --check /Users/twoimo/.codex/worktrees/marker-memory-lifetime-20261001/tzudong/apps/web/performance/repository-quality-20261004/agents/astra-historical/readme/readme.patch
```

기준 SHA: `7a430454cf90a4d9f1ba0ce35ad3ffd5022ceebd`. 현재 저장된 결과는 정적 검증 14/14, local link 62개, anchor 8개, 누락 0개, 두 README 각각 +23/-2다. reverse apply는 `--check`만 사용하여 파일을 되돌리지 않는다.

README 코드 블록의 `git clone`/`npm ci`/`npm run dev`는 사용자를 위한 문서 예시이고 이 audit에서 실행하지 않았다. runtime/DB/provider/배포 확인이 필요하면 그 scope를 가진 담당자가 별도 증거를 생성해야 한다.
