v7 구현 인계: **실제 마커 렌더의 viewport와 idle 비교 key를 동기화하고, expanded viewport revision을 클러스터 debounce에서 분리했다. 좁은 검사 16개/76 assertions와 대상 ESLint가 통과했다.** 지속 blank 및 mobile blank 지속시간 개선은 아직 브라우저로 검증하지 않았다. 부모의 v7 동일 readback·flicker 재측정 전에는 해소나 성능 개선을 주장하지 않는다.

검토·수정 snapshot: 2026-09-30 18:25 KST. HEAD `da805ea2602f4ed83e6e77e52e9da0b74ba2f8c5`. 이 작업의 제품 수정은 NaverMapView.tsx 하나다. 기존 naver-map-render-plan.ts와 marker-pool.ts 변경은 시작 hash 그대로 보존했다. 추가 작성/수정은 허용된 expanded-cluster-flow-invariants.test.ts와 이 새 보고서뿐이다. renderer 소유권을 부모에게 반환한다.

**증거와 원인 판단**

[marker-dom-readback-final-v3/rejected.json](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/marker-dom-readback-final-v3/rejected.json)을 직접 읽었다. 실제 phase는 `return-1`이다. desktop before에서 expected/actual/tuple 모두 143, valid=true이고 첫 cycle 0의 away=0/0 및 return=143/143, exactIds=true까지 완료됐다. 다음 복귀에서 zoom14·center 37.5512/126.9882·mapCreates=1이지만 expected143/actual0/missing143이다. 보존 스크립트는 120회×100ms 대기 한도를 사용한다. 이는 첫 마커 미완성만으로 설명할 수 없는 두 번째 왕복의 실패 증거다. v2는 cases=[]였으므로 그 파일만으로 실패 phase를 특정하지 않는다.

v6 소스에서는 viewport key/ref 갱신까지 idle debounce 안에 있었다. 이전 idle이 A를 기록한 뒤 cached data가 화면 B의 마커를 먼저 모두 해제해도 ref는 A였다. B의 idle callback 실행 전에 A로 돌아오면 key 동등 비교가 revision을 생략할 수 있다. query/cluster 결과 identity까지 같으면 복원 render를 촉발할 값이 남지 않는다. 이 경로를 actual renderer cleanup 및 idle callback을 실행하는 작은 검사로 검증했다. 실제 v6 실패의 내부 ref 값 trace를 확보한 것은 아니므로, 원시 브라우저 실패와 이 소스 경로의 연결은 설명 가능한 원인 판단이며 v7 재현 검증이 필요하다.

한편 부모의 독립 flicker 측정은 다른 결과를 보인다. 이 구분을 유지한다.

| 보존 v6 측정 | desktop 반환 blank | mobile 반환 blank | 최종 복원 |
| --- | ---: | ---: | --- |
| flicker-pan-before-v1, 첫 marker 뒤 350ms 안정화 | 158.0–165.9ms | 308.4–317.4ms | 각각 5/5, 143/55개 |
| flicker-pan-before-v2, 안정화 대기 없음 | 149.8–159.0ms | 308.3–317.1ms | 각각 5/5, 143/55개 |

위 값은 보존 raw의 관측 rAF DOM count span이며 physical-display flicker가 아니다. 둘 다 지속 12초 blank를 재현하지 않았다. 검토 중 읽은 flicker-pan-before-v3도 각각 5/5 복원됐으며, 이 별도 관측 방식의 통과로 exact ID↔좌표 readback의 두 번째 왕복 실패를 무효화하지 않는다. 기존 mobile 250ms 초과 blank는 남아 있는 시각 회귀 증거다.

**수정 내용과 범위**

- [NaverMapView.tsx:290](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/components/map/NaverMapView.tsx:290)에 `getNaverMarkerViewportKey`를 두었다. idle과 renderer가 같은 `fillExtendedBounds(map, 0, ...)` 계약으로 raw bounds·raw zoom·실제 map element 크기를 직렬화한다. 반올림된 bbox나 고정 fallback bbox를 key로 사용하지 않는다.
- [NaverMapView.tsx:2347](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/components/map/NaverMapView.tsx:2347)의 idle/resize handler가 key 변경을 동기적으로 반영한다. expanded ID가 있을 때만 revision state를 증가시킨 뒤 기존 `debouncedUpdateClusters()`를 예약한다. `getClusters`, bbox/center 계산과 cluster equality 처리는 기존 debounce에 남겼다. delay 값·timer·SDK 이벤트 종류를 추가하거나 단축하지 않았다.
- renderer가 시작할 때 key를 캡처하고, empty release·regional cleanup·individual cleanup에서 실제 `releaseExcept`를 수행한 뒤 ref에 기록한다([individual cleanup:3058](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/components/map/NaverMapView.tsx:3058)). early skip이나 retry-only return에는 새 viewport를 처리했다고 기록하지 않는다. cached data의 선행 culling 이후 return idle은 마지막 관측 idle A 대신 실제 렌더 B와 비교한다.
- null로 무조건 무효화하는 대신 실제 렌더 key를 남긴다. 그러면 동일한 empty viewport의 반복 idle에도 revision을 계속 증가시키지 않으면서 복귀 A는 식별할 수 있다. unchanged idle 및 비펼침 pan의 추가 revision은 0회다.

목록/스와이프 후보, selected/search 예외, filter reset, 좌표 mutation, pooled ID/방문 배지 guard, early/signature revision 연결은 보존했다. API/query/cache 구조, 기존 저줌 마커 분기를 변경하지 않았다. disposed guard는 동기 handler와 지연 cluster callback 양쪽에 남아 있다. viewport invalidation은 이제 지연 callback이 cleanup으로 무효화될 때까지 기다리지 않는다.

**수행한 검증**

[expanded-cluster-flow-invariants.test.ts:199](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/tests-unit/expanded-cluster-flow-invariants.test.ts:199)는 실제 소스에서 viewport helper, idle handler, 지연 cluster callback, individual render/cleanup 구문을 실행한다. 네트워크·React 전체 컴포넌트를 로드하지 않고 SDK pool과 callback scheduling만 작은 대역으로 제공한다. A 렌더→B data render로 0개→away idle 없이 A 복귀라는 순서를 고정하고, cluster array identity가 같거나 cluster index가 없어도 지연 cluster query를 실행하기 전에 revision으로 원 ID 목록을 복원하는지 검사한다. 반복 idle, raw bbox의 미세 변화, fractional zoom, width/height 변경, expanded 여부도 검사한다. 이 검사는 React frame timing이나 실제 provider DOM readback을 대체하지 않는다.

- `bun test tests-unit/expanded-cluster-flow-invariants.test.ts tests-unit/expanded-cluster-viewport.test.ts`: **16 pass, 0 fail, 76 expect calls** (Bun 1.4.0). 최초 새 harness 실행은 누락된 테스트 binding 때문에 2건 실패했고, binding 보완 후 최종 통과했다.
- 프로젝트 ESLint를 Node 24 경로로 수정한 component/test 두 파일에 실행: exit 0, `--max-warnings=0`.
- 수정 경로의 `git diff --check`: exit 0.

브라우저, 빌드, 전체 테스트/typecheck, 성능 측정, 외부 모델 요청 및 quota 조회는 실행하지 않았다. 모델 fallback도 수행하지 않았다. 기존 모델 native extraction의 표시를 이번 실행의 vendor transport 증거로 확대하지 않는다.

**부모의 필수 후속 검증**

동일 exact readback에서 before와 첫 왕복 성공을 보존한 채 두 번째/세 번째 왕복을 실행하고 phase·ID↔좌표 tuples·중복/누락·실제 map geo를 남길 것. 첫 uncached 및 두 번째 cached 왕복은 별도 label로 보존하고, 현재 동기 invalidation이 mobile의 250ms 초과 반환 blank를 없애는지는 실제 rAF/trace로 검증할 것. unchanged-idle SDK setter 0 및 ordinary nonexpanded 동작도 확인해야 한다. 현재 수정본 hash가 포함된 v7 build/plan-v6를 사용하고 이전 기각 raw·성공 중간 raw는 그대로 유지한다. 실제 결과가 없으므로 성능 no-admission을 유지한다.

| 인계 입력 | SHA-256 |
| --- | --- |
| NaverMapView.tsx | `9236d84284cc28b1e569db22e979bd1f8a6800a577a234c549126548e5503287` |
| expanded-cluster-flow-invariants.test.ts | `38b96db2925e75ebc5a92504ce3dec6b5188b7db0c6622aecd22e674140fd552` |
| 세 제품 파일 HEAD diff | `7157ecbccd22d9315f0d3cd344b003741ac30fbcafb36b5dc1ba59b77fc68819` |
| 보존 naver-map-render-plan.ts | `75edbb62d7f39d7e39cffee90594e172642ec12eb852fda6885dc38a11cd84ab` |
| 보존 marker-pool.ts | `0816449fe7d1d94f59f555198a77a266b9d346ffbf797275695e0eecd67edade` |
| readback-final-v3/rejected.json | `7ae93cd08cf6f90a551ed5461005dced6e55ea9bece4f41e48d42098f406e52b` |
| flicker-pan-before-v2/raw.json | `a680a14ea3ab072abaeccf5acd96a87e7b87b91c07365edeac7fbbf22a321077` |
| flicker-pan-before-v3/raw.json | `be0c419bc29ea2818ea71335b9aa0168b2aee19366d1bf472903e6a9bcf5fac4` |

작성 보고서: `/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/astra-review-v7.md`. 이전 보고서/plan/runtime/raw 증거는 변경하지 않았다. **NaverMapView.tsx 소유권 반환 완료: 이 인계 이후 추가 source 변경을 하지 않는다.**
