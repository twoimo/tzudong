# 재현과 증거 경계

Node24.21.0·Bun1.4.0·Next16.3.5·Sharp0.35.4·설치된 Chrome154.0.8037.97 및 repository npm11.6.2 pins를 유지한다. source PR은3100/3101/3103/3105/3104/3102, 최종 main은3aebb1c6f446250fd49fceac5f1a4ccac2f5d8f0이다. final main의 apps/web tree는 실제 빌드한 f85b638c0149ba2d63e70a620ee1988928b3a148 및 원본 tested0acb tree와 동일하다. 실험 memory dirty files는 archive/build/promotion에서 제외했다.

1. full-history checkout과 프로젝트 pins를 준비한다. `scripts/generate-brand-png.mjs`는 원본 PNG에서 content-addressed 파생을 만든다. 같은 bytes는 no-op, 다른 bytes의 기존 파일은 거부한다. decoded 검사 및 실제 HTTP receipt의 sha/bytes/alpha를 비교한다.
2. 별도 복사본에서 `TZUDONG_UI_SOURCE_WORKTREE=<checkout> TZUDONG_UI_PUBLIC_CONFIGURATION_FILE=<private public-build-settings>`와 `node build-portable-committed-ui-v5.mjs <sourceSHA> <fresh-label>`을 사용한다. public 설정3개 값/실제 credentials는 evidence에 저장하지 않는다. source Git archive, source inputs, build ID·로그·font hash를 보관한다.
3. 새 출력명을 사용한 owned port3000 runtime에서 `verify-original-derived-png-ui-v11.mjs`를 실행한다. 보관된 v11는 logo-v7 receipt에 결속되어 있으므로 다른 빌드에서는 참조/출력명도 새 이름으로 바꾼 별도 복사본을 사용한다. remote SDK/tiles는 실제이며 REST/auth는 합성 fixture다. localhost HTTPS upgrade는 동일 owned build의 GET transport만 대체하고 CSP를 보존한다. SDK 인증용 포트를 무단으로 바꾸지 않는다.
4. `verify-ui-production-v1.mjs`는 preserved deployment receipt와 실제 www HTTPS·PNG hash/bytes·FontFace·8기하/alpha 조건을 확인한다. 새 배포 검사에서는 복사본의 정확한 SHA/receipt/output label을 갱신한다. 원시 response/request/개인 프로필을 저장하지 않는다. saved image는 익명 검색 로고 crop만이며 CSS dark와 기기 강제 dark를 구분한다.
5. `diagnose-live-console-bounded-v1.mjs`의 새 출력명을 사용해 오류의 고정 분류/상태를 확인한다. arbitrary messages, bodies, headers, URL query는 버린다. current UI pass는 전역 console health0을 뜻하지 않는다.
6. Cloudflare의 `verify-public-font-v1.py`를 별도 packet 복사본/새 출력명으로 실행하면 credentialless HTTPS의 정확 bytes/hash, GET/HEAD/OPTIONS/Range/CORS/cache 상태를 확인할 수 있다. 기존 업로드·domain 연결·CORS 저장·custom purge·cache rule을 재실행하지 않는다. 각 외부 write에는 preview와 독립 readback이 있으며 기존 bucket의 public access가 이미 Enabled였음을 baseline에서 확인한다.
7. protected promotion/guard/deploy receipts는 실행 증거이지 향후 자동 mutation 허가는 아니다. 원래 dirty checkout과 frozen evidence를 reset/stash/clean/overwrite하지 않는다. 마지막 www alias, 현재 project, rollback과 정확한 source를 다시 읽는다. sensitive guard는 비활성화하지 않는다.
8. 최종 artifact-map과 디렉터리 밖 pin으로 파일 집합·크기·sha를 검사하고 evidence Git commit의 blob bytes와도 비교한다. raw logs/patches의 자연 whitespace는 고치지 않는다. frozen packet에 새 파일을 덧붙이지 않고 후속 packet을 만든다.

속도/field 주장, physical Galaxy, 원시 개인 내용 및 운영 관리자 변경은 이 UI 재현의 범위가 아니다. mobile-retain 실험의 scripts/plans/raw/statistics는 ../render-flow-native-memory-final-20261003에 따로 보존한다. 이전 frozen canonical packet의 source/health/zero-admission은 새 UI 결과로 바꾸지 않는다.
