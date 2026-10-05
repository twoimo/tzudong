원인·변경 원리·이론 모델. 아래 모델은 실측값과 별개이며 현재 REPORT의 음성 결과를 대체하지 않는다.

현재 source의 작은 expanded set 보존은 SDK detach/attach·icon 재구성 경로의 반복 비용을 줄이려는 lifetime 변경이다. 1≤N≤1000에서 SDK set을 유지하고, 더 큰 결과는 padded viewport V와 선택 예외를 처리한다. Pool capacity는1000이며 작은 set의 DOM·SDK 객체 보존 비용 O(N)은 trade-off다. Mobile 접근성 노출은 padded view·selection에 맞춰 별도로 동기화한다. 동일 country/viewport membership, capacity overflow, clear/eviction, 변경된 canonical object, cancellation/unmount, 빈 결과를 회귀 경계로 검증한다. 현재 raw에서735는 full set,2000은464 padded-view markers다. Warm endpoint20% guard 실패가 남아 있어 lifetime 변경으로 메모리 회귀가 모두 해소됐다고 말하지 않는다.

고정 marker CSS를 각 HTML에 반복하는 경우 N개 marker의 문자열 비용은 대략 N(Ls+Ld)다. 고정 CSS를 파일로 공유하면 Ls+N·Ld가 되어 반복 정적 표현을 줄일 수 있다. 동적 크기·transform·z-index·badge offset은 inline으로 유지한다. 이 모델은 문자열 표현의 공간 비용이며 SDK 내부 복제·DOM·V8 GC까지 제거하는 식이 아니다. 실제 visual equivalence24cases와 badge800 계약을 보존한 기존 증거는 oldroot에 있다. 이번 b901 cold의19.108816→19.095928MB 차이는 noise 이하로 별도 추가 이득을 입증하지 않았다.

확장 pass에서 같은 canonical object의 중복 처리만 생략한다. 후보 pass2회가 같은 객체 R개를 반복한다면 application-owned acquire/render call은 최대로2R→R로 줄 수 있다. 객체가 바뀌면 다음 renderer가 그대로 처리하므로 ID만 같다고 생략하지 않는다. Source/unit 경계의 처리 횟수 모델이며 실제 UI 시간을 절반으로 만드는 주장이 아니다.

Viewport와 선택 예외는 즉시 만들고 누락된 offscreen marker는 paint 기회 뒤 MessageChannel32 jobs씩 생성한다. Noff 작업은 ceil(Noff/32) slices이며 icon 평균 비용c라면 한 slice의 작업량은 약32c다.60Hz frame budget16.67ms에 들어간다는 것은 이론 목표이지 보장값이 아니다. Pending tail은 data 변경·unmount에 취소하며 reference를 해제한다. 임의 지연/debounce로 feedback을 숨기지 않았다. Current cold/rAF/long-task 표가 실제 browser 결과이고 React production duration은 직접 수집되지 않았다.

Pool inactive __onClick과 application-owned SDK listener를 clear/eviction 때 정리한다. Closure가 restaurant graph를 참조한다면 그 참조 edge를 제거하는 원리다. Reusable SDK의 internal listener는 제거하지 않는다. 이는 SDK 모든 객체·closure가 수거된다는 증명이 아니며 post-finalGC나 WeakRef 진단으로 naturalheap guard를 면제하지 않는다.

해외 country condition builder는 같은 callback에서 두 번 계산하던 값을 한 번 재사용한다. R개 config/K개 term의2·O(R+K)→O(R+K) 상수 작업 감소이며 점근 차수는 같다. Keyword sanitizer는 전체 문자열 길이L에 O(L) 작업을 추가한다. 정상12config의 query 조건·순서와 국내 fallback을 보존했고 실제 initializer/query callback의 helper call2→1을 unit에서 관찰했다. Network request 절감·CPU/heap/INP의 실측 이득은 주장하지 않는다.

Warm measurement observer는 N행 full payload를 C회 전달하면 O(C·N·L) 직렬화·할당을 추가할 수 있다. Compact id/lat/lng를 초기1회 넣으면 그 부분은 O(N·Lcompact)로 줄지만 이후 state 수집·SDK 작업은 남는다. 같은 source full/minimal probe 비교는 관찰 도구 영향이며 제품 최적화가 아니다. 새 A/B에는 양 source에 동일 minimal probe를 사용했다. Endpoint는 GC 시점에도 영향을 받으며 n2 warm 실패와 같은source AA22.15% 차이를 동시에 보고한다.

공개 폰트의 content-address path가 body SHA와 같을 때 긴 TTL은 같은 key의 fresh-cache 수명을 늘린다. Browser TTL14400→31536000초 변경은 정책값이지 지연 개선율이 아니다. 기존4h cache가 stale가 된 뒤에도 conditional304로 body 없이 재검증할 수 있어11.42MB를 매번 절감한다고 추정하지 않는다. 정확한1경로만 수정해 다른 data invalidation이나 private cache 경계를 넓히지 않았다. ActualGET SHA 일치·afterHIT2/2와현재R2billable0을 확인했고 실제월별절감액·사용자LCP 개선은 미검증이다.

Swift package/alias는 보안 스캔의 build discovery 결함을 해결한다. 기존 OCR byte와 Python 호출 경로를 유지하고 실제 컴파일·스캔 범위를 확인했다. 렌더링 성능 최적화나 실제 OCR processing 성과를 뜻하지 않는다.
