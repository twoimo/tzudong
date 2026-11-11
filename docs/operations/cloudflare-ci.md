# Cloudflare Builds 거버넌스 병행 검증

기준일: **2026-11-12 KST**. 같은 작업 시점은 UTC로 2026-11-11이다.

Cloudflare Workers Builds에서 GitHub `Release`의 실제 거버넌스 검사를 병행
실행하고, 해당 커밋의 결과를 별도 `tzudong-ci-governance` Worker에 게시한다.
웹 앱 배포와 전체 CI 이전은 이 단계의 범위가 아니다. GitHub의 기존 필수
검사는 동일 SHA 비교와 보호 규칙 확인이 끝날 때까지 유지한다.

## 구성 및 검증 기록

아래 표는 **2026-11-11 UTC**에 확인한 구성이다. 최신 커밋의 실행 결과는
[PR #3764의 검사](https://github.com/twoimo/tzudong/pull/3764/checks),
공급자의 build 결과 및 GitHub native checks에서 확인한다.

| 항목 | 상태 |
| --- | --- |
| GitHub 기준 소스 | `develop`의 `87abce4cf85f4c4f0d2763ec5449ee573fb17b95` 정리 작업까지 통합한 `ci/cloudflare-free-migration-20261112` |
| Cloudflare 대상 | `tzudong-ci-governance` Worker 생성 확인. Worker tag: `76d391fe6f524121b3b9d74f1b3fa24c` |
| Git repository 연결 | 연결 UUID: `e00c02fa-0913-4361-bd2b-56a017f441a3` 생성 확인 |
| Workers Builds 설정·실행 | 지정 branch의 native push trigger와 실제 검사·배포·HTTP 조회 성공 확인. 아래 첫 원격 실행 기록 참조 |
| GitHub 보호 규칙 | 현재 연결의 branch-protection 조회가 HTTP 403. 기존 required checks 변경 안 함 |
| 이전 저장소 정리 | [PR #3759](https://github.com/twoimo/tzudong/pull/3759)의 develop 병합을 확인하고 README·문서 구조와 CI 소유권을 함께 통합 |

설정 파일이 존재하거나 로컬 테스트가 통과한 것만으로 Cloudflare 검사가 실행된
것은 아니다. Worker·저장소 연결 생성과 해당 SHA의 실제 build 성공을 구분한다.

## 왜 이 범위부터 옮기는가

아래는 **GitHub Actions 관측값**이다. Cloudflare 이전 후 성능으로 해석하지 않는다.

| 관측 | 실행 시간과 범위 | 근거 |
| --- | --- | --- |
| 최근 `develop` CI | 전체 6분 55초. shard 1은 409초 중 Chromium 준비 162초, 단위 테스트 211초 | [run 43065906293](https://github.com/twoimo/tzudong/actions/runs/43065906293) |
| 앞선 `develop` CI | 전체 8분 37초. 비교 대상 Chromium 준비 단계 294초 | [run 43062402061](https://github.com/twoimo/tzudong/actions/runs/43062402061) |
| 문서 정리 PR CI | 전체 11분 55초. 미분류 루트 입력으로 전체 벤치마크가 선택된 Windows npm/Bun 작업은 각각 710초/681초 | [run 43065035954](https://github.com/twoimo/tzudong/actions/runs/43065035954) |
| `main` 주간 CI, 2026-11-08 | 전체 28분 25초. 과거 브랜치·설정의 실행으로, 최신 `develop`의 소요 시간이 아님 | [run 42528565890](https://github.com/twoimo/tzudong/actions/runs/42528565890) |
| `develop` Nightly | 전체 39분 59초. 단위 테스트 1,182초, 마이그레이션 318초, 브라우저 263초 | [run 43062413888](https://github.com/twoimo/tzudong/actions/runs/43062413888) |

최근 `develop` 실행의 8개 shard를 합산하면 Chromium 준비 단계는 **945초**,
단위 테스트 단계는 **939초**다. 이 값은 병렬 작업의 단계 시간 합계이며,
사용자가 기다린 6분 55초와 다른 지표다. 따라서 전체 작업을 한 대의 20분
러너에 그대로 넣거나 브라우저 검사를 생략해 성공으로 바꾸지 않는다.

`Release`의 scorer·독립 validator·소스 계약·문서 무결성 검사는 웹 패키지
설치 없이 실행할 수 있다. 이 작은 실제 검사 묶음을 먼저 비교한다. Cloudflare
실행이 생긴 뒤 같은 SHA에서 checkout, 검사, 배포, 대기 시간을 구분해 측정한다.

## 고정할 Cloudflare 설정

설정 파일과 명령은 [.github/cloudflare/](../../.github/cloudflare/README.md)에 있다.
Workers Builds는 build와 deploy 명령을 별도 단계로 실행한다.
([공식 설정 문서](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/))

| 설정 | 값 |
| --- | --- |
| Worker | `tzudong-ci-governance` |
| Git repository | `twoimo/tzudong` |
| Production branch | `ci/cloudflare-free-migration-20261112` — pilot Worker의 기준 브랜치 |
| Root directory | `/.github/cloudflare` |
| Build command | `node ../scripts/run-cloudflare-governance.mjs --branch ci/cloudflare-free-migration-20261112` |
| Deploy command | `node ../scripts/deploy-cloudflare-governance.mjs --branch ci/cloudflare-free-migration-20261112` |
| Preview builds | `false` |
| `NODE_VERSION` | `24.22.1` |
| `BUN_VERSION` | `1.4.0` |
| Python | 빌드 이미지의 `python3` 사용, 3.11 이상 검증 및 실제 버전 기록 |
| `SKIP_DEPENDENCY_INSTALL` | `1` |
| `WRANGLER_SEND_METRICS` | `false` |

Cloudflare의 npm 선택은 프로젝트 루트 `package.json`의 `packageManager`를
사용한다. 그래서 루트를 `/.github/cloudflare`로 고정하고 그 패키지에서
`npm@11.6.2`, Node `24.x`, 정확한 Wrangler 버전과 lockfile을 관리한다.
`NPM_VERSION`이라는 임의 변수를 만들어 버전 고정을 대신하지 않는다.
([빌드 이미지와 버전 선택](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/))

Python은 표준 라이브러리 문서 검사에만 사용한다. 별도 `PYTHON_VERSION` 선택으로
오래 걸리는 런타임 설치를 추가하지 않고, 빌드 이미지의 `python3`가 3.11 이상인지
확인한 뒤 실제 버전을 receipt에 기록한다. 실행 파일 부재나 검사 실패는 실패로 처리한다.

검사 runner는 기본적으로 원격 환경을 요구한다. 공급자가 주입한
`WORKERS_CI`, `WORKERS_CI_BUILD_UUID`, `WORKERS_CI_COMMIT_SHA`,
`WORKERS_CI_BRANCH`와 실제 Git 소스를 검증한다. 이 값들을 사용자 정의 변수로
덮어써 원격 실행을 흉내 내지 않는다. `--local`은 로컬 진단 전용이며 원격 성공
영수증으로 승격하지 않는다.

배포 runner는 해당 실행의 receipt, SHA, branch, 도구 버전을 다시 확인한 뒤
잠긴 npm 의존성을 설치하고 로컬 Wrangler 실행 파일을 사용한다. Wrangler
대상은 항상 `.github/cloudflare/wrangler.jsonc`로 명시한다. 자동 프레임워크
감지로 웹 앱이나 다른 Worker의 설정을 선택하지 않는다.

## 무료 예산과 실행 상한

[Workers Builds 공식 한도](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)의
Free 기준은 계정당 월 **3,000분**, 동시 실행 **1개**, 실행당 **20분**,
**2 vCPU / 8 GB RAM / 20 GB 디스크**다. 같은 계정의 Bitcoin 관련 프로젝트와
다른 Workers Builds도 이 시간과 동시 실행 슬롯을 공유한다.

| 구분 | 이 pilot의 기준 |
| --- | --- |
| 거버넌스 runner | 최대 10분; 시간 초과는 실패 |
| 잠긴 npm 설치 | 최대 4분 |
| Wrangler 배포 | 최대 3분 |
| 공급자 전체 한도 | 20분; 위 단계 외 checkout·준비·정리 시간을 남겨 둠 |
| 계정 월간 운영 목표 | 모든 프로젝트 합계 2,100분 이내 |
| 계정 월간 예비분 | 나머지 900분 |

**2,100분 목표와 900분 예비분은 운영 계획이며 자동 집행되는 코드가 아니다.**
runner의 시간 제한은 한 번의 실행을 제한한다. 계정 월간 사용량과 공급자
한도 도달 여부는 별도로 확인한다. [한도 조회 API](https://developers.cloudflare.com/api/resources/workers_builds/methods/get_account_limits/)를
사용할 때도 조회 권한과 실제 응답을 확인한다.

월간 계산은 `tzudong 사용분 + Bitcoin 프로젝트 사용분 + 기타 사용분`으로 한다.
다른 사용량이 없다고 가정해 평균 5분이면 2,100분 안에 420회, 평균 8분이면
262회가 들어간다. 이는 계산 예시이며 호스팅 실측치가 아니다. 재시도도 사용량에
포함해 기록하고, pilot에 불필요한 예약 실행이나 모든 브랜치 preview를 추가하지 않는다.

## 자격 증명과 브랜치 경계

Cloudflare 배포 자격 증명은 이 새 CI Worker의 배포에만 사용한다. 빌드 구성용
API 권한과 실제 배포용 build token은 구분한다. 토큰 값은 저장소·로그·receipt에
넣지 않고, 기존 앱의 Supabase·Vercel·DB·provider secret을 이 프로젝트에 복사하지 않는다.

자동 생성 build token의 기본 권한은 여러 계정 리소스를 포함할 수 있다. 실제
토큰 권한을 읽어 확인하기 전에는 “Worker 하나로 권한 제한 완료”라고 기록하지
않는다. 단일 브랜치 pilot 연결에는 기존 build token을 선택할 수 있다. 초기
연결 시점의 token 권한 조회는 OAuth HTTP 403으로 확인되지 않았다. 이 동안
권한 최소화가 완료됐다고 표시하거나 preview 실행 범위를 확대하지 않는다.
([Builds API 권한과 build token](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/),
[자동 생성 토큰의 기본 권한](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#api-token))

거버넌스 검사와 npm 설치의 자식 프로세스에는 필요한 도구·경로 변수만 전달한다.
runner가 실행하는 자식 프로세스 중 Wrangler에만 배포 자격 증명을 전달한다.
이 환경 변수 제한은 토큰 자체의 계정 권한 축소를 뜻하지 않는다.
preview는 비활성화하고 지정한 저장소와
pilot branch만 연결한다. fork PR이나 임의 branch의 코드를 배포 토큰이 있는
경로에서 실행하지 않는다.

## GitHub에서 계속 맡는 검사

GitHub `Release`, 전체 8-shard 단위 테스트, 앱 build/lint/typecheck, 플랫폼별
검사, CodeQL, Security/npm/pip 감사, Dependabot, Nightly, 환경 보호와
`develop → data → main` 승격 경로를 유지한다. 기존 artifact 업로드와 보존
계약도 유지한다. 별도 CI Worker가 성공했다는 사실로 이 작업들의 성공 상태를
대신 만들지 않는다.

Cloudflare의 의존성 캐시는 설치 최적화용이다. 캐시 복구는 검사를 실행한 증거나
영수증 보관 수단이 아니다. 각 실행은 현재 SHA에 대해 다시 검사하고 새 결과를
만든다. [공식 캐시 문서](https://developers.cloudflare.com/workers/ci-cd/builds/build-caching/)도
캐시를 프로젝트 공유 데이터로 설명하며 별도 보존 한도를 둔다.

## 비교 후 전환할 때 확인할 것

1. 공급자 API에서 Worker, 저장소, root directory, 두 명령, branch, preview 비활성화를 읽어 확인한다.
2. 실제 build ID와 커밋 SHA를 receipt 및 GitHub의 같은 SHA 결과에 연결한다. 실패·취소·시간 초과도 비교 대상으로 남긴다.
3. scorer 출력과 해시, 검사 목록·결과, 도구 버전을 대조한다. 이전 실행의 성공이나 캐시만으로 현재 검사를 생략하지 않는다.
4. GitHub branch protection/ruleset을 읽을 수 있는 권한으로 실제 required-check 이름을 확인한다. 필요 변경은 승인된 범위에서 하고 다시 읽어 확인한다.
5. 이 단계의 증거가 쌓이기 전까지는 병행 검증으로 유지한다. 전환 중 문제가 생기면 새 pilot 연결을 중단하고 기존 GitHub 검사를 계속 사용한다.

전환 완료 기록에는 실제 SHA, GitHub run URL, Cloudflare build URL/ID,
Worker version, 비교 결과와 보호 규칙 readback을 남긴다. 이 문서의 초기 상태는
그 완료 기록을 대신하지 않는다.

## 확인된 첫 원격 실행

2026-11-11 UTC의 커밋 `d4eda9434f6ca7fc106767f664d79b1f185add37`에서
Cloudflare native push trigger, 실제 검사, 배포, HTTP 결과까지 확인했다.
이 기록은 해당 커밋의 거버넌스 범위이며 최신 HEAD의 전체 CI 통과를 대신하지 않는다.

| 관측 | 결과 |
| --- | --- |
| [Cloudflare native GitHub check](https://github.com/twoimo/tzudong/runs/130718748336) | `Workers Builds: tzudong-ci-governance`, success |
| Build ID | `3fd4f72b-4f1d-4bce-9f90-607b823e114e` |
| 생성부터 종료까지 | 146.516초 |
| 거버넌스 검사 | 5개 단계 모두 통과, 94.715초 |
| 실제 도구 | Node 24.22.1, Bun 1.4.0, Python 3.14.8, Git 2.43.0 |
| [공개 receipt](https://tzudong-ci-governance.twoimo.workers.dev/receipt) | HTTP 200, 같은 commit/tree/build ID, `no-store` |
| Scored fixture | 22,002바이트, receipt·실제 바이트·checksum의 SHA-256 일치 |

GitHub [같은 후보의 CI 실행](https://github.com/twoimo/tzudong/actions/runs/43076461540)에서
8개 shard의 브라우저 준비 단계 합계는 72초였다. 앞선 두 후보 실행에서는
78초와 74초였으며, 기준 실행의 945초보다 짧았다. 이 값은 브라우저 준비 단계의
병렬 작업 합계다. 큐 대기·전체 compiler benchmark를 포함한 전체 CI 개선율로
환산하지 않는다. 마지막 커밋의 통과 여부는 해당 SHA의 필수 검사에서 확인한다.
