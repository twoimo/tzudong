# Tzudong 렌더링·시각 안정성 진단 결과

SDK 마커 생성을 확장된 전체 결과에서 현재 padded viewport의 결과로 제한했다. 735개 synthetic 결과를 펼칠 때 마커 수는 데스크톱 735→143개(80.54% 감소), 모바일 735→55개(92.52% 감소)였다. 전체 목록·선택·스와이프의 데이터는 보존했다. 기존 pool의 식당 ID·방문 배지 재사용 오류와 최적화 과정의 캐시 pan 복귀 공백을 수정했다. 최종 production renderer 회귀 검사 170개, 실제 CDP touch 검사 63개, 단위 검사 111개가 통과했다.

**엄격한 시간 개선 admission은 0건이다.** 최종 89쌍 모두 공유 Mac의 다른 작업 부하와 겹쳤고, 일부 캡처도 사전 게이트에 걸렸다. 아래 큰 시간 차이는 로컬 simulated SDK의 공유부하 관찰값이다. 운영 사용자 성능, 실제 Naver SDK 시간, 전체 UI 성능 개선으로 일반화하지 않는다. 2,000개 cell의 자연 GC heap은 25.53% 증가하여 사전 20% 예산을 초과했다. 이 결과는 남은 회귀 위험이다. 배포·운영 데이터 변경·field 성과 측정은 수행하지 않았다.

## 고정 기준선과 측정 환경

| 항목 | 기록 |
|---|---|
| 기준 Git | `da805ea2602f4ed83e6e77e52e9da0b74ba2f8c5`, tree `6fbbe72ad209b3c9fb6ebdfb323e03672539711b` |
| 기준 production build | [build-baseline-v1/receipt.json](build-baseline-v1/receipt.json), ID `0OxkiMV0zCpf_VLIeTl1i` |
| 최종 production build | [build-candidate-v7/receipt.json](build-candidate-v7/receipt.json), ID `IudS4C9U60JOVFefHNMHz` |
| 최종 소스 식별 | 같은 기준 Git + [보존된 uncommitted 3-file patch](build-candidate-v7/source.patch); SHA-256 `7157ecbccd22d9315f0d3cd344b003741ac30fbcafb36b5dc1ba59b77fc68819`. 새 candidate Git commit이 아님 |
| 앱 런타임 | `/opt/homebrew/opt/node@24/bin/node` v24.21.0; Next 16.3.5, React 19.2.8; production webpack/standalone |
| 측정 harness | Bun 1.4.0. raw의 `node: v26.3.0`은 Bun의 Node 호환 표기이며 앱 Node 버전과 다름 |
| 의존성 | exact repository package-lock; 로컬 npm 11.19.0, repository authority 11.6.2 차이를 기록. 전역 설치/설정 변경 없음 |
| 기기·브라우저 | Darwin 25.6.0 arm64, Apple M5 Max, 논리 코어 18; Playwright Chromium 151.0.7922.34; headless |
| viewport | 데스크톱 1440×900 / 모바일 390×844, DPR 1, ko-KR. 모바일 에뮬레이션이며 물리 기기가 아님 |
| 데이터 | 고유 synthetic 식당 3/735/2,000개, single-Seoul cluster; [runtime.mjs](runtime.mjs)의 결정적 좌표 공식. 운영의 735개를 서울에 몰아놓은 데이터로 취급하지 않음 |
| 캐시 | 매 표본 fresh browser context·빈 app/query storage; 동일한 warmed Node 서버·브라우저 프로세스. interception으로 HTTP cache 비활성; service worker 차단. 별도의 warm query pan/반복 방문 회귀 검사 |
| CPU·네트워크 | primary CPU×4; small CPU×1; 2,000 CPU×4; slow mobile CPU×1 + CDP 150ms RTT/1.6Mbps downstream. fixture service 지연 120ms; 외부 트래픽 fence |
| 느린 네트워크 해석 | CDP throttle은 loopback asset에 적용. intercepted API body의 실제 wire 대역폭/전송량은 측정하지 않음. fixture JSON bytes는 전송량과 분리 |
| 자원 부하 | [resources-plan.json](resources-plan.json): 외부 한 프로세스 ≥80% CPU이면 heavy, 외부 합계 >18×85% 또는 load1>18이면 saturated, 쌍의 외부 CPU range>200%이면 unequal. PID·명령·인증정보를 저장하지 않은 숫자 telemetry. GPU 부하 미측정 |
| 계획 | [plan-v6.json](plan-v6.json), SHA `effbc7f636f5a4cfa0efba1725006e751869d9084db59ba5062527b0f481c9af`. v7 build 전에 고정. 이전 계획·실패 표본 보존; 정확성 gate 확장 외에는 목표/표본/예산을 낮추지 않음 |

개발 모드의 수치는 최종 성과에 포함하지 않았다. 실제 앱의 production route와 React 상태·DOM 경로를 실행하되, SDK 및 API는 repository의 mock helper와 synthetic fixture로 대체했다. 로그인·위치 권한·쓰기 흐름을 우회해 운영 성공으로 보고하지 않았다.

## 탐색 결과와 우선순위

| 우선순위 | 사용자 동작·발생 조건 | 증거·원인 | 판단 |
|---|---|---|---|
| 1 | 큰 지역 cluster를 선택해 확대·펼치기 | 확장 ID 전체에 SDK marker acquire/DOM 삽입 실행. 735개 중 target padded viewport는 데스크톱 143/모바일 55개. n=1 trace에서 style/layout 작업 집중 | 화면 밖 SDK 작업 제거. 실제 사용자 전체 빈도는 측정하지 않았으며 cluster 펼치기마다 발생하는 경로임 |
| 1 | 마커를 pool release 후 다른 식당에 reuse; 방문 배지 값 변경 | review bubble fast patch가 ID/정적 badge/의미 속성 변경도 처리해 이전 DOM을 남김. 실제 browser source probe 8단계 중 7단계 오류 | 성능과 별도로 정확성 결함 수정 |
| 1 | 최적화된 v6에서 cached data가 먼저 갱신되는 두 번째 pan away→return | 이전 viewport render key/SDK 완료 key가 엇갈림. 동일 center 복귀의 invalidation이 debounced cluster 결과에 의존. 143→0→복귀 후 0이 ≥12초 지속한 실패 보존 | v6 폐기. raw bounds/zoom/크기 key를 idle/resize에서 즉시 비교하고 SDK 완료 key를 cleanup과 동기화 |
| 2 | 초기 진입·느린 asset 로딩 | FCP/관찰 LCP 차이가 0–수십 ms; API body/request 수 동일 | 개선 입증 안 됨. 번들·이미지·폰트 재설계를 시작하지 않음 |
| 2 | 연속 검색·빈 결과·필터 reset·데이터 좌표 변경 | 늦은 old 응답 280ms와 new 응답 25ms 순서 반전, 빈 결과, immutable 좌표 변경 회귀 통과 | 기존 정확성 유지. debounce 추가 없음 |
| 2 | 목록 스크롤·상세 열기/닫기·뒤로가기·스와이프 | 실제 735 목록 후보 유지, 기존 모바일 20개 카드 제한, scroll 이동, trust된 pointer/keyboard/touch, 지도 identity=1 | 목록을 viewport culling으로 자르지 않음. 각 흐름의 전체 before/after 시간은 별도 입증하지 않음 |

비용 연결은 fixture 응답 지연→fetch/merge/query 상태→React passive effect의 marker render→N개 SDK acquire/DOM 삽입→style/layout→paint로 관찰했다. primary timer는 데이터 로드 이후 cluster 클릭에서 시작하므로 네트워크 대기 감소를 의미하지 않는다. React 개별 render/commit 횟수·시간, compositor 비용은 별도 신뢰 가능한 카운터를 확보하지 못했다. trace의 effect stack을 독립 React profiler 수치로 바꾸지 않았다.

## 구현과 비용 모델

수정한 production 파일은 `components/map/NaverMapView.tsx`, `lib/naver-map-render-plan.ts`, `lib/marker-pool.ts` 3개다. 원문과 caller는 build receipt에 보존했다. source SHA는 각각 `9236d84284cc28b1e569db22e979bd1f8a6800a577a234c549126548e5503287`, `75edbb62d7f39d7e39cffee90594e172642ec12eb852fda6885dc38a11cd84ab`, `0816449fe7d1d94f59f555198a77a266b9d346ffbf797275695e0eecd67edade`다.

`shouldRenderExpandedClusterMarker`는 viewport가 유효할 때 25% padding 안의 마커 또는 selected/search 예외를 SDK에 표시한다. bounds 없음/viewport 제한 비활성은 기존 fallback이다. expanded snapshot, 목록 후보, 스와이프 순서는 보존한다. N개 ID 검사는 O(N)으로 남고 SDK 갱신·표시 DOM은 O(V+예외)로 줄어든다. 측정 cell에서는 V/N=143/735 또는 55/735다. 기존 idle pool 상한 1,000개를 늘리지 않았고 새 bounded cache, Worker, 가상화를 도입하지 않았다. 검사 비용과 데이터 N개 유지 메모리는 그대로다.

raw viewport key는 south/west/north/east, zoom, map element 크기다. `idle`/`resize`에서 key가 실제로 바뀌고 expansion이 있을 때만 가벼운 revision을 갱신한다. cluster 계산의 기존 debounce는 유지했다. SDK cleanup의 완료 viewport key도 동기화해 cached-data-before-away-idle 경합을 막았다. ordinary pan/같은 idle은 새 revision을 만들지 않는다. 회귀에서 unchanged idle의 setMap/setIcon/setPosition은 모두 0이었다.

pool의 bubble-only DOM 갱신은 restaurant ID, role/tabindex/aria-label/title, 정적 방문 badge가 같을 때만 사용한다. 하나라도 달라지면 기존 setIcon 경로가 static DOM을 교체한다. 같은 식당의 review bubble만 바뀌면 이미지 DOM을 유지한다. static 교체 시 icon/이미지 작업은 늘 수 있으나 잘못된 ID·접근성 의미·배지를 남기는 오류를 허용하지 않는다. 별도 네트워크 증가량은 입증하지 않았다.

mock SDK는 삽입 뒤 `getBoundingClientRect`를 읽어 강제 layout을 만들 수 있다. interleaved 삽입·전체 layout 비용이 누적된다면 이론적으로 Σk=O(N²)가 가능하지만, 실제 Naver SDK 알고리즘이나 운영 복잡도로 주장하지 않는다. 타이밍의 큰 차이는 이 mock 특성의 영향을 받는다. 최종 통합 효과만 표에 사용하며, 중간 candidate의 개선율을 더하거나 pool 정확성 수정의 개별 시간 효과를 추정하지 않았다.

## 반복 측정과 통계 판정

final primary는 viewport당 31쌍, secondary는 3개 cell당 9쌍이다. 합계 89쌍=178개 측정 흐름이며 cell당 warmup 2쌍, 총 10쌍=20개 warmup 흐름을 제외했다. primary 한 번, secondary 한 번의 전체 harness/server/browser 프로세스 실행 안에서 매 variant의 fresh context를 만들고 AB/BA를 교차했다. 31개를 31번의 독립 OS/browser 프로세스 실행으로 세지 않았다. frame, 한 context의 swipe·pan 반복도 독립 실행 표본이 아니다. JIT·서버 warmup은 제외했지만 Mac의 다른 작업은 중지하지 않아 부하와 시간 상관을 완전히 통제하지 못했다.

A/A는 초기 desktop/mobile 각각 6표본의 noise와 이후 같은 최종 sampler의 각각 6표본+warmup을 보존했다. 추가 A/A는 기존 floor를 낮추지 않았다. 유효 conservative floor는 desktop MAD 546.0ms, 2×MAD 1092.0ms, alternating 차이 242.3ms, 앞/뒤 drift 1320.7ms; mobile MAD 442.3ms, 2×MAD 884.6ms, alternating 차이 382.8ms, drift 1140.1ms다. 초기 A/A의 이전 sampler는 새 sampler의 calibration으로 재명명하지 않았다.

사전 목표는 감소가 50ms, baseline의 10%, 2×표본 maxMAD, A/A noise/alternating/drift floor를 모두 넘고 paired 및 adjacent AB/BA block 95% CI lower bound>0이며 순서/시간 strata도 일치하는 것이었다. 회귀 예산은 50ms/10%, memory는 20%다. 10,000회 fixed-seed bootstrap을 사용하며 홀수의 마지막 쌍은 block resample마다 한 번 보존했다. n<20은 p95를 생략한다. CI는 이 공유 환경 표본에 조건부인 기술통계이며 외부 부하 systematic bias를 제거하지 않는다.

최종 모두 heavy overlap 89/89, quiet 0, saturated 0이었다. unequal은 primary 24쌍+secondary 11쌍=35쌍이었다. invalid capture는 cell 순서대로 31/31, 4/31, 9/9, 9/9, 1/9였다(배타적 분류 아님). strict scorer는 fixture 외부 fence가 차단한 console error도 제외한다. 측정 흐름의 console error 관찰 98건, page error 0, incomplete request 0이며 별도의 예상 transport 분류는 gate를 면제하지 않는다.

7개 sample에서는 stable-first보다 transient-first가 0.1–0.2ms 늦게 기록됐다. sampler가 같은 rAF 안에서 `pendingFirst`를 먼저, `transientFirst`를 나중에 다른 clock read로 저장하는 순서와 양립한다. 실제 플리커라고 판단하지 않았으며 [measurement-issues.json](measurement-issues.json)에 원본 좌표를 보존했다. raw를 보정하거나 gate를 완화하지 않았다. **표는 invalid capture를 포함한 all-observed descriptive 집계다.** 모든 admission은 0이며, quiet 보충 실행을 공유부하 표본으로 대체하지 않았다.

낮을수록 좋은 지표의 절대 변화=Before−After, 상대 변화=(Before−After)/Before×100이다. 양수는 감소, 음수는 증가다. fraction의 절대 변화는 percentage points다. 타이머 해상도 0.1ms 이하/0 baseline에는 배수나 개선율을 만들지 않았다. rAF 누락 비율은 관찰 전 median frame gap을 예산으로 round(gap/budget)하여 계산한 추정치이며 GPU dropped-frame counter가 아니다. markerless DOM frame은 pixels가 아니다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
|---|---|---|---:|---:|---:|---:|---|---|---|
| 735개 클러스터 펼치기·데스크톱 | 1440×900, CPU×4, 31쌍, 공유부하 | 클릭→안정된 대상 DOM (ms) | 1,762.7 | 189.8 | 1,572.9 | 89.23% | MAD 128.5→18.1; paired CI [1530.2, 1692.6]ms; block CI [1536.9, 1620.9]ms; p95 1998.2→235.3ms | 공유부하 관찰치; 시간 개선 미입증 | [paired-v6/raw.json](paired-v6/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·데스크톱 | 1440×900, CPU×4, 31쌍, 공유부하 | 최대 rAF 간격 (ms) | 1,775.8 | 200.3 | 1,575.5 | 88.72% | MAD 124.2→17.0 | 공유부하 관찰치; 시간 개선 미입증 | [paired-v6/raw.json](paired-v6/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·데스크톱 | 1440×900, CPU×4, 31쌍, 공유부하 | 클릭 관찰창 long task 합계 (ms) | 1,771.8 | 173.4 | 1,598.4 | 90.21% | MAD 128.9→35.2 | 공유부하 관찰치; 시간 개선 미입증 | [paired-v6/raw.json](paired-v6/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·데스크톱 | 1440×900, CPU×4, 31쌍, 공유부하 | long task 수 | 2 | 2 | 0 | 0.00% | MAD 0→0 | 공유부하 관찰치; 시간 개선 미입증 | [paired-v6/raw.json](paired-v6/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·데스크톱 | 1440×900, CPU×4, 31쌍, 공유부하 | 추정 누락 rAF 비율 | 74.67% | 26.21% | 48.45pp | 64.89% | MAD 1.04%→1.97% | 공유부하 관찰치; 시간 개선 미입증 | [paired-v6/raw.json](paired-v6/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·데스크톱 | 1440×900, CPU×4, 31쌍, 공유부하 | SDK 마커 수 | 735 | 143 | 592 | 80.54% | MAD 0→0 | 해당 fixture의 작업량 감소 | [paired-v6/raw.json](paired-v6/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·데스크톱 | 1440×900, CPU×4, 31쌍, 공유부하 | 전체 DOM 요소 수 | 4,829 | 1,277 | 3,552 | 73.56% | MAD 2→1 | 해당 fixture의 작업량 감소 | [paired-v6/raw.json](paired-v6/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·데스크톱 | 1440×900, CPU×4, 31쌍, 공유부하 | 자연 GC 상태 JS heap (MB) | 20.238 | 21.143 | -0.905 | -4.47% | MAD 0.083→0.107 | 관찰치; 누수/retained heap 결론 없음 | [paired-v6/raw.json](paired-v6/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·데스크톱 | 1440×900, CPU×4, 31쌍, 공유부하 | 초기 FCP (ms) | 348.0 | 348.0 | 0.0 | 0.00% | MAD 12.0→8.0 | 차이 없음/노이즈 범위; 개선 미입증 | [paired-v6/raw.json](paired-v6/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·데스크톱 | 1440×900, CPU×4, 31쌍, 공유부하 | 관찰 종료까지 LCP (ms) | 828.0 | 820.0 | 8.0 | 0.97% | MAD 20.0→12.0 | 차이 없음/노이즈 범위; 개선 미입증 | [paired-v6/raw.json](paired-v6/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·데스크톱 | 1440×900, CPU×4, 31쌍, 공유부하 | fixture JSON 응답 body (bytes) | 922,733 | 922,733 | 0 | 0.00% | MAD 0→0 | 동일; 실제 전송량 미측정 | [paired-v6/raw.json](paired-v6/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·데스크톱 | 1440×900, CPU×4, 31쌍, 공유부하 | fixture 요청 수 | 5 | 5 | 0 | 0.00% | MAD 0→0 | 동일; 실제 전송량 미측정 | [paired-v6/raw.json](paired-v6/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·모바일 | 390×844, CPU×4, 31쌍, 공유부하 | 클릭→안정된 대상 DOM (ms) | 1,737.3 | 107.5 | 1,629.8 | 93.81% | MAD 171.1→11.9; paired CI [1556.8, 1726.7]ms; block CI [1564.6, 1723.8]ms; p95 2548.1→132.1ms | 공유부하 관찰치; 시간 개선 미입증 | [paired-v6/raw.json](paired-v6/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·모바일 | 390×844, CPU×4, 31쌍, 공유부하 | 최대 rAF 간격 (ms) | 1,742.1 | 108.8 | 1,633.3 | 93.75% | MAD 167.9→16.6 | 공유부하 관찰치; 시간 개선 미입증 | [paired-v6/raw.json](paired-v6/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·모바일 | 390×844, CPU×4, 31쌍, 공유부하 | 클릭 관찰창 long task 합계 (ms) | 1,881.7 | 70.9 | 1,810.8 | 96.23% | MAD 222.1→41.2 | 공유부하 관찰치; 시간 개선 미입증 | [paired-v6/raw.json](paired-v6/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·모바일 | 390×844, CPU×4, 31쌍, 공유부하 | long task 수 | 3 | 1 | 2 | 66.67% | MAD 1→1 | 공유부하 관찰치; 시간 개선 미입증 | [paired-v6/raw.json](paired-v6/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·모바일 | 390×844, CPU×4, 31쌍, 공유부하 | 추정 누락 rAF 비율 | 75.72% | 21.65% | 54.07pp | 71.41% | MAD 1.75%→2.06% | 공유부하 관찰치; 시간 개선 미입증 | [paired-v6/raw.json](paired-v6/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·모바일 | 390×844, CPU×4, 31쌍, 공유부하 | SDK 마커 수 | 735 | 55 | 680 | 92.52% | MAD 0→0 | 해당 fixture의 작업량 감소 | [paired-v6/raw.json](paired-v6/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·모바일 | 390×844, CPU×4, 31쌍, 공유부하 | 전체 DOM 요소 수 | 4,961 | 882 | 4,079 | 82.22% | MAD 1→1 | 해당 fixture의 작업량 감소 | [paired-v6/raw.json](paired-v6/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·모바일 | 390×844, CPU×4, 31쌍, 공유부하 | 자연 GC 상태 JS heap (MB) | 19.635 | 16.403 | 3.232 | 16.46% | MAD 0.068→0.072 | 관찰치; 누수/retained heap 결론 없음 | [paired-v6/raw.json](paired-v6/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·모바일 | 390×844, CPU×4, 31쌍, 공유부하 | 초기 FCP (ms) | 352.0 | 352.0 | 0.0 | 0.00% | MAD 24.0→16.0 | 차이 없음/노이즈 범위; 개선 미입증 | [paired-v6/raw.json](paired-v6/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·모바일 | 390×844, CPU×4, 31쌍, 공유부하 | 관찰 종료까지 LCP (ms) | 988.0 | 976.0 | 12.0 | 1.21% | MAD 36.0→28.0 | 차이 없음/노이즈 범위; 개선 미입증 | [paired-v6/raw.json](paired-v6/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·모바일 | 390×844, CPU×4, 31쌍, 공유부하 | fixture JSON 응답 body (bytes) | 595,828 | 595,828 | 0 | 0.00% | MAD 0→0 | 동일; 실제 전송량 미측정 | [paired-v6/raw.json](paired-v6/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·모바일 | 390×844, CPU×4, 31쌍, 공유부하 | fixture 요청 수 | 2 | 2 | 0 | 0.00% | MAD 0→0 | 동일; 실제 전송량 미측정 | [paired-v6/raw.json](paired-v6/raw.json) / [scored.json](scored.json) |
| 3개 클러스터 펼치기·데스크톱 | 1440×900, CPU×1, 9쌍, 공유부하 | 클릭→안정된 대상 DOM (ms) | 45.9 | 45.9 | 0.0 | 0.00% | MAD 4.3→7.5; paired CI [-6.4, 14.4]ms; block CI [-5.6, 5.9]ms; p95 생략(n<20) | 중앙값 동일·CI 0 포함; 개선 입증 안 됨 | [secondary-v5/raw.json](secondary-v5/raw.json) / [scored.json](scored.json) |
| 3개 클러스터 펼치기·데스크톱 | 1440×900, CPU×1, 9쌍, 공유부하 | 최대 rAF 간격 (ms) | 41.6 | 41.7 | -0.1 | -0.24% | MAD 8.3→8.3 | 공유부하 관찰치; 시간 개선 미입증 | [secondary-v5/raw.json](secondary-v5/raw.json) / [scored.json](scored.json) |
| 3개 클러스터 펼치기·데스크톱 | 1440×900, CPU×1, 9쌍, 공유부하 | SDK 마커 수 | 3 | 3 | 0 | 0.00% | MAD 0→0 | 감소 입증 안 됨 | [secondary-v5/raw.json](secondary-v5/raw.json) / [scored.json](scored.json) |
| 3개 클러스터 펼치기·데스크톱 | 1440×900, CPU×1, 9쌍, 공유부하 | 전체 DOM 요소 수 | 275 | 277 | -2 | -0.73% | MAD 3→1 | 감소 입증 안 됨 | [secondary-v5/raw.json](secondary-v5/raw.json) / [scored.json](scored.json) |
| 3개 클러스터 펼치기·데스크톱 | 1440×900, CPU×1, 9쌍, 공유부하 | 자연 GC 상태 JS heap (MB) | 13.058 | 13.064 | -0.006 | -0.04% | MAD 0.038→0.052 | 관찰치; 누수/retained heap 결론 없음 | [secondary-v5/raw.json](secondary-v5/raw.json) / [scored.json](scored.json) |
| 3개 클러스터 펼치기·데스크톱 | 1440×900, CPU×1, 9쌍, 공유부하 | 초기 FCP (ms) | 124.0 | 128.0 | -4.0 | -3.23% | MAD 8.0→8.0 | 차이 없음/노이즈 범위; 개선 미입증 | [secondary-v5/raw.json](secondary-v5/raw.json) / [scored.json](scored.json) |
| 3개 클러스터 펼치기·데스크톱 | 1440×900, CPU×1, 9쌍, 공유부하 | 관찰 종료까지 LCP (ms) | 468.0 | 472.0 | -4.0 | -0.85% | MAD 8.0→12.0 | 차이 없음/노이즈 범위; 개선 미입증 | [secondary-v5/raw.json](secondary-v5/raw.json) / [scored.json](scored.json) |
| 3개 클러스터 펼치기·데스크톱 | 1440×900, CPU×1, 9쌍, 공유부하 | fixture JSON 응답 body (bytes) | 6,045 | 6,045 | 0 | 0.00% | MAD 0→0 | 동일; 실제 전송량 미측정 | [secondary-v5/raw.json](secondary-v5/raw.json) / [scored.json](scored.json) |
| 3개 클러스터 펼치기·데스크톱 | 1440×900, CPU×1, 9쌍, 공유부하 | fixture 요청 수 | 5 | 5 | 0 | 0.00% | MAD 0→0 | 동일; 실제 전송량 미측정 | [secondary-v5/raw.json](secondary-v5/raw.json) / [scored.json](scored.json) |
| 2,000개 클러스터 펼치기·데스크톱 | 1440×900, CPU×4, 9쌍, 공유부하 | 클릭→안정된 대상 DOM (ms) | 13,696.5 | 207.1 | 13,489.4 | 98.49% | MAD 789.1→10.5; paired CI [12206.8, 14274.6]ms; block CI [12214.6, 14172.2]ms; p95 생략(n<20) | 공유부하 관찰치; 시간 개선 미입증 | [secondary-v5/raw.json](secondary-v5/raw.json) / [scored.json](scored.json) |
| 2,000개 클러스터 펼치기·데스크톱 | 1440×900, CPU×4, 9쌍, 공유부하 | 최대 rAF 간격 (ms) | 13,708.6 | 216.5 | 13,492.1 | 98.42% | MAD 790.6→16.8 | 공유부하 관찰치; 시간 개선 미입증 | [secondary-v5/raw.json](secondary-v5/raw.json) / [scored.json](scored.json) |
| 2,000개 클러스터 펼치기·데스크톱 | 1440×900, CPU×4, 9쌍, 공유부하 | SDK 마커 수 | 2,000 | 143 | 1,857 | 92.85% | MAD 0→0 | 해당 fixture의 작업량 감소 | [secondary-v5/raw.json](secondary-v5/raw.json) / [scored.json](scored.json) |
| 2,000개 클러스터 펼치기·데스크톱 | 1440×900, CPU×4, 9쌍, 공유부하 | 전체 DOM 요소 수 | 12,419 | 1,278 | 11,141 | 89.71% | MAD 1→3 | 해당 fixture의 작업량 감소 | [secondary-v5/raw.json](secondary-v5/raw.json) / [scored.json](scored.json) |
| 2,000개 클러스터 펼치기·데스크톱 | 1440×900, CPU×4, 9쌍, 공유부하 | 자연 GC 상태 JS heap (MB) | 27.379 | 34.368 | -6.989 | -25.53% | MAD 0.056→0.097 | 25.53% 증가; 사전 20% 예산 초과 | [secondary-v5/raw.json](secondary-v5/raw.json) / [scored.json](scored.json) |
| 2,000개 클러스터 펼치기·데스크톱 | 1440×900, CPU×4, 9쌍, 공유부하 | 초기 FCP (ms) | 356.0 | 356.0 | 0.0 | 0.00% | MAD 12.0→16.0 | 차이 없음/노이즈 범위; 개선 미입증 | [secondary-v5/raw.json](secondary-v5/raw.json) / [scored.json](scored.json) |
| 2,000개 클러스터 펼치기·데스크톱 | 1440×900, CPU×4, 9쌍, 공유부하 | 관찰 종료까지 LCP (ms) | 860.0 | 832.0 | 28.0 | 3.26% | MAD 32.0→24.0 | 차이 없음/노이즈 범위; 개선 미입증 | [secondary-v5/raw.json](secondary-v5/raw.json) / [scored.json](scored.json) |
| 2,000개 클러스터 펼치기·데스크톱 | 1440×900, CPU×4, 9쌍, 공유부하 | fixture JSON 응답 body (bytes) | 2,471,753 | 2,471,753 | 0 | 0.00% | MAD 0→0 | 동일; 실제 전송량 미측정 | [secondary-v5/raw.json](secondary-v5/raw.json) / [scored.json](scored.json) |
| 2,000개 클러스터 펼치기·데스크톱 | 1440×900, CPU×4, 9쌍, 공유부하 | fixture 요청 수 | 5 | 5 | 0 | 0.00% | MAD 0→0 | 동일; 실제 전송량 미측정 | [secondary-v5/raw.json](secondary-v5/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·느린 네트워크 모바일 | 390×844, CPU×1, 9쌍, CDP 150ms/1.6Mbps, 공유부하 | 클릭→안정된 대상 DOM (ms) | 207.9 | 47.8 | 160.1 | 77.01% | MAD 20.3→5.9; paired CI [136.5, 181.2]ms; block CI [137.1, 172.4]ms; p95 생략(n<20) | 공유부하 관찰치; 시간 개선 미입증 | [secondary-v5/raw.json](secondary-v5/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·느린 네트워크 모바일 | 390×844, CPU×1, 9쌍, CDP 150ms/1.6Mbps, 공유부하 | 최대 rAF 간격 (ms) | 200.2 | 41.5 | 158.7 | 79.27% | MAD 16.9→0.8 | 공유부하 관찰치; 시간 개선 미입증 | [secondary-v5/raw.json](secondary-v5/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·느린 네트워크 모바일 | 390×844, CPU×1, 9쌍, CDP 150ms/1.6Mbps, 공유부하 | SDK 마커 수 | 735 | 55 | 680 | 92.52% | MAD 0→0 | 해당 fixture의 작업량 감소 | [secondary-v5/raw.json](secondary-v5/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·느린 네트워크 모바일 | 390×844, CPU×1, 9쌍, CDP 150ms/1.6Mbps, 공유부하 | 전체 DOM 요소 수 | 4,966 | 886 | 4,080 | 82.16% | MAD 0→0 | 해당 fixture의 작업량 감소 | [secondary-v5/raw.json](secondary-v5/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·느린 네트워크 모바일 | 390×844, CPU×1, 9쌍, CDP 150ms/1.6Mbps, 공유부하 | 자연 GC 상태 JS heap (MB) | 19.731 | 19.661 | 0.070 | 0.35% | MAD 0.368→0.140 | 관찰치; 누수/retained heap 결론 없음 | [secondary-v5/raw.json](secondary-v5/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·느린 네트워크 모바일 | 390×844, CPU×1, 9쌍, CDP 150ms/1.6Mbps, 공유부하 | 초기 FCP (ms) | 2,316.0 | 2,316.0 | 0.0 | 0.00% | MAD 4.0→0.0 | 차이 없음/노이즈 범위; 개선 미입증 | [secondary-v5/raw.json](secondary-v5/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·느린 네트워크 모바일 | 390×844, CPU×1, 9쌍, CDP 150ms/1.6Mbps, 공유부하 | 관찰 종료까지 LCP (ms) | 4,792.0 | 4,788.0 | 4.0 | 0.08% | MAD 12.0→20.0 | 차이 없음/노이즈 범위; 개선 미입증 | [secondary-v5/raw.json](secondary-v5/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·느린 네트워크 모바일 | 390×844, CPU×1, 9쌍, CDP 150ms/1.6Mbps, 공유부하 | fixture JSON 응답 body (bytes) | 595,828 | 595,828 | 0 | 0.00% | MAD 0→0 | 동일; 실제 전송량 미측정 | [secondary-v5/raw.json](secondary-v5/raw.json) / [scored.json](scored.json) |
| 735개 클러스터 펼치기·느린 네트워크 모바일 | 390×844, CPU×1, 9쌍, CDP 150ms/1.6Mbps, 공유부하 | fixture 요청 수 | 2 | 2 | 0 | 0.00% | MAD 0→0 | 동일; 실제 전송량 미측정 | [secondary-v5/raw.json](secondary-v5/raw.json) / [scored.json](scored.json) |

모든 수치의 min/max/MAD와 다른 지표는 [scored.json](scored.json), 시계열·resource before/after는 pair/sample sidecar에 있다. 초기 layout shift는 입력 전 관찰 구간의 non-recent-input entry 합계만 [supplementary-statistics.json](supplementary-statistics.json)에 보존했다. lifetime/session-window CLS 또는 field CLS로 보고하지 않는다.

## 플리커·잘못된 중간 상태

기존 baseline pool 결함의 구체적 정의는 “pool에서 다른 식당으로 reuse하거나 방문 수가 바뀐 marker가 이전 restaurant DOM ID 또는 visit badge를 보여 줌”이다. [pool-dom-final-v2/raw.json](pool-dom-final-v2/raw.json)은 원본 baseline/최종 source를 browser에서 각각 실행한다. 8단계(다른 ID reuse, none→2→3→none badge, 같은 ID badge 증가/제거, bubble-only)에서 baseline accuracy failure 7회→candidate 0회였다. 각 variant의 8단계는 한 시퀀스이며 간헐적 발생률의 독립 표본이 아니다. static DOM 오류를 고쳤다는 증거이며 운영 pixel flicker 빈도는 확보하지 못했다.

최적화 v6의 결함은 “첫 왕복 뒤 warm cache를 사용한 두 번째 empty viewport→동일 target center 복귀에서 expanded 마커가 143개로 복구되지 않음”이다. [rejected readback](marker-dom-readback-final-v3/rejected.json)에 zoom14, center37.5512/126.9882, expected143/actual0이 120×100ms 관찰 동안 남았다. 초기 회귀 170개와 개수 검사만으로는 이 순서 경합을 잡지 못해 추가 DOM ID↔SDK 좌표 독립 readback을 도입했다. v6는 최종 후보에서 제외했다.

v7은 raw viewport invalidation과 cleanup 완료 key 동기화로 이를 수정했다. [final readback](marker-dom-readback-final-v4/raw.json)은 새 context 2개(각 viewport 1개)에서 각각 3왕복을 실행했다. 모든 return에서 exact ID 집합/좌표/고유성, away 0개, map identity1을 확인했다. 이는 6독립 실행이 아니다. harness에 잘못 복사된 과거 `plan-v5.json.txt`는 지우지 않고 historical artifact로 남겼으며 [readback-binding-v7.json](readback-binding-v7.json)이 raw hash, 실제 plan-v6 hash, 실제 v7 receipt를 별도로 묶는다.

동일한 frozen flicker sampler의 v6→v7 비교는 다음과 같다. >250ms zero-marker span은 v7 build 전 정한 threshold이며 original production baseline 비교가 아니다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
|---|---|---|---:|---:|---:|---:|---|---|---|
| 캐시 pan 복귀·데스크톱 (중간 v6→최종 v7) | CPU×4; 버전당 새 context 5개; 2초 관찰 | 관찰된 zero-marker span 중앙값 (ms) | 158.4 | 8.4 | 150.0 | 94.70% | 범위 150.0–158.5→7.6–16.7ms; CI 없음 | >250ms 관찰 0/5→0/5; 완전 제거 판정 아님 | [before](flicker-pan-before-v3/raw.json) / [after](flicker-pan-after-v1/raw.json) |
| 캐시 pan 복귀·모바일 (중간 v6→최종 v7) | CPU×4; 버전당 새 context 5개; 2초 관찰 | 관찰된 zero-marker span 중앙값 (ms) | 308.2 | 16.7 | 291.5 | 94.58% | 범위 307.4–316.1→16.3–16.9ms; CI 없음 | >250ms 관찰 5/5→0/5; 완전 제거 판정 아님 | [before](flicker-pan-before-v3/raw.json) / [after](flicker-pan-after-v1/raw.json) |

각 시도는 fresh context이며 첫 pan 왕복 후 warm-query 두 번째 복귀를 2,000ms 관찰했다. rAF median 주기는 약 8.3ms였다. v7도 7.6–16.9ms의 짧은 zero-DOM span이 남는다. **모바일 5회 중 >250ms span 0회 관찰**이며 완전 제거를 의미하지 않는다. desktop v7 2/5 context에 250ms 이상의 rAF blind gap이 있었다. main thread가 멈춘 동안은 DOM/프레임을 검사할 수 없다.

같은 pan 비교에서 case별 maximum rAF gap 중앙값은 desktop 166.1→249.3ms, mobile 50.7→92.4ms로 악화했다. n=5 sequential 공유부하 diagnostic이며 이 sampler에는 resource telemetry가 없어 원인을 확정하지 못한다. 짧은 DOM 공백 개선을 전체 프레임 안정성 개선으로 주장하지 않는다. 임의 delay·추가 debounce·필수 loading feedback 숨기기는 사용하지 않았다.

[desktop before filmstrip](flicker-pan-before-v3/desktop/filmstrip.html), [desktop after](flicker-pan-after-v1/desktop/filmstrip.html), [mobile before](flicker-pan-before-v3/mobile/filmstrip.html), [mobile after](flicker-pan-after-v1/mobile/filmstrip.html)와 trace/rAF timeline을 함께 보존했다. CDP screenshot은 적응형으로 desktop 5frame씩, mobile before231/after203frame이며 연속 pixel capture가 아니다. 그림의 gap은 실제 UI 공백 길이와 동일하지 않다.

CDP 실제 touchStart/move/end의 `isTrusted=true` 스와이프 5회는 1context 내 반복이다. 식당 이름 0292→0297 순서 전환, sampled panel present, panel x/y/width/height 변화0, map identity1, overflow0를 확인했다. 가장 큰 sampled rAF gap59.2ms와 long task59/53ms도 남는다. 물리 모바일 touch latency, 전체 pixel flicker, 일정 frame rate 보증은 아니다. 근거는 [native-touch-final-v2/raw.json](native-touch-final-v2/raw.json)이다.

## 트레이스와 화면 비교

final baseline/candidate diagnostic trace는 각각 n=1이고 profile·screenshot instrumentation overhead를 포함한다. 독립 paired timing 통계와 합치지 않았다.

| 관찰창 | Baseline | Candidate | 의미 |
|---|---:|---:|---|
| UpdateLayoutTree | 740회 / 662.715ms | 148회 / 57.442ms | mock 삽입·layout 경로의 작업 축소 |
| Layout | 741회 / 929.019ms | 149회 / 47.819ms | SDK DOM의 N→V 제한과 양립; 실제 SDK 시간 주장 아님 |
| Paint | 33회 / 8.269ms | 33회 / 9.663ms | 증가 관찰, n=1이라 개선/회귀 통계 결론 없음 |
| CDP screenshot | 4frame; 최대 gap2434.622ms | 4frame; 최대 gap606.285ms | 캡처가 막힌 구간; pixel readiness 증명 아님 |

근거: [baseline trace/profile/filmstrip](trace-baseline-final-v1/filmstrip.html), [candidate trace/profile/filmstrip](trace-candidate-final-v1/filmstrip.html), 각 디렉터리의 trace.json/profile.json/summary.json. 실제 live SDK/compositor/React commit 지표는 미측정이다.

최종 unmasked screenshot은 viewport당 1개다. desktop은 pixel identical, mobile 차이0.072913%는 header[12,10,378,58] 안에 있고 모든 channel 차이≤8이었다. [screen-comparison.json](paired-v6/screen-comparison.json)과 [desktop before](paired-v6/baseline-cell-0.png)/[after](paired-v6/candidate-cell-0.png), [mobile before](paired-v6/baseline-cell-1.png)/[after](paired-v6/candidate-cell-1.png)를 보존했다. n=1 정적 비교가 모든 반응형 상태·애니메이션·플리커를 보장하지 않는다.

## 메모리와 남은 병목

2,000개의 full timing sampler 자연 GC heap 중앙값은 27,378,957→34,367,833B, +6,988,876B(+25.53%)다. frozen memory 예산20%를 초과했다. 큰 DOM 감소만으로 메모리 감소를 주장하지 않는다. browser observer 및 GC phase가 측정에 관여할 수 있지만 이 원인을 확정하지 못했다.

별도 minimal-observer protocol의 explicit CDP GC 후 retained heap diagnostic은 3번의 독립 paired whole server/browser 실행이다. after-GC 중앙값은 19,036,124→16,374,364B였다. [memory-gc-diagnostic-v1/raw.json](memory-gc-diagnostic-v1/raw.json)에는 GC 전/후 숫자만 있고 heap object/snapshot은 없다. 이것은 다른 protocol에서 retained 증가가 관찰되지 않았다는 진단이며 원래 자연 heap budget 위반을 교체·면제하지 않는다. 누수 제거와 장기 운영 메모리 안정성을 입증하지 않는다.

warm-query 10왕복 동안 map1·DOM/ID 복구를 확인했으나 heap은 자연 GC에 따라 오르내렸다. 지속 증가율을 추정하지 않았다. 작은 검색/반복 방문도 각 viewport 10cycle이었다. 새 캐시를 넣지 않았고 pool cap1,000 초과/축출, 기존 bubble 이미지 유지, 누락 bounds, selected/search viewport 예외, data identity/coordinate 변경을 단위·통합 검사했다.

남은 병목은 v7의 CPU×4 cluster 최댓값 rAF gap(대표 median200.3/108.8ms), pan 복귀의 막힌 구간, native touch59ms task, N개 데이터/snapshot 검사와 fixture 응답 비용이다. 초기 FCP·LCP·요청 수·응답 body 개선은 입증되지 않았다. 실제 SDK에 대한 동일 조건 재측정, quiet host 시간 입증, 자연 heap 회귀 원인 분리와 장기 메모리 측정이 후속 판단에 필요하다.

## 정확성·회귀·필수 검사

| 검사 | 결과 | 근거 |
|---|---|---|
| affected unit suite | 111pass/0fail, 2,521 expectations, 11files | [unit-tests-v7.log](unit-tests-v7.log), [보존된 test input hash](final-verification-inputs-v2.json) |
| target ESLint | exit0 | [eslint-v7.log](eslint-v7.log) |
| project native/stable TS parity | 0diagnostics, 2,368 logical inputs | [typecheck-parity-v7-v2.log](typecheck-parity-v7-v2.log) |
| production build | webpack/TS/48pages 성공 | [build-candidate-v7/receipt.json](build-candidate-v7/receipt.json), build.log |
| CSS route boundary | home192,639B/gzip45,626B, 220KiB/48KiB 예산 내 | [css-boundaries-v7-v2.log](css-boundaries-v7-v2.log) |
| actual production renderer regression | 170checks/0failure, desktop/mobile×735/3 네 case | [regression-candidate-v7-v1/raw.json](regression-candidate-v7-v1/raw.json) |
| native CDP touch supplement | 63checks/0failure, 5trusted swipes/1context | [native-touch-final-v2/raw.json](native-touch-final-v2/raw.json) |
| cached pan exact readback | 2contexts×3rounds 모두 정확 ID↔좌표; map1 | [marker-dom-readback-final-v4/raw.json](marker-dom-readback-final-v4/raw.json) |
| actual-source pool DOM | baseline8steps/7bad; candidate8steps/0bad; bubble-only image 유지 | [pool-dom-final-v2/raw.json](pool-dom-final-v2/raw.json) |
| canonical project scorer/validator | 각각 exit0; admittedIds=[], releaseBlocked=true | [canonical-execution-receipt.json](canonical-execution-receipt.json), [backlog.scored.json](canonical-zero-admitted-v1/backlog.scored.json) |

browser regression은 최초 진입, native cluster/pointer/keyboard 선택, 목록·scroll, 확대/이동/10왕복, 상세 close/back, synthetic 기존 swipe와 별도 native touch, 빈 filter/reset, 검색 응답 순서 반전/empty 검색, immutable 좌표 갱신, 반복 방문을 포함한다. 필터·검색·list/swipe snapshot의 전체 후보를 SDK culling과 분리해 확인했다. 실제 route/UI는 실행했지만 외부 SDK pan/zoom은 mock API 호출이다. 접근성 role/label/tabindex/keyboard를 유지·검증했고 전체 screen reader/axe 검사는 하지 않았다. 전체 앱의 admin/auth/review 제출/외부 지도 링크·physical device·full warm HTTP/PWA는 미검증이다.

실패 증거도 남겼다. generated TS probe가 앱 tsconfig에 들어간 parity2error는 owned probe를 .ts.txt/scratch로 바꾸어 해결했고 앱 설정은 바꾸지 않았다. 잘못 추정한 CSS module path와 canonical 상대 root CLI 실패는 실제 인터페이스로 고쳤다. 첫 native touch 관찰자는 실제 role=button div를 HTML button으로 가정해 실패했으며 selector를 고친 v2로 재검증했다. 이 harness/setup 실패를 제품 결함 또는 성공 표본으로 바꾸지 않았다. 중간 v6 correctness 실패와 모든 이전 raw/계획/trace도 삭제하지 않았다.

요청된 native Astra review는 gpt-6-astra/max configuration과 native assistant 응답을 확인했고 [delegation-routing.json](delegation-routing.json), [astra-review-v8.md](astra-review-v8.md)에 보존했다. vendor transport ID는 확보하지 못했다. 다른 모델로 조용히 전환하거나 quota/유료 capacity를 추가하지 않았다.

## Canonical 판정·보존·재현

evidence root는 `/Users/twoimo/.codex/worktrees/179f/tzudong/apps/web/performance/render-flow-20260930`다. 프로젝트 canonical scorer/validator·별도 map hash 규칙을 실행했다. [canonical-zero-admitted-v1](canonical-zero-admitted-v1/basis.json)의 Git identity는 원래 기준선이고, 최종 candidate는 별도의 uncommitted patch hash다. field source=`source_not_produced`, local gate incidents110(워밍업 포함), health gate 실패, admittedFieldSlices=0, releaseBlocked=true다. canonical 통과는 이 차단 판정이 계약·해시와 일치한다는 의미이며 release 승인/운영 health 성공이 아니다. CLI pin·basis·결과·실패/성공 log를 보존했다.

전체 증거는 [artifact-map.json](artifact-map.json)에 size/SHA-256로 묶고 map 자체 해시는 root 밖 `../render-flow-20260930-artifact-map.sha256`에 둔다. 전체 재계산·exact full-tree hash readback 결과는 `../render-flow-20260930-verification.json`에 저장한다. map 생성 후 root 내부를 편집하면 검증이 실패한다. map을 보고서의 hash에 포함하거나 보고서에 자기 map hash를 삽입하지 않는다. metadata·fixture값·수치·synthetic 화면만 보존했으며 cookies/headers/auth token/비공개 DB 응답/heap 객체를 수집하지 않았다. 원본 JSON이나 trace에 새로운 private session을 섞지 않는다.

다음 명령의 cwd는 `apps/web`, Node는 `/opt/homebrew/opt/node@24/bin/node`, TS browser runner는 `/Users/twoimo/.bun/bin/bun`이다. ports3310–3312는 이 작업의 local 전용이었다. 새 재실행은 빈 전용 checkout에서 baseline commit을 checkout하고 retained patch를 적용하며 같은 package-lock으로 의존성을 설치한다. 사용자 dirty checkout을 reset/stash/clean하지 않는다. retained unit test .txt도 해당 원래 경로에 복사한다. 빌드 라벨·출력 경로는 기존 증거와 겹치지 않게 새 것으로 지정한다.

```sh
# 두 production variant를 새 라벨로 생성; build.mjs는 기존 output overwrite를 거부함.
/opt/homebrew/opt/node@24/bin/node performance/render-flow-20260930/build.mjs baseline replay-baseline
/opt/homebrew/opt/node@24/bin/node performance/render-flow-20260930/build.mjs candidate replay-candidate
```

원본 paired.mjs/runtime.mjs는 보존된 build-baseline-v1/build-candidate-v7을 읽는다. 새 build 재측정은 scripts를 별도 작업 폴더로 복사해 receipt label만 새 것으로 연결하고 수정된 harness도 보존한다. 기존 build가 동일 host에 있으면 다음 새 output-label 실행으로 같은 sampler를 반복할 수 있다. `PLAYWRIGHT_BASE_URL`은 repo helper의 origin과 일치시킨다.

```sh
PLAYWRIGHT_BASE_URL=http://localhost:3310 /Users/twoimo/.bun/bin/bun performance/render-flow-20260930/paired.mjs replay-primary
PLAYWRIGHT_BASE_URL=http://localhost:3310 /Users/twoimo/.bun/bin/bun performance/render-flow-20260930/paired.mjs replay-secondary --secondary
PLAYWRIGHT_BASE_URL=http://localhost:3310 /Users/twoimo/.bun/bin/bun performance/render-flow-20260930/regression.mjs replay-regression
```

이는 HTTP/PWA/live SDK timing 재현 명령이 아니다. frozen mock helper는 [final-verification-inputs/mobile-home-map-helpers.ts.txt](final-verification-inputs/mobile-home-map-helpers.ts.txt)에 있다. 별도 touch/readback/flicker/trace/GC harness는 각 run dir의 frozen .txt와 현재 source로 보존했다. 기본 output이 고정된 script는 새 복사본에서 새 output label로 변경하고 그 복사본을 보존한다.

```sh
/opt/homebrew/opt/node@24/bin/node performance/render-flow-20260930/score.mjs \
  --plan performance/render-flow-20260930/plan-v6.json \
  --aa performance/render-flow-20260930/baseline-aa-v3/raw.json \
  --additional-aa performance/render-flow-20260930/baseline-aa-final-v1/raw.json \
  --resources-plan performance/render-flow-20260930/resources-plan.json \
  --raw performance/render-flow-20260930/paired-v6/raw.json \
  --raw performance/render-flow-20260930/secondary-v5/raw.json \
  --output /tmp/tzudong-score-replay.json
```

canonical prepare→프로젝트 scorer→finalize→프로젝트 validator의 정확한 명령/pin은 [evidence-notes.md](evidence-notes.md)와 execution receipt를 따른다. protected CLI의 artifact-root는 절대 경로다. output-dir 기존 존재 시 새 label을 사용하고 기존 baseline/map/hash를 덮어쓰지 않는다.

```sh
# 별도 해시 파일 첫 칼럼의 pin을 사용. 이 명령은 read-only이며 root에 새 log를 만들지 않음.
/opt/homebrew/opt/node@24/bin/node performance/render-flow-20260930/verify-evidence.mjs verify \
  --scored performance/render-flow-20260930/scored.json \
  --artifact-map performance/render-flow-20260930/artifact-map.json \
  --artifact-map-sha256 DETACHED_PIN_FROM_PARENT_DIRECTORY
```

verifier는 deterministic score 재계산, baseline/candidate retained source/build/patch binding, raw↔sample sidecars, exact map coverage와 supplementary ID↔좌표/touch/pool/flicker invariants를 확인한다. supplementary QA는 성능 admission을 올리지 않는다. own browser contexts·standalone servers는 harness finally에서 닫았고 [browser-cleanup.json](browser-cleanup.json)에 임시 IAB viewport 복구/owned tab 정리를 보존했다. 다른 chat의 프로세스·계정·queue·편집은 건드리지 않았다.

소스 수정과 로컬 테스트·실제 production renderer 검증·재측정·증거 보존을 완료했다. 시간 개선의 엄격한 입증은 공유 환경·캡처 조건 때문에 완료되지 않았으며 0건 판정을 유지한다. 운영 배포·실제 SDK/물리 모바일·field 성과와 자연 heap 회귀 해소는 이 결과로 승인하거나 추정하지 않는다.
