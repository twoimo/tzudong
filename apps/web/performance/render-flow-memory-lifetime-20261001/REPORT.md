모바일 하단 네비게이션 뒤로 그려지던 지도·마커·저작권 영역을 제외하는 수정과 선택 위치 보정을 **운영에 반영했다**. Galaxy의 Chrome·삼성 인터넷 실제 HTTPS/REST/Naver SDK 흐름 8개씩을 통과했고, 실제 기기 화면 12장씩에서 지도 겹침은 **약61px→0px**, 해당 검은 사각형은 **12장 중0장 관찰**이었다. 사전 수정의 56px animate-pulse 막대도 별도로 제거했다. 모든 프레임·기기·기존 열린 문서에서 완전 제거를 증명한 것은 아니다.

최종 main은 `1ab5b7520357d56261a5961d8b10cdd235e12a99`, tree는 `4967190555ece2a99eb966b7892bc5477ba49154`다. Vercel `dpl_G55TzNuyiMaUJPZ4tMBKiCpJjT3G`의 READY/production/Git SHA와 독립 `www.tzudong.app` alias를 읽었다. 소스 검증 입력19개가 final main과 일치했다. 명명된 rollback은 직전 운영 `b977c717a7c3f06d1b5269f74437c6ac57829176` / `dpl_7cRLCj7QpUA4SiCDYS9p9iagJv8c`다. exact-main sensitive guard를 유지했다. develop→data→main의 보호된 승격을 따랐고 PR3094/3095/3097/3098/3096의 검사에서 실패0·pending0을 확인했다. 소스·local build·실제 렌더링·운영 readback은 별도 영수증이다.

데스크톱 원본 대비 회귀는 최종 production build 재측정에서 기존20% 자연 힙 허용치 안이었다: **18.783→18.865MB, 0.082MB 증가(+0.43%)**. 원본의 이전 회귀를 허용치 안으로 되돌린 결과이며 전 환경의 메모리 누수 제거나 힙 감소를 뜻하지 않는다. 최종 모바일 emulation은18.832→19.015MB(+0.97%), 시간473.6→457.9ms였다. 시간 차이를 노이즈와 분리해 증명하지 못했으며, 새 속도 개선율을 주장하지 않는다. 이전 중간 소스에서 관찰한23.868→18.879MB 감소도 A/A 자연 GC 변동11.524MB보다 작아 정확한20.90% 인과 효과로 주장하지 않는다.

현재 field는 과거 release의 CLS1·LCP1, INP0이며 final release에는 비교 가능한 cohort가 없다. LCP1은≥12000ms overflow bin이고 CLS1은[0,0.01)이다. 과거 자료를 소급 생성하거나 QA를 실제 사용자로 포함하지 않았다. 현재1ab5 release를 다음 변경의 prospective baseline으로 계속 수집한다. 현재 자료로 사용자 p75·p95 또는 운영 개선율을 산출할 수 없다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화¹ | 상대 변화¹ | 노이즈·신뢰구간 | 판정 | 증거 경로 |
|---|---|---|---:|---:|---:|---:|---|---|---|
| 최종735개 펼치기 vs원본 | production/actual SDK,1440×900/DPR1/CPU4;9 fresh-process쌍+2 warmup | 자연 JS heap MB |18.783372|18.864928|−0.081556|−0.434%|paired95% 감소 CI[−0.101228,−0.024796]MB; 이전 matching-source A/A는 별도 시간창|소폭 증가/원본20% guard 통과|`map-nav-final-original-regression-summary-v1.json`|
| 같은 최종 flow | 동일9쌍 | 클릭→첫 가시 marker ms |801.7|623.2|178.5|22.265% contrast|CI[133.4,189.4]ms; 보수적으로 이전 A/A noise332.78ms 적용|개선 입증 안 됨/15% guard 통과|동일 summary, `desktop-ab-map-nav-final-original-regression-v1/raw.json`|
| 최종 mobile geometry+centering | actual SDK/합성735,390×844/CPU4;9 fresh-process쌍+2 warmup | 자연 JS heap MB |18.832476|19.015440|−0.182964|−0.972%|CI[−0.473496,0.104000]MB; 해당 mobile A/A 없음|증가 관찰/20% guard 통과|`map-nav-final-mobile-regression-summary-v1.json`|
| 같은 최종 mobile flow | 동일9쌍 | 클릭→첫 가시 marker ms |473.6|457.9|15.7|3.315% contrast|CI[13.4,35.0]ms; matching mobile A/A 부재|새 속도 개선 주장 안 함/15% guard 통과|동일 summary|
| 중간 b977 vsfield-instrumented control | actual SDK/1440×900/CPU4;9process쌍+matching A/A9쌍 | 자연 JS heap MB |23.867572|18.879032|4.988540|20.901% contrast|CI[1.518156,12.806200]MB; A/A95% 절대차11.524177MB|샘플 감소; 인과적 정밀 개선율 입증 안 됨|`final-nav-owner-matched-summary-v1.json`, `final-nav-owner-natural-heap-aa-diagnostic-v1.json`|
| 같은 중간 flow | 동일9쌍 | 클릭 지연 ms |561.7|564.4|−2.7|−0.48%|CI[−29.6,34.28]ms/noise104.14ms|미세 지연/개선 입증 안 됨|동일 summary|
| 중간 b977 강제GC 진단 | 동일9쌍/primary 이후 GC | GC heap MB |17.221624|18.388252|−1.166628|−6.774%|진단용; primary 예산 면제에 사용 안 함|full735 보유 비용 공개|동일 summary|
| 필터 empty→reset | actual SDK/1440×900/CPU4;9process쌍·각3반복, A/A5쌍; reset양쪽571정확IDs | 반영 지연 ms |588.5|538.4|50.1|8.51% contrast|CI[−22.6,179.5]/noise223.2ms|개선 입증 안 됨|`final-filter-summary-v1.json` 및 filter raw²|
| 같은 filter flow | 동일9process쌍 | 자연 heap MB |27.456708|28.420720|−0.964012|−3.511%|강제GC로 면제하지 않음|증가/20% guard 통과|동일 filter evidence²|
| 대량2000 | actual SDK/CPU4;9process쌍+2warmup;992정확IDs | 자연 heap MB |24.854284|24.516028|0.338256|1.361% contrast|2000 전용 A/A 없음|성능 개선 주장 안 함/20% guard 통과|`desktop-css-large-summary-v1.json`²|
| desktop warm60 | ABBA4새process, 각60내부cycles; n2/variant | process median heap MB |28.232|30.599|−2.367|−8.384%|n2, CI/p95 산출 안 함|증가 trade-off/20% guard 통과|`desktop-css-warm-confirm-summary-v1.json`|
| 같은 warm60 | 동일4process | endpoint heap MB |27.056|31.110|−4.054|−14.983%|자연 GC phase 영향|증가 trade-off/20% guard 통과|동일 summary|
| 이전 Galaxy Chrome warm60 | one device/existing process;1tab/variant·각60cycles | tab median heap MB |25.696384|25.606712|0.089672|0.349% contrast|독립process/사용자 표본 아님;CI없음|개선 입증 안 됨;endpoint+11.92%,peak+13.71%|`native-memory-final-summary-v1.json`|
| 이전 Galaxy Samsung warm60 | one device/existing process; ABBA4tabs×60; n2/variant | tab median의 중앙 MB |36.662560|38.066209|−1.403649|−3.829%|첫 쌍+22.16%는20%초과; 전체집계만 통과|개별 실패 공개/누수 해소 증명 안 됨|동일 native summary|
| 제거한56px animated skeleton | 각browser Before2/After2ownedvisits·visit당30상관frames | 막대가 남은 방문 |2/2|0/2|2방문 감소|방문단위100% 감소|프레임마다opacity0.50~1.00; 신뢰구간/사용자 발생률 미산출|정의한 legacy DOM 결함 해결|`bottom-nav-final-legacy-comparison-v1.json`|
| 운영Chrome 하단 겹침 | SM-S928N/Android16/420×769,DPR3.425;Before6·After12 nativeframes, 각1visit | 지도 overlap CSSpx |60.876|0|60.876|100% 높이 감소|After12중0검은사각형 관찰; sparse/서로 다른 pan cadence|구조적 겹침 제거/모든 pixel 플리커 제거 주장 안 함|`native-footer-chrome-{before,after}-inspection-v1.json`|
| 운영Samsung 하단 겹침 | 같은폰/467×810,DPR3.0825;Before12·After12 nativeframes, 각1visit | 지도 overlap CSSpx |60.969|0|60.969|100% 높이 감소|After12중0관찰; 약1.5~2.6s 캡처간격|구조적 겹침 제거|`native-footer-samsung-{before,after}-inspection-v1.json`|
| 부분 상세 시트 선택 위치 | actual SDK/390×844;별도fixture1회씩·동일선택ID | 목표중앙 대비 오차 px |30.5004|<0.5|>30px 감소|계산 안 함|SDK layer offset을 중심 상대값으로 정규화;0.5px허용|정렬 보정 통과/속도 성과 아님|`map-nav-selected-centering-v7.json`|
| 실제 field | UTCday/release/device/metric/nav/bucket 집계;old CLS1/LCP1/INP0;final 충분한 표본0 | matched p75/성과 |불충분|불충분|산출 불가|산출 불가|분포·사용자 독립성·환경 matching 성립 안 됨|운영 개선 입증 안 됨|`field-baseline-final-post-1ab5-v1.json`|

¹ 낮을수록 좋은 지표: 절대 감소=Before−After, 상대 감소=(Before−After)/Before×100. 음수는 증가다. geometry·방문수 감소와 latency·메모리 개선을 혼동하지 않는다. 충분한 독립 표본이 없어 p95를 제공하지 않았다. bootstrap은 source별 seed·10,000회·MAD/range와 원시 쌍을 보존한다. ABBA conditional sensitivity는 마지막 홀수 쌍 고정 조건의 재표집이며 무조건부95% 보장이 아니다. 중간·개별 변경과 최종 효과를 더하지 않는다. ² filter는 `final-filter-summary-v1.json`, large는 `desktop-css-large-summary-v1.json`이다. final footer 소스를 측정하지 않은 이전 filter/large/warm 자료를 새 source의 직접 측정으로 재명명하지 않았다.

네비게이션 아래의 첫 결함은 HomeStaticSkeleton의 불필요한 h-14 animate-pulse였다. mobile에는 desktop-only homePanelReady가 완료되지 않아 footer와 opacity0.50~1.00 사이의 박자가 남았다. child MobileControlOverlay가 실제 mount된 이후에만 상단 pending shell을 퇴장시키고, 전체화면의 controls-only unmount에서는 준비 상태를 유지하며 home runtime을 떠날 때 지운다. 필요한 loading·error 피드백을 타이머나 과도한 debounce로 숨기지 않았다. 초기 ready-too-early 및 fullscreen 리셋 버전은 거부·보존했다.

그 뒤 사용자 재신고에 새 실기기 픽셀을 확인해, 실제 map/SDK marker/copyright가95%투명 nav 뒤까지 남은 것을 확인했다. nav의 색·투명도·버튼 디자인을 바꾸지 않고 home content에서 측정된 effective nav height를 예약했다. 측정 높이는 safe area를 포함하며 nav가 숨겨지면0이 된다. SDK map resize로 attribution도 bar 위에 배치한다. 이론적으로 excluded area는 W×Hnav지만 실제 paint/성능 절감률로 바꾸지 않는다. 겹침 구조가 제거돼도 신고된 모든 간헐적 composite 사각형의 동일성/원인이 확정된 것은 아니다. 화면 캡처는 샘플 사이의 짧은 현상을 배제하지 못한다.

새 height 예약과 기존 선택 offset의 중복을 검사해 보정했다. nav contribution은 max(0,navHeight−max(0,viewportHeight−SDKmapHeight))다. 숨긴 높이0을 fallback60으로 바꾸지 않으며 optional SDK size API를 안전하게 사용한다. O(1) 시간·공간이고 새로운 강제 동기 DOM layout read를 추가하지 않는다. 실제 부분 시트 fixture에서는 중심 오차−30.5004px→−0.00019px를 확인했다. absolute SDK offset을 viewport로 오인한 이전 fixture와 fullscreen의 보존 위치를 강제로 재중앙화해야 한다고 가정한 fixture는 거부·보존했다. [Naver의 좌표 변환 API](https://navermaps.github.io/maps.js.ncp/docs/naver.maps.MapSystemProjection.html)를 사용하되 SDK center와의 상대 offset으로 검증했다.

메모리 구현은 동일한 canonical source object의 동기 두 번째 pass만 생략하고, 고정 marker CSS를 공유하며 HTML을 직접 간결하게 생성한다. 데이터가 변경된 객체는 갱신 경로를 유지한다. desktop expanded≤1000은 padded viewport+selected/search exceptions를 먼저 표시하고 나머지를32개의 MessageChannel job으로 나눠 full set을 보유한다. mobile/>1000은 padded culling을 유지한다. data change/unmount는 tail 참조를 버리고, 재시도는6+초기회로 제한한다. pool 상한1000과 원래 batch release를 유지하고 inactive app click closure 및 app-owned listener만 해제한다. SDK 내부 listener를 제거하지 않는다.

ID 검사의 O(N)은 그대로다. 이735 cell의571 immediate+164 tail은 생성 작업의22.3%를 critical pass 뒤로 옮기는 이론 모델이며 전체 대기 시간이22.3% 개선됐다는 주장이 아니다. HTML899→448문자/공백text nodes7→0이라는 fixture 결과도 전체 UI 배수로 환산하지 않는다. 실제 CSS/박스/텍스트/이미지·badge·접근성 속성24case, admin lazy CSS dependency624raw/341gzip을 확인했다. pool128, runtime regex compaction, reverse reuse, 기존 offscreen update slicing의 비용 증가 실험은 채택하지 않았다. raw 결과·거부 사유를 모두 보존했다.

메모리 예산은 자연 JS isolate heap의600ms endpoint로 판정하고 강제GC는 그 이후 진단으로 분리한다. browser 전체 RSS/GPU/장기 누수 안정성은 검증하지 않았다. full735 보유로 GC heap/warm endpoint가 증가하며 native 첫 Samsung 쌍의22.16% 초과를 숨기거나 전체집계로 면제하지 않았다. 마지막 footer/centering 소스의 추가 native60 ABBA는 준비됐지만 기기가 인증 잠금으로 바뀌어 실험 탭이 hidden이었고 현재0표본이다. 새 native 반복 메모리의 해소 판정은 **미검증**이며 사용자 unlock 이후 별도 후속 증거가 필요하다. 기존 native60 자료는 그 자체의 이전 소스·조건에만 귀속한다.

실제 운영8checks/browser는 HTTPS home readiness, nav·attribution geometry, real cluster expand, marker detail, controls 숨김/복귀, detail close, empty search를 포함한다. 단일 map/duplicates0/overflow0 및 관찰한 Runtime console/page 오류0이었다. 해당 채널이 CSP·모든 network error를 완전 포괄하는 것은 아니다. 이전 native12flow+5returns/browser는 list/detail swipe/pan/pinch/filter/search와 finite DOM absence>250ms0/5를 보존했다. pixel filmstrip은 최소180ms 간격이어서 짧은 플리커를 제외하지 못한다. 이전 simulated SDK5/5→0/5 수치를 native before 발생률로 재사용하지 않았다.

진단 trace의19,885 sanitized event·URL 없는 CPU profile·React commit8회는 network→상태→React→layout/paint 연결에만 쓰며 primary 측정에서 제외했다. production React 개별 render/commit duration을 얻지 못했으므로0ms로 대체하지 않았다. nested duration을 합쳐 total elapsed를 만들지 않았다. 실제 느린 셀룰러·다른 Android·iOS·장기 RSS/GPU·모든 frame의 composite 탐지는 미검증이다.

source checks, production build/route CSS boundary, controlled actual-SDK lab, native localhost lab, actual WWW 운영, field를 구분한다. final helper11tests/25assertions, nav/resize9tests/22assertions, targeted ESLint/TS parity0, viewport transitions7, 실제 selected identity/close/client navigation 및 final protected CI를 확인했다. 복사 lab build는 b977 Git base+보존 patch로 구성했으며 source input19개가 final main과 일치하지만 lab에 주입한 public release tag는base 값이다. QA/local은 field admission0이므로 이 값을 운영 field release로 재분류하지 않는다.

Canonical `canonical-memory-production-v9/` scorer0/validator0, detached maps·scored checksum을 보존했다. matched app-owned field p75는 unavailable이고 admission0이다. 44개의 laboratory rows에 남은 CSP incident로 canonical releaseBlocked=true가 도출됐다. 이것은 G003 성과/전체 운영 건강/배포 허가의 증명이 아니며 별도 operator 승인·보호된 source promotion·READY readback을 대체하지 않는다. 기존 frozen root/pins를 덮어쓰지 않았다. final artifact map과 out-of-band SHA, independent file-set/Git-blob verification receipt는 디렉터리 밖에서 확인한다.

현재 남은 작업은 인증 잠금 해제 뒤 final source의 추가 native 반복 메모리 비교 및 가능한 owned Chrome intent-tab cleanup readback이다. 이미 완료한 actual WWW 운영 검증과 캡처는 유지된다. field 성과는 충분한 다음 cohort가 필요하다. 개인정보·credentials·정확한 device location·raw request/response·heap objects를 증거로 보관하지 않았다. known-byte privacy scan과 캡처 눈 검사는 완전한 개인정보 탐지 보장이 아니다.
