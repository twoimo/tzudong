# Cloudflare 거버넌스 CI Worker

`tzudong-ci-governance`는 실제 거버넌스 검사 결과를 게시하는 별도 Worker다.
현재 단계는 GitHub `Release`와의 병행 검증이다. 전체 설정·실측 기준·예산·활성화
상태는 [운영 문서](../../docs/operations/cloudflare-ci.md)를 따른다.

현재 소스의 `main` 설정은 [main 중심 전환](../../docs/operations/main-first-transition.md)을
위한 **적용 예정 구성**이다. 이 변경은 Workers Builds 설정을 바꾸거나 원격 실행을
확인하지 않았다. 실제 연결은 먼저 읽어 확인하고, 보호된 최종 승격 이후 별도로
적용·검증한다. 이전 `develop` 실행 기록과 현재 공급자 상태를 혼동하지 않는다.

## 파일과 역할

| 파일 | 역할 |
| --- | --- |
| [package.json](package.json) · [package-lock.json](package-lock.json) | npm `11.6.2`와 정확한 Wrangler 의존성의 설치 기준 |
| [build-settings.json](build-settings.json) | 적용 예정 main branch, root directory, 명령과 빌드 변수의 검토 기준 |
| [wrangler.jsonc](wrangler.jsonc) | 이 CI Worker의 명시적 배포 대상 |
| [거버넌스 runner](../scripts/run-cloudflare-governance.mjs) | 원격 실행 정체성 확인, 실제 검사 실행, 해당 SHA 결과 생성 |
| [배포 runner](../scripts/deploy-cloudflare-governance.mjs) | receipt·도구 버전 재검증, 잠긴 설치, 해당 Worker 배포와 공개 결과 대조 |

## Workers Builds 설정

Root directory는 **`/.github/cloudflare`**, production branch는
**`main`**, preview builds는 **비활성화**한다.
여기서 production branch는 이 CI Worker의 배포 기준이며 서비스 앱의 `main`
승격을 뜻하지 않는다. 아래 설정은 main 중심 정책의 최종 보호된 승격 후,
동일 trigger의 branch와 두 명령을 함께 바꾸는 별도 작업으로 적용한다.
기존 값을 복구 입력으로 보관하고 저장된 설정 및 main의 native build·receipt를
다시 확인한다. [PR #3764](https://github.com/twoimo/tzudong/pull/3764)는 이전 develop
전환의 기록이며 이번 main 설정이 적용됐다는 증거가 아니다.

Build command:

```sh
node ../scripts/run-cloudflare-governance.mjs --branch main
```

Deploy command:

```sh
node ../scripts/deploy-cloudflare-governance.mjs --branch main
```

빌드 변수는 `NODE_VERSION=24.22.1`, `BUN_VERSION=1.4.0`,
`SKIP_DEPENDENCY_INSTALL=1`,
`WRANGLER_SEND_METRICS=false`다. npm은 이 폴더의 `packageManager`에서
`npm@11.6.2`를 선택한다. [공식 버전 선택 규칙](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/#package-manager-versions)을
따르며 임의 `NPM_VERSION` 변수로 대체하지 않는다.

배포 runner가 receipt를 검증한 뒤 `npm ci --ignore-scripts --no-audit --fund=false`로
이 패키지만 설치하고, 설치된 Wrangler에 이 폴더의 config를 명시한다.
거버넌스 검사는 10분, 설치부터 공개 결과 대조까지는 합계 7분으로 제한한다.
설치는 최대 4분, Wrangler는 최대 3분이지만 마지막 45초를 공개 결과 대조에
남기도록 공통 마감 시각으로 제한한다. 실패를 성공으로 바꾸는 fallback은 없다.

Wrangler 종료 코드가 0이어도 아직 성공으로 반환하지 않는다. 고정된 공개
Worker의 receipt·health·artifact·checksum 네 응답을 최대 세 번 조회하고,
이번 실행의 전체 receipt, commit·tree·branch·build ID, 산출물 바이트·해시와
`no-store`를 대조한다. 요청에 토큰을 보내거나 redirect를 따라가지 않으며,
응답 크기·요청 시간·전체 대조 시간을 제한한다. 이전 성공 배포, 누락·과대 응답,
시간 초과 또는 취소는 이번 실행의 배포 확인 실패다. 이미 수행된 Wrangler
배포를 자동으로 되돌렸다는 의미는 아니다.

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
