# 재현 및 증거 범위

기준 보고서는 `REPORT-DELIVERED-20261004-v2.md`다. 원본 dirty worktree, 기존 frozen packets와 외부 pin을 변경하지 않는다. 이 packet은 source·실험실·운영 rendering·배포·field를 분리하며, 새 Galaxy 검증과 matched field 성과가 미완료임을 유지한다.

실험 source는 `d24f8d633a628518f072c24d76166d388d33c398`, 운영 main은 `ca235e250957c4360ad713ffd29e118c11cc5b7c`다. `overlay-source-main-equivalence-v1.json`은 performance history를 제외한 전체 tracked web source의 동등성을 확인한다. baseline/candidate archive·patch·20 입력 hash·build IDs는 `build-baseline-control-ui-v2/`와 `build-candidate-ret-overlay-v1/`에 있다. 기존 기록의 source를 새 source로 재분류하지 않는다.

도구는 Node24.21.0, Bun1.4.0, npm11.6.2, Next16.3.5 webpack, Playwright1.62.1, 설치된 Chrome154다. Node 실행 경로는 `/opt/homebrew/opt/node@24/bin/node`, Bun은 `/Users/twoimo/.bun/bin/bun`이다. project package-lock과 pinned 런타임을 사용한다. 다른 OS/CPU/브라우저 버전에서는 재현 실험으로 별도 기록하고 원래 수치와 동일 환경으로 주장하지 않는다.

raw 및 집계 재검산은 packet을 새 작업 경로에 복사한 뒤 실행한다. 집계 출력은 `open('x')`이므로 원래 결과를 덮어쓰지 않는다. 기존 summary를 제외한 검산용 복사본을 쓰거나 집계 스크립트의 output label만 새 버전으로 바꾼다.

```text
python3 aggregate-mobile-retain-overlay-v1.py
python3 aggregate-mobile-retain-overlay-warm-v1.py <fresh-label>
python3 aggregate-final-overlay-diagnostics-v1.py <fresh-label>
```

새 브라우저 실행에는 독립 source checkout과 npm dependencies, production public browser 설정3개, Naver가 허용한 개발 origin이 필요하다. env 값은 packet 밖에만 둔다. `build-retention-accessibility-v2.mjs`의 source checkout/Node/Bun 경로를 재현 호스트에 맞추되 변경 diff와 hash를 새 packet에 기록한다. `PERF_BUILD_SOURCE_COMMIT`을 지정해 baseline과 candidate를 **새 build label**로 만들고 plan의 build label을 사전에 고정한다. profile/viewport/cache/CPU/600ms endpoint와 기존15%/20% 허용치는 변경하지 않는다. source archive+patch의 입력 hash를 해당 source commit에 대조한다. 기존 private build를 운영 빌드나 public binary로 게시하지 않는다.

```text
PERF_BUILD_SOURCE_COMMIT=<baseline-receipt-source> node build-retention-accessibility-v2.mjs baseline <fresh-baseline-label>
PERF_BUILD_SOURCE_COMMIT=d24f8d633a628518f072c24d76166d388d33c398 node build-retention-accessibility-v2.mjs candidate <fresh-candidate-label>
node measure-mobile-retain-overlay-v1.mjs <fresh-label> aa
node measure-mobile-retain-overlay-v1.mjs <fresh-label> ab
node measure-mobile-retain-overlay-warm-v1.mjs <fresh-label>
```

현재 driver의 plan/source/output 이름은 이 실험에 결속돼 있다. 복사한 driver/plan에서 새 label·source checkout만 일관되게 바꾸고 그 변경을 보관한다. 각 raw는 plan SHA를 기록하며 집계가 일치를 확인한다. cold는9 process pairs+2warmup pairs, A/A735만, AB735/2000을 사용한다. warm은 ABBA4 fresh processes×60 의존cycles이며 independent warm A/A가 없어 population gain/CI를 주장하지 않는다. mac local port3000이 비어야 하며 기존 서버를 재사용하거나 종료하지 않는다. Node child/browser/context는 driver가 소유한 것만 종료한다.

기능 재현은 `verify-retained-overlay-v2.mjs`(production review HTML generator를 쓰는 owned constructor/setIcon fixture), `verify-root-readiness-interactions-v1.mjs`, `verify-root-readiness-responsive-v1.mjs`, `verify-delayed-sdk-root-v1.mjs`, boundary/data-refresh scripts를 해당 새 candidate label로 복사해 실행한다. delayed fixture160ms는 test-only다. raw AX/DOM/provider contents는 저장하지 않는다. rejected overlay-v1 fixture와 correction receipt를 남기고 AX/geometry 기준을 완화하지 않는다.

source checkout의 `apps/web`에서 관련 검사는 아래다. 이 packet의 합계는25+11=36 tests/1214 assertions이다.

```text
bun test tests-unit/retained-marker-accessibility.test.ts tests-unit/marker-pool.test.ts tests-unit/deferred-marker-renders.test.ts
bun test tests-unit/expanded-cluster-flow-invariants.test.ts
node node_modules/eslint/bin/eslint.js lib/retained-marker-accessibility.ts tests-unit/retained-marker-accessibility.test.ts
npm run typecheck:parity
```

`diagnose-final-overlay-heap-v1.mjs`는 별도 forced-GC/snapshot/CPU diagnostic이다. primary heap 예산을 면제하지 않는다. snapshot strings/graph와 profile URLs/bodies는 버리고 fixed type totals/SDK WeakRef ownership/source classes만 저장한다. `final-overlay-diagnostic-plan-v1.json`을 고정하고 baseline/candidate 각1process, checkpoint0/30/60과60 cycles를 새 label로 실행한다. candidate 진단의 처음에는 별도 public live browser가 함께 실행됐으므로 CPU timing 인과 비교에 사용하지 않는다.

운영 재현의 기준은 `memory-production-ready-status-v2.json`이다. `read-memory-new-deployment-v1.py <fresh-label>`은 exact project/source deployment/independent alias를 read-only 확인한다. `verify-live-memory-production-v1.mjs`는 actual WWW anonymous context에서 실제 SDK·데이터·assets를 수정 없이 사용한다. `verify-live-logo-v1.mjs`의6CSS theme cases는 직전 동일 PNG source의 운영 상태이며 새 main의3viewport alpha 확인은 live memory verifier에 있다. role/title/원시 review 내용은 저장하지 않는다. capture inspection receipt의 stable-state/150ms+capture-latency 탐지 한계를 유지한다. 이 검사들을 physical Galaxy로 분류하지 않는다.

과거 native temp capture는 inspection·SHA readback 후 `chrome-v6-native-capture-preservation-v1.json` 및 `other-native-capture-preservation-v1.json`의 상대 savedPath로 옮겼다. 원래 raw absolute temp paths는 불변 원료이며 대응 receipt로 찾아야 한다. 실패·미검증 setup의3tmp frames는 packet에 포함하지 않았다. 이전 source의 native 캡처를 새 source·운영·temporal flicker proof로 사용하지 않는다. 새 실기기 실행에는 현재 `adb device`와 SM-S928N shell 모델 확인이 필요하며, 기존 전달 주소/port를 현재 주소로 가정하지 않는다. lock/settings/다른 앱 작업을 변경하지 않는다.

field 재검산은 `field-readback-reproduce-v3.json`의 fixed seven-column SELECT와 balanced JSON decoder다. 값·headers·raw wrapper·provider error를 버리고 metric instance count만 보존한다. 새 관찰은 `field-baseline-readback-20261004-v4.json`이다. 오래된15instances로 새 main의 p75/p95 또는 성과를 계산하지 않는다. synthetic QA는 field admission0이며 실제 수집을 대신하지 않는다.

canonical 원래 packet은 그대로 보존했다. `preserved-canonical-validator-v1.json`의 command는 read-only 재검증이며 validator0은 **원래 candidate만** 확인한다. 새 candidate의6종 health coverage가 완비되지 않은 상태에서 미측정 count를0으로 만들지 않는다. 따라서 새 canonical 성과 admission/certification을 주장하지 않는다. 이 제한은 operator의 기존 배포 승인과 별개다. Vercel redeploy의 현재 옵션은 [공식 문서](https://vercel.com/docs/cli/redeploy)에서 확인했고 기존 exact-SHA guard를 유지했다.

최종 `artifact-map.json`은 모든 packet 파일의 size/SHA를 포함하고 map 자신은 제외한다. pin은 packet 바깥의 `render-flow-native-memory-final-20261003-artifact-map.sha256`이다. 독립 verifier로 실제 file set·bytes·map pin을 대조하고 evidence Git commit의 blob에서도 같은 검증을 수행한다. Git blob readback receipt는 packet 밖에 두어 frozen map을 바꾸지 않는다. freeze 뒤의 새 측정·작업 상태·수정은 새 packet/receipt에 쓴다.
