# Exact Vercel preview 취소 원인 · 2026-10-09

**확인된 원인: 두 Git preview의 Ignored Build Step이 허용되지 않은 feature branch를 의도적으로 skip(exit0)하여 취소했다.** 현재HEAD56819502aaa6993d847efb8b78a5bcd6a4ecdaf2의 build/runtime 실패로 해석하면 안 된다.

공식 Vercel MCP get_project에서 `tzudong / prj_sau35J5uUtShIQ9OKofRtOVVnTSl / team_OUj64KeLxJI3PkEbOaFZnorA / Node24.x`를 확인했다. 두 get_deployment의 project ID/name과 exact Git SHA를 다시 대조한 뒤 해당 ID의 finite events를 읽었다. Deployment creator, commit message, 환경값/키, password/protection 값, raw logs는 기록하지 않았다.

| Git SHA | Deployment | 실제 Git ref | 실제 결과 |
| --- | --- | --- | --- |
|99b1256297db3619c10b3d4e7fa3b108b4bdef5f|dpl_G2kimSeJAxdU3FoBxg7nabEwVSeC|codex/pipeline-performance-restart-20261002|CANCELED, source=git |
|2b6e7339fa75b1d403cb97a257e8d9d5b8b37e3c|dpl_2anRkLjU4RPxtTkTLbnybUnBVoGb|codex/pipeline-performance-restart-20261002|CANCELED, source=git |

각각12개 events를 받아 실제 stdout에서 다음 고정 정책 문구를 확인했다:

`[vercel-ignore-build] skip: preview deployments are limited to develop; skipping non-production branch (env=preview, ref=codex/pipeline-performance-restart-20261002)`

그 직후 stderr 취소 이벤트에는 Ignored Command와 exit0가 함께 명시된다. `deployment-events-sanitized.json`은 이 stdout 및 취소/exit0 markers와 timestamp만 기록한다. 요청은 follow0/limit100이며 두 response 모두12 events였다. 조회한 로그에는 npm ci/npm run build/app compiler 완료가 관측되지 않았다. Main app build 실행의 성공/실패 검증으로 대체하지 않는다.

## Source 대조와 공식 의미

두 과거 SHA의 `apps/web/scripts/vercel-ignore-build.mjs`, `apps/web/vercel.json`은 현재56819502의 파일과 바이트가 동일하다. script는 preview ref develop만 허용하고, 그 외 feature/missing-ref는 exit0다. vercel.json도 automatic Git deployments를 main/develop에만 허용한다. **실제 취소의 직접 근거는 ignore-command stdout과 exit0 취소 이벤트**이며, git.deploymentEnabled 설정만으로 원인을 추측하지 않았다.

[공식 ignoreCommand 문서](https://vercel.com/docs/project-configuration/vercel-json)는 exit0을 build ignore, exit1을 build continue로 정의한다. [Git deployment 설정](https://vercel.com/docs/project-configuration/git-configuration)과도 현재 allowlist가 대응한다. 로컬에서 실제 환경/키를 읽지 않는 synthetic preview env만으로 feature→exit0, develop→exit1, missing ref→exit0을 재생했다. source SHA와 결과는 `source-and-local-decision.json`에 있다. CLI/MCP의 deploy/cancel/redeploy/update 동작은 실행하지 않았다.

## 현재 승인 경계 내 정식 preview 검증 경로

1. Root의 기존 보호된PR/release 경로에서 리뷰와CI가 끝난 source를 **실제 develop**으로 반영한다. 기존허용 Git 경로이므로 project 설정·ignoreCommand·production freeze를 바꿀 필요가 없다. 이 helper는 merge/push를 수행하지 않았다.
2. 해당 develop Git deployment를 exact project/team으로 조회하고 READY를 확인한다. Git SHA와 source/tree hash를 검증한다. merge SHA가 후보56819502와 달라지면 그 차이와 검증이 바인딩된 source를 명확히 기록한다.
3. 실제 READY URL에서 승인된 읽기 route/flow를 검증한다. Deployment Protection이 있으면 공식 authenticated fetch/CLI curl 경로를 사용한다. 공유 URL/bypass token 생성·환경변경·운영 mutation으로 접근을 우회하지 않는다. 실제 로그인·관리자·운영 데이터가 필요한 항목은 synthetic/e2e와 실제 범위를 구별한다.
4. READY/HTTP/render/read flow 증거를 로컬 build/test 및 GitHub status와 따로 기록한다. 검증 뒤의 data/main 승격은 기존 보호순서·production 승인·rollback/readback 범위로 진행한다.

feature branch에 develop metadata를 덧씌우거나 ignore-command/설정을 무시하도록 강제하는 경로는 제안하지 않는다. 현재 두 canceled URL은 정상 preview/render 증거가 아니며, 현재HEAD의 READY 배포도 이번 조회로 증명하지 않았다.

## 수행 경계

read-only 공식 metadata/events 조회와 local source 결정 재생만 수행했다. source/config/env/freeze 수정0, 배포생성/취소/재배포0, 실제preview HTTP/브라우저요청0, 운영DB/provider/model 호출0. 기존user탭/서비스/PID와 과거 evidence를 보존했다. 새runtime server/브라우저handle은 만들지 않았다.
