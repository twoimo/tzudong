v6 독립 소스 검토: **marker-pool의 9줄 guard는 보고된 stale restaurant ID·방문 배지 문제의 원인에 맞는 좁은 수정이다. 새 제품 코드 변경에서 추가 P1/P2는 발견하지 않았다. 부모의 v6 브라우저 회귀 170 checks/0 failures 기록도 읽었다. 다만 sampler의 좌표 기반 ID 판정에는 실제 DOM ID와의 연결을 검증하지 않는 P2 공백이 남아 있다.** 현재 성능 판정은 no-admission이다.

제품 snapshot: 2026-09-30 17:34 KST, HEAD `da805ea2602f4ed83e6e77e52e9da0b74ba2f8c5`. 17:37 이후 추가된 부모의 v6 회귀 결과와 변경된 regression.mjs도 아래에 반영했다. 제품 diff는 NaverMapView.tsx, naver-map-render-plan.ts, marker-pool.ts 세 파일이다. 앞의 두 파일은 v5 검토 hash와 같고, 마지막 파일에만 9줄 guard가 추가됐다. API/cache/refactor나 기존 low-zoom pooled 분기를 변경할 요구는 없다.

**제품 수정 판정**

| 경로 | 정적 확인 결과 |
| --- | --- |
| 다른 restaurant로 pool 재사용 | [marker-pool.ts:52](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/lib/marker-pool.ts:52)는 DOM의 `data-restaurant-id` 및 root role/tabindex/aria-label/title을 next template과 비교한다. 다른 ID이면 bubble DOM에 손대기 전에 false를 반환하고, [acquire:204](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/lib/marker-pool.ts:204)의 기존 `setIcon(icon)`으로 간다. 위치만 갱신되고 과거 DOM ID가 남던 경로를 차단한다. |
| 같은 ID의 고정 방문 배지 변경 | 55–57의 badge `outerHTML` 비교가 수치·aria-label·표시 여부 차이를 포함한다. 배지 추가/제거, 2→3, 화면 텍스트가 같은 100→101의 aria-label 변화도 불일치가 되어 전체 icon 교체 대상으로 간다. 현재 producer는 [cluster-marker.ts:305](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/lib/cluster-marker.ts:305)에서 이 selector를 사용한다. |
| 같은 ID, 같은 static 내용, review bubble만 변경 | 기존 style/image/anchor 검사를 통과하면 bubble patch와 `currentIcon.content` 갱신 경로를 유지한다. 새 guard 자체는 기존 category image를 교체하지 않는다. 이는 허용되는 fast path의 정적 판정이며 모든 실제 bubble DOM 조합의 이미지 동일성을 실행으로 검증한 것은 아니다. |
| 이벤트·선택·현재 위치 | acquire의 position 설정 및 `__onClick` 교체는 유지된다. expanded caller는 [NaverMapView.tsx:2728](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/components/map/NaverMapView.tsx:2728)에서 실제 restaurant를 visual 생성기에 넘기며, 생성기가 그 ID를 HTML에 넣는다. root ID가 항상 없는 저줌 fallback까지 수정 범위를 넓히지 않는다. |

목록/스와이프 후보 보존, selected/search 예외, pan/zoom/resize revision, empty cleanup, filter reset의 v5 소스 판정은 동일 hash 범위에서 유지한다. 새 guard가 이 상태 계산에 관여하지 않는 것을 확인했다. 기존 v5 정적 검토는 전체 marker-pool DOM 재사용의 실행 보증이 아니며, 이번 부모의 브라우저 실패가 추가로 드러낸 데이터 정확성 문제를 그 이전 판정으로 덮지 않는다.

**[P2] 남은 검증 공백: 좌표로 추정한 ID를 실제 DOM ID 검증으로 취급할 수 없음**

[sample.mjs:65](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/sample.mjs:65)의 `actualIds`는 SDK marker의 좌표를 fixture row에 매칭해서 만든다. 해당 DOM의 `data-restaurant-id`와 비교하지 않는다. 19–29의 첫 visible member도 처음에는 좌표의 row.id를 쓰며, 이후 fast path는 DOM ID를 쓰지만 둘의 일치를 요구하지 않는다. 따라서 좌표가 맞고 DOM ID만 stale/duplicate인 이번 실패 유형에서도 final missingIds가 0이고 sample.valid가 true일 수 있다. full summary 보존 수정은 정상이나, 없는 불변식을 대신 검증하지 않는다.

현재 [regression.mjs:237](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/regression.mjs:237)은 map-container 안의 실제 DOM ID 배열을 읽으며, 427–437에서 첫 pan 전후 배열을 비교한다. 이는 이번 중복을 찾는 유효한 검사다. 다만 양쪽이 동일하게 잘못된 ID/좌표 연결이면 배열 비교만으로 통과할 수 있고, 첫 반환 대기도 현재 marker 수 >0까지다. 뒤의 반복 cycle은 전체 ID 배열 일치까지 기다리도록 보강됐다. 이 파일 또는 별도 작은 pan 검증에서 다음을 확인해 최종 후보 hash와 함께 보존하면 된다.

- 같은 목표 geo/bounds로 돌아와 안정화된 각 provider marker에서 `{domId, lat, lng}`를 함께 읽고, fixture의 해당 ID 좌표와 비교한다. DOM ID uniqueness와 padded-bounds expected ID의 누락 0을 명시적으로 확인한다. before/away/return의 실제 tuple과 중복·누락·불일치 ID를 저장한다.
- 해당 v6 correctness 결과를 timed run에 선행하는 별도 gate로 두거나 sampler에도 같은 ID↔좌표 일치 검사를 추가한다. 현재 sampler.valid 하나를 DOM 데이터 정확성 통과로 쓰지 않는다. 제품 소스 추가 수정은 필요하지 않다.

**읽은 회귀 증거와 필수 보완**

[regression-candidate-v5-v3/raw.json](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/regression-candidate-v5-v3/raw.json)은 BUILD_ID `5JgbN16naASnTwy693jlR`의 실패 자료다. desktop pan-return의 실제 ID 앞부분에 `...0010`, `...0010`, `...0011`, `...0011` 중복이 기록돼 있고, desktop mock-3에서도 동일 ID selector가 두 DOM에 매칭된 실패가 있다. 이를 직접 읽어 사용자의 DOM 중복 보고를 확인했다. SDK 좌표가 정확했다는 부분은 이 축약 failure 값만으로 별도 인증하지 않는다. 해당 run 전체는 75 checks/5 failures이며 v6 성공 자료로 재사용하지 않는다. 다른 list-order/timeout 실패까지 이번 guard 하나로 해소됐다고 추정하지 않는다.

검토 도중 추가된 [marker-pool.test.ts:453](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/tests-unit/marker-pool.test.ts:453)는 같은 이미지인 A→B 재사용과 동일 ID의 방문 배지 2→3 변경에서 `setIcon`을 요구한다. 기존 371의 bubble test는 `setIcon=0` 경로를 검사한다. 부모의 [marker-pool-fix-tests-v2.log](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/marker-pool-fix-tests-v2.log)에 10 pass/0 fail/79 expectations가 기록돼 있다. 이 검토에서 테스트를 재실행하지 않았다. FakeMarker.setIcon은 icon 값을 저장하는 stub이므로 이 로그가 실제 DOM 교체를 증명하지는 않는다.

작은 보완은 배지 없음→있음 및 있음→없음 사례를 기존 table에 넣고, 실제 pan DOM readback으로 새 ID·배지·해당 식당 상세 선택을 함께 확인하는 것이다. 같은 ID bubble-only에서는 명시적 ID를 가진 기존 img 노드의 동일성과 불필요한 setIcon 없음도 확인한다.

검토 도중 생성된 [regression-candidate-v6-v1/raw.json](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/regression-candidate-v6-v1/raw.json)은 v6 BUILD_ID 및 이번 세 제품 파일 patch hash에 연결돼 있다. 4개 시나리오 총 170 checks/0 failures를 기록한다. desktop/mobile 735 fixture 각각 10회 memory-cache pan cycle의 exactMarkerSnapshot=true와 unchanged-idle SDK setter 0도 읽었다. 이는 부모가 실행한 모의 provider의 브라우저 회귀 자료를 읽은 결과이며, 내가 브라우저를 재실행하거나 실제 Naver SDK/방문 배지 DOM 전체를 검증한 결과는 아니다. 이 run의 DOM ID 전후 비교 통과는 보고하되 위 ID↔좌표 불변식까지 검사했다고 확대하지 않는다. 최종 paired-v5/raw.json은 확인 시점에 없었다.

**성능·build·식별 정보의 경계**

plan-v5의 budgets는 plan-v4와 정확히 같고 50ms/10%, 31 pairs/cell, 2 warmups, desktop/mobile CPU4 설정을 유지한다. 이전 A/A noise는 이전 sampler 자료라고 표시돼 있다. 새 sampler A/A readiness/noise 자료와 최종 v6의 유효 paired 증거 없이 새 성능 주장을 할 수 없다. 기존 busy-only 결과는 no-admission을 유지하며, 두 지점 CPU snapshot·교대 실행만으로 pair 독립성이나 GPU 여유가 증명되지는 않는다.

검토 중 생성된 [build-candidate-v6/receipt.json](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/build-candidate-v6/receipt.json)의 세 product input 사본/hash와 source.patch/plan hash를 현재 소스와 대조해 일치를 확인했다. 보존 BUILD_ID도 receipt의 `uqeszApikRN4PIuKNfHiF`와 일치한다. 빌드 실행·build log 판정·브라우저 동작 검증은 수행하지 않았다.

기존 delegation-routing.json의 hash는 v5 검토와 같다. 그 native extraction 요약의 `gpt-6-astra/max` 및 assistant response 존재는 이전에 확인한 세션 증거다. 이번 v6 응답의 transport trace나 vendor request/response ID를 새로 확보한 것은 아니며, 모델 성공·공급자 경로·quota 잔량을 추가 추정하지 않는다.

| 검토 입력 | SHA-256 |
| --- | --- |
| NaverMapView.tsx | `746f3dc33b2f0879dd0ab916db6df35cdd11da4706547aa9edb179ffe5ecd71c` |
| naver-map-render-plan.ts | `75edbb62d7f39d7e39cffee90594e172642ec12eb852fda6885dc38a11cd84ab` |
| marker-pool.ts | `0816449fe7d1d94f59f555198a77a266b9d346ffbf797275695e0eecd67edade` |
| 세 제품 파일 HEAD diff | `a2c4c1c7c315623f8171cd9a40f88086e6cea37d48eff309f4a7985de0097d98` |
| marker-pool.test.ts | `2f473935c70ad3e9a991e687d6462f6315fb7e07e80f4badc39ba07d560e572c` |
| sample.mjs | `cc9233c38816fb9f8b8c2247a9f777b4872a6abef151c3f00dd5f7c1acbf4001` |
| regression.mjs | `1752a0e9d771965878d2df1b12e5289c4f5a28351ff5e12db4438732bd9a30a6` |
| paired.mjs | `f69c8d77d1712ba596ec7ea889bdf01a256d328f71d857093c39c4edbfb8f7d7` |
| plan-v5.json | `81fdeda1cb3dbd8d48e8209c44bb3d28ee572f70b60da6b33b87661429d60b0c` |
| regression-candidate-v5-v3/raw.json | `66b94d3e454a7092b4815b27c8838b895d05c9fcd48668d5ca3b4bfb09ca4ad1` |
| regression-candidate-v6-v1/raw.json | `6f4c47b120208ba47845e3ff6ea6ecffd52fa822d28353511f6799b2243b0cf0` |
| marker-pool-fix-tests-v2.log | `c582828896f15f95b674a554cf4cbcde9c84b78d092b5894ca573d1c73de92a5` |

검사 범위는 제품 diff 및 관련 visual/acquire/HTML callers, unit test source, 측정·회귀 스크립트, 보존 JSON/log/hash의 읽기다. 브라우저·빌드·테스트·외부 모델 요청·quota 조회를 실행하지 않았다. 이전 보고서와 원시 증거를 보존했다. **유일한 작성 경로:** `/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/astra-review-v6.md`.
