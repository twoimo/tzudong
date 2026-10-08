# 검색·스와이프 캐시 검증 — 파일럿과 확인 실행

동일 배열의 행 변경을 놓치던6개 정확성 경로를 재현·수정했다. 첫 후보879a8657은 자연 종료/idle 메모리20% guard를 넘겨 채택하지 않았다. 키 객체별 공유 수정21a86dca는 정확한 projection/IN 응답의 단일 비교에서 heap이 줄고 입력 관찰 지연은 증가했다. 각1개 독립 프로세스의 파일럿이며 개선·회귀 해소의 증명은 아니다. 운영 변경0, field admission0, 물리 기기 검증0이다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화(Before−After) | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
|---|---|---|---|---|---|---|---|---|---|
| 동일 배열 데이터 갱신 | Bun1.4.0,6개 실패 경로 | 정확성 실패 |6개 |0개 |6개 감소 |성능율 아님 |결정적 회귀 테스트 |수정 |mutation-before-v1.log, tests-pooled-v1.log |
| 키 스냅샷 보유 | Chrome154 진단1회/128동작 | 키/참조 객체 수 |13,505키/735개 원본 객체 |공유 구현, 재보유량 확인 필요 |이론상 중복12,770개 |이론값, 실측 감소 아님 |GC 유발 진단; 자연 guard 대체 불가 |중복 보유 원인 |ui-candidate-128-reference-diagnostic-v2/raw.json |
| 128검색2회 후 종료 | production,각1프로세스/256종속동작 | 자연 V8 heap MB |45.744876 |42.559676 |3.185200 |6.962966% 감소 |CI 없음, A/A·9쌍 확인 진행 |파일럿20% guard내/개선 미입증 |projected-pilot-summary-v6.json |
| 같은 작업5초 idle | 같은 조건 | 자연 heap MB |46.871316 |43.655792 |3.215524 |6.860324% 감소 |같음 |파일럿 guard내/회귀 해소 미입증 |projected-pilot-summary-v6.json |
| 검색 선택 화면 관찰 | 같은 조건 | 세션 중앙값 ms |218.8 |227.5 |−8.7 |−3.976234% |256동작은 독립256사용자가 아님 |지연 증가,15% guard내/판정 미완료 |projected-pilot-summary-v6.json |
| 첫 후보 종료 메모리 | 이전 v2합성 DTO 조건,각1프로세스 | 자연 heap MB |28.130320 |46.969016 |−18.838696 |약−66.97% |CI 없음; 불완전fixture 별도 보존 |실패, 면제 안 됨 |ui-pilot-rejection-v1.json |

대조 소스da4c9be17e54733414cc7e1d2f8365d25bee4d87, 초기 후보879a8657edf7ca5d2da6108edc9806381c2f8a5d, 공유 후보21a86dca974f9bbdeed52d19d2fde0e9cc1fcac6. Node24.21.0/Next16.3.6/실제Chrome154.0.8037.98/390×844/dpr1/touch emulation/CPU4/HTTP cache·SW우회/네트워크 무감속. 원격 SDK·타일은 실제이고 REST735/Auth401은 합성이다. SDK 스크립트SHA802f8c5...가 양쪽에서 동일했다. DevTools HeapProfiler 진단은 별도이며 raw snapshot 문자열/인증값/원문 응답을 저장하지 않았다.

원인은 WeakSet/목록 참조 캐시가 행 변경을 검사하지 않던 것이다. 관련ID·이름·좌표·병합ID 및 객체 교체를 검사한다. 목록당 검색/근접 캐시64개 한도는 유지한다. 첫 구현은 같은 원본 객체를 여러 목록에서 만날 때 키를 중복 생성했다. WeakMap으로 원본 객체당 불변 키를 공유하며 값 변경 시 새 키를 만들고 이전 목록 키는 변경 감지를 위해 보존한다. 이론적 비용은 검증O(N+M), 키 보유는 동일값 원본 객체별O(U), 목록 참조O(sumN)이다. 약927KB 구조 보유 관측은 이전진단 조건의 값이며 전체heap이나 누수 수치가 아니다.

원시 v1/v2 fixture는 SELECT를 무시하고 이름 IN 조회를 정확히 처리하지 않았다. 같은조건의 비교 기록은 그대로 남기되 실제 DTO형 성능 증거로 채택하지 않는다. v3/v4의 unsupported 인기순 정렬도 실패로 남겼다. 최종v6은 projection/alias/IN/널조건/인기 숫자정렬을9개 Node 검사로 확인했다. 상품 소스 Bun34개 검사는 pooled-v1 로그의40개중6개 당시fixture검사와 구분한다. lint/native7.0.2·compat6.0.2 parity 및 production build가 통과했다. npm build의 CSS CLI는 기본.next를 읽으므로 각 실제 named dist에 동일exported validator를 적용한 별도CSS receipt가 결정적 근거다. 임계값을 약화하지 않았다.

실제SDK 흐름에서 양쪽256회 동안 올바른 상세/선택 마커/중복0/지도 생성1/overflow0를 관찰했다. 이는 DOM·4장의 화면 범위이며 전체 픽셀 플리커·핀치·뒤로가기·물리Samsung검증이 아니다. page error0,console2는 숨기지 않았다. connect-src 차단 대상은kr-col-ext.nelo.navercorp.com이며 같은 공식SDK 코드에NELO와/_store가 있다. 로그 수집기라는 해석을 코드로 뒷받침했다. 정책을 넓히거나 오류를0으로 만들지 않았다. 다른 취소된 SDK 요청도 raw에 남았다.

필드 수집은 기존v1만 운영중이다. 소스 검토에서 tablet이desktop에 섞이고 Chrome/Samsung분리가 없는 것을 확인했다. 새protocol/분모/사전계획/추가migration/실제수집readback이 남는다. 예전수집량을 새cohort로 부르지 않는다. 휴대폰 사용 보류 유지. PR3138의 별도marker후보도 미승격이며 본 후보와 혼합하지 않았다. 전체warm60·cold735/2000·128확인·viewport/회전/키보드/배경복귀·물리2브라우저·보호된승격/운영배포·field조건은 전체 목표의 미완료 항목이다. 원래20%heap/15%latency guard와 과거26.2%실패를 유지한다.

A/A4프로세스 다음 무작위순서9쌍18프로세스 확인은browser-confirm-plan-v6.json과run-browser-series-v6.mjs로 직렬 실행한다. 자체build/test/profiler는 측정중 중복하지 않는다. 외부호스트부하는 완전히 통제되지 않는다. 실행 완료와 canonical admission/성과 판정은 별개다. 현재 admission0이다. 이 root는 확인 실행중 mutable이며 final artifact-map/독립검증/Git 저장은 실행 종료 후 해야 한다.
