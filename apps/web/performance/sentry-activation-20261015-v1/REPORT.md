# Sentry 연결 결과 · 2026-10-15

Sentry 조직 `tinyburn-data-lab`의 `tzudong` 프로젝트와 실제 전송·수신을 연결했다. Next.js의 기존 SDK 11.4.0과 개인정보 필터를 재사용했다. 실제 Vercel 프로젝트의 production·preview 환경값 7개를 설정했고, 읽기 토큰은 `event:read` 하나만 허용한다. 소스는 PR #3205에 있으며 운영 배포와 구분한다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CSP 수집 경로 | production proxy, 결정적 회귀 | 정확한 ingest 호스트 허용 | 실패 | 통과 | 허용 경로 1개 | 계산 안 함 | 기능 검증 | 수정 | csp-before-test.txt, affected-tests-v1.txt |
| 브라우저 오류 | local production build, Chrome, 1440/834/390 각 독립 context 1개 | 동일 event ID 실제 Sentry 조회 | 실제 연결 미구성 | 3/3 HTTP200 조회 | — | 계산 안 함 | 성능·성공률 모집단 추정 아님 | 통과 | browser-smoke-v5.json |
| 브라우저 개인정보 | 위 합성 이벤트 3개 | 이메일/IP/합성 원문 잔존 | 비교 표본 없음 | 0/3 | — | 계산 안 함 | 지정 sentinel 탐지 한계 | 통과 | browser-smoke-v5.json |
| Node 오류 | Node24.21.0, SDK11.4.0, 합성 1개 | 동일 event ID 실제 Sentry 조회 | 실제 연결 미구성 | 1/1 HTTP200 조회 | — | 계산 안 함 | 독립 SDK; deployed Next route 오류 아님 | 통과 | node-live-smoke-v2.json |
| 관리자 feed 함수 | 실제 issue API 1회 | 상태/그룹 수 | not_configured | connected/2 | 연결 1개 | 계산 안 함 | production CMS 로그인 검증과 구분 | 통과 | admin-live-feed-v2.json |
| 수집 상한 | 실제 프로젝트 key API | 오류 수집 상한 | 없음 | 100/86400초 | 상한 설정 | 계산 안 함 | 초과 오류는 누락됨 | 적용 | project-settings-readback-v1.json |

로그·트레이스·프로파일·리플레이·세션·첨부 수집은 기존 코드와 검사로 차단한다. SaaS의 IP 저장 차단, 기본 scrubber, TLS 검증, source scraping off, SDK loader의 tracing/replay/logs off를 직접 readback했다. 자동 이메일 alert는 만들지 않았다. Billing 화면은 Trial/결제 수단 없음이며 결제·플랜 변경은 0건이다. 표시된 $5,000을 공식 스타트업 승인이라고 단정하지 않는다. 하루 100건 상한은 노이즈 폭주를 줄이는 운영 한도이며 누락 없는 오류 통계를 보장하지 않는다.

CSP 변경은 유효한 설정의 정확한 Cloud ingest origin만 추가한다. wildcard, DSN public key, 새로운 script-src/unsafe-inline/unsafe-eval 허용을 추가하지 않는다. Proxy에 SDK runtime을 import하지 않는다. 환경값과 토큰은 Git·증거에 없으며 읽기 토큰을 source-map 업로드에 재사용하지 않는다. 별도 CI upload token과 sourcemap 업로드는 미설정이다. 원문 오류 메시지/URL/request/user/DB/OCR를 버리는 기존 정책 때문에 오류 유형·허용된 코드 프레임·그룹 수 중심으로 진단한다.

관련 41개 검사와 root-layout 6개, 최종 개인정보 5개, targeted lint, TS native7.0.2/compat6.0.2 parity, production build와 named-dist CSS gate를 통과했다. 같은 검사 반복 표본을 독립 UI 표본으로 계산하지 않는다. CSS 결과: home195887/general369820/admin382583/deferred195887 bytes. 원래 목표의 heap/INP/LCP/CLS 개선이나 physical Galaxy/field 성과로 해석하지 않는다.

실패 보존: v1은 없는 /login 경로 때문에404/버튼 timeout, v2는 브라우저 response 관찰 timeout, v3은 event:read-only token에 맞지 않는 project event endpoint403, v4는 harness의 native Response.status 함수 호출 오류였다. 실제 앱 소스나 권한을 느슨하게 하지 않고 실제 /auth/required 화면과 공식 organization issue-event 조회로 고쳤다. Browser HTTP POST response 자체는 관찰되지 않았으므로200 전송 응답을 주장하지 않는다. 정확한 event ID의 SaaS 조회200으로 수신을 확인한다. 브라우저 전송 envelope에서 비밀 sentinel 탐지 0, pageerrors는 각 의도한 TypeError1개이며 주입 전0개다.

모든 새 프로젝트 이벤트는 이 검증의 합성 트래픽이다(대시보드 마지막 확인 TypeError8/RangeError2). 실제 사용자 field cohort에서 첫 운영 활성화 이전 이벤트 전체와 확인된 synthetic IDs를 제외해야 한다. 원시 이메일/쿠키/인증값/heap/응답 본문/원본 Aside transcript는 저장하지 않았다. 화면은 익명 auth-required UI의 정적 PNG 3개이며 플리커 영상이 아니다.

보호된 source promotion, 전체 관련 CI, 새 main의 기존 운영 DB 의존성 검증, exact-SHA deployment 및 deployed app 오류 수신은 남은 전달 단계다. 현재 운영 alias는1884f87e이며 이 수정의 운영 완료를 뜻하지 않는다. 배포 hold와 원래 메모리·field·미적용 SQL 작업을 이 연결의 성공으로 면제하지 않는다.

재현: 환경과 secret을 Git 밖 private runtime에 공급한 후 저장된 browser-smoke-v5.mjs를 검증한 production build/owned localhost3003에서 실행한다. Node smoke는 pinned Bun build --target node --packages external 후 pinned Node24로 실행한다. 관리자 standalone 검사는 Next의 server-only sentinel만 test stub으로 대체하고 실제 함수·token·HTTPS transport를 사용했다(권한 route는 기존 isolated tests로 별도 검사). 모든 기록은 functional evidence이며 before/after 성능 실험은 아니다.

공식 참고: [SDK 옵션](https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/) · [event:read 지원 issue event API](https://docs.sentry.io/api/events/retrieve-an-issue-event/).
