# 재현 및 보존

이 패키지는 main056a86600f412eb42df4304e3206841679012f3e와 로컬81d5aca4951e7cef5d67c1e910f31b3436597466의 비교다. 후보는 아직 채택·승격·운영 배포하지 않았다. 결과는 REPORT-v1.md와 outcome-v1.json에 있다.

통계만 다시 확인하려면 전체 패키지를 새로운 임시 디렉터리에 복사하되 browser-confirm-summary-v7.json을 그 복사본에서만 제외한다. Python3.12.14로 복사본의 aggregate-browser-v7.py를 실행한다. 원본 요약 SHA는 9b68f7cb61ea92c4c307c5a049b42f8a1f766a2d15be787ae8376ac3ad8f6e37이다. -O로도 같은 바이트를 계산한 영수증이 independent-statistics-rerun-v1.json에 있다. 통계 스크립트는 새 출력만 만들며 기존 출력이 있으면 중단한다. 보존된 원본에서 출력이나 원자료를 지우지 않는다.

브라우저 재실행은 별도 새 evidence root에서 수행한다. 두 소스 커밋을 별도 체크아웃하고 Node24.21.0/npm11.6.2/Next16.3.8/Chrome154.0.8037.98/Playwright1.63.0을 유지한다. production Webpack 빌드와 실제 distDir의 CSS gate를 통과한 BUILD_ID·lock·helper 해시를 새 build-receipts-v7.json에 기록한다. 기존 영수증을 새 빌드의 영수증으로 재사용하지 않는다. 운영자의 기존 환경에서 필요한 네 개 공개 설정만 빌드로 전달하며, 값·키·서버 설정을 증거에 쓰지 않는다.

browser-confirm-plan-v7.json은 측정 전 고정했다. fixture v7 SHA346c9c865201a48b590c439a4e06306bfada92f91c73f9a83293a991a51058b5, REST735/Auth401 합성, SDK SHA802f8c5bb436eeb0014e0e8c72e7f675ae88e102766d2a923cd2c24c7eca74d1을 확인한다. SDK나 fixture가 달라지면 기존 결과에 섞지 말고 새 조건의 계획부터 만든다. origin은 허용된 http://localhost:3000이고 보안 헤더를 유지한다. CSP가 upgrade한 소유 루프백 GET 자산만 동일한 HTTP 빌드에서 제공한다. 원격 SDK와 타일을 모의 객체로 바꾸지 않는다.

3000 포트가 비어 있는지 확인한 뒤 pinned Node로 run-browser-series-v7.mjs를 실행한다. 다른 작업의 서비스를 종료하지 않는다. 자체 build/test/profiler/forcedGC 없이 AA4·AB9쌍의 고정 교차 순서를 지킨다. CPU4/cache disabled/SW bypass/390×844/dpr1/원격 네트워크 무감속이다. 한 실행 안 검색128개와 같은128개 재방문은 종속 동작이다. 독립 실행과 독립 사용자를 혼동하지 않는다. 20% heap·15% latency guard를 유지하며 결과를 본 뒤 제외·임계값을 바꾸지 않는다.

canonical-zero-v1/basis.json에 실제 scorer와 validator 인수가 있다. 재계산은 새로운 복사본에서 기존 scored 출력·sidecar·validate map을 제외하고 실행하며 새 artifact-root·실제 map SHA를 지정한다. 후보 커밋·tree·plan·fixture·health 연결을 유지한다. 현재 budget에 heap metric이 없어 items0/admitted0이고, 오류 관측 때문에 releaseBlocked=true다. exit0은 성능 또는 릴리스 통과가 아니다.

raw.json은 고정 분류와 집계만 보존했다. 개인정보·키·쿠키·헤더·실사용자 응답은 저장하지 않았다. 88개 정지 캡처는 합성 맛집 화면이며 영상이나 플리커 빈도 증거가 아니다. SDK console44·network288은 서로 중복 가능하다. 물리 Galaxy·삼성 인터넷·field·운영 성과로 확대하지 않는다.

artifact-map-v1.json의 별도 pin은 docs/evidence/query-callback-memory-primary-20261012-v2.md에 있다. 독립 verifier는 backend/bin/verify_query_callback_memory_primary_20261012.py이며 --root로 보존된 다른 위치를 검사할 수 있다. 지도·trace의 추가 진단은 이 frozen root에 덧붙이지 않고 새 root에 저장한다.
