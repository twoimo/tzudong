# 마커 ID 재사용 후보: 채택하지 않음

0437dd27 후보는 풀 용량1000을 유지하면서 WeakMap으로 이전 ID를 찾아 재사용한다. 획득이 기존 O(1) pop에서 O(P) findIndex/splice(P≤1000)로 바뀐다. 추가 약한 메타데이터는 풀의 최대 P개 marker에 한정된다. 실제 16동작 프로파일에서는 setIcon638→633, setPosition587→582로5회씩만 줄었다. 프로파일 시간은 단일 독립 실행이며 성능 증거가 아니다.

Node24.21.0/npm11.6.2/Next16.3.8/Chrome155.0.8059.40, CPU4,390×844/dpr1, cacheoff/SWbypass, 합성735 REST/Auth401과 실제 remote SDK/tiles. SDK script SHA802f8c5bb436eeb0014e0e8c72e7f675ae88e102766d2a923cd2c24c7eca74d1. baseline056a8660/buildbCb62_hmbOJndVfvPKnhI; candidate0437dd27/buildOeHAhHBkEo53NHb6HGyho.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 감소 | 상대 감소 | 노이즈·신뢰구간 | 판정 | 증거 |
|---|---|---|---|---|---|---|---|---|---|
| 검색 결과 선택 | production 독립1쌍, 각16종속 동작 | click→2RAF 관찰 median ms |192.60|169.05|23.55|12.23%|n1; CI 불가. 별도 baseline177.20ms|개선 입증 안 됨|ui-natural-before/after-v1/raw.json|
| 동일 탐색 | 같은1쌍, 자연 상태 | 종료 JS heap MB |26.088944|25.747340|0.341604|1.31%|두번째 baseline24.438540MB; CI 불가|회귀 guard 미평가|동일 raw|
| 동일 탐색 | 같은1쌍,5초 idle | JS heap MB |27.282392|26.979192|0.303200|1.11%|두번째 baseline25.717020MB; CI 불가|회귀 guard 미평가|동일 raw|

역순 candidate(ui-natural-after-v2)는0동작으로 실패했다. 종료/idle heap은 미측정이며0이 아니다. 대응 baseline v2는 성공했지만 완전한 쌍이 아니므로 좋은 결과만 골라 합치지 않는다. 추가 startup ABBA 진단4회 중2회 실패. runtimev9~12는 안전한 분류·CDP local asset 타임라인을 추가하며 기존 실패를 덮어쓰지 않았다.

CSS LINK error의 target은 marker stylesheet a6fc645b5cccf57e.css(624B)였고 브라우저가 canceled로 보고했다. 최종 sheet는 존재했다. 이 관찰만으로 app/Chrome/하네스 중 원인을 단정하지 않는다. Naver connect-src CSP 오류도 따로 남아 있다. 이후 별도 sibling marker-style-readiness 후보에서 live SDK 실패 시 자동 stub 전환이 관찰되어 source 수정 작업을 분리했다.

Candidate tests3455pass/11skip/0fail, focused32pass, lint/parity, production/CSS pass는 소스 동작 검사다. 성능 admission0, primary22process 미착수, 배포0/field0/물리0. 오래된 Chrome154 결과와 이 Chrome155 수치를 동일 조건 비교로 합치지 않는다. 원래 guard20% heap/15% latency 유지.

재현: 보존 Git의056a/0437을 각각 격리한 checkout에 준비하고 build-owned-v1.mjs의 기존 owned roots 및 exact commit 확인 후 npm11.6.2 ci와 production build를 실행한다. 비밀값은 기존 환경에서 RAM으로만 읽고 허용된 공개 build설정4개만 전달한다. 서버 localhost3000이 비면 serve가 해당 build만 소유한다. measure-ui-error-pilot-v2.mjs <baseline|candidate> <새-고유-label> 8 2를 고정 ABBA 순서로 실행한다. 기존 output 이름으로 덮어쓰지 않는다. 이는 파일럿 재현 절차이며 새로운 primary 연구의 사전 계획을 대신하지 않는다.
