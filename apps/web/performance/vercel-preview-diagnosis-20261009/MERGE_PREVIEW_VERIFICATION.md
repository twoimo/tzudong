# develop merge preview · 실제 READY/읽기 검증

Exact Git-integrated deployment **dpl_He2HgNHEkNsdbQg556dGJsreTEgr**는 최종 재조회에서도 READY였다.

URL: [merge preview](https://tzudong-76i12vmwe-twoimos-projects.vercel.app)

Project/team: `tzudong / prj_sau35J5uUtShIQ9OKofRtOVVnTSl / team_OUj64KeLxJI3PkEbOaFZnorA`.

Git ref/SHA: `develop / 614b249175c35636a7062bf05cb01ebad538b10d`. 처음 BUILDING으로 발견한 **같은 ID**만 재조회했다. helper는 배포를 만들거나 재배포하지 않았다.

## Source/test와 preview의 연결

GitHub Git Commit API에서 후보56819502aaa6993d847efb8b78a5bcd6a4ecdaf2와 merge614b2491의 tree가 모두 `f4c18d5f74a722947eeb063ec1e304602e588beb`임을 확인했다. Root의 기존 source/test 증빙을 같은 committed source tree로 연결할 수 있지만 환경/데이터까지 같다는 뜻은 아니다. source/tests, Git preview, production 반영은 별도 단계다.

## 실제 HTTP 읽기

공식 `vercel curl` full-URL 경로로 공개·계정22경로 및 익명관리자5경로, 총27GET을 확인했다. existing automation credential을 공식 인증된 project GET에서 메모리로만 사용했다. 새 protection token을 만들지 않았고 process-only credential으로 CLI 자동token 생성 경로를 피했다. raw project JSON/환경값/키, raw headers/body, cookies/session은 저장하지 않았다.

| 범위 | 결과 |
| --- | --- |
| 공개/계정22개 inventory | HTTP200×13, 로그인/권한 경로307×8, 무효 공유링크404×1 |
| 익명 /admin |307, 홈의 로그인 intent로 이동 |
| 익명 graph/users/pipeline/refresh-history API |모두401 Unauthorized + no-store |
| Vercel 보호페이지가 대신 응답했는가 |27개 모두아님. 실제앱응답 |

`merge-preview-http-routes.json`에 path/status/cache/header분류/byte수만 있다. account redirect와 missing-resource 결과를 실제인증데이터 성공으로 대체하지 않는다. 별도 음성 control `/login`은 source에 없는 경로라404였으며 실제로그인은 홈AuthModal이다. 이를 source/UI 결함으로 보고하지 않았다.

## 실제 브라우저 읽기

새 소유 headless Chromium의 desktop1440×1000/mobile390×844에서 실제preview의 로그인Modal·기존logo/브랜드·viewport bounds, 개인정보처리방침 렌더, 익명admin→홈로그인intent, privateadmin canvas 미노출을 확인했다. 입력credential/GoogleOAuth를 시작하지 않았다. login패널만 캡처해서개인정보를피했다.

인증header는 exactpreview origin에만추가했고 외부origin에는전달하지않았다. browser쓰기와websocket도막았다. 실제 mutationforward0. pageerror0. 외부dependency17개를의도적으로차단한환경에서는 consoleerror23개가수집됐으므로 ‘모든console오류없음’/지도SDK·타일·전체feed/liveclientdata 정상/전수접근성 완료를주장하지않는다. HTTP200은22경로의전체dataflow 성공증거가아니다.

첫브라우저 실패는 /admin redirect의 login query를빼고URL정확일치로기대한검사였다. source의실제intent `/?auth=login...`를확인해 sameorigin/rootpath/auth=login과privatecanvas없음을함께검사했고통과했다. 첫실패결과도보존했다.

## 아직 없는 관리자 인증과 production 증거

Vercel보호접근은통과했지만 **애플리케이션 OAuth관리자 세션은없다**. 현재 `requireAdmin`은 Supabase사용자, active-current-session RPC, adminrole, activeaccount를요구한다. 이preview origin에서이조건을만족하는실제operator세션으로허용된관리자읽기를확인해야한다. 세션/쿠키/키를추출하거나artifact로export하여해결하지않는다. actualadmin rows/전체sidebar실데이터흐름은미검증이다.

새preview생성·설정변경·remoteenv/freeze 변경·data/main 승격·운영쓰기/모델호출은하지않았다. 이mergepreview는production adoption증거가아니다.

## CLI 자동link 문제와 종료

CLI56.5.0의 `project inspect --non-interactive`가예상과달리오래된web프로젝트로로컬auto-link2파일을생성했다. 생성시각/birthtime/내용/SHA를검증해private recoverybackup을만든뒤새로생성된2파일만제거했고원래unlinked상태로복구했다. gitignore는변경없다. CLI의path-only/cwd resolution을재사용하지않고이미검증한 fullpreview URL과existing credential만사용했다. 자세한receipt는 `cli-inspect-auto-link-recovery.json`이다. 이자동localwrite를‘전혀쓰기없음’으로숨기지않는다.

HTTP/browser runner는모두종료됐고browser.close 완료. user탭/기존서비스/원본/prod/freeze는보존했다. 기존 canceled-deployment진단도historical증거로유지했다.
