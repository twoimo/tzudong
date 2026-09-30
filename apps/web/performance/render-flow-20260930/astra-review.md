검토 결론: **현재 v3의 SDK 마커 절감 방향은 목록/스와이프 후보를 직접 줄이지 않지만, 동작 보존과 주 timed 성과의 승인은 보류한다.** 아래 P1 두 건을 해결하고, 부하·통계 조건을 충족한 별도 증거가 필요하다. quiet 표본이 없으면 busy 환경별 관측값과 `no-admission / 재측정 필요`를 함께 보고하는 것이 타당하다.

검토 기준은 2026-09-30 16:38 KST에 읽은 HEAD `da805ea2602f4ed83e6e77e52e9da0b74ba2f8c5`와 미커밋 diff이다. 아래 지적은 정적 호출 경로와 저장된 JSON의 재계산에 근거하며 실제 브라우저 재현을 주장하지 않는다. 부모가 병행 편집 중이므로 파일명뿐 아니라 마지막 표의 해시를 기준으로 읽어야 한다.

**1. [P1] 화면 이동 자체가 마커 재계산을 보장하지 않는다.**

새 culling은 [NaverMapView.tsx:2698](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/components/map/NaverMapView.tsx:2698), [2986](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/components/map/NaverMapView.tsx:2986)에서 현재 bounds를 사용한다. 그런데 idle 처리의 유일한 cluster 갱신은 [2324](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/components/map/NaverMapView.tsx:2324)의 `areClusterFeaturesEqual ? previous : newClusters`이고, 렌더 effect [3044](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/components/map/NaverMapView.tsx:3044)에는 viewport revision이 없다. effect 안에서 bounds를 읽는 것만으로 effect가 실행되지는 않는다.

구체적 경로: 펼친 ID가 현재 데이터에서는 빠졌지만 snapshot에는 남아 있는 상태가 명시적으로 허용된다([snapshot:95](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/lib/expanded-cluster-restaurant-snapshot.ts:95), [기존 test:124](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/tests-unit/expanded-cluster-restaurant-snapshot.test.ts:124)). 그 ID를 화면밖에서 cull한 뒤 해당 위치로 pan해도, 현재 display 데이터로 만든 cluster index의 결과가 계속 같거나 빈 배열이면 React 의존성이 변하지 않는다. 기존에는 유지되던 SDK 마커가 이제는 없어졌으므로 다른 상태 변화 전까지 복원되지 않을 수 있다. zoom 또한 quantized cluster 결과가 같으면 같은 의존성 문제가 있다. v3의 의도적인 empty cleanup은 이 복원 경로를 더 중요하게 만든다.

작은 수정안: idle에서 실제 zoom/bounds의 직전 값과 비교해 변경 시에만 `viewportRevision`을 올리고 렌더 effect 의존성에 넣는다. 이 갱신은 cluster index 존재 여부와 cluster 배열 동등성 검사보다 먼저 수행한다. 지도 크기 변화도 같은 갱신 경로로 연결한다. 검증은 “동일 cluster 결과 + bounds만 이동”, “snapshot-only ID의 화면밖 → 화면안 → 화면밖”, “전체 cull 후 pan 복귀”, “동일 quantized zoom 내 실제 zoom 변화”를 포함해야 한다. 목록·스와이프 ID/순서는 함께 비교한다.

**2. [P1] 현재 완료 조건으로는 실제 픽셀 표시나 올바른 펼침 완료를 판정할 수 없다.**

[sample.mjs:12](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/sample.mjs:12)는 `x>400/0, y>100, y<innerHeight-100`라는 고정 사각형과 document 전체의 아무 individual marker 하나를 검사한다. 실제 map-container/패널 clipping, 가림, opacity, 클릭한 cluster의 ID, 목표 center/zoom, 이전 마커 여부를 검사하지 않는다. 다른 마커가 남아 있거나 중간 bounds에서 잠깐 사각형이 들어와도 완료가 고정된다. 600ms 대기는 그 완료 시각을 검증하지 않으며, 최종 summary에도 첫 마커 ID/rectangle/당시 bounds가 없다.

`requestAnimationFrame` 안에서 rectangle을 읽은 시각은 paint 완료 영수증이 아니다. 표준상 animation-frame callback 뒤에 style/layout 및 rendering 단계가 이어진다([HTML rendering 순서](https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering)). 현재 plan-v2의 “first rAF observing … rectangle”라는 제한된 이름은 유지할 수 있지만 “실제 pixel 완료”, “전체 펼침 완료”, “깜빡임 제거”로 확대하면 안 된다.

dynamic-bounds 차이도 남아 있다. [mock:320](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/tests/mobile-home-map-helpers.ts:320), [352](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/tests/mobile-home-map-helpers.ts:352), [382](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/tests/mobile-home-map-helpers.ts:382)는 center/zoom 변경과 projection을 즉시 반영하고 idle을 동기 발생시킨다. [jumpWithPanelOffset:1521](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/components/map/NaverMapView.tsx:1521)의 zoom → center 이동 중 실제 SDK의 지연·중간 projection 경로를 이 mock으로 입증할 수 없다. 실제 SDK race가 관측됐다는 뜻은 아니며, 현재 측정이 그 위험을 검사하지 않는다는 뜻이다.

작은 수정안: click 전 확정된 기대 cluster ID/멤버와 viewport 상태를 저장하고, 목표 idle 이후 실제 map-container와 화면의 교집합에서 해당 멤버의 rectangle·가림 여부를 검사한다. 첫 조건 충족 시 ID, rect, map rect, center/zoom/bounds, idle epoch를 보존하고 후속 frame에서 유지되는지도 확인한다. “첫 반응”과 “최종 기대 visible IDs 일치”를 별도 지표로 두어 일부 마커만 그린 회귀가 빠른 성공으로 통과하지 않게 한다. 실제 픽셀 주장을 하려면 부모의 별도 시각/trace 증거가 필요하다. 두 번째 rAF만 추가해 pixel 증명으로 취급하지 않는다.

`runtime.mjs:48`의 `markerlessFrames`도 cluster/화면밖 DOM까지 센다. 그 값이 0이어도 빈 지도나 누락을 배제하지 못한다. [paired.mjs:22](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/paired.mjs:22)는 양쪽 sample 완료 전에 pair를 저장하지 않아 후반 timeout이면 앞쪽 결과와 실패 시 화면 상태가 rejected.json에 남지 않는다. 각 sample 직후 append-only 파일로 저장하고 실패 시에도 해당 pair의 부분 결과와 안전한 viewport 진단을 보존하는 작은 보완이 필요하다.

**3. [P2] A/A의 시간에 따른 큰 변동이 있어 일반 pair bootstrap의 독립성은 아직 성립했다고 볼 수 없다.**

`baseline-aa-v3/raw.json`의 `samples[mobile].summary.clickToExpandedMs`를 Python 표준라이브러리로 재계산했다. 아래 값은 기존 원시값의 요약이며 새로운 성능 측정이 아니다.

| 항목 | Desktop | Mobile |
| --- | ---: | ---: |
| A/A 표본 수 | 6 | 6 |
| 전체 중앙값 | 2593.55ms | 2109.40ms |
| MAD / 2×MAD | 546.00 / 1092.00ms | 442.30 / 884.60ms |
| 2×MAD / 중앙값 | 42.10% | 41.94% |
| 앞 3개 중앙값 → 뒤 3개 중앙값 | 2714.70 → 1394.00ms | 2882.20 → 1742.10ms |
| 앞/뒤 중앙값 차이 | 1320.70ms | 1140.10ms |
| plan의 교대 분할 A/A 차이 | 242.30ms | 308.40ms |

교대 분할 수치는 plan과 일치하지만 시간 추세를 요약하지 못한다. 이 6개는 독립 A/A pair 6개도 아니며 `baseline-aa.mjs`에는 별도 warmup 제외가 없다. 31쌍 AB/BA 교대, fresh context, warmup 2쌍은 유용한 설계이지만 같은 browser/host의 시간 상관·공유 부하를 제거하는 증명은 아니다. 현재 검토 입력에는 scorer/bootstrap 구현 또는 admitted 결과가 없다.

필수 보완: cell별 완결된 pair를 통계 단위로 보존하고 `d_i=B_i-C_i`의 median 등 추정량을 미리 명시한다. B/C를 독립 resample하거나 프레임을 독립 표본으로 세지 않는다. 대응 bootstrap은 같은 index로 B/C를 함께 뽑는 방식이다([SciPy paired bootstrap 정의](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html)). 다만 pair 간 독립성은 별도 문제이므로 order/time/load 구간별 차이를 확인하고, 인접 AB/BA 블록을 보존한 민감도 분석 또는 독립 실행 반복을 제시한다. 31쌍 중 한 쌍이 남는 블록 처리, seed, 반복 수, 제외 사유도 고정한다. 유리한 bootstrap 방식이나 표본만 사후 선택하지 않는다.

50ms/10% 기준은 유지하되 이것만 통과하면 승인되는 것이 아니다. scorer에서 `2*maxMAD`가 참조하는 모집단을 명확히 하고 plan-v2의 A/A noise floor(1092.0/884.6ms)를 잃지 않아야 한다. 동일한 완료 조건/부하 층에서 absolute·relative·noise budget과 CI 조건을 모두 평가한다. v2의 낮은 noise를 복구하거나 A/A를 A/B 표본에 섞지 않는다.

**4. [P2] 부하 분류는 보수적인 제외에는 유용하지만 quiet 실행이나 CPU 격리를 입증하지 않는다.**

추가로 읽은 [resources.mjs:6](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/resources.mjs:6), [paired.mjs:22](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/paired.mjs:22), [resources-plan.json](/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930/resources-plan.json)은 sample 전후 기록, own descendant 제외, pair의 네 snapshot 중 최악 분류, CPU range >200% 표시, heavy/saturated/unequal pair의 주 quiet 승인 제외를 연결한다. 이 방향은 적절하다. 측정자는 이 검토에서 ps를 다시 실행하지 않았다.

사용자가 제공한 외부 CPU 합 1247%, 18 logical cores, load1=13.99, 최대 101%, ≥80%인 4개 프로세스라면 외부 CPU는 논리 용량의 약 69.28%이다. 외부 포화 기준 1530%(18×85) 및 load>18은 넘지 않지만, `heavy_overlap`이므로 **주 timed 성과에는 no-admission**이 맞다. “포화 아님”을 “부하 영향 없음”으로 읽으면 안 된다. CPU4는 호스트 성능 대비 slowdown이며 별도 CPU 자원을 예약하는 증거가 아니다([Chrome CPU throttling 설명](https://developer.chrome.com/docs/devtools/performance/reference#throttle_the_cpu_while_recording)).

남은 한계와 작은 보완: 전후 snapshot은 중간 burst를 놓치고 load1은 sample 순간만의 값이 아니다. 현재 CPU 포화 값은 외부 process 합이므로 owner까지 포함한 호스트 총 사용량을 뜻하지 않는다. `hostCpuPercent`와 `otherCpuPercent`를 함께 보존하고, 필요하면 고정 주기의 저빈도 기록을 미리 정한 방식으로 양쪽에 동일 적용한다. GPU는 `unavailable`로 유지한다. 현재 `quiet` label은 “두 지점에서 조건 미검출” 수준으로만 해석한다.

새 resource plan은 quiet-admission 제외 기준을 명시했으므로 scorer에도 같은 규칙을 적용하고 모든 시도·제외 건수·AB/BA 수를 보고해야 한다. 부하 제외 뒤 남은 n을 31로 표현하지 않는다. quiet 표본이 없거나 독립 실행이 확보되지 않으면 busy 각 층의 n/중앙값/대응 차이/marker 수 및 한계만 보고하고, 주 성과는 no-admission으로 남긴다. 바쁜 표본만으로 일반 환경이나 실제 모바일 기기의 개선율을 주장하지 않는다.

**상태 불변식 검사 범위**

| 항목 | 정적 검토 결과와 필요한 보완 |
| --- | --- |
| 목록/스와이프 후보 | NaverMapView 2439–2461에서 expanded ID를 먼저 복원하고 2529–2557에서 후보/payload를 발행한다. 새 predicate는 그 뒤 SDK acquire에만 적용된다. home-map-container 950–995/1022–1055도 DOM 수가 아니라 전달받은 후보로 목록·스와이프를 결정한다. 이번 diff가 후보를 직접 축소하는 경로는 발견하지 않았다. |
| 선택/검색 예외 | marker-visible selected/searched ID는 predicate에서 viewport보다 우선한다. 좌표 normalization과 user-submitted visibility guard도 유지된다. 이것은 predicate에 도달한 행에 대한 보장이다. 화면밖 선택/검색, merged/canonical ID, detail→다음 swipe까지의 실제 호출 경로 검증은 남아 있다. |
| empty / bounds 부재 | v3의 2777–2788/3017–3028은 유효 bounds에서 후보가 전부 cull되면 stale pool을 release하고 branch 끝에서 retry를 reset한다. bounds=null은 이전처럼 그린다. 상위 signature-skip 경로의 일시 retry 예약까지 없어진 것은 아니므로 “모든 retry 경로 제거”로 표현하지 않는다. 전체 cull 후 pan 복원은 지적 1의 대상이다. |
| filter / region | 2135–2137에서 expanded IDs를 reset하고 user-submitted 숨김은 2057–2061에서 reset한다. 이 동작은 diff에서 바꾸지 않았다. 빈 필터 결과/선택 해제/숨김 후 잔존 마커는 통합 검증이 필요하다. |
| mutation | 새 predicate 자체에는 cache가 없고 입력을 변경하지 않는다. 그러나 새 test 21–27은 predicate에 같은 객체를 직접 다시 전달한다. renderer의 early key(2360–2382), useMemo, lookup/reference cache를 통과하는 mutation 검증은 아니다. 현재 caller의 immutable array 교체 계약(mobile-home-search-selection:294)에 맞춘 동일 ID 좌표 변경·삭제/교체를 검사해야 한다. in-place 변경 지원을 주장하려면 그 경로를 별도로 입증해야 한다. |
| pan / zoom | 지적 1의 갱신 보장이 빠져 있어 helper 단위 테스트만으로 통과 판정할 수 없다. |

이번에 실행한 검사는 scoped git diff/read, 호출부 정적 추적, JSON 통계 재계산, 파일 해시/receipt 대조뿐이다. 브라우저 실행·브라우저 측정·빌드·테스트 suite·외부 환경 변경은 하지 않았다. 새 test 파일도 읽기만 했다. 새 브라우저 증거는 부모의 순차 검증으로 남긴다.

v3 build receipt의 9개 retained input hash가 현재 소스와 일치하고, 두 파일의 diff가 v3 source.patch와 일치한다. 저장된 BUILD_ID와 build.log 해시도 baseline/v3 receipt와 일치한다. 이는 **저장된 빌드 증거의 일관성 확인**이며 이 검토자가 빌드나 앱 실행 성공을 재현한 결과는 아니다. baseline BUILD_ID=`0OxkiMV0zCpf_VLIeTl1i`, candidate-v3 BUILD_ID=`VOhKVO1ind7PiZajdhdQG`, receipt Node=`v24.21.0`.

기각된 `baseline-aa-v2/raw.json`과 `paired-v1/rejected.json`은 그대로 보존한다. 후자는 `TimeoutError`, pairs=[], warmups=[]라서 자체로 실패 시 rectangle/center를 복원할 수 없다. 원 fixture의 잘못된 longitude와 거짓 DOM 완료 원인은 사용자 설명 및 setup-rejections의 기각 이유로 구분한다. 현재 runtime의 longitude126.96/중구 주소, plan-v2의 갱신된 A/A 값은 직접 확인했다. 과거 기각 결과를 v3 성과에 합치지 않는다.

**검토 대상 식별값(SHA-256)**

| 입력 | SHA-256 |
| --- | --- |
| NaverMapView.tsx | `93dd8df7026a4d39d07b0aea70f925ad8a21c7bc8bad7c59c0337ca795166d3d` |
| naver-map-render-plan.ts | `75edbb62d7f39d7e39cffee90594e172642ec12eb852fda6885dc38a11cd84ab` |
| v3 source.patch | `d6e0ad0ed3025b3cd7dccca062ea22c78df617d2ccf5c05852cd70c67efe7aff` |
| runtime.mjs | `d059349d55776caa7b1331aa89e59b17f72693f6412a3eeaee7f2edf75ab30c3` |
| sample.mjs | `cee0538aad97fad8cbf3a57605914f7ec817166cfd0496666e58540777ffa81f` |
| paired.mjs (resource 연결 후) | `bde5cc86a8fc9e7bb0933b366f33b63cb4c6a7d2bea27a7bc019f7d3b14f07f9` |
| resources.mjs | `75ff3874a927520b1118280d6a044ece0679a5d99c92d4380af836b5366ad75a` |
| resources-plan.json | `c62a2152dd963a7e2767b2a75ba3311454541db79ef6cb68488e73ef94336035` |
| plan-v2.json | `79c33100da2e07b6b36559bf2702442ff7ea51941a1a88aa7287d502d6d0bb52` |
| baseline-aa-v3/raw.json | `6795d932d2b0874a364b74737e13a4a7036b2462baa323e3cd23c07f86892490` |
| baseline-aa-v2/raw.json | `531944f8c953ff130a4c89c21cd509c32a8cdeeb9d126df6e78cdc7f9bb2637d` |
| paired-v1/rejected.json | `864fcd7520011d415a8a4270f22f5da41ccd518ffb5fd263b00e77fed541b4d4` |

수정 경로는 이 보고서 `apps/web/performance/render-flow-20260930/astra-review.md` 하나뿐이다. renderer/runtime/plan/raw/기존 test에는 쓰지 않았다.

모델 호출 식별: 이 검토 입력에는 실제 provider/model 요청 ID·응답 ID 또는 라우팅 영수증이 없다. `astra-review.md`라는 파일명이나 UI 모델 표시를 근거로 Astra 호출·라우팅 성공을 주장하지 않는다.
