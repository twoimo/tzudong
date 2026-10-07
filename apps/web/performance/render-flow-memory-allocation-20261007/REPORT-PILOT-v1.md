지도 signature의 반복 Set·sort·join 할당을 줄인 후보를 만들고 실제 Naver SDK에서 재측정했다. 작은 matched-source pilot은 기존 회귀 허용치 내였지만, 원래 ca235 기준 메모리 회귀 해결과 노이즈를 넘는 체감 개선은 아직 입증하지 않았다. 운영 배포는 하지 않았다. Astra 감사 세션은 사용자 쿼타 지시에 따라 종료했고 추가 Astra 호출은0이다.

현재 main과 동일 트리의91a2 소스에서427.39MB로 추정된 앱 누적 생성량은 후보791795bc에서364.00MB로 측정됐다. 이는64KiB 샘플링에 GC로 수거된 객체를 포함한 n1/소스 진단값이다. retained heap 감소, 누수 제거, 사용자 속도 향상으로 해석하지 않는다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 지도735개 확장 후60회 이동·복귀 | Chrome154.0.8037.98,390×844,CPU4,n2 새 프로세스/소스 | 자연 heap 프로세스별 중앙값의 중앙값 |33.029702MB|31.126388MB|1.903314MB 감소|5.7624% 감소|Before32.283172–33.776232/After30.909636–31.343140MB; 모집단 CI 없음|20% 회귀 가드 통과; 개선 입증 안 됨|warm-signature-matched-pilot-v1/raw.json|
| 같은 흐름 | 위와 같음;240개의 종속 주기 합계 | 자연 heap peak 중앙값 |46.664886MB|44.790858MB|1.874028MB 감소|4.0159% 감소|Before45.778996–47.550776/After42.844356–46.737360MB; CI 없음|20% 회귀 가드 통과; 개선 입증 안 됨|warm-signature-summary-matched-pilot-v1.json|
| 같은 흐름 | 위와 같음 |60회 종료 heap 중앙값 |44.601560MB|37.408004MB|7.193556MB 감소|16.1285% 감소|Before44.593516–44.609604/After37.062420–37.753588MB; 이전 다른 Chrome patch A/A22.15%; 현재 동일 patch A/A 없음|20% matched 가드 통과; original ca235 가드 해결 판정 보류|warm-signature-summary-matched-pilot-v1.json|
| 같은 흐름 | 각 프로세스의 유한 프레임 관측 |rAF gap p95 중앙값 |16.8ms|16.8ms|0ms(0.1ms 보고 해상도)|계산 안 함|사용자 p95가 아님; 작은 차이 보고 제외|15% 가드 통과; 프레임 개선 입증 안 됨|warm-signature-matched-pilot-v1/raw.json|
| 같은 흐름 | n1 새 프로세스/소스,60종속 주기; 프로파일러 켜짐 | 앱 self sampled allocation 합계 |427.388528MB|364.000784MB|63.387744MB 감소|14.8314% 감소|Poisson 추정; 반복 표본 부족, CI 없음; observer overhead 별도|할당 경로 진단; 메모리 회귀 해결/field 성과 아님|allocation-attribution-v2/raw.json;allocation-signature-values-v1/raw.json|

낮을수록 좋은 값의 절대 감소는before−after, 상대 감소는(before−after)/before×100이다. 겹치는 개선율을 합산하지 않는다. 기준선0 또는0.1ms 미만 프레임 차이에서는 비율을 계산하지 않는다. process n2와 내부60주기는 서로 다른 표본 단위다. 한 after 프로세스에서50ms를 넘는 gap1회(최대50.1ms), 다른 after에서는0회였다. before 둘은0회였다. long task는 양쪽0이다. 마커 누락·중복·추가 SDK map 생성·overflow는4×60검사 중0이었다. React commit/remount 횟수는 이번 pilot에서 측정하지 않았다. 이는 픽셀 플리커 탐지가 아니며 검은 사각형 완전 제거를 뜻하지 않는다.

원인·수정 원리: 실제 public chunk basename/line/column과 AST를대조해 map-render-guard의 makeDisplayIdsSignature 및 naver-map-render-plan의 token 생성 경로를 확인했다. 확대된 마커 토큰 배열은 새 객체로 만들어져 기존 WeakMap 캐시가 매번 miss였다. 새 구현은 마지막 문자열 배열의 값 snapshot1개와 canonical 문자열1개만 보유한다. 동일 ordered values는O(N)비교로 Set/sort/join을 건너뛴다. miss는 기존O(N log N)정렬과O(L)문자열 생성 후 snapshot을 교체한다. 메모리는O(N+L)이며 view history·DOM·식당 객체·callback은 보유하지 않는다. N은 토큰 수, L은 전체 문자열 길이다. 전체 렌더 경로의좌표·visit token 생성 비용은 여전히 남는다.

동일 배열을 직접 수정했을 때 이전 canonical 문자열을 반환하던 기존 테스트 계약도 수정했다. 추가·같은 길이 수정·축소·빈 배열·중복·순서·다른 view 개입 후 복귀를 검증한다. 기존 데이터와 디자인·접근성·security 경계는 변경하지 않았다. shared 단일 cache는 동시 view가 개입하면 miss가 날 수 있으나 정확성은 유지한다. snapshot 문자열은 다음 miss까지 강하게 보유되는 trade-off가 있다.

소스는791795bccea2e1f57173ca33cd76de6444df9f46, develop 기준5df2808c083c910b0b87ae7a2c4a24c5cbfbf166. 관련 unit25/83assertions, lint0, native7.0.2/compat6.0.2 parity0diagnostics/2449inputs, Next16.3.6 production build와route CSS gate를 통과했다. 실제 SDK/합성 REST 모바일 화면에서10개 동작 검사와4개의 trusted CDP 상세 스와이프를 통과했다. Chrome 데스크톱 엔진의 모바일 재현이며 실제 Galaxy·삼성 인터넷·field 성과를 대체하지 않는다. 오류 page0/console2는 양쪽에서 동일하게 관측했으나 raw provider diagnostics는 저장하지 않았다.

단계 구분: 로컬 소스·commit·tests·compiled rendering은 확인했다. 이 후보의 protected promotion·production 배포·운영·물리 휴대폰·field 성과는 미검증이다. 기존 ca235 대비warm endpoint+26.21%의20%가드 실패는 그대로 남겨두며, 이번 matched pilot이나 측정 후 강제GC로 면제하지 않는다. 현재 Chrome patch의A/A·충분한 독립 반복, original ca235 재대조, cold735/2000회귀, 휴대폰 사용 가능 후Chrome·삼성 인터넷 및운영 재검증이 남는다. 현재사용자 hold에 따라 휴대폰은 사용하지 않았다. 개인 사용자field 표본을 만들지 않았다. 이 후보에는 scorer·validator를 아직 실행하지 않았고 신규G003 측정을 admission하지 않았다. canonicalrelease 성과 승인은 미완료다.

재현 절차는 REPRODUCE-PILOT-v1.md, 환경/소스/build hash는candidate-source-and-checks-v1.json 및build receipt, 원본은각raw.json·sanitized trace/alloc profile에 보존한다. 이전 frozen1770개 파일과실패 증거를덮어쓰지 않았다. 작업 초기 dependency link 경로와 parity script 경로의setup오류는 corrected receipt에 명시했고 실제 성공 검사와 구분했다. Astra의 source-only matrix는 부분 결과이며 독립브라우저증명을 대신하지 않는다.
