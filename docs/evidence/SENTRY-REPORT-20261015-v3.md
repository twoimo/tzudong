# Tzudong Sentry 연결 결과 · 2026-10-15

기존 `tinyburn-data-lab` 조직에 `tzudong` 프로젝트를 연결했고, 수정 소스를 보호된 `develop → data → main` 순서로 전달했다. main은 `275fb4bedcaabfe151658acebeaf4611d9db9115`이다. 실제 Sentry 수신과 버전 식별은 로컬 production 빌드와 보호된 Vercel preview에서 확인했다. 운영 주소의 활성화는 기존 리뷰 DB 선행 작업 때문에 보류돼 있다.

| 검증 | 환경·독립 표본 | 결과 | 증거 |
| --- | --- | --- | --- |
| 브라우저 오류·개인정보 | Chrome 155, 1440/834/390 너비, 각각 새 context 1개 | 동일 이벤트 ID 3/3 수신, 테스트 원문·사용자·IP 0/3 | `sentry-activation-20261015-v1/browser-smoke-v5.json` |
| 브라우저 버전 식별 | 같은 세 너비, 수정된 production 빌드 | 이벤트 ID·Git SHA 3/3 일치 | `sentry-release-binding-20261015-v1/local-release-smoke-v1.json` |
| 서버 초기화 | Node 24.21.0, 실제 서버 설정, 합성 오류 1개 | ID·SHA 일치, 개인정보 원문 없음 | `sentry-release-binding-20261015-v1/node-source-init-v1.json` |
| 실제 배포 preview | Vercel READY, SHA `da65ba93`, 390×844 새 context 1개 | ID·배포 SHA·preview 환경 일치, CSP 거부 0 | `sentry-preview-release-20261015-v1/preview-release-smoke-v2.json` |
| 관리자 조회 함수 | 실제 Sentry API, 조회 1회 | connected, 오류 그룹 2개 | `sentry-activation-20261015-v1/admin-live-feed-v2.json` |
| 보호된 소스 승격 | PR #3205–#3212 중 관련 승격·보완 PR | main #3209 병합, 강제·관리자 병합 없음 | GitHub PR 및 delivery JSON |

처음에는 환경값이 없었고 CSP가 수집 주소를 허용하지 않았다. 정확한 수집 origin 하나만 추가했고 wildcard 허용이나 script 정책 완화는 하지 않았다. 첫 preview에서 Git SHA가 빠지는 문제를 실제로 발견해 기존 Next env 객체에 빌드 SHA를 명시적으로 넣었다. 패키지 버전·계정명·짧거나 잘못된 SHA는 거부한다.

SDK 11.4.0의 기존 개인정보 필터를 유지했다. 사용자·쿠키·요청 본문·원문 검색·OCR·AI 입출력·첨부·원문 오류 메시지는 수집하지 않는다. 서버 IP 저장과 source scraping도 막았다. Replay, tracing, profiling, 로그 수집은 꺼져 있다. 하루 100건 상한을 설정했으며, 초과 오류는 누락될 수 있다. 읽기 토큰에는 `event:read`만 주고 server-only로 저장했다. source map 업로드는 별도 CI 토큰이 없어 미설정이다. 결제·유료 플랜 변경은 0건이다.

관련 검사 41개, root-layout 6개, SHA 연결 관련 검사 15개, lint, native/compat TypeScript parity, production build와 CSS gate를 통과했다. 같은 검사 반복을 독립 표본으로 세지 않는다. 개인정보 판정은 지정된 합성 원문과 저장된 이벤트 필드에 대한 검사이며 모든 가능한 개인정보 유출 경로의 증명은 아니다. Edge는 소스·타입·빌드 검사만 수행했다. production CMS 로그인 검증과 물리 휴대폰 검증은 포함하지 않는다.

CI의 RSS 샘플 간격 100.46ms가 사전 기준 60ms를 넘은 실패를 원시 자료와 함께 보존했다. 같은 소스의 해당 작업만 1회 재실행했고 CI는 통과했다. 독립 validator는 `inconclusive_noise`, admitted 0개를 반환했다. 이를 컴파일러·UI·메모리 성능 향상으로 해석하지 않는다. 두 hosted artifact 11920019337/11921368124가 모두 남아 있다. 첫 preview의 SHA 누락과 이후 수신 timeout도 성공 결과와 별도로 보존했다.

운영은 여전히 `1884f87e53c4567ead7c9a0fb394b09b91a70396`, READY `dpl_EUxJnWmDDozCSMWb2sqNSPgKJLM5`다. 운영 승인 SHA는 바꾸지 않았다. 새 main의 Git 배포는 기존 보류 경로에 따라 CANCELED됐다. 기존 리뷰 SQL·불확실한 operation UUID·private verification 이전을 위한 직접 PostgreSQL 접속 설정, rehearsal, writer fences, 적용/readback이 필요하다. 알려진 local env와 process에는 필요한 DB 접속값이 없고, 기존 설정 위치 요청은 아직 미해결이다. 여기서는 DB·Storage·producer·폰·운영 배포를 변경하지 않았다.

필수 main Release/Promotion은 통과했다. 추가 main CI가 진행 중이면 그 최종 결과도 확인해야 한다. 원래 메모리 20% guard와 실제 사용자 field 평가는 남아 있다. Sentry 이벤트는 전부 합성이므로 운영 활성화 이전 이벤트 전체와 저장된 test IDs를 실제 사용자 cohort에서 제외해야 한다.

모든 원자료는 `apps/web/performance/`의 버전별 packet과 별도 SHA256 pin으로 보존했다. 초기 84개 원격 blob은 로컬과 크기·SHA256이 같았다. 추가 CI 재실행 자료는 별도 packet으로 보관한다. 현재 보고서·작업 목록은 evidence-only branch에 있으며 release 소스의 운영 문서는 불변 커밋 링크로 연결한다. 기존 실패와 packet은 덮어쓰지 않았다. 이 채팅의 첨부 상한 100개 때문에 후속 PR은 링크로 확인한다.

다음 운영 단계는 DB 선행 조건의 실제 검증, 승인된 main의 deployment/alias/asset readback, production 오류 ID·SHA 수신과 관리자 화면 검증이다. field/메모리/원래 전체 목표는 별도 완료 조건으로 유지한다.
