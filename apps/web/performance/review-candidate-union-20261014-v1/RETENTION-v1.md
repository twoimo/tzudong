# 별도 메모리 구조 진단

primary22실행의 표본·판정·guard는 변경하지 않았다. 별도각1개의 기준선/후보 프로세스에서256동작 후 marker setter를 계수하고, 자연end/idle을 기록한 다음 강제GC와 heap구조 캡처를 수행했다. SDK프록시·강제GC·snapshot비용이 있으므로 primary성능비교에 포함하지 않는다. 약51MB의 heap원문은RAM에서만 처리하고 allowlisted형식·클래스명·숫자카운터만 보존했다. 임의 원문문자열·자격증명·payload·원시heap파일은 저장하지 않았다.

| build | 마커 생성 | setIcon | setMap | end heap MB | idle heap MB | forced-GC heap MB | forced-GC DOM nodes / listeners |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline | 164 | 9354 | 16904 | 41.380 | 25.273 | 23.434 | 1516 / 1491 |
| candidate | 164 | 9354 | 16904 | 28.696 | 29.716 | 23.362 | 1520 / 1491 |

많은 marker아이콘/setMap 변경과 자연GC후 DOM·리스너 감소를 관측했다. 이는 allocation churn과GC시점이 변동에 기여할 수 있다는 조사 근거다. 단일 두 실행으로 누수 부재, 전체성능 개선 또는20%guard통과를 주장하지 않는다. union후보는 marker구현을 바꾸지 않았다. 다음 수정은 실제setter/DOM교체의 소유 경로와 안정ID 재방문 동등성을 먼저 확인해야 하며 speculativecache나필요피드백숨김으로 대신하지 않는다.

heap snapshot의detachedness코드는 해석하지 않은숫자분포로 보존했다. retained-path를 입증한 것으로 부르지 않는다. raw.json에 자연heap과 강제GC후heap을 각각 기록했다. primary와diagnostic관측의 메모리 API범위는 Runtime.getHeapUsage.usedSize이며 graph.totalSelfBytes나embedder/backingStorage를 같은수치로비교하지 않는다.
