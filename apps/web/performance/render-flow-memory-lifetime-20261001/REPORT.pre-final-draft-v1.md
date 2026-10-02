이 파일은 이전 작업 중 초안이며 최종 판정은 REPORT.md를 따른다. 운영 진행 중 문장과 이전 소스 수치는 역사적 기록이다.

메모리 수정 단계는 기존 렌더링 개선 뒤 발생했던 **원본 대비 자연 힙 증가를 사전20% 허용치 안으로 되돌렸다**. 마지막 모바일 스켈레톤 수정까지 포함한 통합 재검증에서도 자연 JS heap 중앙값18.879MB를 관찰했다. 현재 field 계측이 포함된 코드와 최종 공개 renderer를 동일 조건에서 비교한 결과, 클러스터 펼치기 후 자연 JS heap 중앙값은 **23.653→18.863MB, 4.790MB 감소(20.25%)**였다. 원본 Git 소스와 별도 비교한 최종 값은18.781→18.849MB(+0.36%)로 허용치를 통과했다. 이것은 해당 실험실 endpoint의 결과이며 browser 전체 RSS/GPU 메모리나 일반적인 누수 제거의 증명이 아니다.

최종 실행의 Before는 자연 GC phase에 따라20.3~31.7MB로 변했고 A/A95% 절대 차이도11.524MB였다. 앞선 중간 nav-v2 실행의39.99% contrast와 최종 nav-v3 실행20.90% contrast는 서로 다른 시간 창에서 나온 같은 프로토콜의 결과다. 이 contrast들을 앞선20.25%에 더하거나, 바텀 네비게이션 수정의 추가 성과로 귀속하지 않는다. 강제GC 진단에서는17.222→18.388MB(+6.77%)의 보유 비용이 남았다.

**속도 개선은 최종 재측정에서 입증되지 않았다.** 최종 비교는2.7ms 증가였고95% CI가0을 가로질렀다. 현재 코드 비교13.2ms, 원본 비교249.2ms, 필터 초기화50.1ms의 중앙값 감소가 관찰됐지만 사전 A/A noise 판정을 넘지 못했다. 이전 실행 창의22% 결과를 최종 통합 성과로 재사용하지 않는다. 운영 field 수집에는 개선 전 release의 CLS/LCP가 각각1개 있고 INP는0개였다. 현재 이 작은 집계로 실제 사용자 성과를 계산할 수 없다.

운영 승격·배포 결과는 이 보고서 마지막의 확정 readback으로 구분한다. 보고서를 작성하는 현재 `main` PR3087은 보호된 검사 및 측정 검토 후 병합됐으며 운영 배포·실주소 검증이 진행 중이다. 확정 main SHA는 e728c8ec5dc7889028054e9d2346d4ef1cafe184다. 이 문장은 운영 검증 완료 후 실제 결과로 갱신한다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화¹ | 상대 변화¹ | 노이즈·신뢰구간 | 판정 | 증거 경로 |
|---|---|---|---:|---:|---:|---:|---|---|---|
| 최종 소스735개 펼치기 | production/실제SDK,1440×900/CPU4,9 process 쌍+2 warmup,matching A/A9쌍 | 자연 JS heap MB |23.868|18.879|4.989 감소|20.90% contrast|paired95% 감소 CI[1.518,12.806]MB; A/A95% 절대차11.524MB, GC phase 변동|20% guard 통과/샘플 감소 관찰; 정밀 개선율의 노이즈 분리 입증 안 됨|`final-nav-owner-matched-summary-v1.json`, `final-nav-owner-natural-heap-aa-diagnostic-v1.json`|
| 같은 최종 소스 흐름 | 동일9쌍 | 클릭→첫 가시 marker ms |561.7|564.4|−2.7|−0.48%|CI[−29.6,34.28]ms; noise104.14ms|미세 지연 관찰/개선 입증 안 됨/15% 허용 통과|`final-nav-owner-matched-summary-v1.json`|
| 735개 펼치기, 현재 코드 | production/실제SDK,1440×900/CPU4,9 새 process 쌍+2 warmup 쌍 | 자연 JS heap MB |23.653|18.863|4.790 감소|20.25% 감소|paired95% 감소 CI[4.726,10.897]MB; MAD 원시 집계에 보존|감소 확인/20% budget 통과|`final-retry-matched-summary-v1.json`, `desktop-ab-final-retry-matched-ab-v1/raw.json`|
| 735개 펼치기, 원본 코드 | 동일 조건,9 쌍; 별도 matching A/A9쌍 | 자연 JS heap MB |18.781|18.849|−0.068|−0.36%|감소 CI[−0.105,−0.027]MB|미세 증가/원본20% budget 통과|`final-retry-original-summary-v1.json`|
| 735개 펼치기, 현재 코드 | 동일9쌍, matching A/A9쌍 | 클릭→첫 가시 marker ms |724.2|711.0|13.2|1.82%|CI[−88.7,289.9]ms; noise215.76ms|개선 입증 안 됨/15% 회귀 허용 통과|`final-retry-matched-summary-v1.json`|
| 735개 펼치기, 원본 코드 | 동일9쌍, original A/A9쌍 | 클릭→첫 가시 marker ms |1056.2|807.0|249.2|23.59%|CI[85.9,407.5]ms; noise332.78ms|개선 입증 안 됨/15% 회귀 허용 통과|`final-retry-original-summary-v1.json`|
| 2000개 펼치기 | 실제SDK/CPU4,9 쌍+2 warmup,992개 정확히 cull | 자연 JS heap MB |24.854|24.516|0.338|1.36%|감소 CI[0.299,0.343]MB; 이 cell의 A/A 없음|회귀 guard 통과; 별도 speed 주장 없음|`desktop-css-large-summary-v1.json`|
| 2000개 펼치기 | 동일9쌍 | 표시 ms |858.4|860.5|−2.1|−0.24%|CI[−24.9,89.3]ms|시간 개선 입증 안 됨/15% 허용 통과|`desktop-css-large-summary-v1.json`|
| 필터 빈 결과→초기화 | production/실제SDK/CPU4,9 process 쌍,process당 warmup1+측정3; A/A5쌍 | 입력→같은571개 표시 ms |588.5|538.4|50.1|8.51%|CI[−22.6,179.5]ms; noise223.20ms|개선 입증 안 됨/15% 허용 통과|`final-filter-summary-v1.json`|
| 같은 필터 흐름 | 위와 동일 | 자연 JS heap MB |27.457|28.421|−0.964|−3.51%|감소 CI[−1.097,−0.762]MB|증가 확인/20% 허용 통과, trade-off|`final-filter-summary-v1.json`|
| warm 지도 이동·복귀 | 실제SDK,각 variant2 process/60 cycle,ABBA총240 cycle | process별 중앙 힙의 중앙값 MB |28.232|30.599|−2.367|−8.38%|n2process/variant, CI·p95 제공 안 함|20% 허용 통과, 더 많이 유지|`desktop-css-warm-confirm-summary-v1.json`|
| 같은 warm 흐름 | 동일 | endpoint 힙의 중앙값 MB |27.056|31.110|−4.054|−14.98%|동일 유한 반복 관찰; 누수 부재의 증거 아님|증가/20% 허용 통과|동일 경로|
| 같은 warm 흐름 | 동일 | 각 process peak의 중앙값 MB |37.267|31.148|6.119|16.42%|n2; 전체 분포 보존|관찰 peak 감소, 독립 성과로 합산 안 함|동일 경로|
| Galaxy Chrome 이동·복귀 | Android16/Chrome154,1기기/기존 process,새 탭1개씩/60 cycle | 탭 중앙 힙 MB |25.696|25.607|0.090|0.35%|process 독립성 없음/CI 없음|감소 입증 안 됨/관찰20% guard 통과|`native-memory-final-summary-v1.json`|
| Galaxy Samsung Internet 이동·복귀 | Android16/Internet30,1기기/기존 process,ABBA4탭/총240 cycle | 탭 중앙 힙의 중앙값 MB |36.663|38.066|−1.404|−3.83%|각 variant2탭; 첫 쌍+22.16% 실패도 포함|전체 관찰20% guard 통과; 개선 입증 안 됨|`native-memory-final-summary-v1.json`, `samsung-native-abba-extension-plan-v1.json`|
| SDK offscreen 영구 오류 | 실제SDK에 명시적 합성 LatLng 예외,version당 진단1페이지 | 관찰 재시도 횟수 |3초13→4.5초19|7→7|무한 증가→기존6 retry+initial 제한|rate/개선율 계산 안 함|정상 SDK 성능 표본과 분리|제한 및 가시571개 보존 확인|`deferred-failure-browser-summary-v2.json`|
| native 반환 공백 | Chrome/Internet 각각1탭,5 return trial | >250ms DOM 가시 marker 부재 |동일 native Before 표본 없음|각각0/5 관찰|비교 계산 안 함|계산 안 함|rAF 관찰; 최소180ms filmstrip,≤120프레임/실행|완전 제거 단정 안 함|`native-flicker-observation-summary-v1.json`|
| 관리자 직접 진입 마커 | 실제 compiled route+lazy CSS,공개 HTML24case | 원래 스타일/박스와 일치 |lazy style 의존성 없음|24/24 일치|소비자 의존성 복구|성능율 계산 안 함|관리자 원시 자료·인증을 사용하지 않음|디자인 회귀 수정|`admin-marker-compiled-css-equivalence-v2.json`|
| prospective field | deployed Before release/desktop,n1 metric instance씩 | CLS/LCP/INP |CLS[0,.01),LCP≥12s,INP0표본|matched new-release cohort 미확보|계산 안 함|계산 안 함|사용자 독립성·exact 값·tail 추정 불가|실제 사용자 개선 입증 안 됨|`field-prospective-pre-memory-snapshot-v1.json` 및 최종 field readback|

¹ 낮을수록 좋은 값은 절대 감소=Before−After, 상대 감소=(Before−After)/Before×100이다. 음수는 증가다. MB는10⁶bytes이다. 과거 단계의 개선율, shared CSS 단독 수치, 최종 통합 수치를 더하지 않는다. 원본/현재 비교는 별도 comparand와 별도 A/A이며 한 표본 묶음으로 합치지 않는다.

primary 자연 힙은 최초 가시 표시 후600ms, ID 배열 직렬화 전에 수집했다. 명시적 GC 이후 값은 별도 진단으로만 남겼다. 현재 코드 비교의 GC 진단 힙은17.223→18.380MB(+6.72%)로, full small desktop set을 유지하는 비용도 확인됐다. n9process 쌍의 중앙값/MAD와10,000회 paired bootstrap을 제공하되 일반 사용자 p95를 만들지 않는다. ABBA 민감도 CI는 마지막 홀수 쌍을 고정하는 조건부 분석이라는 한계를 밝힌다. shared Mac·외부 SDK·네트워크의 시간 변화는 A/A로 드러났으며, 통제할 수 없는 부하는 원시 host snapshot에 남겼다.

측정 전에 정한 시간15%, 자연 힙20% 회귀 허용치와 practical noise 하한은 유지했다. 잠금/탭 숨김, 폰트 build 실패, 잘못된 distDir label, 시험용 선택자/터치/상태 기준, 실제 주입0회 오류 테스트, build와 겹친 A/A는 성공으로 세지 않았다. 각각 원시 자료와 거부/복구 영수증을 보존했다. 삼성 첫 메모리 쌍의22.16% 증가도 제외하지 않았고 동일 조건의 B/A를 추가해 ABBA 전체를 보고했다.

원인은 초기 marker DOM과 일시적 객체 할당·해제의 중첩이었다. 동일한 expanded 식당을 contextual pass에서 다시 SDK에 전달해571개에 대해 최대1142회의 중복 icon getter 경로가 관찰됐고, bare 생성 HTML에는 공백 text node7개와 동일한 style 선언이 반복됐다. plain fixture 하나의 HTML은899→448문자, 공백 text node7→0으로 바뀌었으며24case의 CSSOM/박스/텍스트/속성 비교가 통과했다. 이 단독 수치를 전체 UI의 배수로 바꾸지 않는다.

같은 source object의 두 번째 pass만 생략하므로 데이터가 바뀐 객체는 기존 갱신 경로를 탄다. 검색·선택 예외와 전체 목록/스와이프 후보를 유지했다. desktop expanded set≤1000은 전체 SDK set을 유지해 반복 detach/reattach를 줄이고, 처음에는 padded viewport와 예외를 표시한 뒤 offscreen 일을32개 단위 MessageChannel task로 나눴다. 모바일과>1000개 결과는 기존 padded culling을 유지한다. 데이터 변경·unmount는 남은 job 참조를 버리고 channel을 닫는다. 기존 pool 상한1000은 늘리지 않았다.

시간 복잡도는 ID 검사의 O(N) 그대로이며, 바뀐 것은 중복 상수 비용과 critical frame의 SDK 작업 수다. 이735개 cell은 처음571개를 표시하고164개 tail을 나눈다. 이론적으로 marker 생성 일을 약22.3% 뒤쪽으로 옮긴다고 전체 대기 시간이22.3% 줄었다고 주장할 수는 없다. 실제 timer와 A/A 판정은 위 표처럼 분리했다. full735 보유, warm endpoint 증가, 필터 초기화 후 inactive164개 보유가 유지 비용이다. 작은 pool128, runtime regex compaction, 역순 재사용 등 peak50–60MB를 만든 실험은 채택하지 않았다.

inactive marker의 app click closure를 비우고, eviction/clear에서는 **app이 등록한 SDK listener만** 해제했다. reusable marker의 SDK 내부 listener는 제거하지 않는다. 영구적인 offscreen API 실패가 재시도 카운터를 초기화하던 결함은 성공한 batch에서만 reset하도록 수정했다. 실제 production callback을 실행한 검사와 SDK 오류 주입 모두 제한을 확인했다. 새로운 캐시·Worker·자료구조나 기능 지연을 추가하지 않았다.

관리자도 같은 HTML factory를 쓰므로 이름을 추측해 한 화면만 검증하지 않고 소비자 전체를 확인했다. 관리자 lazy widget에서 빠진 CSS 의존성을 복구했고, 실제 compiled dependency는624bytes(진단 gzip341bytes)다. 공개 renderer12개 input hash와 shared CSS bytes는 retry build와 최종 build에서 동일했다. 관리자 auth·data 또는 root global stylesheet를 바꾸지 않았다.

플리커는 두 경우를 분리했다. 이전 frozen simulated-SDK 단계에서는 intermediate v6의 cached pan 복귀가 debounce/viewport 완료 key 경합으로 늦어져 mobile5/5회>250ms, 중앙308.2ms였다. v7에서는0/5회, 중앙16.7ms였으나 조건이 달라 이 수치를 새 실제 SDK/native 결과의 Before로 쓰지 않는다. 그 packet의 original prevalence도 확립되지 않았으며 desktop 관찰에는291.8ms blind rAF gap이 있었다. 이전 증거는 Git59ad8be4와 기존 detached pins로 보존됐다.

이번 실제 SDK의 Chrome·Internet 각각5회 반환에서는 정의한 초기 DOM 부재>250ms가0회 관찰됐고 해당 rAF window의>250ms blind interval은 없었다. pixel filmstrip은106/109프레임, 최소180ms 간격이어서 짧거나 샘플 사이의 이미지/opacity/composite 플리커는 배제하지 못한다. Dark mode·네이티브 overlay·브라우저 capture viewport의 제한도 있어 완전한 제거를 단정하지 않는다. 기존 hydration, marker identity/badge, viewport invalidation 수정은 유지했고 필요한 loading/오류 피드백을 숨기지 않았다.

새 production 진단에는 network→query/상태→React commit→layout/paint를 연결하는19,885개 sanitized timeline event와 URL 없는 CPU profile이 있다. cluster 구간 React commit은8회 관찰됐다. production React 개별 render/commit duration은 얻지 못했으며0ms로 대체하지 않는다. nested FunctionCall/style/layout/paint duration 합은 전체 elapsed가 아니다. trace/CPU profiler가 개입한 실행은 primary 성능 표본에서 제외했다. SDK vendor telemetry의 기존 CSP 차단도 허용 목록을 넓혀 없애지 않았다. 그 console 사건은 canonical packet에서 release/health gate 실패 및0 admission으로 정직하게 남긴다.

source 검사, simulated/real SDK lab, 실기기와 운영을 분리했다. 관련94개 unit/1417assertion, retry17개/86assertion, targeted ESLint와 TypeScript parity0diagnostic, production route CSS budgets, 보호된 Ubuntu/Windows Bun/npm·보안·release 검사를 보존했다. source08c, retry ab970, admin bb086의 PR은3083/3085/3086이며 data PR3084에 순서대로 반영했다. Native 두 브라우저는 각각12개 selection/back/list/detail/swipe/pan/pinch/filter/search 검사와5회 반환을 통과했다. 이 lab의 식당 자료는 synthetic이며 실제 field 방문으로 세지 않았다.

남은 불확실성은 충분한 정상 사용자 Before/After cohort, 장기간 device RSS/GPU/메모리 안정성, 다른 Android·iOS 브라우저, 실제 느린 셀룰러 환경, 모든 frame의 pixel/composite 검출이다. 이번 결과로 이를 추정하지 않는다. 운영 source와 장기 필드 수집은 배포 이후 exact release별로 확인하며 적은 sample이나 overflow bin에서 개선율을 만들지 않는다.

최종 운영·증거 readback: 작성 중. 아래 항목은 실제 완료 후 기록한다: protected main SHA/배포 READY/독립 www alias, named rollback, actual WWW의 Chrome·Samsung verification, 최종 field count 및 unavailable 판정, privacy audit, canonical scorer·validator0 admission, 전체 artifact-map의 외부 pin, Git blob 독립 검증.

추가 검토의 기존 offscreen 갱신 분할은 PR3088에서 실제로 구현·검사·측정한 뒤 **채택하지 않았다**. 기존1471–1472회 getter의 task 구간은6.3–6.6ms였고, 제안은 최대task당 호출 수를 줄였지만 전체 호출3531/3220/3212회 및 취소·재실행 비용이 증가했다. 1process/3내부 선택의 상세 표시 시간300.1/110.9/87.4→386.3/108.8/83.5ms에서 개선을 입증하지 못했고 첫 trial의 long task는55→132ms였다. 정량화되지 않은 일반적인 권고보다 사용자가 정한 실측 기준을 우선해 제안 branch/commit을 보존하고 PR은 닫았다. 이것은 기존 마커 갱신을 모두 sliced 처리했다는 주장도, 해당 갱신이 모든 환경에서 빠르다는 주장도 아니다. 새 데이터/종류 갱신의 지속 비용은 남은 관찰 대상이다. `offscreen-update-proposal-rejection-v1.json` 및 Before/After v2 진단을 확인한다.

최종 모바일 준비 상태는 실제 child overlay가 처음 마운트될 때 표시하고, HomeRuntimeShell이 떠날 때만 지운다. 전체화면에서 컨트롤만 잠시 unmount되는 경우에는 준비 상태를 유지해 상단 스켈레톤이 다시 나타나지 않는다. 실제 SDK와 trusted pointer의 Before/After 흐름은 nav-v2에서 fullscreen의 shell display가block, nav-v3에서none임을 재현했고, 복귀와 feed로의 client navigation cleanup을 함께 통과했다. 두 경우 모두 fullscreen 왕복 중 map 인스턴스는1개였다. `bottom-nav-fullscreen-browser-v1.json`을 확인한다.

과거 native memory run의 임시 PNG 하나는 workspace/runtime archival 뒤 사라져 검증 증거로 사용하지 않았다. 해당 자연 heap/DOM/visibility 표본과 별도로 보존된 native functional filmstrip은 남아 있지만, 잃어버린 PNG의 내용이나 pixel 성공을 추정하지 않는다. `native-memory-temp-capture-unavailable-v1.json`에 기록했다.
