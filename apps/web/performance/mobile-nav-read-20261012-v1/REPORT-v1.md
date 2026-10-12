# 네비게이션 높이 직접 읽기: 단독 시도

후보0b5cb0a20fefda86e3eb1712dc39c5af89c4c514는 main056a에서3개 파일만 수정했다. query callback 후보81d5와 합치지 않았다. 관련44테스트·린트·native/compat parity와production Webpack·실제 CSS gate가 통과했다. 생성된 tsconfig include만 별도로 보존하고 복원했다. source promotion/운영 배포는 없다.

네비게이션 producer가 쓰는 현재 inline pixel 값을 읽고, 없거나 CSS 표현식이면 기존 computed 값으로 돌아간다. 자료구조/캐시/표시 데이터/동작 지연은 추가하지 않았다. helper 테스트는 숨김0·표시60·높이72.25 변경, 초기 stylesheet, var/calc/rem, invalid/negative 값의 기존fallback을 검증했다.

실제 SDK의16동작 diagnostic에서 inlineNavHeight50회는 합계0.100ms, computedNavHeight0회였다. 그러나 visualViewport.height218회는324.200ms를 사용했다. production profile에서 계산 비용은 offset callback의 다음 geometry 읽기로 이동했고 UpdateLayoutTree 비용은 남았다. 이 단독 수정으로 사용자 체감 속도가 개선됐다고 인정하지 않는다. 후속 후보723e는 viewport resize/pageshow/visibility에서 값을 갱신하고 선택 중에는 읽는 방식이며 별도 root에서 검증한다.

프로파일·getter wrapper는 시간을 바꿀 수 있다. 이16동작을 자연 상태 primary나 실제 사용자의 field 표본으로 집계하지 않는다. 고정20%heap/15%input guard를 바꾸지 않았고 아직 이 후보의 primary/admission은0이다. 물리기기는 사용하지 않았다. 실제 SDK script SHA802f8c5bb436eeb0014e0e8c72e7f675ae88e102766d2a923cd2c24c7eca74d1, 보고 버전null이다. pageerror0/console2는 제한된 관측이며 CSP를 넓히지 않았다.
