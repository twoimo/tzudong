v4 후속 독립 검토: **viewport revision의 effect/가드 연결은 보완됐지만, mock bounds 경로와 sample 완료 판정의 잔여 P1 때문에 전체 검증 완료 판정은 보류한다.** 새 성능 개선이나 배포 성공은 주장하지 않는다. 이번 작성 파일은 `astra-review-v4.md` 하나이며 [이전 검토](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/astra-review.md)는 보존했다.

검토 시점은 2026-09-30 16:53 KST의 renderer와 16:57 KST에 다시 읽은 sample/paired이며, HEAD는 `da805ea2602f4ed83e6e77e52e9da0b74ba2f8c5`다. 종료 전 병행 변경된 sample/paired도 반영했다. 정적 소스 검토 및 기존 파일 해시 대조이며 브라우저·빌드·테스트 실행은 없다. 실제 runtime 재현과 아래 조건부 경로 추론을 구분한다.

**해소된 부분**

- [NaverMapView.tsx:2317](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/components/map/NaverMapView.tsx:2317)에서 viewport key 비교와 revision 증가가 cluster index 검사보다 앞선다. revision이 early key(2400/2424), expanded marker-layer signature(2620), render effect 의존성(3066)에 모두 연결되어 있다. 정상적인 bounds 인터페이스에서 pan/zoom/resize가 발생하고 key가 달라지면 cluster 배열 동등성과 무관하게 재평가할 수 있다.
- idle/resize를 모두 구독하고, cleanup의 `disposed=true`를 callback 첫 줄에서 검사한다(2298/2351). 지연 callback의 state 쓰기를 차단한다. debounce utility에는 cancel API가 없으므로 “timer 자체 취소”가 아니라 “남은 callback 무효화”가 정확한 설명이다. 이를 별도 차단 결함으로 취급하지 않는다.
- 목록/스와이프 발행은 여전히 SDK culling 앞에 있으며 선택/검색 ID 예외, filter/region reset, v3의 의도적인 empty cleanup은 유지됐다. low-zoom pooled/cluster 분기의 기존 acquire 동작은 변경 요구에서 제외한다. 모든 zoom에서 pool 전체가 viewport로 잘린다고 확대 해석하지 않는다.
- [sample.mjs](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/sample.mjs)는 실제 map/screen 교집합, 첫 member ID/rectangle/geo, idle epoch, 최종 padded-bounds expected/actual/missing IDs를 기록한다. padding .25는 renderer의 VIEWPORT_PADDING=.25와 일치한다. [plan-v3.json:20](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/plan-v3.json:20)은 지표를 첫 rAF 관측으로 제한하고 pixel/complete-paint 증명이 아님을 명시했다.
- [paired.mjs:22](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/paired.mjs:22)는 완료한 sample을 즉시 append-only 파일로 보존한다. 뒤쪽 sample이 실패해도 앞쪽 완료 결과가 사라지던 부분은 보완됐다. resources에는 hostCpuPercent도 추가됐다.

**1. [P1, mock 검증 경로] 현재 viewport key는 mock의 실제 pan bounds를 읽지 않는다.**

[NaverMapView.tsx:2318](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/components/map/NaverMapView.tsx:2318)는 `resolveNaverClusterBoundsBbox(bounds)`를 raw viewport key로 쓴다. 그러나 [helper:204](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/lib/naver-map-cluster-helpers.ts:204)는 `getWest/getSouth/getEast/getNorth` 경로만 처리하며, getWest가 없으면 항상 `[124,33,132,43]`을 반환한다. 현재 [MockMap.getBounds:382](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/tests/mobile-home-map-helpers.ts:382)는 getSW/getNE만 반환한다. 반면 실제 culling의 [fillExtendedBounds:55](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/lib/naver-map-view-helpers.ts:55)는 getSW/getNE를 사용하므로 mock의 이동된 bounds를 정상적으로 읽는다.

따라서 zoom과 map 크기가 같은 두 pan 위치의 revision key는 둘 다 `[zoom,124,33,132,43,width,height]`이다. cluster 결과도 같은 경우 revision은 증가하지 않는다. “snapshot-only 멤버가 전체 cull된 뒤 bounds-only pan으로 복귀”라는 이전 P1의 검증 경로가 현재 mock에서는 여전히 열려 있다. 정상 Naver SDK가 getWest 등을 제공하는 경로까지 실패했다고 주장하는 것은 아니다. **production 명목 경로의 연결 보완과 mock 기반 회귀 증명을 구분해야 한다.**

작은 수정안: cluster 조회용 fallback bbox를 viewport key에 재사용하지 말고, 그 위치에서 culling과 같은 getSW/getNE의 실제 네 좌표를 읽는다. 읽기 실패 상태는 별도 sentinel로 표현한다. shared cluster helper나 low-zoom pool 분기를 바꿀 필요는 없다. 또는 mock이 실제 bounds와 일치하는 네 directional getter를 제공하게 만들 수 있으나, getSW/getNE 기준 key가 culling과의 계약을 더 직접적으로 맞춘다.

필수 확인은 같은 zoom/크기·같은 cluster 결과에서 pan만으로 revision이 변하는지, 같은 bounds의 반복 idle은 revision을 올리지 않는지, index 부재/snapshot-only/empty→복귀와 resize·같은 quantized 구간의 zoom 변경이다. 추가된 [expanded-cluster-flow-invariants.test.ts:81](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/tests-unit/expanded-cluster-flow-invariants.test.ts:81)도 직접 helper를 호출하므로 event→revision→render/pool 경로를 실행하지 않는다. refreshed-array mutation 검사가 추가된 것은 확인했다. 이 검토에서는 테스트를 실행하지 않았다.

**2. [P1, 완료 판정] 기록은 강화됐지만 클릭 이후 목표 상태의 안정성을 gate하지 않는다.**

[sample.mjs:14](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/sample.mjs:14)의 idle epoch는 listener 설치 이후 누적 값이다. click handler는 click 시각만 바꾸고 `clickIdleEpoch`를 저장하지 않는다. 조건 `__idleEpoch>0`은 클릭 전 idle만으로도 충족될 수 있다. 16:57판 [observe:32](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/sample.mjs:32)는 첫 match 뒤 `__observedMarker.isConnected`만으로 stableFrames를 증가시킨다. DOM 연결 상태는 rectangle 가시성이나 center/zoom/bounds/idle epoch의 안정성을 뜻하지 않는다.

`__firstExpansion`은 첫 match에 한 번 고정되고 이후 가시성이 사라져도 취소되지 않는다. 마지막 valid(49)는 missing.length===0, actual.length>0, stableFrames>1만 검사한다. 예를 들어 중간 bounds의 member로 t1을 찍은 뒤 그 DOM이 연결된 채 화면밖으로 이동해도 stableFrames가 증가한다. 특히 baseline처럼 모든 member DOM을 유지하는 쪽은 final expected=[]이고 finalVisibleMember=null이어도 actual.length>0이므로 통과할 수 있다. final expected 역시 관측된 final bounds에서 계산하므로 이동 자체가 잘못된 목적지에서 끝났는지를 판정하지 못한다. initialGeo/finalGeo/firstMarker를 저장하는 것과 그 일치를 검증하는 것은 다르다.

작은 수정안은 다음 조건을 같은 sampler에 추가하는 것이다.

1. click 순간의 idle epoch를 저장하고, click 이후 epoch 증가와 미리 정한 Seoul cluster의 목표 zoom/center 또는 목표 viewport 도달을 확인한다.
2. 안정성 key를 `memberId + 실제 geo/bounds + map rectangle + idle epoch`로 만들고 동일 key가 연속 유지될 때만 stableFrames를 증가시킨다. 중간 match가 깨졌다면 pending first-match를 버리거나 별도 transient-first-reaction으로 기록한다.
3. 최종 valid에 목표 viewport 확인, 현재 visible member 존재, 안정성 key 유지, 기대 ID 포함을 묶는다. 먼저 반응한 시각과 안정 완료 시각을 따로 남긴다. rAF 지표의 이름은 현재 plan-v3처럼 유지한다.

동일 범주의 두 작은 보완도 필요하다. [sample:9](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/sample.mjs:9)의 memberIds는 클릭한 cluster에서 읽은 값이 아니라 catalog 전체다. 현재 single-Seoul fixture 가정을 유지하려면 클릭 대상의 종류/label/count가 그 fixture와 일치함을 assert하면 충분하며 제품 코드로 membership API를 넓힐 필요는 없다. [sample:27](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/sample.mjs:27)의 `hit.contains(element)`는 map/body 같은 조상도 통과시키므로 `marker._element.contains(hit)`처럼 실제 해당 marker wrapper 안의 hit로 한정한다.

이 지적은 sample의 거짓 성공 가능성에 대한 정적 경로다. 현재 저장된 sample이 실제로 이 경로를 밟았다고 단정하지 않는다.

**3. [P2, 실패 증거] safeState 보존은 추가됐지만 실패 시 최종 불변식 진단은 빠져 있다.**

[sample.mjs:55](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/sample.mjs:55)의 새 catch는 click/first/markerCount/mapCount/zoom을 safeState로 모으고 [paired.mjs:29](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/paired.mjs:29)가 rejected.json에 저장한다. 이 개선을 확인했다. 다만 safeState.geo는 실패 당시 bounds가 아니라 `__initialGeo`이고, invalid summary의 expectedIds/actualIds/missingIds/finalGeo는 throw와 함께 유실된다. 실패 원인 판별에 필요한 마지막 불변식 상태까지 보존되지는 않았다.

작은 수정안: 실패 시에도 안전한 동일 summary/viewport 진단을 `status:rejected, phase, reason`과 함께 결과로 반환해 caller가 append-only 저장한 뒤 run을 기각하거나, summary를 구조화된 error에 붙여 catch에서 별도 rejected sample 파일로 저장한다. 성공으로 점수화하지 않고 기존 raw는 덮어쓰지 않는다. 사용자 데이터나 원문 console/provider 오류를 저장할 필요는 없다.

**통계·부하·모델 식별 경계**

이번 요청은 소스 후속 검토이며 새 timed 성과를 요구하지 않는다. 기존 50ms/10%와 A/A noise floor, heavy/saturated/unequal pair의 주 quiet 승인 제외 정책은 유지된 것으로 읽었다. plan-v3의 `independent fresh-context` 표현만으로 같은 호스트의 pair 간 독립성이 입증되지는 않는다. 새 sample의 관측 계약이 달라졌으므로 기존 baseline-aa-v3 값은 이전 sampler의 noise 자료임을 표시하고, 새로운 sampler A/A 결과로 재명명하지 않는다. 새 측정 주장을 하려면 그때 동일 sampler/부하 층의 증거를 준비해야 한다. quiet 자료 부재/GPU 미계측 한계와 no-admission 원칙을 철회하지 않는다.

모델 식별에 대한 새 사용자 제공 증거는 “native turn_context에서 `gpt-6-astra`, reasoning=`max`, assistant response 확인”이다. 따라서 모델 표시뿐이라는 이전 입력 상태보다 강한 **native session metadata + 응답 존재** 증거로 기록한다. 이번 검토자가 해당 추출 원본을 별도로 읽지는 않았다. transport trace/vendor response ID가 없으므로 실제 공급자 라우팅을 그 이상 주장하지 않는다. quota는 사용자 보고 `none`이며 독립 계정/quota 조회나 무제한 사용 가능성 추정은 하지 않았다. 파일명 자체는 모델 증거로 사용하지 않는다.

**검토 범위와 보존**

읽은 범위: 두 renderer 파일의 diff 및 v4 추가 경로, bounds/debounce helper, MockMap bounds/marker, sample/runtime/paired/plan-v3/resources, predicate/flow-invariants test, v4 빌드 receipt 및 retained input/hash. 목록·선택·검색·filter의 기존 callers는 앞선 검토와 현재 diff의 변경 범위를 대조했다. low-zoom의 기존 pool/cluster 생성 방식을 별도 수정 대상으로 확장하지 않았다.

v4 receipt가 생성되어 있음을 읽었고, 9개 retained input hash와 현재 소스, v4 source.patch와 현재 두 파일 diff, BUILD_ID 및 build.log hash가 일치했다. 저장된 BUILD_ID는 `iW4x_VbzhreKC8_bbpydZ`, receipt Node는 `v24.21.0`이다. 이는 기존 빌드 증거의 일관성 확인이며 이 검토자가 빌드/브라우저를 실행했다는 뜻은 아니다. 성능 수치나 새 테스트 통과를 주장하지 않는다.

| 검토 입력 | SHA-256 |
| --- | --- |
| NaverMapView.tsx | `d0ec4a43836533387391533c8da60cd1a02642e8b7c0b5ba30a3e840482473c6` |
| naver-map-render-plan.ts | `75edbb62d7f39d7e39cffee90594e172642ec12eb852fda6885dc38a11cd84ab` |
| v4 source.patch | `78321cd9748e6cefbb8d61bfa16c64187117cfe8787e49965d64c95ab5063d93` |
| sample.mjs (16:57 재확인) | `cfea57abd1e029a3bae9c80a915afea70058c67859ddb45d58416109ff7ed886` |
| runtime.mjs | `2ed2590012edeaa2079689e3d21195e70d6551f70f564cb3cc6f1b40068a9008` |
| paired.mjs (16:57 재확인) | `f18b614bd3cc99d9a00fd4c8594eeb87213a272b886ba1da3c22b4707ca33e73` |
| plan-v3.json | `fee8971b8945aaba8fc81d2f8cb27500dc9ed78e6c618f26d02a18c7341da455` |
| resources.mjs | `7e4a04525ed16446fde58c08fc18c6b36c000de9bb3de9234bd4107966ace091` |
| 이전 astra-review.md | `8d64af0b4cb00fdd972e2c473a923be5ec8545486ad2375401190858dc6bc15a` |

유일한 작성 경로: `/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/astra-review-v4.md`. renderer/runtime/plan/raw/기존 보고서는 변경하지 않았다.
