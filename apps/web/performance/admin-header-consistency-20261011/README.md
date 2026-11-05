# Admin header consistency loopback fixture

관리자 15개 메뉴의 공통 헤더 렌더를 CUA로 확인하기 위한 합성 전용 실행 패키지다. 기존 `scripts/preview-design-fixtures.mjs`의 식당, 영상, 사용자, 리뷰, 평가, 배너, 스토리보드 합성 데이터를 유지하고, 기존 `fixture-transport-security-20261009/loopback-transport.mjs`의 고정 목적지와 Host/Origin 검사를 새 포트로 적용한다.

## 고정 포트와 출력

| 역할 | 주소 |
| --- | --- |
| Next.js 개발 서버 | `http://127.0.0.1:18820` |
| 합성 Supabase | `http://127.0.0.1:18821` |
| 브라우저 진입 gateway | `http://127.0.0.1:18822` |
| 개발 모드 Next 출력 | `.next-admin-header-consistency-18820` |
| production bundle 출력 | `.next-admin-header-build-20261012` |

18792, 18793, 18794 포트의 기존 서버와 브라우저는 사용하거나 종료하지 않는다. 브라우저는 gateway 주소만 사용한다.

## 실행 전 소스 검증

```bash
cd /Users/twoimo/.codex/worktrees/goal-followthrough-20261011/tzudong/apps/web
/opt/homebrew/opt/node@24/bin/node performance/admin-header-consistency-20261011/verify-package.mjs
```

이 검사는 서버와 브라우저를 시작하지 않는다. 실제 transport 순수 함수에 대해 고정 `127.0.0.1:18820` 목적지, Host/Origin, GET/HEAD, Next 16 `/_next/hmr`와 호환 `/_next/webpack-hmr`의 정확한 WebSocket 경로, 요청 헤더 allowlist, 임의 인증·쿠키·proxy 헤더 제거, gateway가 발급한 정확한 합성 세션 쿠키의 제한적 재구성, CSP의 고정 mock Supabase origin 허용을 확인한다. 결과와 패키지/입력 소스 SHA-256은 `source-verification.json`에 기록한다.

## Root 실행 명령

인자 없는 기존 명령은 webpack 개발 모드를 유지한다.

```bash
cd /Users/twoimo/.codex/worktrees/goal-followthrough-20261011/tzudong/apps/web
/opt/homebrew/opt/node@24/bin/node performance/admin-header-consistency-20261011/launch.mjs
```

dev compile/Flight 조건을 제외하고 이미 생성된 production bundle을 검사할 때만 다음 명령을 사용한다.

```bash
cd /Users/twoimo/.codex/worktrees/goal-followthrough-20261011/tzudong/apps/web
/opt/homebrew/opt/node@24/bin/node performance/admin-header-consistency-20261011/launch.mjs --production
```

`--production`은 `.next-admin-header-build-20261012/BUILD_ID`가 존재할 때만 `next start --hostname 127.0.0.1 --port 18820`을 실행한다. 이 launcher는 production build를 만들거나 수정하지 않는다. build가 `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:18821`, 합성 anon key, gateway site URL과 local runtime flag로 생성되었는지는 별도 source/build 검증이 필요하며, `BUILD_ID` 존재만으로 이를 입증하지 않는다. 다른 인자와 추가 인자는 `FIXTURE_ARGUMENTS_INVALID`로 거절한다.

launcher는 Node 24의 고정 경로를 검사하고 Next.js와 gateway를 같은 터미널의 자식 프로세스로 실행한다. Next의 E2E enable/context/runtime/token 환경 변수, production smoke runtime/allow flag와 두 bypass 헤더 이름은 실행 시 `lib/e2e-admin-route-bypass.ts`에서 읽는다. production 모드는 `NODE_ENV=production`, `VERCEL` 부재, `local-production-bundle-smoke` runtime과 해당 allow flag를 사용한다. 두 모드 모두 부모 환경은 HOME, locale, PATH, shell, terminal, temporary directory, timezone, user로 제한하며 `.env` 재로딩을 막는다. Supabase key와 bypass token은 공개된 합성 문자열이다. 명령 인자나 자식 환경에 실제 DB, provider, 인증 secret을 넣지 않는다.

준비 후 CUA 진입 주소는 다음과 같다.

```text
http://127.0.0.1:18822/__fixture/start
```

이 페이지는 자동 이동하지 않는다. 화면의 **관리자 화면 열기** 버튼을 누르면 일반 click 이벤트가 `tzudong:e2e-admin-shell-bypass=1`을 localStorage에 저장하고 `/admin`으로 이동한다. SSR secret이나 CUA evaluate로 storage를 쓰지 않는다.

### 최초 setup 실패 증빙

Root가 처음 실행한 `/__fixture/start`는 제목만 표시되고 body가 생기지 않았으며 `/admin` 자동 이동도 발생하지 않았다. 당시 DOM readback은 `ready=complete`, `scripts=1`, `bodyNodes=null`, URL은 `/__fixture/start`, console warn/error는 빈 배열이었다. Next 요청 로그도 아직 없었다. 따라서 이 실행은 관리자 렌더 증빙이 아니라 fixture setup 실패로 분류하며, **당시 시점의** 15개 메뉴 × 3폭 완료 수는 0/45였다. 이 실패 기록은 아래의 후속 production bundle 렌더 증빙으로 대체하거나 삭제하지 않는다.

버튼 보완 후 첫 개발 모드 실행에서 Root의 CUA와 Native Chrome은 `/admin`의 HTML 및 JS를 200으로 받았지만 SSR 로딩 골격에서 hydration이 진행되지 않았다. CDP 로그에서 Next 16.3.8 개발 클라이언트가 사용하는 `ws://127.0.0.1:18822/_next/hmr?id=...` 연결 실패가 반복되었고, fixture transport는 당시 구형 `/_next/webpack-hmr`만 허용했다. 현재 transport는 이 두 정확한 pathname만 GET WebSocket upgrade로 허용하며, 다른 pathname·subpath·method·protocol·origin과 credential 전달 금지는 유지한다. 이 개발 모드 실패 역시 역사 증빙이며, 아래 production bundle 결과와 구분한다.

## 실제 production bundle 렌더 연혁

처음 성공한 production build `-iqj34OuxGGmWhNjbyXPY`는 합성 public 입력과 `127.0.0.1:18821` 결박이 없어서 `build-passed-render-unsuitable`로 분류했다. 이 build artifact는 보존되지 않았고 렌더에는 사용하지 않았다. 뒤의 모든 렌더 증빙은 명시적인 loopback 합성 public env로 다시 만든 bundle이다.

첫 합성 production baseline은 BUILD_ID `P6Z8v8hH7rZE8yHslUIH5`다. `render-readback.json`과 기존 45개 PNG는 15개 메뉴 × 3개 viewport의 헤더 렌더를 보존한다. 제목과 헤더 geometry 검사는 완료됐지만 누적 console readback에는 warning 122건이 있었고 그중 121건이 Recharts width/height 경고였다. 따라서 이 baseline은 헤더 렌더 증빙이지만 warning-free chart 증빙은 아니다. 대응 build/source 경계는 `production-build-readback.json`에 있다.

Recharts 초기 0 크기 mount 처리를 반영한 다음 합성 production bundle은 BUILD_ID `PAhiV2v8TfHlQW4XwMk4s`, canonical source signature `fb29b662cc56451f8b9934cdf4986c3abac012c498f6250da03d816d23492df8`, `AdminConsoleOverview.tsx` SHA-256 `dd86b87c9d006f57b98df9678a935821329a5de3e2f054e90d2b5fe14202f85e`에 묶인다. `after-render-readback.json`은 Chrome 154에서 45/45 고유 메뉴·viewport 조합이 준비됐고 제목 잘림 0, 수평 overflow 0, mobile button 위반 0, warning 0, error 0, Recharts 크기 warning 0임을 기록한다. 모든 제목은 16px/600/24px 한 변형이었다. 대응 build/type/CSS 경계는 `production-build-after-chart-readback.json`에 있다.

이 45/45는 헤더 렌더 결과다. 390px의 마지막 네 메뉴 `storyboard`, `routes`, `llm`, `audit`는 메뉴가 auto-hidden 상태로 남은 뒤 deep-link로 열어 측정했다. 네 헤더의 렌더와 geometry는 통과했지만 해당 네 메뉴의 mobile 메뉴 이동은 아직 입증되지 않았다.

`chart-toggle-before-layout-fix.json`은 같은 PAhi bundle에서 별도 상호작용 회귀를 발견했다. 최초 양수 chart wrapper 높이는 273.15625px였고, table 상태에서 조회수 series를 숨긴 뒤 graph로 돌아오자 양수 wrapper 두 개가 모두 845.984375px로 유지됐다. 이 단일 전환은 `accepted: false`, `chart-height-remained-enlarged-after-table-to-graph`로 보존한다. 합성 fixture의 한 전환이므로 전체 chart 동작의 통계적 결론은 아니지만, 현 source/build를 최종 승인할 수 없는 실제 재현이다. mobile scroll reset과 numeric-height feedback 수정 뒤에는 새 source binding, production build와 렌더·전환 readback이 필요하다.

BUILD_ID `StMTT6clVUew0sIDfYpWM`의 `final-layout-intermediate-readback.json`은 desktop 15개, tablet 15개, mobile overview의 31개 헤더 geometry와 chart 높이 273.15625px → 845.984375px → 273.15625px 복구를 보존한다. 조회수 series의 `pressed=false`도 복구 뒤 유지됐다. 다만 mobile sheet를 닫은 뒤 focus가 canvas가 아니라 trigger로 돌아간 것을 발견했고, 31/45 부분 측정이며 wheel 입력도 보이는 scroll event와 동기화되지 않아 `accepted: false`다.

BUILD_ID `GKEnGiPgevGdstEfWZX7W`의 `mobile-focus-render-readback.json`은 45/45 실제 메뉴 이동, mobile canvas focus 15/15, Escape 뒤 trigger 복귀와 이동 없는 wheel 입력 뒤 메뉴 유지를 통과했다. 누적 warning 2건은 합성 directions fallback이고 Recharts warning과 error는 0건이었다. 그러나 실제 수직 wheel이 dashboard grid의 8px nested scroller에 잡혀 main scroll 결과는 `actualScrollAdmitted: false`였다. 이 결과는 focus와 메뉴 이동 증빙으로는 채택하지만 실제 scroll owner 증빙으로는 채택하지 않는다.

최종 BUILD_ID `-cMz_aROVaZTlUcj5f8XN`은 canonical source signature `58b6e29fa7ef19b52f4b66787261a797b2002d733a60fb2f535f618c65c58c2a`, `AdminConsoleOverview.tsx` SHA-256 `e3ea987a737af697a5d7ea155a474ed448f1d539fe46178914bb5abc419ac4d1`에 묶인다. `production-build-scroll-owner-readback.json`은 두 dashboard grid가 `overflow-x-clip`을 사용하고 합성 public 입력과 CSS boundary가 통과한 build를 기록한다. `scroll-owner-final-render-readback.json`의 최종 CUA 결과는 다음과 같다.

- 15개 메뉴 × 3개 viewport에서 실제 메뉴 이동 45/45, mobile canvas focus 15/15가 통과했다.
- 제목 잘림, 가로 overflow, 44px mobile menu button 위반은 모두 0건이며 제목 typography는 16px/600/24px 한 변형이다.
- 이동 없는 wheel 뒤 메뉴는 유지됐다. overview에서 실제 wheel 350은 main scroller의 `scrollTop`을 0에서 350으로 이동시켰고 header는 `false`, pointer는 `none`이 됐다. 위로 돌아오면 main `scrollTop=0`, header `true`, pointer `auto`로 복귀했다. 이전 main+nested 두 scroll owner 중 불필요한 nested owner가 없어져 관측 owner는 main 하나다.
- chart 높이는 273.15625px → 845.984375px(table) → 273.15625px(graph)로 복구됐고 조회수 series의 `pressed=false` 상태가 유지됐다.
- captured tab 누적 warning 3건은 모두 합성 directions fallback이며 Recharts 크기 warning과 error는 0건이다. 이 로그는 이전 bundle reload까지 누적하므로 build 사이의 독립 비교 통계로 사용하지 않는다.

## 전송 및 합성 데이터 한계

- gateway가 Next로 전달하는 데이터 요청은 GET/HEAD뿐이다. 목적지는 항상 `127.0.0.1:18820`이고 redirect를 따라가지 않는다.
- gateway API는 목록에 등록된 합성 GET/HEAD 응답만 제공한다. 알 수 없는 `/api/*`는 `{ "error": "FIXTURE_ENDPOINT_NOT_FOUND" }`와 404로 끝난다.
- 합성 Supabase는 등록된 테이블의 GET/HEAD와 아래 RPC의 POST만 허용한다. OPTIONS는 지정된 CORS method/header에 대한 빈 preflight만 처리한다.
  - `get_current_privacy_eligibility`
  - `is_current_auth_session_active`
  - `read_public_profile_summaries`
  - `read_public_profile_leaderboard_page`
  - `read_public_profile_leaderboard`
- 알 수 없는 Supabase auth/table/RPC endpoint는 404다. 테이블 쓰기와 그 밖의 POST는 405다.
- incoming Authorization, proxy, forwarded header와 임의 Cookie는 Next로 전달하지 않는다. 예외는 현재 gateway의 `/__fixture/session`이 발급하고 브라우저가 그대로 돌려준 정확한 합성 세션 쿠키 하나이며, transport가 자체 보유 값으로 재구성해 Next SSR에 전달한다. Next 응답은 allowlist만 browser에 전달하고 upstream Set-Cookie를 전달하지 않으며, CSP의 기존 `connect-src`에는 고정된 합성 Supabase origin만 추가한다.
- provider 호출, hosted DB 호출, 외부 HTTP 요청은 구현 경로에 없다. 모델 호출, 데이터 mutation, 운영 readback을 검증하지 않는다.
- 실제 페이지에서 지원하지 않는 endpoint는 빈 성공으로 위장하지 않고 bounded 404를 반환하므로, 그 상태는 화면에서 오류/비가용 상태로 드러날 수 있다.

## 종료

launcher 터미널에서 `Ctrl-C`를 누르면 두 자식 프로세스에 SIGTERM을 전달한다. 터미널을 잃었으면 launcher가 시작할 때 출력한 PID에만 다음 명령을 사용한다.

```bash
kill -TERM <launcher_pid>
```

포트 기반 `pkill`이나 기존 18792–18794 서버 종료는 사용하지 않는다. 두 별도 Next 출력은 종료 후에도 남기므로 기존 개발 출력과 production bundle을 보존한다.

## 현재 증빙과 운영 경계

최종 production 합성 fixture는 해당 build-time source/bundle에서 실제 메뉴 이동을 포함한 헤더 **45/45**, mobile canvas focus **15/15**, 실제 main scroll과 최상단 header/menu 복귀, chart/table 높이 복구를 통과했다. 이는 고정된 세 viewport와 합성 fixture에서 한 번씩 관측한 유한한 조합 census와 단일 상호작용 전환이다. 독립 표본, 성능 비교 또는 일반 사용성 결론이 아니다.

`source-signature-reconciliation-readback.json`은 build receipt producer와 같은 정렬된 `{path, sha256}` 547행을 현재 source에서 다시 계산했다. 현재 signature는 `58b6e29fa7ef19b52f4b66787261a797b2002d733a60fb2f535f618c65c58c2a`로 build receipt와 정확히 같고 path/hash 불일치는 0건이다. `AdminConsoleOverview.tsx`도 최종 SHA-256 `e3ea987a737af697a5d7ea155a474ed448f1d539fe46178914bb5abc419ac4d1`을 유지한다. 앞서 기록한 `3e377b5ce052e29a4c0d2792a07fa3573272d75bca03b91fd3738b461aee5620`은 원 producer 행에 없던 `bytes`를 추가해 직렬화한 비교 불가능 audit projection이었으며 source drift 증거가 아니다.

TypeScript 6.0.2의 raw program filename projection은 build `.tsbuildinfo` 3,289개와 현재 tsconfig 3,139개로 150개 차이가 난다. build-only 150개는 모두 Next 생성 fixture type이며 production dist 143개와 dev dist 7개다. current-only는 0개다. Root가 tsconfig에서 제거한 generated-type include 네 개를 파일 쓰기 없이 메모리에서만 복원하면 3,289개 이름과 digest가 build projection과 정확히 같아진다. `.next-admin-header-*`를 양쪽에서 제외한 투영도 각각 3,137개와 같은 digest로 일치한다. `.tsbuildinfo`의 개별 incremental version 값은 content hash 증거로 사용하지 않았고, source content 결박은 위 canonical live-file manifest만 사용했다. 이 정합화 때문에 build·test·server·render는 다시 실행하지 않았다.

실제 OAuth와 권한, provider, hosted DB read/write, record mutation, 전체 메뉴의 업무 흐름, 실제 directions 성공 경로, 배포·운영 상태는 검증하지 않았다. 로컬 source, build, CSS와 CUA 증빙은 그 운영 경계를 대신하지 않는다. 비용, 속도, production reliability 개선도 주장하지 않는다.

`artifact-map.json`은 이 README, fixture source, 모든 build/render/failure/reconciliation JSON과 228개 screenshot을 SHA-256과 byte 크기로 inventory한다. map 자기 자신과 detached `artifact-map.json.sha256`은 순환 참조를 피하려고 inventory에서 제외한다. 기존 source verification, 실패·중간 receipt, raw readback과 screenshot은 역사 증빙으로 유지하며 최종 source/build/render binding과 혼합하지 않는다.
