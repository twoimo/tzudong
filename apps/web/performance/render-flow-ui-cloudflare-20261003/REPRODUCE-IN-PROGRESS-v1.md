# 재현 절차·경계

이 packet은 진행 중 기록이다. 완결된 운영 성과로 읽지 않는다. 기존 frozen render-flow-memory-lifetime-20261001 packet은 수정하지 않았다.

UI 소스는 bca48572eabd1f20eaf6ff529141c43460d25ad5이다. 별도 깨끗한 checkout을 사용하고 Node24.21.0·npm11.6.2·Bun1.4.0·Next16.3.5·Playwright1.62.1 pins를 유지한다. apps/web에서 npm ci를 사용한다. public logo.png와 assets/source-fonts 원본은 Git blob으로 검증한다.

이 실행 스크립트 폴더를 apps/web/performance/ 아래에 두고 다음 값만 제공한다: TZUDONG_UI_SOURCE_WORKTREE=해당 checkout, TZUDONG_UI_PUBLIC_CONFIGURATION_FILE=개인 로컬 build 설정 파일. 설정 파일은 JSON 문자열 값의 KEY=VALUE 형식으로 NEXT_PUBLIC_SUPABASE_URL·NEXT_PUBLIC_SUPABASE_ANON_KEY·NEXT_PUBLIC_NAVER_CLIENT_ID만 포함한다. 설정 파일이나 키 값을 packet·stdout·Git에 넣지 않는다. localhost:3000에서 사용 가능한 자신의 Naver client를 사용하며 인증 실패를 stub 성공으로 대체하지 않는다.

Node24로 build-portable-committed-ui-v5.mjs <소스SHA> <새 label>을 실행한다. 새 label과 새 output 디렉터리가 필요하며 기존 evidence/runtime을 덮어쓰지 않는다. 레거시 font GET/HEAD는307/no-store/빈 본문, POST는405이어야 한다. verify-public-font-v1.py는 credentialless HTTPS의 bytes/hash/CORS/range/cache status를 확인하고 body를 저장하지 않는다.

responsive-ui-v9는 UI geometry와 실제 remote SDK/tiles, synthetic735행을 검사했다. UI navigation/filter/detail 검증은 timer benchmark가 아니다. CSS dark class는 격리된 검사 context에만 주입해 실제 배경색을 확인했다. OS colorScheme만 요청했던v6·주입이 누락됐던v7 결과는 별도 correction으로 보존했다. 물리 Samsung forced-dark codec/compositor를 이 결과로 대체하지 않는다.

native-memory V7은 같은SM-S928N·기존삼성브라우저프로세스의 새 탭4개를 A1 B1 B2 A2로 실행했다. 탭마다60회 내부반복이며 n240명의사용자가 아니다. JS isolate heap이고 RSS/GPU 메모리는 아니다. forcedGC는없다. providerAPI away/return과 native swipe를 수행하며 foreground/visibility를 읽고 매10회만 화면을 캡처했다. 사진간 짧은 플리커·장기누수 부재를 증명하지 않는다. After735개 SDK set·Before513개 padded set의 trade-off를 유지하고 같은 padded513 membership을 확인한다.20%고정회귀한도를 바꾸지 않는다.

field histogram은 metric instance 집계다.13개 current metric instance가 독립사용자13명이라는 뜻이 아니다. 현재mobile n1/metric의CLS[.12,.13),INP[2736,2752)ms,LCP[6000,6100)ms는추가진단baseline이며개선율·CI·p75/p95를계산하지않는다. 합성데이터를field에전송하지않는다.

CI WindowsBun 실패 receipt는 warmup sampler gap86.8554ms가60ms한도를초과한건이다. 기준은보존하며한작업만재실행요청했다. 거부된evidence를성능회귀/개선표본으로채택하지않는다. Git evidence checkpoint037f66ec는366개관련artifact blob을확인한중간보존이며최종canonical score·maps/pins·운영검증보고서가완료됐다는선언이아니다.
