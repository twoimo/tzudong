# Cloudflare Builds 거버넌스 CI

기준일: **2026-11-12 KST**. 같은 작업 시점은 UTC로 2026-11-11이다.

Cloudflare Workers Builds에서 GitHub `Release`의 실제 거버넌스 검사를 병행
실행하고, 해당 커밋의 결과를 별도 `tzudong-ci-governance` Worker에 게시한다.
웹 앱 배포와 전체 CI 이전은 이 단계의 범위가 아니다. GitHub의 기존 필수
검사는 동일 SHA 비교와 보호 규칙 확인이 끝날 때까지 유지한다.

## Main 중심 전환 후보: 원격 적용 전

현재 [.github/cloudflare/build-settings.json](../../.github/cloudflare/build-settings.json)은
production branch와 build/deploy의 `--branch`를 함께 `main`으로 지정한다.
이것은 [main 중심 전환](main-first-transition.md)의 **적용 예정 소스 구성**이며,
이 변경에서 Workers Builds 설정 변경이나 main 실행 확인은 하지 않았다.

최종 `develop → data → main` 보호 승격이 끝난 뒤 기존 trigger를 읽어 복구 값을
보관하고, 같은 trigger의 세 값을 함께 바꾼다. root, preview 비활성화, 자격 증명,
고정 도구 버전과 예산은 유지한다. 저장된 설정과 native main build를 다시 읽고,
공개 receipt의 commit·tree·build ID 및 산출물 해시를 같은 실행과 대조한다.
공급자 접근이 없으면 원격 적용을 미완료로 기록한다. 기존 develop 연결의 성공은
main의 필수 GitHub 검사를 대신하지 않는다. 아래 develop 설정과 실행 수치는
2026-11-12의 이력이며 이번 main 전환이 완료됐다는 증거가 아니다.

## 구성 및 검증 기록

아래 표는 **2026-11-12 KST 후속 작업 시작 시점**에 확인한 구성이다. 최신 커밋의 실행 결과는
[PR #3764의 검사](https://github.com/twoimo/tzudong/pull/3764/checks),
공급자의 build 결과 및 GitHub native checks에서 확인한다.

| 항목 | 상태 |
| --- | --- |
| GitHub 기준 소스 | `develop`의 `4becfc06c2b9c9246f3f8ba0fa1f46b61cc45ecc`; 정리 #3759와 이전 #3764 병합 포함 |
| Cloudflare 대상 | `tzudong-ci-governance` Worker 생성 확인. Worker tag: `76d391fe6f524121b3b9d74f1b3fa24c` |
| Git repository 연결 | 연결 UUID: `e00c02fa-0913-4361-bd2b-56a017f441a3` 생성 확인 |
| Workers Builds 설정·실행 | 단일 production branch와 두 명령은 `develop`, root `/.github/cloudflare`, cache 활성, preview 비활성. 설정 API readback 및 후속 develop push 두 건 성공 |
| GitHub 보호 규칙 | branch 응답에서 `Release`·`Promotion Path` 필수 상태 확인. 세부 branch-protection 조회는 이전에 HTTP 403; 기존 required checks 변경 안 함 |
| 이전 저장소 정리 | [PR #3759](https://github.com/twoimo/tzudong/pull/3759)의 develop 병합을 확인하고 README·문서 구조와 CI 소유권을 함께 통합 |

설정 파일이 존재하거나 로컬 테스트가 통과한 것만으로 Cloudflare 검사가 실행된
것은 아니다. Worker·저장소 연결 생성과 해당 SHA의 실제 build 성공을 구분한다.

### develop 자동 실행 확인

#3764 병합 직후의 수동 실행과 다음의 **native push 실행**을 구분한다.

| 소스 SHA | Cloudflare build ID | 생성 → 종료 | 결과 |
| --- | --- | ---: | --- |
| `6bab8a57037f3d79a1bc529a6e81af01fad48fb1` | `75f60b5f-bd7f-41c8-8699-baca7e2fa378` | 192.602초 | `push_event`, success |
| `4becfc06c2b9c9246f3f8ba0fa1f46b61cc45ecc` | `0f7d3085-c275-4439-a39d-3658dd2d5ec0` | 202.400초 | `push_event`, success |

두 번째 실행의 [native check](https://github.com/twoimo/tzudong/runs/130751575927)와
[공개 receipt](https://tzudong-ci-governance.twoimo.workers.dev/receipt)의
commit·tree(`96aaccb5c939e0ea2bbf6250e42e3bc9409c7926`)·build ID가 일치했다.
실제 다섯 검사 단계는 146.137초다. 해당 SHA의 GitHub 체크 23개도 모두 성공했다.
공개 URL은 계속 최신 성공 배포로 바뀌므로 이 기록의 SHA와 조회 시점의 SHA를
구분한다. 아래에서 설명하는 자동 HTTP 대조는 이 확인 이후의 후속 변경이다.

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

## 이전 develop 연결 설정 기록

설정 파일과 명령은 [.github/cloudflare/](../../.github/cloudflare/README.md)에 있다.
Workers Builds는 build와 deploy 명령을 별도 단계로 실행한다.
아래는 당시 PR 검증과 보호된 develop 병합 후 적용한 연속 실행 설정이다.
초기 검증에는 작업 브랜치 `ci/cloudflare-free-migration-20261112`만 연결했고,
두 명령의 `--branch`도 그 작업 브랜치와 일치시켰다. 설정 파일 변경만으로
원격 전환을 완료했다고 보지 않으며 최종 원격 상태는 PR의 실행 기록을 따른다.
([공식 설정 문서](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/))

| 설정 | 값 |
| --- | --- |
| Worker | `tzudong-ci-governance` |
| Git repository | `twoimo/tzudong` |
| Production branch | `develop` — 거버넌스 Worker의 기준 브랜치 |
| Root directory | `/.github/cloudflare` |
| Build command | `node ../scripts/run-cloudflare-governance.mjs --branch develop` |
| Deploy command | `node ../scripts/deploy-cloudflare-governance.mjs --branch develop` |
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

Wrangler 성공 후에는 자격 증명 없는 고정 HTTPS 요청으로 `/receipt`, `/health`,
artifact와 checksum을 읽는다. 전체 receipt와 health의 정체성, artifact의
바이트 수·SHA-256, checksum, 네 응답의 `no-store`를 대조한 뒤에만 `deployed`를
반환한다. redirect, 무제한 응답, 오래된 성공, 부분 응답은 허용하지 않는다.
전파 지연을 위한 재시도는 최대 세 번이며 전체 배포 예산의 마지막 45초 안에
끝나야 한다. 대조 실패는 실행 실패로 남기며 이미 수행한 배포를 자동 rollback하지 않는다.

## 무료 예산과 실행 상한

[Workers Builds 공식 한도](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)의
Free 기준은 계정당 월 **3,000분**, 동시 실행 **1개**, 실행당 **20분**,
**2 vCPU / 8 GB RAM / 20 GB 디스크**다. 같은 계정의 Bitcoin 관련 프로젝트와
다른 Workers Builds도 이 시간과 동시 실행 슬롯을 공유한다.

| 구분 | 거버넌스 빌드의 기준 |
| --- | --- |
| 거버넌스 runner | 최대 10분; 시간 초과는 실패 |
| 잠긴 npm 설치 | 최대 4분 |
| 설치·Wrangler·HTTP 대조 합계 | 최대 7분; 마지막 45초를 HTTP 대조에 확보 |
| Wrangler 배포 | 최대 3분이되 HTTP 대조 예비분을 제외한 남은 시간으로 제한 |
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
포함해 기록하고, 불필요한 예약 실행이나 모든 브랜치 preview를 추가하지 않는다.

후속 작업 시작 시 계정의 Worker 다섯 개에서 11월 이력 210건을 조회했다.
초기화(없으면 실행 시작)부터 종료까지 합계는 **약 2,123.77분**이고,
그중 `tzudong-ci-governance`는 8건 **24.41분**이다. 시작 시각이 없는 11건은
합계에서 제외했다. 이는 **공식 사용량·청구 분량·잔여 quota가 아닌 관측 시간**이다.
2,100분 운영 목표는 넘었지만, 한도 API는
`has_reached_build_minutes_limit: false`와 다음 갱신 시각
**2026-12-01 08:59:59.999 KST**를 반환했다. API에는 2,100분 임계 설정이나
누적·잔여 분량 필드가 없으므로 목표 자동 차단을 구현했다고 표시하지 않는다.

Cloudflare Free의 한도 소진은 이 별도 검사 경로의 연속성을 제한할 수 있다.
이 상태에서는 새 trigger·preview·중복 예약을 추가하지 않고 GitHub의 기존
필수 검사 경로를 유지한다. 같은 trigger에 더 최신 빌드가 대기 중이면 이전
대기 빌드를 생략하는 기능은 [공급자가 제공한다](https://developers.cloudflare.com/changelog/post/2026-07-24-skip-superseded-builds/).
진행 중 빌드까지 자동 취소한다는 의미는 아니다.

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
preview는 비활성화하고 지정한 저장소의 단일 신뢰 브랜치만 연결한다.
최초 검증은 작업 브랜치로 실행했고, 기존 연결은 develop이었다. main 중심 정책
설치 후에는 위 순서대로 main 하나로 정렬한다. fork PR이나 임의 branch의 코드를 배포 토큰이 있는
경로에서 실행하지 않는다.

## GitHub에서 계속 맡는 검사

GitHub `Release`, 전체 8-shard 단위 테스트, 앱 build/lint/typecheck, 플랫폼별
검사, CodeQL, Security/npm/pip 감사, Dependabot, Nightly, 환경 보호와
보호된 소스 PR을 유지한다. main 중심 정책은 기존 `develop → data → main`
경로로 한 번 더 설치한 뒤 main PR로 전환한다. 기존 artifact 업로드와 보존
계약도 유지한다. 별도 CI Worker가 성공했다는 사실로 이 작업들의 성공 상태를
대신 만들지 않는다.

주간 Dependency Freshness도 Web CI와 같은 고정 Chromium 준비 helper를 쓴다.
실제 전체 브라우저·headless shell 실행을 확인하고 공유 라이브러리가 없다는
진단이 있을 때만 OS 의존성을 설치한다. 일반 launch·download 실패는 그대로
실패 처리한다. 설치 단계의 중복 npm audit만 제거하며 Security의 독립 감사와
Freshness의 lint·전체 unit·typecheck parity·build 네 검사는 유지한다.

### 로그 경계 검사의 불필요한 정규식 탐색

후속 PR의 [Security 실행](https://github.com/twoimo/tzudong/actions/runs/43092578870/job/130773156365)에서
`test_serialized_over_65536_is_reduced_with_marker` 한 건이 약 172초를 소비했다.
원인은 직렬화 크기 검사 앞에서 구분자가 없는 긴 문자열에 URL userinfo와
민감 필드 정규식을 반복 적용하는 경로였다.

`backend/utils/privacy_log.py`는 해당 정규식 직전의 문자열에 필수 구분자가
존재하는지 먼저 확인한다. URL 정규식은 `://`와 `@`, 민감 필드 정규식은
`:` 또는 `=`가 반드시 필요하다. 이 조건이 없을 때만 탐색을 생략하며
기존 정규식·치환 순서·표식·길이와 깊이 제한은 유지한다. 이메일·전화번호·Bearer
등 다른 마스킹 단계는 계속 실행한다.

| 동일 로컬 fixture 관측 | 결과 |
| --- | ---: |
| 변경 전, 4,000문자 문자열 100개 | 127.973초 |
| 실제 변경 소스, 같은 fixture | 0.150초 |
| 두 출력 | 모두 165바이트, SHA-256 일치 |
| 소스 편집 전 메모리 내 prototype 동등성 대조 | 합성 입력 542건의 JSON 바이트 일치 |

출력 SHA-256은 `21a953e737b2fa5c5598cbea3f5d14f8ef523e0258afbbeeef25fefc73ffcf4f`다.
도구 stdout에서 옮긴 정확한 수치·소스 blob·관측 한계는
[진단 영수증](../../apps/web/performance/ci-redaction-diagnostic-20261112/receipt.json)과
[artifact map](../../apps/web/performance/ci-redaction-diagnostic-20261112/artifact-map.json)에 보존한다.
전후 각각 1회 관측이며 원본에만 호출 수 계측 wrapper가 있다. 계측 당시 Python
정확한 버전은 기록하지 않았고 원본 스크립트·raw 파일도 따로 보존하지 않았다.
542건은 소스 편집 전 prototype 비교이며 실제 수정 소스의 재실행 결과로 취급하지 않는다.
절대·상대·노이즈 예산은 지정하지 않았고 노이즈 분포도 측정하지 않았다.
이는 해당 fixture의 진단 기록이며 정식 benchmark나 전체 CI 개선 주장에 해당하지 않고,
G003 admitted slice는 0개다. 구분자가 있는 모든 입력의 선형 실행 시간을 보장하지 않는다.
기존 큰 fixture와 보안 검사는 그대로 유지하고, separator가 없는 민감값도 계속
마스킹되는 회귀 검사를 추가했다.

### 최초 기본 브랜치 활성화 의존성 기록

당시 시작 시점의 기본 브랜치 `main`은 `98f774346c477ac74058cdcbdf8636b0aff8b54c`였다.
추가한 Cloudflare npm 단위는 develop에만 있어 당시 기본 브랜치의 Dependabot는
일곱 단위였다. 변경된 예약 Freshness·Security·Web CI·Nightly 정의도
그 `main` 승격 전에는 예약 실행의 새 정의로 활성화되지 않았다.
[Dependabot](https://docs.github.com/en/code-security/concepts/supply-chain-security/about-the-dependabot-yml-file)와
[schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)은
기본 브랜치에서 정의를 읽는다.

당시 `Promotion Path`는 `develop → data → main`만 허용했다. 누적 앱·SQL·백엔드
의존성 변경도 포함되므로 CI 파일만 직행시키거나 기본 브랜치를 바꿔 우회하지 않는다.
승격 PR에서 실제 소스 SHA와 포함 범위를 검토하고, 기본 브랜치 반영 후 설정과
예약 실행을 따로 확인한다. develop Worker 성공은 이 활성화의 증거가 아니다.

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

### 이전 develop 연속 실행 전환 절차

다음은 초기 설치 절차의 기록이다. 현재 main 중심 전환에는 문서 맨 위의
별도 순서를 적용하며 develop 연결을 다시 만들지 않는다.

1. PR의 실제 검사와 CodeQL 결과를 확인하고 보호 규칙을 통과하는 정상 PR 병합으로 develop에 반영한다.
2. Workers Builds의 기존 trigger 하나에서 branch를 `develop`으로, build/deploy 명령의 `--branch`도 `develop`으로 함께 바꾼다. Preview는 계속 끈다.
3. 변경한 trigger와 Worker의 production branch를 다시 읽어 설정 파일과 비교한다. 다른 브랜치와 다른 Worker는 변경하지 않는다.
4. 병합 SHA의 develop build를 실행하고 native GitHub check, 공개 receipt, 산출물 checksum, 배포 version을 같은 SHA로 대조한다.
5. 이후 develop push가 동일 trigger로 자동 실행된다. GitHub 필수 검사 교체는 보호 규칙을 확인할 수 있을 때 별도로 수행한다.

병합 또는 원격 변경이 차단되면 현재 동작하는 작업 브랜치 연결을 유지하고,
PR에 차단된 단계와 원인을 기록한다. 원격 설정을 바꾼 뒤 실패하면 앞서 확인한
branch와 명령으로 trigger를 복구하며, 실패한 커밋을 성공으로 표시하지 않는다.

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
