# GitHub CI 병목 분석과 간소화

기준 소스: `a9ce6ba2be377594e30dc865c621f2854006aa79` (`develop`). 운영 애플리케이션·DB·모델·유료 한도는 이 변경의 대상이 아니다.

## 측정된 병목

GitHub Actions의 최근 실행 10개를 한 번 조회해 성공 9개와 취소 1개를 분리 보존했다. 로그·사용자·자격 증명은 수집하지 않았다. 원시 job/step 시간, 설정, 분석 및 해시는 `apps/web/performance/ci-20261010/`에 있다.

| 측정 항목 | 표본 | 중앙값 | 관측 범위 | 평균의 bootstrap 95% 구간 |
| --- | ---: | ---: | ---: | ---: |
| CI 임계 경로 | 9 | 848초 (14분 8초) | 787–912초 | 819.67–872.23초 |
| 병렬 job 실행 시간 합계 | 9 | 3,125초 | 2,843–3,337초 | 3,040.00–3,222.33초 |
| TypeScript 벤치마크·report | 9 | 1,438초 | 1,166–1,576초 | 1,341.00–1,503.44초 |
| 벤치마크·report 비중 | 9 | 45.84% | 41.01–48.85% | 43.77–46.94% |
| 실행별 최대 대기 | 9 | 3초 | 3–48초 | 3.56–19.45초 |

평균 구간을 중앙값의 구간으로 해석하면 안 된다. 전체 분포·중앙값 구간은 [기준선 보고서](../../apps/web/performance/ci-20261010/report.md)에 있다. 성공 실행만의 관측이며 서로 다른 소스·러너 상태의 영향을 포함한다. 취소 실행은 개선 효과 표본에 넣지 않았다.

9개 실행은 7개 head SHA, 실제 Git tree 3개에 속했다(각각 1·6·2개). 실행별 재표집의 독립성 가정을 그대로 받아들이지 않고 tree별 cluster bootstrap도 [별도 분석](../../apps/web/performance/ci-20261010/source-groups/report.md)했다. 임계 경로 평균의 명목 95% 구간은 827–861초였지만 군집 3개는 안정적인 통계 추론에 부족하다. 두 구간 모두 기준선의 기술적 요약이며 개선 유의성의 증거가 아니다.

병렬 CI를 DAG로 보면 전체 완료 시간은 임계 경로에 의해 정해진다. 이 워크플로에서는 병렬 job별 대기 (q_j), 실행 (t_j)에 대해 (T=\max_j(q_j+t_j)), 러너 점유량은 (R=\sum_j t_j)로 구분한다. 따라서 (R)의 감소율을 (T)의 감소율이나 청구 비용으로 사용할 수 없다. 대기보다 컴파일러 반복 실행이 큰 병목이다.

## 적용한 변경

### 컴파일 중복과 측정 시점

`run-typecheck.mjs`의 parity는 native·compat 진단을 각각 수행하고 두 컴파일러의 logical input 이름·내용 해시도 확인한다. `measure-typecheck.mjs`는 같은 verify·parity를 독립 preflight로 다시 수행한다. 기존 CI는 이들 앞에서 native·compat 및 verify·parity를 다시 실행했다.

새 CI는 각 플랫폼에서 **하나의 parity 소유자**를 실행한다. 전체 벤치마크가 필요한 실행은 기존 benchmark 내부 preflight를 사용하고, 일반 기능 변경은 verify·parity를 사용한다. 샘플 수, 시간/RSS/noise 허용값, 독립 report 검증, tree 결속과 실패 처리 코드는 바꾸지 않았다.

| 경로 | 변경 전 → 변경 후 | 절대 감소 | 변화율 | 근거·불확실성 |
| --- | --- | ---: | ---: | --- |
| 전체 측정, 플랫폼당 compiler process | 26–30 → 20–24 | 6개 | 20.0–23.1% 감소 | 성공 경로의 코드 경로 계수. 실패·재시도는 별도 |
| 일반 기능 변경, 플랫폼당 compiler process | 26–30 → 4 | 22–26개 | 84.6–86.7% 감소 | 2개 진단 + 2개 input 조회. 측정 시점도 변경 |
| 전체 측정, 네 플랫폼 합계 | 104–120 → 80–96 | 24개 | 20.0–23.1% 감소 | OS×installer 네 조합 보존 |
| 일반 기능 변경, 네 플랫폼 합계 | 104–120 → 16 | 88–104개 | 84.6–86.7% 감소 | 네 조합의 진단·입력 동등성 보존 |

위 compiler 계수는 프로젝트 진단·input 조회 호출이며 CLI 버전 확인 프로세스는 제외한다. 모두 타입 검사라고 부르거나 이 감소율을 CI 시간 감소율이라고 주장하지 않는다. 정상 benchmark의 7쌍 또는 noise 시 9쌍 측정에 대한 범위이며 재시도가 발생하면 더 많아질 수 있다. 결정적인 호출 개수에는 표본 추정 신뢰구간이 적용되지 않는다.

| 이벤트·변경 | 전체 벤치마크 | 기능 검증 |
| --- | --- | --- |
| 일반 기능 PR → `develop`, 일반 `develop` push | 생략 | 네 플랫폼 verify·parity, 기존 lint·unit·build·browser·admin 유지 |
| 컴파일러·패키지·lock·설정·측정 코드·CI·근거 변경 | 실행 | 동일 기능 검증 유지, verify·parity는 benchmark 내부 소유 |
| PR → `data`/`main`, `data`/`main` push | 실행 | 동일 |
| 주간·수동 실행 | 실행 | 동일 |
| 알 수 없는 이벤트·입력·base, 이력 부족·diff 오류 | 실행 | 동일 |

각 job의 exact HEAD와 이벤트 head를 비교하고 불일치는 즉시 실패시킨다. Git merge-base/diff의 NUL 구분 경로를 분류하며 rename heuristics를 끄므로 삭제·추가 경로를 모두 확인한다. SHA 검증과 인자 배열을 사용하며 이벤트·경로 원문을 출력하지 않는다. 분류기 출력 누락도 전체 증빙 경로로 처리한다. 별도 계획 job을 추가하지 않아 선행 job 대기를 만들지 않는다. 정확한 diff를 위해 네 checkout의 전체 이력과 짧은 분류기 실행 비용이 추가된다.

이는 기능 정확도 검증을 보존하면서 **모든 기능 PR에서의 성능 측정을 주간·승격 전 측정으로 옮기는 선택**이다. 일반 TS 소스도 성능/RSS를 바꿀 수 있으므로 성능 커버리지 시점이 같다고 주장하지 않는다. `data`/`main` 병합 전에 측정하므로 승격 후에만 회귀를 발견하는 구조는 피했다.

### 설치·보안 감사

Install job의 package-only proof와 별도 build를 제거했다. 기존 전체 browser proof가 package graph·격리 npm install·Next production build·CSS 검증·Chromium 행동 검증을 수행하며 기존 Node/npm 실행 경로를 전달받는다. Ubuntu npm의 build와 독립 Bun 설치는 유지한다.

| 항목 | 변경 전 → 변경 후 | 절대 감소 | 변화율 |
| --- | --- | ---: | ---: |
| Install npm 경로의 clean install | 3 → 2 | 1 | 33.3% |
| Install npm 경로의 production build | 2 → 1 | 1 | 50.0% |
| npm/pip 감사 runner job | 7 → 2 | 5 | 71.4% |
| npm 감사 대상 | 2 → 2 | 0 | 0% |
| pip 감사 대상 | 5 → 5 | 0 | 0% |
| PR/push 트리거 패턴, 각각 | 60 → 21 | 39 | 65.0% |

보안 감사는 같은 생태계의 대상들을 순차 처리한다. 첫·중간·마지막 대상의 실패를 주입해도 모든 대상이 실행되고 마지막에 실패로 종료하는 것을 검증했다. 보안 이슈를 무시하는 allowlist나 실패를 성공으로 바꾸는 처리도 추가하지 않았다. job 수 감소는 벽시계 시간 감소와 같지 않으며 생태계 내부 직렬화로 해당 job 시간이 늘 수 있다.

트리거 패턴은 상위 glob에 포함되는 항목만 제거했다. 실행 대상 집합은 같으므로 트리거 정리 자체의 시간 절감은 주장하지 않는다.

## 보존한 검증과 제외한 제안

보호 브랜치 필수 `Release`·`Promotion Path`와 독립 scorer/validator 및 정확한 source tree 결속을 유지했다. Promotion의 `edited` 이벤트는 base 재지정을 검사하므로 남겼다. required workflow 자체를 paths 조건으로 건너뛰는 변경도 하지 않았다. GitHub의 [워크플로 문법](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)과 [생략 동작](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs)을 확인했다.

CodeQL은 Actions·Go·JS/TS·Python·Rust·Swift 모두 실제 소스가 있어 유지했다. 언어 목록의 JS/TS 별칭을 중복 job으로 계산하지 않았다. Swift autobuild가 별도 병목이지만 coverage를 제거하는 단축은 채택하지 않았다. 기존 concurrency cancellation도 유지한다. readiness를 더 나누는 제안은 설정 비용·공유 서비스 충돌 및 러너 합계 증가 때문에 이번 변경에서 제외했다.

## 검증·재현·주장 한계

### 중복 진단 제거의 로컬 전후 측정

같은 소스 snapshot에서 기존 `verify → native → compat → parity`와 `verify → parity`를 7쌍 비교했다. 홀수 쌍은 전→후, 짝수 쌍은 후→전으로 교차 실행했다. 전체 벤치마크 생략, build, 보안 감사 변경의 효과는 이 실험에 포함되지 않는다.

| 지표 | 변경 전 | 변경 후 | 절대 감소 | 감소율 |
| --- | ---: | ---: | ---: | ---: |
| 평균 | 43.76초 | 22.17초 | 21.60초 | 집계 평균 기준 49.35% |
| p50 | 40.47초 | 21.72초 | 18.75초 | 46.32% |
| p75 | 48.31초 | 27.19초 | 21.12초 | 43.71% |
| p95 | 54.38초 | 28.47초 | 25.90초 | 47.64% |

평균 쌍별 절감은 21.60초, bootstrap 95% 구간은 16.92–26.70초였다. 쌍별 감소율의 평균은 **49.00%, 95% 구간 40.42–56.72%**였다. 위 집계 감소율 (1-\bar t_\text{후}/\bar t_\text{전})과 쌍별 비율 평균은 다른 통계량이므로 구별한다. percentile은 선형 보간이며 기존 release benchmark의 nearest-rank 규칙을 바꾸지 않았다.

삭제한 두 standalone 명령의 평균은 native 2.01초, compat 19.42초로, 합계 21.44초의 제거를 예상한다. 관측 절감 21.60초는 이 단순 작업량 모델과 일치한다. 14개 측정 sequence는 모두 성공했다. raw·설정·소스 해시·분석은 [local-compiler](../../apps/web/performance/ci-20261010/local-compiler/report.md)에 있다.

최초 snapshot 복사는 내부 심볼릭 링크를 펼쳐 14개의 verify가 실패했다. 그 7쌍은 전부 제외하고 원시 기록과 당시 정확한 실행 소스를 보존했다. 심볼릭 링크를 보존하는 복사로 수정하고 사전 toolchain 검증 후 새 7쌍을 측정했다. 실패 표본을 성공한 부분만 추출해 재사용하지 않았다.

macOS arm64의 공유 호스트, 단일 소스 snapshot에서 얻은 비교다. CPU 부하·순서·캐시 상태의 영향을 완전히 제거하지 못했으며 미래 실행이나 Linux/Windows의 시간으로 일반화하지 않는다. 최대 RSS는 명령별 기술 통계만 보존했고 프로세스 트리 메모리 개선을 주장하지 않는다.

분류기의 실제 Git fixture로 일반 변경·rename/삭제·누락 이력·head 불일치·악성 SHA·잘못된 이벤트를 검증했다. 네 플랫폼의 YAML에서 parity 소유자, 증빙 upload/finalizer 조건, tree/report 결속, 기존 기능 검증을 확인한다. Windows에서도 테스트 실패가 후속 명령으로 덮이지 않도록 분류기 테스트와 실행을 별도 step으로 둔다.

로컬 검증 환경은 macOS arm64, Node 24.21.0, Bun 1.4.0 및 동일 package-lock을 사용하는 의존성이다. TypeScript native 7.0.2/compat 6.0.2 parity는 diagnostics 0, logical inputs 3,129개로 통과했다. 워크플로 문법은 공식 릴리스·checksum을 확인한 actionlint 1.7.12로 검증했다. 로컬 검증은 Windows·GitHub 호스팅 시간의 증거가 아니다.

원시 기준선을 다시 조회하지 않고 분석을 재현하려면 저장소 루트에서 실행한다.

```sh
python3 .github/scripts/collect-ci-performance.py \
  --input-dir apps/web/performance/ci-20261010 \
  --output-dir /tmp/tzudong-ci-replay
node --test .github/scripts/classify-ci-benchmark.test.mjs
```

신규 관측은 `--input-dir`을 생략하고 별도 `--output-dir`을 지정한다. 기존 기준선을 덮어 비교 표본을 바꾸지 않는다. 최대 조회 실행 수는 10, 성공 기준선 최소 7, bootstrap 10,000회·고정 seed다. 파일별 해시와 분리된 artifact-map SHA를 확인한다.

호스팅 변경 후 표본이 충분하기 전에는 통계적으로 유의한 시간 감소·금액 절감·G003 공식 성능 승인을 주장하지 않는다. 기존 step 시간을 빼는 계산은 추가 checkout·분류·러너 노이즈·감사 직렬화 비용을 포함하지 않아 실제 전후 측정 대신 사용할 수 없다.
