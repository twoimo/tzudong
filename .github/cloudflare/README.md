# Cloudflare 거버넌스 CI Worker

`tzudong-ci-governance`는 실제 거버넌스 검사 결과를 게시하는 별도 Worker다.
계정의 Workers Builds 월간 한도가 소진되면 기존 필수 GitHub `Release`가 같은
다섯 거버넌스 검사를 실행한다. 전체 설정·실측 기준·예산·활성화 상태는
[운영 문서](../../docs/operations/cloudflare-ci.md)를 따른다.

2026-11-15 06:13:46 UTC 공급자 조회에서 단일 `main` 연결과 preview 비활성화를
확인했다. 계정 한도 응답은 `has_reached_build_minutes_limit: true`이고 갱신은
2026-11-30 23:59:59.999 UTC다. 이 한도는 조회 권한 거부나 브라우저 측정 환경의
정책 차단과 별개다. 이전 Cloudflare 실패를 성공으로 바꾸지 않는다.

## GitHub 대체 실행과 Cloudflare 연결 유지

[build-settings.json](build-settings.json)은 GitHub 대체 실행과 **보존하는 Cloudflare
구성**을 기록한다. 보호된
[Release workflow](../workflows/release-governance-ci.yml)는 실제 commit·tree를
확인한 다음 scorer·독립 validator, workflow 계약, 문서 무결성, benchmark 분류기,
Cloudflare runner·배포 실패 경로를 실행한다. 웹 의존성 설치나 새 배포 자격 증명은
필요하지 않다. GitHub `CI`, `Release`, `Security`, `Promotion Path` 필수 검사는
유지하며 `Release` 성공을 전체 웹·브라우저 실측 성공으로 해석하지 않는다.

후보 `8e47b8b970620a97423c2e1df1dda47456907588`의
[Release run 43686032434](https://github.com/twoimo/tzudong/actions/runs/43686032434)에서
다섯 검사와 artifact 보존이 모두 성공했다. 이후 2026-11-15 06:38:16 UTC에
빈 include/all-exclude 배열로 정지하려던 요청은 HTTP 400으로 거부되었다.
06:38:17 UTC readback에서 `branch_includes: ["main"]`, `branch_excludes: []`,
`auto_build_enabled: true`와 다른 설정이 그대로임을 확인했다.

공식 [branch-pattern 제한](https://developers.cloudflare.com/workers/ci-cd/builds/troubleshoot/#builds-api-errors)은
production trigger에 단일 literal branch와 빈 excludes만 허용한다. 이 필터로
정지를 구현하거나 공개 PATCH schema에 없는 필드를 보내지 않는다. 현재 경로는
GitHub `Release`를 필수 거버넌스 검사로 사용하고, Cloudflare의 한도 제한과 optional
실패를 그대로 남긴다. 자동 빌드 중단이 완료됐다는 주장은 하지 않는다.

Worker의 공개 서비스·배포 내용·저장소 연결·명령·토큰은 그대로다.
계정 quota가 갱신된 후 새 main push는 기존 연결로 다시 실행될 수 있다.
마지막 성공 Worker receipt는 과거 Cloudflare 실행의 증거로 남는다.
현재 SHA의 fallback 결과는 GitHub의 해당 SHA `Release` run과 기존 scored
artifact 두 파일에서 확인한다. GitHub 결과를 Cloudflare receipt로 게시하지 않는다.

## 파일과 역할

| 파일 | 역할 |
| --- | --- |
| [package.json](package.json) · [package-lock.json](package-lock.json) | npm `11.6.2`와 정확한 Wrangler 의존성의 설치 기준 |
| [build-settings.json](build-settings.json) | GitHub 대체 실행과 보존하는 main trigger·명령·빌드 변수 |
| [wrangler.jsonc](wrangler.jsonc) | 이 CI Worker의 명시적 배포 대상 |
| [거버넌스 runner](../scripts/run-cloudflare-governance.mjs) | 원격 실행 정체성 확인, 실제 검사 실행, 해당 SHA 결과 생성 |
| [배포 runner](../scripts/deploy-cloudflare-governance.mjs) | receipt·도구 버전 재검증, 잠긴 설치, 해당 Worker 배포와 공개 결과 대조 |

## 보존하는 Workers Builds 설정

Root directory는 **`/.github/cloudflare`**, production branch는
**`main`**, preview builds는 **비활성화**한다.
여기서 production branch는 이 CI Worker의 배포 기준이며 서비스 앱의 `main`
승격을 뜻하지 않는다. 한도 제한 동안에도 아래 명령과 root는 보존한다.
[PR #3764](https://github.com/twoimo/tzudong/pull/3764)는 이전 develop
전환의 기록이며 현재 SHA의 실행 증거가 아니다.

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
보이게 하지 않는다. 원격 연결·성공 여부는 [운영 문서의 현재 상태](../../docs/operations/cloudflare-ci.md#월간-한도와-github-대체-실행)에
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
해시가 맞지 않는 결과를 성공 응답으로 제공하지 않는다. 원격 실행 기록과 URL은
운영 문서에서 조회 시점의 SHA와 함께 확인한다.

새 빌드가 실패하면 기존 배포가 계속 응답할 수 있다. HTTP 200만 보고 새 커밋을
통과 처리하지 않고, 조회한 receipt의 commit·build ID를 확인하려는 실행과 대조한다.

## 유지보수

Wrangler 변경은 이 패키지의 manifest와 lockfile을 함께 갱신하고 runner·배포
검증을 통과시킨다. 캐시나 이전 성공 영수증은 현재 SHA의 검사 결과를 대신할 수
없다. 이 Worker에 앱의 Supabase/Vercel 자격 증명이나 기존 서비스의 bindings를
추가하지 않는다. GitHub의 전체 검사와 필수 상태는 유지한다.

Python 문서 검사는 외부 패키지를 설치하지 않는다. 빌드 이미지의 `python3`(3.11 이상)를 사용하고 실제 버전을 receipt에 기록한다. `PYTHON_VERSION`으로 별도 런타임 설치를 강제하지 않는다.
