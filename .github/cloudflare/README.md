# Cloudflare 거버넌스 CI Worker

`tzudong-ci-governance`는 실제 거버넌스 검사 결과를 게시하는 별도 Worker다.
현재 단계는 GitHub `Release`와의 병행 검증이다. 전체 설정·실측 기준·예산·활성화
상태는 [운영 문서](../../docs/operations/cloudflare-ci.md)를 따른다.

## 파일과 역할

| 파일 | 역할 |
| --- | --- |
| [package.json](package.json) · [package-lock.json](package-lock.json) | npm `11.6.2`와 정확한 Wrangler 의존성의 설치 기준 |
| [build-settings.json](build-settings.json) | develop branch, root directory, 명령과 빌드 변수의 검토 기준 |
| [wrangler.jsonc](wrangler.jsonc) | 이 CI Worker의 명시적 배포 대상 |
| [거버넌스 runner](../scripts/run-cloudflare-governance.mjs) | 원격 실행 정체성 확인, 실제 검사 실행, 해당 SHA 결과 생성 |
| [배포 runner](../scripts/deploy-cloudflare-governance.mjs) | receipt·도구 버전 재검증, 잠긴 설치, 해당 Worker 배포 |

## Workers Builds 설정

Root directory는 **`/.github/cloudflare`**, production branch는
**`develop`**, preview builds는 **비활성화**한다.
여기서 production branch는 이 CI Worker의 배포 기준이며 서비스 앱의 `main`
승격을 뜻하지 않는다. 아래 설정은 PR의 보호된 develop 병합 후 적용한다.
병합 전 검증은 지정한 작업 브랜치와 같은 이름의 `--branch` 인자로 실행하며,
활성 설정과 최종 전환 결과는 [PR #3764](https://github.com/twoimo/tzudong/pull/3764)에서 확인한다.

Build command:

```sh
node ../scripts/run-cloudflare-governance.mjs --branch develop
```

Deploy command:

```sh
node ../scripts/deploy-cloudflare-governance.mjs --branch develop
```

빌드 변수는 `NODE_VERSION=24.22.1`, `BUN_VERSION=1.4.0`,
`SKIP_DEPENDENCY_INSTALL=1`,
`WRANGLER_SEND_METRICS=false`다. npm은 이 폴더의 `packageManager`에서
`npm@11.6.2`를 선택한다. [공식 버전 선택 규칙](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/#package-manager-versions)을
따르며 임의 `NPM_VERSION` 변수로 대체하지 않는다.

배포 runner가 receipt를 검증한 뒤 `npm ci --ignore-scripts --no-audit --fund=false`로
이 패키지만 설치하고, 설치된 Wrangler에 이 폴더의 config를 명시한다.
거버넌스 검사 10분, 의존성 설치 4분, 배포 3분의 실행 상한을 두며 실패를
성공으로 바꾸는 fallback은 사용하지 않는다.

## 로컬 진단

Node 24, Bun 1.4.0, Python 3.11 이상과 Git이 준비된 저장소 루트에서 실행한다.

```sh
node .github/scripts/run-cloudflare-governance.mjs --local --commit "$(git rev-parse HEAD)"
```

`--local`의 결과는 로컬 진단이며 Cloudflare build 성공 또는 배포 영수증이 아니다.
변경 중인 tracked 파일이 있는 로컬 결과도 진단에만 사용한다. 원격 모드는 실제
HEAD·tree·branch와 공급자 실행 정보를 대조하고 tracked worktree가 깨끗해야 한다.
기본 원격 모드의 `WORKERS_CI_*` 값을 수동으로 만들어 로컬 실행을 원격 실행처럼
보이게 하지 않는다. 원격 연결·성공 여부는 [운영 문서의 현재 상태](../../docs/operations/cloudflare-ci.md#구성-및-검증-기록)에
실제 공급자 확인 결과로 기록한다.

## 결과 확인

성공한 runner는 `generated/`에 현재 실행의 `receipt.json`, 검증된
`backlog.scored.json`과 SHA-256 파일, 배포용 모듈을 만든다. 시작 시 이전 결과를
지우며 실패한 실행은 게시할 결과를 남기지 않는다. 이 폴더는 커밋 대상이 아니다.

| Worker 경로 | 결과 |
| --- | --- |
| `/health` | 검사 범위와 현재 배포의 commit·tree·build ID |
| `/receipt` | 같은 실행의 도구 버전, 검사별 결과·시간, 산출물 해시 |
| `/artifacts/backlog.scored.json` | 검사에서 검증한 거버넌스 fixture 결과 |
| `/artifacts/backlog.scored.json.sha256` | 해당 결과의 SHA-256 |

이 경로의 성공은 `governance-contracts-only` 범위다. 전체 웹 테스트나 서비스
배포의 성공을 뜻하지 않는다. Worker는 로컬 진단 receipt, 잘못된 receipt 또는
해시가 맞지 않는 결과를 성공 응답으로 제공하지 않는다. 실제 Worker URL은 원격
활성화 확인 후 운영 문서에 기록한다.

새 빌드가 실패하면 기존 배포가 계속 응답할 수 있다. HTTP 200만 보고 새 커밋을
통과 처리하지 않고, 조회한 receipt의 commit·build ID를 확인하려는 실행과 대조한다.

## 유지보수

Wrangler 변경은 이 패키지의 manifest와 lockfile을 함께 갱신하고 runner·배포
검증을 통과시킨다. 캐시나 이전 성공 영수증은 현재 SHA의 검사 결과를 대신할 수
없다. 이 Worker에 앱의 Supabase/Vercel 자격 증명이나 기존 서비스의 bindings를
추가하지 않는다. GitHub의 전체 검사와 필수 상태는 별도 전환 검증 전까지 유지한다.

Python 문서 검사는 외부 패키지를 설치하지 않는다. 빌드 이미지의 `python3`(3.11 이상)를 사용하고 실제 버전을 receipt에 기록한다. `PYTHON_VERSION`으로 별도 런타임 설치를 강제하지 않는다.
