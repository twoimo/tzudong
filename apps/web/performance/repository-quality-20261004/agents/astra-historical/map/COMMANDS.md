# 재현 명령

모든 GitHub 작업은 읽기 전용이며 아래 명령은 commit/push/설정 변경을 하지 않는다. source 기준은 PR3114 SHA `7a430454cf90a4d9f1ba0ce35ad3ffd5022ceebd`이다. 실행 전 HEAD를 확인한다. 이 문서는 자동 실행 스크립트가 아니다.

```sh
cd /Users/twoimo/.codex/worktrees/promotion-sync-20261004/tzudong
git rev-parse HEAD
git branch --show-current
git status --short
gh pr view 3031 --json number,headRefOid,baseRefOid,headRefName,baseRefName,state,url,files
gh pr view 3032 --json number,headRefOid,baseRefOid,headRefName,baseRefName,state,url,files
gh pr view 3114 --json number,headRefOid,baseRefOid,state,url
git merge-base d75e3360f393038a64846a3c6b0a4daa56b4d38a cd86c106b468c40e83a2e2edf39b49c3b9529937
git merge-base d75e3360f393038a64846a3c6b0a4daa56b4d38a 76afb0634b6710581aa296a9644929313e24b36f
git diff --no-ext-diff d75e3360f393038a64846a3c6b0a4daa56b4d38a cd86c106b468c40e83a2e2edf39b49c3b9529937
git diff --no-ext-diff d75e3360f393038a64846a3c6b0a4daa56b4d38a 76afb0634b6710581aa296a9644929313e24b36f
```

실제로 수행한 좁은 unit 검사:

```sh
cd /Users/twoimo/.codex/worktrees/promotion-sync-20261004/tzudong/apps/web
/Users/twoimo/.bun/bin/bun test tests-unit/map-restaurant-lookup.test.ts tests-unit/naver-map-selection-helpers.test.ts tests-unit/home-map-youtube-kpi.test.ts tests-unit/overseas-region-filter.test.ts
```

실제로 수행한 offline semantic probe(표준 출력은 정제 JSON, network 없음):

```sh
cd /Users/twoimo/.codex/worktrees/promotion-sync-20261004/tzudong/apps/web
/Users/twoimo/.bun/bin/bun /Users/twoimo/.codex/worktrees/marker-memory-lifetime-20261001/tzudong/apps/web/performance/repository-quality-20261004/agents/astra-historical/map/reproduce.ts
```

다른 candidate로 재현하려면 `TZUDONG_SOURCE_ROOT`와 읽기 전용 `TZUDONG_TYPESCRIPT_PATH`를 명시할 수 있다. 보고서의 결과는 기록된 source hashes에만 해당하며 바뀐 source에서의 실행은 별도 결과다. 기존 artifact/frozen evidence에 출력을 덮어쓰지 않는다.

G037는 source/blob 비교만 수행했다. 예를 들어 다음은 DB나 workflow를 실행하지 않는다.

```sh
git diff --name-only d75e3360f393038a64846a3c6b0a4daa56b4d38a cd86c106b468c40e83a2e2edf39b49c3b9529937 -- ':(glob)**/*g037*' ':(glob)**/*G037*'
git diff --name-only d75e3360f393038a64846a3c6b0a4daa56b4d38a 76afb0634b6710581aa296a9644929313e24b36f -- ':(glob)**/*g037*' ':(glob)**/*G037*'
git rev-parse d75e3360f393038a64846a3c6b0a4daa56b4d38a:.github/workflows/g037-hosted-closure.yml
git rev-parse cd86c106b468c40e83a2e2edf39b49c3b9529937:.github/workflows/g037-hosted-closure.yml
git rev-parse 76afb0634b6710581aa296a9644929313e24b36f:.github/workflows/g037-hosted-closure.yml
git rev-parse 7a430454cf90a4d9f1ba0ce35ad3ffd5022ceebd:.github/workflows/g037-hosted-closure.yml
git diff --check
```
