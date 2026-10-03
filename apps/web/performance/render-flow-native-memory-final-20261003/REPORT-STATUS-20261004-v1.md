# 메모리 후속 상태 — 운영 수리 완료 보고가 아님

모바일 small expanded≤1000을 유지해 SDK detach/reattach를 줄이는 prototype은 삼성 인터넷의 finite-window 회귀 guard 및 새 Chrome mobile-emulation cold/warm guard를 통과했다. 그러나 physical Chrome의 같은 retention 후보, 데이터 변경/용량 경계/실사용 흐름의 최종 source 검증, 반복 후 자연 heap 증가의 원인 분리와 배포는 남아 있다. 이 후보를 이미 운영 배포한 것으로 보고하지 않는다. 2026-10-04에 완료한 main3aebb1c6 UI/PNG/font release에는 experimental memory source가 없다.

Before/After 낮을수록 좋은 지표는 절대 감소량=Before−After, 상대 감소율=(Before−After)/Before×100이다. 음수는 증가다. MB는10^6bytes다. original15%latency/20%naturalheap 허용치를 바꾸지 않았으며 explicit GC로 면제하지 않았다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
|---|---|---|---|---|---|---|---|---|---|
| 735개 최초 펼치기 | production/actualSDK·Chrome154·390×844·CPU4·fresh process9쌍+2warmup쌍 | 클릭→2가시 rAF의 첫 표시 ms |455.6|433.5|22.1 감소|4.851% 감소|paired95% CI[-17.3,90.5]; ABBA[-11.1,94.8]; A/A floor97.96ms|개선 입증 안 됨·15%회귀 guard통과|mobile-retain-ui-summary-v1.json, mobile-retain-ui-v2-ab/raw.json|
| 같은735flow | 위동일·heap은첫표시+600ms, IDs직렬화전 | 자연 JSheap MB |20.934524|19.046632|1.887892 감소|9.018% 감소|CI[-1.330468,1.977912]MB; A/A95abs delta0.970422MB|개선 입증 안 됨·20%guard통과|동일 summary/raw|
| 2000개 최초 펼치기 | 위동일9쌍+2warmup; 해당2000 A/A없음 | 클릭→표시 ms |470.3|465.8|4.5 감소|0.957% 감소|CI[-58.2,38.6]ms|개선 입증 안 됨·15%guard통과|동일 summary/raw|
| 같은2000flow | 위동일·padded membership464 양쪽 | 자연 JSheap MB |24.795368|24.870220|0.074852 증가|-0.302%|CI[-6.288924,6.293852]MB·큰GCphase분산|20%guard통과·감소 주장 없음|동일 summary/raw|
| 60회 이동/복귀 | actualSDK·mobile emulation/CPU4·ABBA4 fresh process, variant당2·각60의존cycles | process별heap 중앙값의 중앙값 MB |67.273969|62.989060|4.284909 감소|6.369% 감소|Before process범위[66.570,67.978],After[62.659,63.319]; n2/AA없음/CI없음|20%finite guard통과·노이즈분리 gain주장 안 함|mobile-retain-warm-summary-v1.json, mobile-retain-warm-v1/raw.json|
| 같은60flow | 위동일 | 마지막 자연heap MB |112.851024|86.896432|25.954592 감소|22.999% 감소|Before[107.362,118.340],After[83.593,90.199]MB·n2|20%guard통과·반복후양의증가량남음|동일 warm summary/raw|
| 같은60flow | 위동일·수천rAF/frame/process | process내 gap p95의 중앙값 ms |33.4|16.8|16.6 감소|49.701% 조건부차이|두process 각각같은값; warmA/A·모집단CI없음; 사용자p95아님|15%frame guard통과·성능성과 일반화 안 함|동일 warm summary/raw|
| 삼성인터넷60 nativeflow | Galaxy1·기존browserprocess의fresh tabs2/variant·각60cycles | tab medianheap의중앙값 MB |29.604402|22.486781|7.117621 감소|24.042% 조건부차이|nativeA/A·CI없음; 단일기기·강제GC없음|모든pair median/peak/end20%guard통과|retain-v7-samsung-summary-v1.json, direct-samsung-memory-retain-v7-*/raw.json|

중복 acquire·HTML/SDK icon 변경 감소의 pool-order 단독 후보는 Samsung V6에서median+28.557%,end+40.543%로 guard를 실패했다. SDK allocation 진단에서 약95%setter 감소가 있어도 natural heap 예산을 면제하지 않고 거부했다. full-small retention과 결합한 prototype의 결과는 개별 개선율을 합산한 값이 아니다. V7 native에서는 viewport513→retained735(+43.275%)이고 새 emulation에서는464→735(+58.405%)이다. 더 큰 DOM을 보유하는 trade-off와 서로 다른 viewport membership을 구분한다. >1000에는 viewport culling을 유지한다.

warm after의 자연 heap은 initial보다 많이 증가했다. transient allocation/GC phase인지 지속 보유인지 final-source heap/retainer 진단이 더 필요하며 누수가 해소됐다는 결론은 없다. sparse native capture는10cycles마다7frames/tab이며28frames를 검사·보존했다. 이 주기로 짧은 composite 플리커를 배제할 수 없고 새 nav 사각형이나 강제dark PNG를 완전 제거했다고 주장하지 않는다.

Prospective collector의 field baseline은 이전 main1ab의13metric instances(사용자수 아님)다. mobile1개씩은INP[2736,2752)ms,LCP[6000,6100)ms,CLS[.12,.13)이며 matched cohort/CI/p75/p95 성과가 없다. 새UI release와 메모리prototype의 실험실 측정을 이 field 성과로 바꾸지 않는다. 마지막 ADB는0ready/0offline이므로 새 접속/USB 없이 physical Chrome·최종 삼성 검증을 실행할 수 없다. 현재 접속 주소/USB 재연결 질문은 기존 상태로 대기한다.

원본/frozen packet, 실패/거부 표본, source patch·inputs·build IDs·실행계획·raw·집계를 보존한다. 새cold aggregate의 A/A와 A/B는 각각 독립 driver1회이며 각 observation이 fresh process다. warm은driver1회/4process/240내부cycles다. 기존Playwright기본headless executable 실패는0표본으로 제외하고 설치된Chrome로 새label V2를 사용했다. heap/latency/frame의 source는main처럼 보이게 재분류하지 않고 UI commit f85b638c+실험patch로 결속한다. 최종memory source가 확정되기 전 새canonical admission이나 배포 완료를 주장하지 않는다.
