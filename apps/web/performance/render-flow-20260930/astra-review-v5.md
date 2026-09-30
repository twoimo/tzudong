v5 최종 소스 후속 검토: **이전 P1 두 건과 실패 진단 보존 P2는 소스상 해소됐다. 펼친 클러스터에만 viewport revision을 발행하는 마지막 변경을 포함해, 검토 범위에서 추가 P1/P2는 발견하지 않았다.** 성능 승인은 계속 no-admission이며 실제 브라우저 회귀 통과·v5 빌드 성공을 대신 인증하지 않는다.

검토 snapshot: 2026-09-30 17:09–17:11 KST, HEAD `da805ea2602f4ed83e6e77e52e9da0b74ba2f8c5`. 아래 hash는 부모의 마지막 revision 조건 및 structured 실패 기록 수정을 포함한다. 이번에 작성·갱신한 파일은 이 `astra-review-v5.md` 하나다. 이전 두 보고서 및 renderer/runtime/plan/raw는 수정하지 않았다.

**해소 확인**

| 이전 지적 | 현재 소스와 판정 |
| --- | --- |
| P1: mock pan에서 viewport key 고정 | [NaverMapView.tsx:2317](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/components/map/NaverMapView.tsx:2317)의 `fillExtendedBounds(map, 0, viewportBounds)`가 culling과 같은 getSW/getNE 계약으로 실제 bounds를 읽는다. 무효 bounds는 null로 구분한다. raw zoom·bounds·map 크기를 key로 삼고 변경 시에만 revision을 증가시킨다. cluster index 검사 이전 갱신, idle/resize 구독, early key·expanded marker-layer signature·effect dependency 연결도 유지된다. 고정 Korea bbox를 쓰던 검토 지적은 닫는다. |
| P1: 클릭 전 idle로 완료 가능 | [sample.mjs:16](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/sample.mjs:16)이 clickIdleEpoch를 저장하고 33에서 이후 epoch 증가를 요구한다. 34에서 target zoom14/lat37.5512/lng126.9882를 검사한다. 좌표는 [clustering.ts:263](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/lib/clustering.ts:263) 및 regional click handler와 대조했다. 해당 synthetic fixture의 목표 조건으로 확인했으며 실제 SDK의 모든 패널 배치에 일반화하지 않는다. |
| P1: 연결된 DOM만 안정성으로 계산 | sample 46–50에서 member ID+geo(zoom/center/bounds/epoch)+mapRect로 stable key를 만들고 연속 2프레임에 도달해야 pending-first 시각을 채택한다. 그 전에 key가 바뀌거나 match가 없으면 pending-first를 재설정한다. 기존 `isConnected`만으로 누적하던 경로는 해소됐다. |
| P1: 임의 DOM·일부 member만으로 성공 | sample 9–10의 clicked count/지역 marker 좌표 확인, 23의 fixture 좌표 매핑, 28의 해당 marker wrapper hit-test, 39–44의 후속 rectangle/hit 재검사를 확인했다. 64–67은 최종 .25 padded-bounds expected IDs 전부 존재, 목표 viewport, click 이후 idle, firstMarker.geo와 finalGeo 일치를 요구한다. 계획상 지표는 2프레임 확인된 첫 rAF 반응이며 physical-pixel/완전 paint 증명으로 승격하지 않는다. |

마지막 조건 변경도 타당하다. [NaverMapView.tsx:2323](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/components/map/NaverMapView.tsx:2323)은 raw viewport가 바뀌면 `lastMarkerViewportRef`를 항상 갱신하되, 펼친 ID가 있을 때만 revision state를 증가시킨다. 2359의 listener dependency가 length를 포함하므로 펼침/해제 시 callback의 조건도 갱신된다. 같은 length의 다른 ID 배열은 callback에서 length만 사용하므로 이 조건을 낡게 만들지 않으며, marker render effect는 전체 배열에 의존한다. 펼침 시작 자체가 배열 변경으로 현재 bounds를 다시 렌더하고 signature에도 expanded viewport suffix가 붙으므로, 이전 비펼침 pan에서 ref를 갱신해 둔 것이 첫 expanded 렌더를 생략시키지 않는다. 펼침 해제 시 기존 callback은 disposed guard로 무효화된다. 일반 비펼침 pan에서는 새 revision에 의한 추가 state 갱신을 하지 않으며 기존 cluster 계산은 유지한다. 실제 commit 수 절감은 여기서 측정하지 않았다.

목록/스와이프 후보는 SDK predicate보다 앞에서 구성·발행된다. 선택/검색 ID 예외와 filter/region reset, v3의 empty cleanup은 유지됐다. 현재 제품 diff는 NaverMapView.tsx와 naver-map-render-plan.ts 두 파일이며 API/cache/refactor 변경은 없다. low-zoom pooled marker/cluster 분기의 기존 생성 동작을 새 결함이나 추가 변경 요구로 확대하지 않는다.

기존 helper/flow-invariants test는 읽은 범위의 근거이며 이 검토에서 실행하지 않았다. event→revision→실제 marker/pool 복원, 선택/검색/필터·동일 ID 좌표 갱신의 브라우저 회귀 결과는 부모의 별도 증거다. 정적 P1 해소를 그 실행 결과로 표현하지 않는다.

**실패 진단 P2 해소 확인**

[sample.mjs:69](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/sample.mjs:69)는 invalid summary를 `failure.safeState`에 붙여 throw하고, 73의 catch는 `??=`로 이 진단을 보존한다. timeout 등 summary가 없는 실패에는 initialGeo와 별도로 현재 center/bounds/idleEpoch/stableFrames, zoom, expected/actual/missing IDs와 `capture-rejected` 단계를 수집한다. [paired.mjs:29](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/paired.mjs:29)는 이를 rejected.json에 저장한다. 이전 P2의 핵심인 실패 당시 최종 상태 소실은 소스에서 해소됐다.

runtime의 console/page 오류 기록은 정형 카운터이며 저장 객체에 원 provider 오류 문자열을 넣지 않는다. 이미 완료된 개별 sample/pair의 append-only 저장과 기각 자료 보존도 유지된다. 이번에는 실패를 주입하거나 rejected.json을 새로 생성하지 않았으므로 이 판정은 저장 경로의 정적 대조다. 추가 소스 수정 요구는 없다.

**성능·원시 증거 판정**

plan-v4의 budgets 및 기존 A/A noise 값은 plan-v3와 일치했다. calibrationLimit은 baseline-aa-v3를 이전 sampler 자료로 명시해 noise floor만 보수적으로 유지한다. 새 sampler A/A calibration은 별도 예정으로 취급하며, 이 검토에서 완료 산출물은 확인하지 않았다. 50ms/10%와 noise/CI 요건을 낮출 근거는 없다. fresh context와 AB/BA 교대는 실행 설계이며 pair 간 독립성을 자동 입증하지 않는다.

기존 [paired-v3/raw.json](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/paired-v3/raw.json)의 후보 BUILD_ID는 v4의 `iW4x_VbzhreKC8_bbpydZ`이다. timing을 새로 측정하거나 점수화하지 않고 resource 분류만 집계했다.

| 보존 run | pair 수 | heavy_overlap | saturated | quiet 승인 대상 |
| --- | ---: | ---: | ---: | ---: |
| paired-v2 (candidate v3) | 62 | 43 | 19 | 0 |
| paired-v3 (candidate v4, 중간 증거) | 62 | 61 | 1 | 0 |

따라서 기존 v4 frames/결과는 중간 증거로 보존하고 **주 성능 no-admission**을 유지하는 것이 맞다. v5 결과로 재명명하거나 quiet 개선율로 합치지 않는다. GPU 미계측 한계도 남는다. 성능 주장 전 필수 보완은 새 sampler의 별도 A/A readiness/noise 자료와 최종 소스에 결부된 유효 pair 증거다. quiet 표본이 없으면 busy stratum별 관측치와 한계만 별도로 보고하며, 시간 상관을 무시한 일반 pair bootstrap CI로 quiet 성능을 승인하지 않는다.

검토 중 [build-candidate-v5/receipt.json](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/build-candidate-v5/receipt.json)이 생성된 것을 확인했다. 그 두 source input 사본·기록 hash 및 source.patch hash가 이번 검토본과 일치하고, 보존 BUILD_ID가 receipt의 `5JgbN16naASnTwy693jlR`와 일치하는 것까지만 읽어서 대조했다. 빌드 실행·build log 판정·브라우저 실행은 이 검토에 포함하지 않는다.

**모델 식별·검사 범위**

[delegation-routing.json](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/delegation-routing.json)의 native extraction 요약을 직접 읽었다. 해당 항목은 agent/session ID `01a0f139-dfa2-7463-98a4-ec74aa7a1538`, model=`gpt-6-astra`, reasoning_effort=`max`, assistant_response_present=true, error_codes=[]이다. 이 ID는 vendor 요청/응답 ID가 아니다. extraction 요약과 응답 존재까지의 증거이며 원 transport trace나 공급자 라우팅을 별도로 확인한 것은 아니다. error_codes=[]에서 quota 잔량이나 무제한 사용을 추정하지 않는다.

수행한 검사는 두 파일의 Git diff, 관련 bounds/render/marker/click callers 및 sampler/plan/실패 저장 경로의 정적 대조, 기존 JSON의 부하 분류 집계와 hash 확인이다. 브라우저·빌드·테스트·모델 호출·계정 quota 조회는 실행하지 않았다.

| snapshot 입력 | SHA-256 |
| --- | --- |
| NaverMapView.tsx | `746f3dc33b2f0879dd0ab916db6df35cdd11da4706547aa9edb179ffe5ecd71c` |
| naver-map-render-plan.ts | `75edbb62d7f39d7e39cffee90594e172642ec12eb852fda6885dc38a11cd84ab` |
| 두 파일 HEAD diff | `e4af4dc0f6d81e539661810a79c7ac8a370a00281aa9b71e3ab47f17577f616f` |
| sample.mjs | `cc9233c38816fb9f8b8c2247a9f777b4872a6abef151c3f00dd5f7c1acbf4001` |
| paired.mjs | `6584b95d318ba7c309b7d93242b4344c71d3828ab5e95e7173201aae93325d77` |
| runtime.mjs | `4614e32a90aa1e672bf366cbd13b791abe2e7ddae08ec448d52cef40400777ab` |
| plan-v4.json | `b246521f5b4013f820948f7b6931141586221a04472ba7377b023619f33a9321` |
| paired-v3/raw.json | `21b269ac9baf0c00efa77e6ff3b6ec92018a8339bc43b9b30f7c3608576e7c0f` |
| delegation-routing.json | `781edd3984217312f97ce00499343e200a04a1c993ffc60070c28af62a88661e` |

유일한 작성 경로: `/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/astra-review-v5.md`.
