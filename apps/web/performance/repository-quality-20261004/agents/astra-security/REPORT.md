# Tzudong 읽기 전용 보안·품질 감사 — 2026-10-04

감사는 완료했지만 “전체 해결” 상태는 아니다. 현재 소스에서 재현되는 레이아웃 명세 결함, 오래된 PR의 취약 의존성, 승격 대상 위반, 미분류 외부 검사 실패가 남아 있다. 이 감사는 소스·원격 상태를 변경하지 않았다. 실제 세션 기록은 `openai / gpt-6-astra / xhigh`이며 모델 대체는 없었다.

## 범위와 현재 상태

- 기준 소스: `readiness-core-20261004/tzudong`, `99f91157190058ac4691ec10046d3f520466ebd8`. 부모의 리뷰 업로드 변경은 별도 진행 중이다.
- 저장소 브랜치 **371개 / 4페이지**를 열거하고 각각의 `refs/heads/...`에서 열린 Code scanning 경고를 조회했다. 모든 조회 성공, 열린 경고 0개. 스캔하지 않은 코드를 안전하다고 인증하는 수치는 아니다.
- PR 담당자의 08:28:56 UTC 목록 **26개**를 재사용했다. 각 PR의 체크·상태와 `pr=<number>` 기반 모든 PR ref의 열린 경고를 조회했다. **#3099에 #78 High, #79 Critical 두 개**만 열려 있다. 기본 브랜치 0건을 전체 PR 0건으로 해석하면 안 된다.
- Secret scanning **0개**, Dependabot **0개**. 각각 API 200 및 마지막 페이지까지 확인했다.
- #80–84는 모두 `false positive`로 dismissed 상태다. 재평가·재해제하지 않았고 기본 브랜치 열린 경고에 합산하지 않았다.
- Code Quality 목록·설정 API는 모두 **404**. 수량은 `null / 미확인`이다. 저장소 `admin, maintain, push, triage, pull=true` 및 OAuth `gist, read:org, repo, workflow`가 노출됐지만 404의 원인을 기능 비활성화·구독·권한 중 하나로 확정할 수 없다.
- 현재 `main=ca235e25`, `data=4bda4aae`, `develop=d0e38f33`, PR3111=`99f91157`의 읽은 체크에는 실패가 없다. 다만 PR3111에는 Security의 npm/pip/readiness 전체 작업이 실행된 증거가 없다.
- 열린 PR의 기록된 SHA에서 보안·품질 관련 실패 체크 **30개 / 19개 PR**가 남아 있다. 원본 목록은 `open-pr-failed-security-checks.json`. CodeQL 1, AI security 4, GitGuardian 2, readiness 14, Freshness 6, npm audit 2, pip audit 1이다.
- 2026-09-04 이후 전체 실패 실행 **643개 / 7페이지**, Security 실행 **225개 / 3페이지**를 수집했다. Security는 실패122·성공85·시작실패6·취소12이며, 과거 실행을 현재 결함 개수로 계산하지 않는다.

## 확인된 결함과 가장 작은 수정 단위

1. **P2 — 현재 main과 PR3111의 레이아웃 명세 누락.** `backend/layout-manifest.v1.json`에 `assets`, `assets/source-fonts`, `docs/build-ship`, `docs/performance`가 없다. Git에 커밋된 트리만으로도 디렉터리37개가 산출되지만 두 테스트는33개를 기대한다. `backend/utils/tests/test_layout_naming_source_recovery.py:74`, `backend/bin/tests/test_check_layout_manifest_unittest.py:418`이 영향을 받는다. 오래된 main의 Security 실행36491966037에서도 이 계열 두 테스트가 실패했다. 현재 3개 표적 테스트 중 reconciliation 1개 통과, layout 2개 실패로 재현했다.
   - 최소 배치: 실제 네 디렉터리 항목·assets 범위 메타데이터를 추가하고 두 정확한 개수 검증을37로 갱신한다. 검사기 허용 규칙을 느슨하게 만들지 않는다.
   - 검증: layout/rename의 관련 단위·소스 계약과 `check_layout_manifest.py --json`, 이어서 부모가 정확한 후보 SHA의 Security 체크를 확인한다. 현재 작업 폴더의 `apps/web/node_modules` 심볼릭 링크는 별도의 로컬 alias 실패도 유발한다. 공유 링크를 제거하지 말고 깨끗한 후보에서 검증해야 한다.

2. **P1 — 오래된 PR2906의 취약 버전.** `600a75d5`의 웹 lockfile은 maplibre-gl5.24.0·sharp0.35.3·js-yaml4.3.1, 백엔드는 js-yaml4.3.1이다. 해당 npm 감사는 웹에 critical2/high2를 보고했고 백엔드도 js-yaml 감사에 실패했다. 직접 호출은 공개 지도 `OverseasMap.tsx`와 서버 이미지 처리 모듈들에 있다. 특정 악용 경로까지 입증한 것은 아니다.
   - 현재 main과 PR3111은 maplibre-gl6.10.0·sharp0.35.4·js-yaml4.3.2다. 현행 lockfile을 광범위하게 업그레이드할 근거는 없다.
   - 최소 배치: 부모/PR 담당자가 오래된 의존성 후보를 현행 develop에 맞추되 그 PR의 의도한 변경만 유지한다. npm 두 프로젝트 감사와 해당 핀·lockfile 계약 및 필수 CI를 확인한다.

3. **P2 — PR2902의 승격 대상 위반.** 아직 열린 PR이며 base는 main이다. 실패한 Freshness 실행36424190192의 보관 산출물에는 이 PR만 `target_branch_violation`으로 표시돼 있다. `verify-dependency-freshness.mjs`의 develop-only 규칙이 실제 원인이다.
   - 최소 배치: 부모/PR 담당자가 이 오래된 후보의 유지·대체를 정리한다. 규칙을 완화하지 않는다. 후보를 정리한 뒤 수집·거버넌스 분류를 다시 확인하고, 허용된 후보의 정확한 SHA에만 검증을 연결한다.

## 소스 추적상 오탐 근거

- **CodeQL #79 / PR3099 / Critical `js/request-forgery`:** `a29e464e`의 `preview-design-fixtures.mjs:5`는 목적지를 상수 `http://127.0.0.1:18792`로 정하고, 179에서 해석한 URL의 pathname/search만213에 붙인다. redirect는 manual이며 서버는221에서 루프백에 바인딩한다. WebSocket도229에서 hostname/port를 고정한다. Node24.21.0으로 외부 authority·userinfo·슬래시·역슬래시·인코딩을 포함한14개 입력을 네트워크 없이 검증했고 목적지가 모두 고정됐다. 해당 파일은 PR3111 소스에 없다.
- **CodeQL #78 / PR3099 / High `py/weak-sensitive-data-hashing`:** `codex-imagegen-provider-core.py:359`의 해시는 비밀번호 검증이 아니라 요청·응답 provenance 지문이다. 유일한 호출413–414는 endpoint+생성 요청 payload와 redacted response를 입력으로 사용한다. auth_file은404의 전송 함수에 별도로 전달된다. 비밀번호 KDF로 바꾸는 수정은 이 경고에 적합하지 않다. 이 파일도 PR3111에 없다.
- **GitGuardian PR3099:** 지목한 replay receipt의 `comparedHashes` 값은 파일의64자리16진수 해시다. 원문 해시값은 보관하지 않았다. 정확한 외부 incident-to-line 연결은 미노출이므로 강한 오탐 근거와 incident 해제 여부를 구분한다.
- **GitGuardian PR2908:** `test_g014_pg17_owner_contract.py:129`는 `secrets.token_hex(24)`로 실행 중 임시 값을 만든다.130의 컨테이너는 `--network none`,134는 cleanup 등록이다. 공용 docker helper가 메모리의 값을 환경으로 넘긴다. 인간 비밀번호나 커밋된 자격증명이 아니며, 테스트 DB·컨테이너를 실행하지 않았다.

두 CodeQL 경고는 여전히 open, 두 GitGuardian 체크도 failure다. 이 감사는 해제·억제·스캐너 비활성화·키 교체를 하지 않았다. 필요한 경우 부모가 정확한 항목별 근거를 검토할 수 있다.

## 미확인과 전달 검증

- AI security 실패4개는 소스 결함으로 확정하지 않았다. 가장 최근 검사 작업은 `Processing Request (Linux)`에서 실패했으나 원인·구독·쿼터·권한을 단정할 근거가 없다.
- PR2888의 오래된 pip-audit 실패는 보존한 투영 결과에서 advisory를 찾지 못했다. 취약점으로 단정하지 않고 후보 갱신 뒤 고정된 pip-audit 검증 대상으로 남겼다.
- PR3099의 reconciliation 실패는 해당 커밋의 실제 테스트와 연결되며, 현행 PR3111에서 동일 표적 테스트는 통과했다. PR3099 자체의 체크가 해결됐다고 주장하지 않는다.
- 원격 쓰기·소스 수정·경고 변경·메시지/댓글·계정 전환·유료 기능·자격증명 파일 읽기·DB 쓰기는0회. 정제한 메타데이터와 이 보고서만 할당된 `astra-security` 디렉터리에 저장했다. 원문 로그·산출물 ZIP·provider 진단·비밀값은 보관하지 않았다.
- 브랜치/PR 상태는 기록된 시각과 SHA 기준이다. 보호된 전달과 최종 hosted 검증은 부모의 책임이다.

핵심 파일: `summary.json`, `findings.json`, `all-branch-alert-coverage.json`, `open-pr-failed-security-checks.json`, `tracked-layout-source-trace.json`, `targeted-readonly-tests.json`, `dependency-source-trace.json`, `freshness-artifact-sanitized.json`, `ssrf-url-semantics-result.json`.

API 범위 해석은 [GitHub Code scanning REST 문서](https://docs.github.com/en/rest/code-scanning/code-scanning#list-code-scanning-alerts-for-a-repository), 404/접근 한계는 [Code Quality REST 문서](https://docs.github.com/en/rest/code-quality/code-quality#list-code-quality-findings-for-a-repository)를 확인했다. 모든 실제 수량과 상태는 현재 gh API 관측에서 얻었다.
