# HTTPS 기준선·자원 회수 진단

두 독립 프로세스에서 각각128개 검색을2회 순회했고, 총512개의 종속 동작에서 선택·상세·marker 연결/중복0·map 생성1을 확인했다. 이는 SDK 기능 검증이며 메모리 회귀 해결이나 성능 개선 판정이 아니다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
|---|---|---|---|---|---|---|---|---|---|
| 동일 소스 A/A | Chrome155/HTTPS/CPU4/REST735/390×844; 독립2회, 회당256 동작 | 종료 JS heap | 31.72164MB | 42.07610MB | A2−A1 +10.35446MB | +32.64% | n=2, CI 추론 안 함 | 측정 변동 큼; 개선 입증 안 됨 | ui-baseline-aa-1/raw.json, ui-baseline-aa-2/raw.json |
| 동일 소스 A/A | 위와 같음, 종료 후 idle5초 | idle JS heap | 32.78950MB | 43.25555MB | A2−A1 +10.46605MB | +31.92% | guard 면제에 쓰지 않음 | 회귀 guard 미평가 | aggregate-v1.json |

A/A의 After 열은 제품 수정본이 아니라 두 번째 동일 소스 실행이다. 변화는 A2−A1, 상대 변화는 (A2−A1)/A1×100이다. 낮을수록 좋은 before/after 제품 개선율과 혼동하지 않는다. p95는 aggregate에 회당256개의 종속 동작에 대한 기술 통계로만 제공했다. 전체 UI의 독립 실행 p95나95% CI로 해석하지 않는다. heap 최대값은16-query 간격의 checkpoint 최대값으로, 연속 측정 peak가 아니다.

별도256동작 WeakRef 수명주기 진단에서는 마커 생성164, 추적164, overflow0, attached126을 관찰했다. 자연 idle34.27198MB 뒤 한 번의 명시적 GC에서22.331752MB, DOM2497→1558, 리스너2880→1483으로 줄었지만 live marker164는 그대로였다. 미회수 할당과 유지되는 SDK 객체를 분리하는 단서다. 강제 GC 값은 원인 진단이며 자연 heap guard의 after 값으로 사용하지 않는다. 이 관찰만으로 누수 부재나 무제한 증가를 단정하지 않는다.

HTTPS16동작의 별도 profiler는 SDK setIcon638회/309.3ms, setMap1055회/340.6ms를 관찰했다. CPU profile과17112개 sanitized trace event를 보존했다. trace 범주의 시간은 겹칠 수 있으므로 합산하지 않는다. profiler 실행은 natural A/A와 분리했으며 overhead 미정이다. REST first64 query shape도 원문 값 없이 기록했다. ID를 풀 전체에서 찾아 재사용하는 이전 O(P) 후보는 setIcon을5회만 줄였던 관찰과 비용을 고려해 계속 미채택이다.

모든 새 실행에서 page error0, console에는 기존 Naver connect-src CSP1이 있었다. provider 요청 취소/실패는 raw의 분류와 canonical health에 그대로 보존했다. 이를 전체 SDK 고장이나 픽셀 공백 횟수로 바꾸지 않는다. scorer·validator는 통과했지만 items0/admitted0/releaseBlocked=true이다. canonical budget에 heap metric이 없으므로 이 통과는20% heap guard의 통과가 아니다.

Node24.21.0/npm11.6.2/Next16.3.8/Playwright1.63.0/Chrome155.0.8059.40, source056a866, SDK SHA802f8c5b…을 사용했다. CPU4, HTTP cacheoff/SW bypass, 실제 remote SDK·타일/합성REST735/Auth401, 앱 캐시128검색재방문, desktop touch emulation이다. TLS는 자체 localhost SPKI만 예외이며 production CSP/remote TLS를 유지한다. 물리 기기·운영·field 증거가 아니다. 기존 HTTP 실패/다른 Chrome 버전 표본은 비교에 섞지 않았다.

재현: plan-v1.json과 build-receipts-v8.json의 산출물을 준비하고 Node24로 measure-ui-https-v1.mjs baseline <새 label> 128 2를 실행한다. 두 실행은 직렬로 새 Chrome 프로세스를 사용한다. measure-lifecycle-https-v2.mjs는 별도의 진단이며 natural samples 뒤에만 GC를 요청한다. profile-flow-https-v3.mjs baseline은 별도의16동작 profiler다. 기존 출력은 덮지 않고 새 root로 복제한다. private TLS key/.env는 저장소 밖에 두고 public runtime 네 설정만 RAM에서 사용한다.

남은 일: 측정된 할당·보유 경로를 더 좁혀 실제 수정 후보를 구현하고, A/A4회와 독립 A/B9쌍 등 기존 계획과 fixed20% heap/15% latency 판정에 따라 재측정한다. 검색 결과·마커 수·상태를 줄이거나 guard를 완화하지 않는다.
