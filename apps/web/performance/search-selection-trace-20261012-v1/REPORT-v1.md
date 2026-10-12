# 검색 선택의 비용 진단

main056a와 query callback 후보81d5에서 각각 첫8검색+같은8재방문을 수행했다. 실제 Naver SDK/타일, 합성REST735/Auth401, productionNext16.3.8, CPU4, Chrome154, 390×844/dpr1 조건이다. CDP CPU sampling1000µs와 trace를 켰으므로 primary 비교에 합치지 않는다. 단일 실행의 차이를 통계적 개선으로 주장하지 않는다.

v1·v2 기록은16동작을 완료했지만 trace 수집이32MiB의 RAM 상한을 넘어 실패했다. 원자료와 실패를 보존했다. v3은 중복 V8/toplevel 기록을 제외하고 devtools.timeline·blink.user_timing을 사용했고, 같은16동작과 기록을 완료했다. v4는 공개 JS chunk basename의 점 구분자를 허용해 코드 위치를 연결했다. 버전별 실행은 합산하거나 동일 프로파일이라고 취급하지 않는다. raw trace args/URL/코드/요청/키는 저장하지 않았다.

v4에서 기존 소스와81d5의 SDK setter 호출 수는 동일했다: setIcon638, setMap1055, setPosition587, setZIndex190. 따라서 query callback 분리는 이 경로의 SDK churn을 줄이지 않았다. 루트의 CSS custom property를 읽는 NaverMapView callback 경로에 getPropertyValue sampled self181.598ms(main)/196.805ms(81d5)가 연결됐다. UpdateLayoutTree complete-event 합계는596.114/617.500ms였다. 타임라인 이벤트는 중첩되므로 FunctionCall/EventDispatch/Layout 합계를 더해 전체 시간을 계산하지 않는다.

attribution JSON은 프로파일 위치와 production AST의 고정 API 토큰을 연결하며 코드나 literal 값을 남기지 않는다. 이 결과는 nav 높이 읽기를 먼저 조사할 근거이며 DOM 노드나 실제 플리커 제거를 증명하지 않는다. 다음 단계는 mobile-nav-read-20261012-v1의 단독 시도와 mobile-viewport-height-20261012-v1의 후속 시도다. 모두 독립 root로 보존하고 원래 primary는 변경하지 않았다.
