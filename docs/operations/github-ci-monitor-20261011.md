# GitHub CI 증분 감시와 다음 최적화 방향

PR [#3168](https://github.com/twoimo/tzudong/pull/3168)의 CI 간소화에 읽기 전용 감시를 추가했다. 전체 목표의 현재 상태와 별개로, 정기 감시는 CI 읽기와 분석만 수행한다. 감시 실행은 운영 DB·배포·병합·워크플로 재실행·한도 증액을 변경하지 않는다.

## 수학적 선택 기준

run 생성 뒤 job 생성까지의 시간, 생성 뒤 대기와 실행을 각각 \(a_j,q_j,t_j\)라 하면 마지막 job까지의 관측 시간은 \(T_{last}=\max_j(a_j+q_j+t_j)\), 러너 점유량은 \(R=\sum_j t_j\)다. 분석기의 `criticalPathSeconds`는 실제 run 생성부터 마지막 job 완료까지의 차이를 쓴다. 선행 job을 기다리는 시간도 포함하며, 마지막 job 이후 GitHub의 workflow 종료 처리 시간은 포함하지 않는다. 의존 그래프의 이론적 임계 경로는 경로별 작업·대기 시간 합의 최댓값이므로, 의존 job이 있으면 단순히 가장 긴 job 시간으로 대신하지 않는다. 비용 청구와 관측 시간을 혼동하지 않는다. 임계 경로에 없는 작업의 단축은 전체 완료 시간을 줄이지 않을 수 있다.

수집은 목록 페이지 \(P\), 갱신 attempt job set \(A\), 캐시되지 않은 소스 조회 \(S\)에 대해 API 읽기 \(O(P+A+S)\), SQLite 조회는 건당 \(O(\log H)\)다. 중복 키는 `(run_id, attempt)`이며 검증된 완료 기록만 재사용한다. 신규 분석은 \(O(r(j+s))\), 체크포인트 읽기·쓰기는 \(O(H)\), bootstrap은 코호트·지표마다 \(O(B(n_0+n_1))\)다. reference 준비의 일반 tick은 최신 export 한 개와 bounded checkpoint만 확인한다. 과거 export 전체 결합은 후보 최초 생성 때만 수행하고, 이미 준비한 후보는 코호트 manifest로 조회한다. 전체 작업을 상수 시간이라고 주장하지 않는다.

이벤트·러너 계열·워크플로 blob·실행 모드·job topology가 다른 결과는 분리한다. 소스 tree마다 중앙값을 만든 후 군집 bootstrap 10,000회로 명목 95% 구간을 계산한다. 전후 각각 성공 7개와 소스 tree 7개 미만이면 개선 판정을 보류한다. p95는 각각 소스 군집 20개부터 표시한다. 반복 관측과 여러 지표의 검정은 오탐 위험을 높이므로 모든 신호는 탐색용이다. 인과적 개선·기존 G003 scorer 승인·금액 절감으로 승격하지 않는다. 새로운 워크플로 버전에는 새 비교 기준선이 필요할 수 있다.

탐색 경보는 95% 구간 전체가 절대·상대 임계값을 동시에 넘을 때 발생한다. 기준선에 0초 군집이 있으면 상대 변화의 bootstrap 구간은 정의하지 않고 절대 기준만 적용한다. 이를 0% 변화라고 표시하지 않는다.

| 지표 | 절대 기준 | 상대 기준 |
| --- | ---: | ---: |
| 임계 경로 | 30초 | 5% |
| 러너 점유량 | 120초 | 5% |
| 최대 대기 | 20초 | 25% |

이는 감시용 정책이며 기존 compiler 성능 승인 기준을 바꾸지 않는다. 실패·취소·미완료·tombstone은 시간 표본에서 제외하고 별도 집계한다.

## 수집·재시작 경계

- 최초에는 최근 20개만 수집한다. 이후에는 워터마크에서 48시간 겹치는 구간을 페이지당 20개, 최대 5페이지 읽는다. 목록 밖 기존 active run은 최대 100개 직접 확인한다. 각 run은 최근 attempt 최대 10개를 보존한다.
- 페이지 total 변화·중복 경계·상한 도달은 coverage 경보가 된다. 불완전한 구간에서는 워터마크를 전진시키지 않는다. 전체 GitHub 이력을 수집했다고 주장하지 않는다. 알려지지 않은 아주 오래된 run의 재실행은 48시간 목록 범위 밖에서 발견되지 않을 수 있다.
- run과 attempt별 job 수·완료·시간을 확인한다. 불완전한 completed 응답은 다시 확인하고, 이후 변경된 검증 완료 분석은 fail-closed 처리한다.
- 고정 기준선의 완료 attempt는 변경하지 않는다. 뒤늦게 페이지로 발견한 과거 기록은 after 표본에 넣지 않는다. 기준선 시점 이후 시작한 신규 실행·재시도만 after로 분석한다.
- 기준선 hash·다섯 소스 파일 hash·설정이 바뀌면 수집 전에 중단한다. tick 잠금, SQLite 트랜잭션, atomic/fsync 체크포인트로 겹친 실행과 부분 기록을 보호한다. 유실된 tick 영수증은 완료 attempt를 다시 분석 표본에 추가하지 않고 복구한다.
- 고정 기준선에는 완료 상태와 실제 terminal conclusion만 허용한다. 성공 표본에는 job·step 완료와 시간순서의 완결성을 요구하고, 실패·취소의 시간 미관측은 별도 보존한다. 기존 기준선에서 새 workflow cohort의 before 군집 수는 늘지 않으므로, 새 코호트의 성공·source tree가 각각 7개에 도달하면 불변 reference 후보를 준비한다. 원본 창에 미해결 non-tombstone attempt가 하나라도 있거나 수집 누락이 있으면 준비를 보류한다. 동일 코호트·소스 미확정·검증된 다른 코호트의 pending을 각각 기록한다. 후보 준비는 개선 판정이 아니며, 이전 창 보관 → 별도 새 상태 디렉터리 → 검증된 후보 경로·SHA를 기준선으로 지정 → 첫 tick 확인 순서로만 비교 창을 전환한다. helper 자체가 이전 창의 지속 감시를 보장한다고 주장하지 않는다.
- 기준선·export·reference candidate는 한 번 읽은 동일 byte snapshot으로 해시와 JSON 파싱을 검증한다. analyzer에는 인증한 기준선 snapshot을 전달한다. 최신 tick의 기본 선택과 명시적 선택 모두 state root 밖 symlink·경로를 거부한다.
- collector의 기본 최대 2,000 attempts와 기준선 최대 100개를 합쳐 analyzer 입력 상한 2,100개로 맞췄다. 체크포인트는 5,000개를 넘으면 보존 후 새 명시적 창이 필요하다. 자동 삭제·무한 보존 정책을 만들지 않았다.
- 읽기 시간은 요청당 30초, tick 수집 300초·분석 60초로 제한한다. 모델·raw log·사용자·자격 증명·임의 provider 진단을 저장하지 않는다.

## 실제 관측

환경: macOS arm64 공유 호스트, Python 3.14.8, 현재 인증된 `gh`의 읽기 전용 GitHub REST API. 공급자 네트워크·캐시 영향을 포함한다. 초기 기준선 20개는 성공 17·실패 1·취소 2, 소스 tree 10개다. 초기 관측 당시 변경 후 표본은 0개였으며 후속 관측은 아래에 구분한다.

| 실험 | 전 → 후 | 절대 차이 | 감소율 | 95% 구간·표본 |
| --- | --- | ---: | ---: | --- |
| 초기 최근 20개 재조회, API 요청 | 53 → 1회 | 52회 | 98.11% | 동일 기록 1쌍, 추정 구간 없음 |
| 초기 최근 20개 재조회, 수집 시간 | 33.453 → 1.074초 | 32.379초 | 96.79% | 1쌍, 불확실성 미추정 |
| 60개 구간 catch-up → 재조회, API 요청 | 115 → 3회 | 112회 | 97.39% | 동일 기록 1쌍, 추정 구간 없음 |
| 60개 구간 catch-up → 재조회, 수집 시간 | 74.044 → 3.859초 | 70.185초 | 94.79% | 1쌍, 불확실성 미추정 |

초기 20개 실험은 pagination 보완 전의 진단용 영수증이다. 최종 60개 실험은 같은 수집 코드와 동일 record 배열을 사용했다. 첫 catch-up은 이미 캐시된 20개를 재사용하며 나머지 40개를 채웠다. 전체 cold 60개 실험으로 부르지 않는다. 재조회는 job set 60개를 모두 재사용하고 목록 3페이지를 실제 읽었다. 두 수치를 CI 실행 시간·요금 절감으로 일반화하지 않는다. 프로그램의 모델 호출과 원격 mutation은 각각 0회다. heartbeat 자체의 Codex 토큰 사용은 별도이며 0이라고 주장하지 않는다.

기존 중복 compiler 제거의 7쌍 로컬 결과는 측정 당시 dirty source의 전체 내용이 보존되지 않아 성능 근거에서 제외했다. 원시 기록은 그대로 보존했지만 49% 단축을 승인된 성과로 사용하지 않는다. 판정은 [기존 보고서](github-ci-performance-20261010.md) 및 `local-compiler/admission.json`에 기록했다. 새 고정 소스 측정은 별도로 수행한다.

새 실험은 고정 source tree `24e0a272dc0fab99351890337ef10fe28f3ae88c`에서 7개 전후 쌍과 7개 A/A 쌍을 측정했다. 평균 시간은 35.073 → 18.688초, 평균 쌍별 감소율은 46.61%이고 명목 bootstrap 95% 구간은 43.31–50.24%다. 그러나 A/A p95 차이가 28.28%로 사전에 정한 5% noise budget을 초과해 이 결과도 **not admitted**다. 기준을 완화하지 않았으며 최적화 채택·운영 개선의 근거로 사용하지 않는다. raw·설정·논리 입력 manifest·실패 실험·판정은 `ci-20261010/local-compiler-clean-20261011/`에 분리 보존한다.

## Opus 독립 검토와 다음 방향

설치된 OpenCodex 2.77.0의 실제 catalog·지원 API를 확인한 뒤 기존 OAuth 경로 `google-antigravity/claude-opus-5-5`, reasoning `high`로 검토했다. 모델·라우터·유료 한도를 변경하지 않았다. [공식 proxy 문서](https://opencodex.me/reference/proxy-formats/)와 [GitHub workflow runs API](https://docs.github.com/en/rest/actions/workflow-runs)를 확인했다.

첫 요청은 출력 제한에서 잘려 최종 검토를 받지 못했다(13,141 reported tokens). 좁힌 두 번째 요청은 완료됐다(3,566 reported tokens, 29.527초). 합계 16,707 reported tokens이며 실제 금액은 확인하지 않았다. 완료한 최종 검토와 두 시도의 영수증을 모두 보존했다. 이후 정기 수집마다 Opus를 호출하지 않는다. 새로운 복잡한 병목의 해석이 필요할 때만 사용한다.

직전 후보 실행 `38044128078`의 Windows Bun job은 721초 중 benchmark/report가 481초(66.7%)였다. 이 구간을 절반으로 단축할 수 있다면 해당 job의 작업량 모델은 721 → 480.5초다. 다른 job이 새 임계 경로가 될 수 있으므로 전체 CI의 예상 단축으로 쓰지 않는다. 관측은 1개이며 Windows Bun은 이전 기준 710 → 721초로 11초 악화했다. 다음 개선은 이 측정 구간의 중복·I/O를 확인하는 것으로 정하고, 샘플·scorer·검증 coverage는 유지한다.

## 실행과 증빙

6시간 주기 thread heartbeat는 아래 프로그램을 호출한다. mutable 상태는 저장소 밖 runtime-cache에 둔다. 반복되는 실패·coverage·성능 신호는 같은 키로 중복 알림하지 않는다. 새로운 문제가 있으면 원시 실행과 source tree를 확인하고, 변경은 별도 검증된 PR로 제안한다. 운영 적용이나 자동 병합을 허용하지 않는다.

```sh
"$TZUDONG_PYTHON" .github/scripts/run-ci-monitor.py \
  --state-dir "$TZUDONG_CI_STATE" \
  --baseline apps/web/performance/ci-monitor-20261011/baseline.json \
  --baseline-sha256 d8e08c6371f3dab93fdb3495d5b14266d457e6e0490876f1e2546177a0b89070
```

`TZUDONG_PYTHON`은 프로젝트의 고정 Python 3.14.8 실행 파일, `TZUDONG_CI_STATE`는 저장소 밖 전용 상태 경로다. 공개 영수증은 상태 루트에 상대적인 `state://` 참조를 사용한다. 과거 다섯 영수증의 원본은 비공개 경로에 먼저 보존하고 경로 필드만 정제했으며, 원본·정제본 해시는 `path-redaction.json`에 기록했다. 과거 Git 이력을 다시 쓰지 않았다. 기준선·읽기 영수증·통합 첫 tick·분석·Opus 최종 응답·설정·소스 hash는 `apps/web/performance/ci-monitor-20261011/`에 보존한다. detached `artifact-map.json.sha256`으로 무결성을 확인한다. 공식 운영 개선으로 admitted한 slice는 0이다.

최종 수정 소스의 검증: CI Python 77개, 관련 backend Python 19개, 변경된 Bun source contract 28개(635 assertions), Node classifier 6개 통과. workflow actionlint와 reconciliation도 통과했다. 감시 테스트는 pagination 절단·attempt 실패·손상 시각·scope 충돌·자료 유실·중복 실행·active tombstone·상한·단계 완료·phase 충돌·0초 기준선·pending cutoff·symlink·byte snapshot 정합성을 포함한다. 이 결과는 로컬 기능 검증이며 미래 heartbeat 실행이나 GitHub CI 성공을 대신하지 않는다. PR의 16개 지적과 연결된 테스트는 `review-fixes.json`에 기록한다.

최초 hosted 감시 테스트 step은 `38123487112`에서 2초로 통과했다. GitGuardian은 sanitization 테스트에 쓴 가짜 비밀번호 문자열을 Generic Password로 탐지했다. fixture는 비자격증명 표식으로 수정하고 33개 테스트를 재검증했다. 검사 설정은 유지한다. [공식 문서](https://docs.gitguardian.com/internal-monitoring/prevent/detect-secrets-in-real-time-in-github)대로 PR의 과거 커밋도 검사하므로 source 수정만으로 이전 탐지가 해결됐다고 주장하지 않는다.

## 후속 관측

2026-10-11 09:31 UTC 수동 tick은 65개 run을 4페이지로 확인했다. 60개 job set을 재사용하고 신규 attempt 5개를 반영했으며, API 19회와 11.345969초를 사용했다. 수집 누락 경보는 0개다. 기준선과 후속 표본을 합친 25개 attempt는 성공 21·실패 2·취소 2다. 코호트마다 후속 성공 source tree는 최대 2개여서 효과의 95% 구간과 개선 판정을 제공하지 않는다.

새로 포착한 실패 `38123578345:1`은 별도 PR #3147의 과거 SHA `7cb7f73b`에서 Ubuntu npm `test:unit` 단계가 실패한 기록이다. 현재 PR의 최신 상태나 실패가 해결됐는지는 이 관측만으로 확정하지 않는다. CI 후보 `6098055f`의 검사는 성공 23·건너뜀 2·실패 0이었다. 실행 직전 사용자 승인으로 과거 테스트 fixture 탐지 #38096602 한 건에만 `Skip: test cred`를 적용했고, GitHub check #114434689929의 `skipped` 결과와 테스트 자격증명 분류 제목을 읽어 확인했다. 검사 설정은 유지했으며 incident 전체의 종료는 확인하지 않았다. 증빙은 `scanner-readback.json`이다.

6시간 감시 설정의 persisted readback을 재확인했다. 현재 전체 목표 상태를 변경하지 않고 CI 범위만 수행하도록 문구를 정정했으며, 자동화 ID·주기·대상 thread는 유지했다. 수동 tick과 설정 저장을 확인했지만 미래 스케줄 실행은 아직 확인하지 않았다. 새 영수증은 `followup-live-tick/` 및 `automation-readback-v2.json`에 보존한다.

정확성 보강으로 감시 source hash가 바뀌어 기존 창을 덮지 않고 v2 → v3 → v4로 전환했다. 각 창의 config·checkpoint·캐시는 보존했고 SQLite backup의 행 일치와 integrity를 확인했다. 이전 체크포인트를 새 분석 표본에 복사하거나 완료 데이터를 임의 phase 이동하지 않았다. v3의 실제 수동 tick은 58개 run, API 5회, 4.161585초, 캐시 재사용 56개·갱신 2개였으며 비교 코호트의 성공·source tree는 각각 4개였다.

현재 v4의 첫 수동 tick(2026-10-11 10:35 UTC)은 60개 run을 3페이지로 읽고 API 9회, 6.236070초를 사용했다. 캐시 58개를 재사용하고 job set 2개를 갱신했으며 coverage 경보·새 경보·프로그램 모델 호출·원격 mutation은 모두 0개다. 기준선 포함 29개 attempt 중 성공 23·실패 2·취소 2·미완료 2개다. 선택된 새 코호트의 성공·source tree는 0개이고 미해결 attempt는 2개이므로 reference 준비와 효과 판정을 보류한다. 이는 이전 4개 표본이 삭제됐다는 뜻이 아니라 실행 모드·topology가 다른 코호트를 구분한 결과다.

현재 자동화는 v4를 실행하도록 기존 ID·6시간 주기·thread를 유지해 갱신하고 저장본을 재확인했다. 영수증은 `corrected-live-tick-v2/`, `corrected-live-tick-v3/`, `corrected-live-tick-v4/`와 `automation-readback-v3.json`, `automation-readback-v4.json`이다. source snapshot 5개는 상태 창에 보존했다. 미래 예약 실행·실제 CI 시간 단축·금액 절감은 아직 확인하지 않았다.

## 2026-10-15 attempt 시간순서 결함

run `38617798185`, attempt `2`는 attempt별 job 응답 6개 중 5개에서 `startedAt-createdAt`이 -993~-1,002초였다. 같은 attempt의 run과 job 결합은 맞았고 CI conclusion은 success였다. [GitHub 공식 workflow jobs API](https://docs.github.com/en/rest/actions/workflow-jobs)는 `GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}/jobs`를 attempt별 job 조회 경로로 정의한다. 현재 문서의 workflow job 응답 예시는 `started_at`과 `completed_at`을 보여 주지만 이 모순의 생성 원인이나 `created_at`의 부분 재실행 의미를 규정하지 않는다. 따라서 공급자 원인을 단정하거나 시각을 보정하지 않는다.

기존 analyzer는 현재 창의 시간순서 모순도 `ChronologyError`로 전체 tick 밖에 던졌다. 그 결과 정상 신규 관측까지 분석하지 못했고 checkpoint는 불변으로 남았다. collector는 같은 record를 보존하되 `invalid_timing_order` 때문에 terminal로 고정하지 않았다. 수정된 경계는 다음과 같다.

- 고정 before 기준선의 모순은 계속 fail-closed다.
- after attempt의 모순은 원본 fingerprint와 완료·실패 상태를 보존하고 고정 코드로 기록한다. 시각 clamp, 추정, 삭제, tombstone 변환은 하지 않는다.
- 해당 attempt는 완료 결과 자체는 `terminalOutcomeComplete=true`로 보존하지만 `snapshotImmutable=false`, `timingUsable=false`이며 임계 경로·러너 점유·queue·stage 표본을 모두 비운다. 동일 fingerprint는 O(1) checkpoint 중복 조회로 재사용하고, 공급자가 같은 attempt를 일관된 값으로 교정한 경우에만 교체 후 불변화할 수 있다.
- reference 성공·source-tree 표본에서는 제외하고 `chronology_invalid_attempt` pending으로 창 전환을 막는다. 오류 코드는 1회성 `chronology:<run>:<attempt>:<code>` 경보로 노출한다. 이후 정상 attempt 수집과 분석은 계속한다.

불변 입력을 별도 상태 디렉터리에서 재생한 결과 첫 tick은 69개 attempt를 수용했고 문제 attempt에 `JOB_START_PRECEDES_JOB_CREATION`, `JOB_COMPLETION_PRECEDES_JOB_CREATION`을 기록했다. 시간 지표는 모두 `null` 또는 빈 stage였고 reference는 성공 11개·source tree 7개가 있어도 pending 1개 때문에 `collecting_reference`를 유지했다. 같은 입력의 두 번째 tick은 신규 수용 0·중복 69·새 경보 0이었다. 직접 테스트 60개와 전체 CI Python 테스트 82개는 기준선 fail-closed, 현재 창 표본 제외, 동일 fingerprint 중복, 교정 가능한 비terminal 상태, 교정 후 불변화, 정상 신규 run 지속 수용, 준비된 후보의 재차단, reference 차단을 검증했다. 이는 격리 로컬 재생이며 GitHub 응답의 근본 생성 원인 해결이나 운영 창 전환을 뜻하지 않는다.

`offline-replay/`와 `final-offline-replay/`의 당시 `export.json`을 각 tick의 `exportSha256`과 같은 원본 byte로 보존했다. 이 replay·raw·analysis·admission은 당시 소스와 입력에서 생성된 historical receipt이며 현재 analyzer 또는 현재 성능 개선의 증명으로 재라벨하지 않는다. PR head `73a439d4`에 있던 artifact map과 sidecar는 `historical-artifact-map-73a439d4/`에 byte-exact로 보존했다. 현재 artifact map은 76개 경로의 현재 bytes/hash를 검증하며, historical map 두 파일도 별도 entry로 결속한다. 이 map 갱신은 과거 scorer 결과나 `formalPerformanceAdmittedSlices=0`을 바꾸지 않는다.

후보를 `origin/develop` `ab9196b30f469ce34e9bda6e36db90098059a822`와 병합한 뒤 reconciliation 207개 entry의 현재 bytes에서 candidate content hash를 다시 계산했다. CI Python 82개, source classifier 6개, reconciliation 7개와 관련 workflow 3개의 actionlint 1.7.12가 통과했다. 저장소 전체 actionlint는 이 후보가 바꾸지 않은 `daily-crawler.yml`, `g035-hosted-recovery.yml`, `ts7-release-evidence.yml`의 기존 오류 4건으로 실패하므로 전체 workflow 무결성을 주장하지 않는다.

## 2026-10-15 오래된 재실행 발견과 판정 경계

[GitHub workflow runs 공식 API](https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow)의 `created`는 원래 run 생성시각 필터다. 따라서 생성시각 overlap만으로 오래된 terminal run의 새 attempt를 모두 찾는다고 주장할 수 없다. 새 collector는 알려진 terminal run ID를 순환하며 tick마다 기본 최대 20개를 per-run GET으로 확인한다. 추가 원격 조회는 R≤20이고 전체 네트워크 상한은 O(P+A+R+S)다. 로컬 SQLite는 PK scan과 correlated indexed MAX lookup이므로 보수 상한을 O(H log H)로 기록한다.

안정적인 알려진 terminal 집합 H와 모든 tick의 성공을 전제로 최대 발견 지연은 ceil(H/R) ticks다. 수정 시점 v8 cache의 H=172, R=20에서는 9 ticks, 기존 6시간 주기에서는 최대 54시간이다. 이는 현재 코드의 상한 모델이지 실제 발견시간 개선 측정이 아니다. 목록에 없던 과거 run의 재실행은 이 방식으로 보장하지 않는다. 전체 과거 inventory가 확인되지 않으면 `HISTORICAL_RUN_INVENTORY_INCOMPLETE`, 현재 tick에 알려진 terminal 전부를 확인하지 않았으면 `KNOWN_TERMINAL_RERUN_REFRESH_INCOMPLETE`를 보존한다. 생성시각 창·과거 inventory·현재 terminal 확인이 모두 완결돼야 `incrementalWindowComplete=true`가 되므로 불완전 coverage로 reference를 전환하지 않는다.

운영자 지정 절대·상대 threshold는 이제 모두 유한한 양수여야 한다. 0 threshold는 입력 검증에서 거부하며, 동일 결과의 [0,0] 구간은 inconclusive다. 양·음 경계의 improvement/regression은 별도 fixture로 검증했다. compiler 증빙 validator는 보존된 앱 입력 835개와 의존성 입력 2,227개의 이름·내용 결합 digest를 재계산하고, 28개 실제 보존 parity 명령의 성공·stdout SHA·428 bytes를 manifest payload와 결속한다. 원시 측정·표본 수·기존 noise budget과 `admitted=false`는 변경하지 않았다.

자동 감시는 아직 기존 v8 상태를 사용한다. v9 후보에서 과거 immutable success 4건이 빠진 것을 발견해 활성화를 거부했고, v10을 위해 원시 입력 합집합 82키를 준비했다. 새 source 동결·빈 checkpoint 재분석·첫 tick·전체 설정 readback 전에는 기존 상태나 기준선을 덮지 않는다. 이는 감시 정확성 보완이며 실제 CI 시간·비용 개선이나 공식 scorer 승인을 뜻하지 않는다.
