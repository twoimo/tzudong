# Query callback 수명 후보: 자연 상태 primary 비교

메모리 개선과 입력 지연 개선은 입증되지 않았다. 종료 heap 중앙값은 34.581208→31.741044MB(2.840164MB, 8.213% 감소), 5초 idle은 35.815840→32.898168MB(2.917672MB, 8.146% 감소)다. 두 지표의 paired 95% CI가 0을 포함하며 제한적인 A/A heap 변동은 약9.29MB다. 고정20% 메모리 회귀 기준은 중앙값과 상대95% CI 모두 충족하지만, 이것은 유의미한 개선이나 누수 부재의 증명이 아니다.

전체 입력 중앙값174.4→175.0ms는 개선되지 않았다. 재방문 지연은159.25→158.15ms지만 paired 상대95% CI [-20.208%,12.866%]가 고정15% 악화를 배제하지 못하며2/9쌍이15%보다 느렸다. 전체 median guard만으로 후보를 채택하지 않는다. 후보81d5는 로컬 검증 상태이며 성능 admission0, 운영 미배포다. 이전 캐시 후보21a의 실패와 준비만 했던 primary-v1도 보존했다.

Before main056a86600f412eb42df4304e3206841679012f3e / After81d5aca4951e7cef5d67c1e910f31b3436597466. Next16.3.8 production, Node24.21.0/npm11.6.2, Chrome154.0.8037.98, Playwright1.63.0, viewport390×844/dpr1, CPU4, HTTP cache disabled·SW bypass. REST735/Auth401은 합성이고 원격 Naver SDK·타일은 실제다. SDK SHA802f8c5bb436eeb0014e0e8c72e7f675ae88e102766d2a923cd2c24c7eca74d1, fixture SHA346c9c865201a48b590c439a4e06306bfada92f91c73f9a83293a991a51058b5, 빌드·helper·lock 해시를 매 실행 확인했다. SDK가 버전을 보고하지 않아 관측 버전은null이다. touch 설정을 켠 데스크톱의mouse fill/click이며 실기기·삼성 인터넷·실제touch·field 검증이 아니다.

사전 고정한 A/A4개 fresh process와 A/B9쌍(18개 process)을 순서 교차하여 실행했다. 실행당 검색128개+동일128개 재방문, 총5632개 종속동작은5632명의 독립 사용자가 아니다.22/22에서 결과·선택 마커·중복 없음·지도1회 생성·visible·overflow0 조건이 일치했다. profiler·forcedGC·자체 build/test를 primary 창에 사용하지 않았다. 원격provider·GC와 외부host부하는 완전히 통제하지 못했다.

낮을수록 좋은 지표의 절대 감소=Before−After, 상대 감소=(Before−After)/Before×100이다. 양수는감소/음수는증가다. 표의Before/After는독립9실행의중앙값이고95%CI는쌍별차이의중앙값에대한20,000회bootstrap(seed20261009)이다. 중앙값끼리의차이와쌍별차이의중앙값은다를수있다.9독립쌍은모집단p95를판정하기부족하며표의p95는각실행내256동작의기술통계다. A/A는2쌍뿐인약한노이즈추정이며회귀면제에쓰지않았다. 타이머분해능이하차이와긴frame의잔여소수점은유의미한변화로해석하지않는다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
|---|---|---|---|---|---|---|---|---|---|
| 검색128개×2회 | production·CPU4, 독립9쌍 | 초기 heap (MB) | 12.532500 | 12.544672 | -0.012172 | -0.097% | A/A≤0.284740; paired95%CI [-0.078628, 0.079772] | 개선 입증 안 됨; 회귀 CI 기준 충족 | browser-confirm-summary-v7.json / ui-ab-query-owner-v2-*/raw.json |
| 검색128개×2회 | production·CPU4, 독립9쌍 | 256동작 종료 heap (MB) | 34.581208 | 31.741044 | 2.840164 | 8.213% | A/A≤9.289264; paired95%CI [-2.047380, 9.136320] | 개선 입증 안 됨; 회귀 CI 기준 충족 | browser-confirm-summary-v7.json / ui-ab-query-owner-v2-*/raw.json |
| 검색128개×2회 | production·CPU4, 독립9쌍 | 5초 idle heap (MB) | 35.815840 | 32.898168 | 2.917672 | 8.146% | A/A≤9.290784; paired95%CI [-2.051600, 9.031228] | 개선 입증 안 됨; 회귀 CI 기준 충족 | browser-confirm-summary-v7.json / ui-ab-query-owner-v2-*/raw.json |
| 검색128개×2회 | production·CPU4, 독립9쌍 | 관측 표본 peak heap (MB) | 51.322488 | 46.506268 | 4.816220 | 9.384% | A/A≤3.929468; paired95%CI [-1.867680, 7.809676] | 개선 입증 안 됨; 회귀 CI 기준 충족 | browser-confirm-summary-v7.json / ui-ab-query-owner-v2-*/raw.json |
| 검색128개×2회 | production·CPU4, 독립9쌍 | 입력→화면 관찰 중앙값 (ms) | 174.400000 | 175.000000 | -0.600000 | -0.344% | A/A≤0.700000; paired95%CI [-17.850000, 16.650000] | 개선 입증 안 됨; 회귀 CI 기준 충족 | browser-confirm-summary-v7.json / ui-ab-query-owner-v2-*/raw.json |
| 검색128개×2회 | production·CPU4, 독립9쌍 | 첫 128개 검색 중앙값 (ms) | 176.800000 | 191.300000 | -14.500000 | -8.201% | A/A≤11.950000; paired95%CI [-16.050000, 14.200000] | 개선 입증 안 됨; 회귀 CI 기준 충족 | browser-confirm-summary-v7.json / ui-ab-query-owner-v2-*/raw.json |
| 검색128개×2회 | production·CPU4, 독립9쌍 | 동일 128개 재방문 중앙값 (ms) | 159.250000 | 158.150000 | 1.100000 | 0.691% | A/A≤14.900000; paired95%CI [-32.000000, 21.300000] | 개선 입증 안 됨; 회귀 배제 실패 | browser-confirm-summary-v7.json / ui-ab-query-owner-v2-*/raw.json |
| 검색128개×2회 | production·CPU4, 독립9쌍 | 실행 내 p95의 중앙값 (ms) | 252.675000 | 256.075000 | -3.400000 | -1.346% | A/A≤16.175000; paired95%CI [-50.550000, 48.175000] | 개선 입증 안 됨 | browser-confirm-summary-v7.json / ui-ab-query-owner-v2-*/raw.json |
| 검색128개×2회 | production·CPU4, 독립9쌍 | long task 수 | 239.000000 | 240.000000 | -1.000000 | -0.418% | A/A≤8.000000; paired95%CI [-8.000000, 5.000000] | 개선 입증 안 됨 | browser-confirm-summary-v7.json / ui-ab-query-owner-v2-*/raw.json |
| 검색128개×2회 | production·CPU4, 독립9쌍 | long task 합계 (ms) | 19729.000000 | 19798.000000 | -69.000000 | -0.350% | A/A≤1478.000000; paired95%CI [-2910.000000, 2818.000000] | 개선 입증 안 됨 | browser-confirm-summary-v7.json / ui-ab-query-owner-v2-*/raw.json |
| 검색128개×2회 | production·CPU4, 독립9쌍 | 최대 관측 frame 간격 (ms) | 183.300000 | 183.300000 | -0.000000 | -0.000% | A/A≤16.700000; paired95%CI [-50.200000, 33.300000] | 개선 입증 안 됨 | browser-confirm-summary-v7.json / ui-ab-query-owner-v2-*/raw.json |
| 검색128개×2회 | production·CPU4, 독립9쌍 | 합성 맛집 요청 수 | 2434.000000 | 2434.000000 | 0.000000 | 0.000% | A/A≤0.000000; paired95%CI [0.000000, 0.000000] | 개선 입증 안 됨 | browser-confirm-summary-v7.json / ui-ab-query-owner-v2-*/raw.json |
| 검색128개×2회 | production·CPU4, 독립9쌍 | 종료 DOM 노드 수 | 3334.000000 | 6111.000000 | -2777.000000 | -83.293% | A/A≤1884.000000; paired95%CI [-890.000000, 10254.000000] | 개선 입증 안 됨 | browser-confirm-summary-v7.json / ui-ab-query-owner-v2-*/raw.json |
| 검색128개×2회 | production·CPU4, 독립9쌍 | 종료 JS 리스너 수 | 4235.000000 | 4237.000000 | -2.000000 | -0.047% | A/A≤2542.000000; paired95%CI [-1313.000000, 16028.000000] | 개선 입증 안 됨 | browser-confirm-summary-v7.json / ui-ab-query-owner-v2-*/raw.json |

Console 관측44개: {'http401': 0, 'blockedClient': 0, 'provider': 0, 'other': 22, 'csp': 22}. 원격 요청 실패 관측288개: {'other-network-failure': 22, 'net::ERR_ABORTED': 266}. pageerror0은이22실행에서의관측이다. Console과network관측은중복가능하며고유결함/사용자수로합산하지않는다. NELO connect-src 차단은보안정책을넓혀숨기지않았다. 실제타일요청의abort와SDK오류는분리진단이필요하다. 의미대응을검증하지않은오류를정상으로분류하지않는다.

88장의정지캡처는연속영상이아니므로플리커발생률·지속시간을판정하지못한다. CDP Nodes/listeners는GC시점에의존하고detached객체를포함할수있다. 특히DOM중앙값3334→6111(+83.293%)를숨기지않으며95%CI가넓어증가원인이확정되지않았다. GPU·renderer전체메모리는미측정이다.

Python3.12.14 optimized모드의별도임시복사본재계산이byte-identical이었다(SHA 9b68f7cb61ea92c4c307c5a049b42f8a1f766a2d15be787ae8376ac3ad8f6e37). 원자료는변경하지않았다. canonical scorer와독립validator는통과했지만items0/admitted0/releaseBlocked=true다. 현재budget에heapmetric이없어새가짜metric으로admission하지않았다. Console44/network288을정제건강자료에연결했고다른incident0은실기기·field·보안coverage증거가아니다.

변경원리는쿼리cache가componentlexicalcontext의Reactdispatch/Fiber를보유하는경로를끊는것이다. 생산minifier가factory를render-localIIFE로재인라인하여첫시도가실패했고,5개fixedfunctionreference의Object.freeze조회로4inlinefactory→0을확인했다. diagnostic의Fiber1202→946는forced-snapshot조건의객체수차이이며primaryheap21.3%감소를뜻하지않는다. fixedregistry는O(1)공간이며검색querycache의수명·키·범위를바꾸지않았다. 일반적인모든callback에확대적용하지않는다.

다음조치는재방문긴작업의브라우저타임라인/샘플링진단과원인별수정,동등한primary재측정이다. warm60/cold2000·수명주기·viewport·실제픽셀·운영재검증·prospectivefield의충분한표본은남아있다. 휴대폰은사용자의지시로사용하지않는다. G037운영SQL동결예외는미승인이고새후보의소스승격/배포는없다. 전체목표완료가아니다.
