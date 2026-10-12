# SDK resize 후보: primary 회귀 기준 미충족

후보87b78e839206a56a255a1d408a410bf4b1829cc4의 사용자 반응 시간 개선과 메모리 회귀 해소는 입증되지 않았다. 선택 클릭 지연 중앙값159.95→160.30ms는0.35ms 느려졌으며 paired95%CI [-3.45,0.55]ms가0을 포함한다. idle heap 중앙값30.861592→33.853112MB(+2.991520MB,+9.693%)이고, paired 상대95%CI [-22.009%,17.952%]가 고정20% 악화를 배제하지 못한다.2/9쌍이20%보다 높다. A/A idle 차이 최대10.896636MB를 근거로 기준을 면제하지 않았다. 모든 median guard는 통과했지만 primary 상대CI guard는 통과하지 못했다. 후보는 미채택이며 승격·운영 배포하지 않는다.

Before main056a86600f412eb42df4304e3206841679012f3e / After87b78e839206a56a255a1d408a410bf4b1829cc4. 앞선 query callback81d5와 geometry cache723e를 포함하지 않았다. 마지막map/target/width/height의O(1)기록으로 같은 크기의 초기 ResizeObserver 알림에서 중복 SDK 측정을 줄이고, 실제 크기·map·target 변경과 기존320ms post-transition centering을 보존했다. 새로운 listener/delay/데이터 축소는 없다. 진단의resize75→50회는 SDK 내부 호출도 포함하며 UI 속도나 heap 개선을 증명하지 않았다. 단일pilot의17.45ms 감소는 이 반복 비교에서 재확인되지 않았다. 개선율을 단순 합산하지 않는다.

Next16.3.8 production Webpack, Node24.21.0/npm11.6.2, Chrome154.0.8037.98/Playwright1.63.0,390×844/dpr1,CPU4,HTTPcache disabled·SW bypass,원격 SDK/타일 무감속이다. REST735/Auth401은 합성이고 SDK script SHA802f8c5bb436eeb0014e0e8c72e7f675ae88e102766d2a923cd2c24c7eca74d1은 실제 원격 응답이다. 관측 SDK 버전은null이며 API pathv3을 semantic version으로 간주하지 않는다. source/build/lock/helper/fixture해시를 매 실행 확인했다. 다른 소유 작업의 부하·GC·원격 provider 지연은 완전히 통제하지 못했다.

사전에 고정한 AA4 fresh processes와 AB9쌍(18processes),각256동작(128개 검색+같은128개 재방문)을 모두 완료했다.5632동작은5632명의 독립 사용자가 아니다.22/22에서 선택한 상세 이름·선택 marker·중복0·map1·visible·overflow0 조건을 충족했다. 모든 검색 결과의 전체 정렬/실제 사용자 데이터 동등성, 실제 touch swipe, 인증 쓰기 흐름까지 이 검사로 확대하지 않는다. 프로파일·forcedGC·자체 build/test는 primary 창에 사용하지 않았다.

측정의inputToObserved는 검색 결과 행을 클릭한 시점부터 두rAF 뒤 상세/선택marker를 확인한 시간이다. 검색어 타이핑→결과 대기 전체 시간 또는 field INP가 아니다. 표의Before/After는9독립실행 중앙값이고 paired95%CI는쌍별차이 중앙값의20,000회bootstrap(seed20261009)이다. 중앙값끼리 차이와쌍별차이 중앙값은 다를 수 있다. A/A는2쌍뿐인 약한노이즈 추정이다. 실행 내256클릭p95는 기술통계이며9독립쌍에서 모집단/실사용자p95를 추론하지 않는다.

낮을수록 좋은 지표의 절대 감소=Before−After, 상대 감소=(Before−After)/Before×100이다. 양수는감소,음수는증가다. 분해능 아래 차이의 상대율은 보고하지 않는다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
|---|---|---|---|---|---|---|---|---|---|
|128검색×2회|production·CPU4,독립9쌍|초기 heap (MB)|12.509356|12.564668|-0.055312|-0.442%|A/A≤0.499348; paired95%CI [-0.182400, -0.017448]|개선 입증 안 됨; 회귀 CI 기준 충족|browser-confirm-summary-v7.json / ui-ab-resize-gate-v1-*/raw.json|
|128검색×2회|production·CPU4,독립9쌍|256동작 종료 heap (MB)|36.724928|32.978100|3.746828|10.202%|A/A≤10.882100; paired95%CI [-0.158432, 18.382616]|개선 입증 안 됨; 회귀 CI 기준 충족|browser-confirm-summary-v7.json / ui-ab-resize-gate-v1-*/raw.json|
|128검색×2회|production·CPU4,독립9쌍|5초 idle heap (MB)|30.861592|33.853112|-2.991520|-9.693%|A/A≤10.896636; paired95%CI [-5.477024, 7.701184]|개선 입증 안 됨; 회귀 배제 실패|browser-confirm-summary-v7.json / ui-ab-resize-gate-v1-*/raw.json|
|128검색×2회|production·CPU4,독립9쌍|표본 시점 peak heap (MB)|49.278776|49.978712|-0.699936|-1.420%|A/A≤3.896728; paired95%CI [-2.163780, 1.744540]|개선 입증 안 됨; 회귀 CI 기준 충족|browser-confirm-summary-v7.json / ui-ab-resize-gate-v1-*/raw.json|
|128검색×2회|production·CPU4,독립9쌍|선택 클릭→상세·마커 관찰 (ms)|159.950000|160.300000|-0.350000|-0.219%|A/A≤14.850000; paired95%CI [-3.450000, 0.550000]|개선 입증 안 됨; 회귀 CI 기준 충족|browser-confirm-summary-v7.json / ui-ab-resize-gate-v1-*/raw.json|
|128검색×2회|production·CPU4,독립9쌍|첫128개 선택 클릭 (ms)|175.550000|176.300000|-0.750000|-0.427%|A/A≤15.550000; paired95%CI [-3.300000, 1.250000]|개선 입증 안 됨; 회귀 CI 기준 충족|browser-confirm-summary-v7.json / ui-ab-resize-gate-v1-*/raw.json|
|128검색×2회|production·CPU4,독립9쌍|같은128개 재방문 선택 클릭 (ms)|143.600000|144.300000|-0.700000|-0.487%|A/A≤14.800000; paired95%CI [-15.650000, 0.500000]|개선 입증 안 됨; 회귀 CI 기준 충족|browser-confirm-summary-v7.json / ui-ab-resize-gate-v1-*/raw.json|
|128검색×2회|production·CPU4,독립9쌍|실행 내 클릭p95의 중앙값 (ms)|227.125000|230.100000|-2.975000|-1.310%|A/A≤30.675000; paired95%CI [-11.125000, 4.350000]|개선 입증 안 됨|browser-confirm-summary-v7.json / ui-ab-resize-gate-v1-*/raw.json|
|128검색×2회|production·CPU4,독립9쌍|관측 long task 수|229.000000|234.000000|-5.000000|-2.183%|A/A≤6.000000; paired95%CI [-10.000000, 6.000000]|개선 입증 안 됨|browser-confirm-summary-v7.json / ui-ab-resize-gate-v1-*/raw.json|
|128검색×2회|production·CPU4,독립9쌍|관측 long task 합계 (ms)|17139.000000|17670.000000|-531.000000|-3.098%|A/A≤2181.000000; paired95%CI [-1781.000000, 338.000000]|개선 입증 안 됨|browser-confirm-summary-v7.json / ui-ab-resize-gate-v1-*/raw.json|
|128검색×2회|production·CPU4,독립9쌍|최대 관측 frame 간격 (ms)|133.400000|133.400000|-0.000000|계산 안 함: 분해능 아래 차이|A/A≤50.000000; paired95%CI [-49.900000, 16.700000]|개선 입증 안 됨|browser-confirm-summary-v7.json / ui-ab-resize-gate-v1-*/raw.json|
|128검색×2회|production·CPU4,독립9쌍|합성 맛집 요청 수|2434.000000|2434.000000|0.000000|0.000%|A/A≤0.000000; paired95%CI [0.000000, 0.000000]|개선 입증 안 됨|browser-confirm-summary-v7.json / ui-ab-resize-gate-v1-*/raw.json|
|128검색×2회|production·CPU4,독립9쌍|종료 DOM 노드 수|9820.000000|5231.000000|4589.000000|46.731%|A/A≤10895.000000; paired95%CI [-2821.000000, 14548.000000]|개선 입증 안 됨|browser-confirm-summary-v7.json / ui-ab-resize-gate-v1-*/raw.json|
|128검색×2회|production·CPU4,독립9쌍|종료 JS 리스너 수|7910.000000|6807.000000|1103.000000|13.944%|A/A≤15914.000000; paired95%CI [-4114.000000, 20945.000000]|개선 입증 안 됨|browser-confirm-summary-v7.json / ui-ab-resize-gate-v1-*/raw.json|

Console44개 관측: {'http401': 0, 'blockedClient': 0, 'provider': 0, 'other': 22, 'csp': 22}. Network102개 관측: {'other-network-failure': 22, 'net::ERR_ABORTED': 80}. 서로 중복 가능하며146고유 사용자/결함으로 합산하지 않는다.22실행의pageerror0을 오류 확률0으로 해석하지 않는다. SDK·CSP 오류를 숨기거나 허용 도메인을 넓히지 않았다.88장의 정지캡처는 영상이 아니므로 플리커 발생률/지속시간을 판정하지 못한다. 실제 타일/마커 표시의 일부 정지 증거와 생성1회 조건만 확인했다. frame/longtask는 bounded 관측기 범위이며 초기 buffered 작업이 첫 구간에 포함될 수 있다. DOM/listener는 detached/GC 시점의 영향을 받으므로46.7% DOM 중앙값 감소를 독립 개선으로 주장하지 않는다.

통계의Python3.12.14 optimized 독립 재계산은 byte-identical(SHA bcaffb2cf5a48cffb7067e37d7a0e07a1e6d6b6529f1adf352a891f2be89aa2d)이다. 원자료는 변경하지 않았다. canonical scorer/독립validator는통과하지만heap budget metric이없어items0/admitted0이며남은오류로releaseBlocked=true다. 형식/해시/CI green은성능채택이나운영성공이아니다. 같은source의fullunit3456pass/11skip/0fail,lint/parity/build/CSS와6개의모바일context viewport mapgeometry 일치는별도diagnostic root에보존했다.

PR3197은draft이며성능판정을반영해승격/배포를보류한다. serving readback은1884f87e53c4567ead7c9a0fb394b09b91a70396/dpl_EUxJnWmDDozCSMWb2sqNSPgKJLM5였고현재field v1은CLS6/INP6/LCP10 metricinstances이다. browser/tablet/분모/독립사용자 정보가없어prospective field 성과가아니다. 휴대폰은사용하지않았다. warm60/cold2000·전체수명주기·픽셀영상·인증·보호된delivery/운영SQL/field protocol v2는미완료다.

다음은자연GC 변동과다른보유경로/SDK marker DOM 재생성 비용을분리하는것이다. 캐시용량확대/forcedGC/과도한debounce로기준을통과시키지않는다. 이후새후보는다시원인·동등성·사전고정측정·회귀판정으로진행한다. 이결과는전체목표완료가아니다.
