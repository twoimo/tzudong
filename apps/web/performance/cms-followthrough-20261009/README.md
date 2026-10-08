# CMS follow-through evidence, 2026-10-09

Candidate: `/Users/twoimo/.codex/worktrees/pipeline-admin-integration-20261007/tzudong`; initial HEAD `8d918f851d8a0ec7dc1637f677cf9db05a61b460`.

## Changes and limits

The operations request reader used to convert every thrown error, including the query owner cancelling its request, into an `unavailable` snapshot. The new boundary rethrows owner cancellation before fetch, after headers, during body reading and from the catch path. Network failures and the independent 20-second timeout still produce a bounded unavailable state; HTTP 401/403 remain forbidden, and successful payloads still pass the aggregate-only parser.

The desktop inspector did not handle Escape. It now closes and restores focus to the originating row, matching the mobile drawer close behavior. Enter/Space activation already bubbled from the native row button and was preserved.

These are bounded behavior fixes, not evidence that every CMS function, public route, hosted database, or deployment works. No schema, lockfile, release or operational mutation was performed by this helper.

## Verification versus implementation

| Area | Current implementation evidence | Current verification evidence | Remaining |
| --- | --- | --- | --- |
| Operations request cancellation | Owner abort remains cancellation; timeout and forbidden responses remain bounded | Five new behavioral unit cases plus existing read-model contracts | Real operator session and hosted outages are not exercised |
| Operations inspector | Desktop Escape closes and returns focus; mobile Sheet retained | Browser results below; only synthetic read responses | Hosted user flow not exercised |
| Admin navigation | 15 modules listed by the actual sidebar ID contract | Prior hydration target list omitted three modules; updated spec passed all 15 modules and one legacy alias below | Shell/header checks do not prove successful data or mutation workflows |
| Public/account pages | 22 page.tsx route sources exist | Source inventory only in this helper run | Public route functional and visual validation remains required |
| Legacy/admin pages | 5 page.tsx route sources exist | Source inventory; canonical module checks distinct | Authenticated legacy redirect/content paths remain unverified |
| Existing design contracts | Admin two-pane grammar and shared shell asserted | Four targeted test files: 28 pass, 0 fail; ESLint passes; typecheck parity 0 diagnostics | Source assertions are not rendered visual evidence |

## Route inventory

| Route | Source | This run |
| --- | --- | --- |
| `/auth/required` | `app/auth/required/page.tsx` | Source only |
| `/auth/reset-password` | `app/auth/reset-password/page.tsx` | Source only |
| `/data-deletion` | `app/data-deletion/page.tsx` | Source only |
| `/feed` | `app/feed/page.tsx` | Source only |
| `/global-map` | `app/global-map/page.tsx` | Source only |
| `/home-frame` | `app/home-frame/page.tsx` | Source only |
| `/insights` | `app/insights/page.tsx` | Source only |
| `/leaderboard` | `app/leaderboard/page.tsx` | Source only |
| `/mypage/bookmarks` | `app/mypage/bookmarks/page.tsx` | Source only |
| `/mypage` | `app/mypage/page.tsx` | Source only |
| `/mypage/profile` | `app/mypage/profile/page.tsx` | Source only |
| `/mypage/reviews` | `app/mypage/reviews/page.tsx` | Source only |
| `/mypage/submissions/edit` | `app/mypage/submissions/edit/page.tsx` | Source only |
| `/mypage/submissions/new` | `app/mypage/submissions/new/page.tsx` | Source only |
| `/mypage/submissions/recommend` | `app/mypage/submissions/recommend/page.tsx` | Source only |
| `/` | `app/page.tsx` | Source only |
| `/privacy/onboarding` | `app/privacy/onboarding/page.tsx` | Source only |
| `/privacy` | `app/privacy/page.tsx` | Source only |
| `/s/[code]` | `app/s/[code]/page.tsx` | Source only |
| `/stamp` | `app/stamp/page.tsx` | Source only |
| `/submissions` | `app/submissions/page.tsx` | Source only |
| `/user/[userId]` | `app/user/[userId]/page.tsx` | Source only |
| `/admin/banners` | `app/admin/banners/page.tsx` | Source only |
| `/admin/evaluations` | `app/admin/evaluations/page.tsx` | Source only |
| `/admin` | `app/admin/page.tsx` | Source only |
| `/admin/privacy-incidents` | `app/admin/privacy-incidents/page.tsx` | Source only |
| `/admin/submissions` | `app/admin/submissions/page.tsx` | Source only |

## Sidebar versus hydration smoke at task start

| Sidebar module | Existing smoke target |
| --- | --- |
| `overview` | Present |
| `restaurants` | Present |
| `submissions` | Present |
| `reviews` | Present |
| `users` | Present |
| `banners` | Present |
| `insights` | Present |
| `pipeline` | Missing |
| `knowledge-graph` | Missing |
| `sentry` | Missing |
| `youtube-thumbnail-generator` | Present |
| `storyboard` | Present |
| `routes` | Present |
| `llm` | Present |
| `audit` | Present |

## Current browser scope

The candidate already had a Node 24 local dev server on 127.0.0.1:19872 (PID 57309). The harness owns a separate headless Chromium process/context. It uses the local E2E shell and route bypass only; token is read into process memory and never saved in evidence. All non-GET/HEAD requests are blocked. API responses are synthetic (pipeline empty ready state, other endpoints bounded 503); external requests are blocked. No cookies, local storage snapshots, provider diagnostics or raw admin payloads are saved. `browser-results.json` records actual results; `operations-desktop.png` captures only the synthetic operations panel.

## Browser results and selector reconciliation

The first run proved desktop and mobile keyboard focus return, with zero page errors and zero attempted non-read requests. Ten of fifteen modules matched the old per-module-header selector. Five did not: overview, restaurants, knowledge-graph, sentry and storyboard. Source inspection found changed heading contracts (overview intentionally suppresses its outer embedded header but renders an inner dashboard `AdminPageHeader`; four modules provide their own `AdminPageHeader`). The first result is retained unchanged, and only these five are retried with current component selectors in `browser-selector-reconciliation.json`.

| Module | First old-selector check | Current selector follow-up |
| --- | --- | --- |
| `overview` | Selector mismatch | See reconciliation artifact |
| `restaurants` | Selector mismatch | See reconciliation artifact |
| `submissions` | Passed | Not repeated |
| `reviews` | Passed | Not repeated |
| `users` | Passed | Not repeated |
| `banners` | Passed | Not repeated |
| `insights` | Passed | Not repeated |
| `pipeline` | Passed | Not repeated |
| `knowledge-graph` | Selector mismatch | See reconciliation artifact |
| `sentry` | Selector mismatch | See reconciliation artifact |
| `youtube-thumbnail-generator` | Passed | Not repeated |
| `storyboard` | Selector mismatch | See reconciliation artifact |
| `routes` | Passed | Not repeated |
| `llm` | Passed | Not repeated |
| `audit` | Passed | Not repeated |

The selector reconciliation passed all five cases. Combined local module rendering coverage is 15/15, with zero page errors. These checks use synthetic read responses and do not establish successful hosted data/guarded mutation behavior. Both desktop and mobile operations keyboard flows passed.


## Hydration spec repaired and executed

`tests/admin-console-module-hydration.spec.ts` now includes pipeline, knowledge-graph and sentry, and uses actual current component header/body selectors. Assertions still require the active module, visible header and visible content-ready element for every target. It also compares the full target set against the authoritative 15 sidebar IDs, so future omissions fail. The legacy latest-refresh link remains covered: it must normalize to restaurants with restaurantView=refresh, show the current restaurant header, show the refresh body and select the refresh tab.

The first actual spec run exposed that legacy route normalization and failed; its report/log remain as `hydration-legacy-routing-first.json` and `hydration-legacy-routing-first.log`. After updating the expected canonical state and adding URL/tab assertions, the scoped Playwright test passed in 35.2 seconds across 16 paths (15 sidebar modules plus the legacy alias), with no hydration/runtime errors and zero attempted mutations. Evidence is `hydration-artifacts/g001-admin-console-modules-transcript.json` and `hydration-run.json`. The test uses local synthetic bounded error reads; success does not establish hosted data or mutation correctness. Other tests in the hydration file were not run in this bounded follow-up.

Three existing restaurant routing unit cases passed; targeted spec ESLint passed. Compiler parity is recorded separately in `hydration-typecheck.log`.

## Process and browser ownership

The dev server on 127.0.0.1:19872 (PID 57309) existed before this helper and was reused after checking its checkout and local E2E configuration. This helper did not start, stop, or change that server. The custom harnesses owned fresh headless Chromium processes/contexts and awaited browser.close in finally on completed runs. The Playwright spec owned its separate worker/browser fixtures, which were torn down on both the failed first execution and passing second execution. No existing user browser targets, tabs, services or storage states were adopted or closed. `process-ownership.json` records the final process check; all helper harness/runner processes had exited and the pre-existing server remained running.

이번 웹 변경의 Next16.3.8 프로덕션 build와 50개 페이지 생성·route CSS boundary 검사가 통과했다. 기존 dev 출력과 분리한 디렉터리를 사용했고 compiler가 추가한 두 include만 검사 후 제거하여 tsconfig 원래 bytes를 복원했다. 배포 증빙은 아니다.
