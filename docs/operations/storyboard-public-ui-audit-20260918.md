# Public UI audit — 2026-09-18

Production target: `https://www.tzudong.app` (the apex redirects here). This is a read-only, anonymous first-visitor audit, not release acceptance or a legal-compliance assessment. **No overall visual acceptance pass is established.**

## Evidence and scope

Evidence is in [storyboard-public-ui-20260918](../../apps/web/.omx/artifacts/storyboard-public-ui-20260918/). The original 16 screenshots and [observations](../../apps/web/.omx/artifacts/storyboard-public-ui-20260918/observations.json) were preserved. Continuation captures and bounded measurements are in [resume-observations.json](../../apps/web/.omx/artifacts/storyboard-public-ui-20260918/resume-observations.json). Capture `04` is transitional; `05` is its settled replacement.

The audit uses local Playwright 1.62.1 / Chromium 151.0.7922.34 in a fresh anonymous context, with no stored login state or location permission. Reviewer identities and review text are masked in screenshots. Pink rectangles are audit redactions, not application defects; masks can obscure overlapping fixed navigation. No cookies, storage dumps, credentials, response bodies, or headers are retained. The earlier audit-owned Aside tab encountered an existing signed-in session and was closed without inspecting account data or logging out, according to the prior handoff.

No application source, migrations, package files, storyboard implementation, or acceptance ledger are audit outputs. No commits, deployments, account creation, content submission, or local application server startup are part of this audit. Concurrent storyboard changes were already present when the audit resumed.

## Actual route inventory and visitor scenarios

The [source inventory](../../apps/web/.omx/artifacts/storyboard-public-ui-20260918/source-inventory.json) contains **22 non-admin page files**. Login/signup, map filters, restaurant detail and bookmarks are also shared UI states; no standalone login/signup/restaurant/terms page is invented.

| Actual route/state | First-visitor scenario and observed result |
| --- | --- |
| `/` | Domestic map shows 723 restaurants. Search `한추`, open its result and restaurant detail; review action opens login. Desktop recommendations have loaded video thumbnails. Home overseas round trip and filter checks are pending continuation. |
| `/global-map` | Country selector renders; Turkey has two restaurants and Japan a five-restaurant option. This is separate from the home overseas toggle. |
| `/home-frame` | Alternate home shell exists in source; live check pending. |
| `/feed` | Two distinct public reviews render repeatedly in the feed. Mobile/tablet retain `/feed`; desktop redirects to `/?panel=feed`. No review-photo elements exist in the inspected anonymous feed, so photo-carousel behavior is untested. |
| `/stamp` | Public restaurant collection renders. Tablet screenshot shows a two-column grid, loaded video thumbnails and a clearly marked guide card. Desktop redirects to `/?panel=stamp`. Stamp accrual requires an authorized test account. |
| `/leaderboard` | Mobile/tablet page and desktop `/?panel=leaderboard` render an explicit empty ranking state. Period switching pending. |
| `/insights` | Source route present; live check pending. |
| `/mypage` | Source redirects to `/mypage/submissions/new`; direct live check pending. |
| `/mypage/profile`, `/mypage/bookmarks`, `/mypage/reviews` | All three direct anonymous visits redirect to `/auth/required?reason=mypage` (safe recorded query excludes the return path). Private account contents remain blocked. |
| `/mypage/submissions/new`, `/mypage/submissions/edit`, `/mypage/submissions/recommend` | Source routes present. Verify anonymous gate without filling or submitting; live checks pending. |
| `/submissions` | Source redirects to `/mypage`; live check pending. |
| `/auth/required` | Reached by the three MY routes above. Direct entry and login/home link checks pending. |
| `/auth/reset-password` | Source inspected; no recovery proof or request supplied. Live entry check pending. |
| `/privacy/onboarding` | Source redirects into the home onboarding state. No consent or challenge submission authorized; live entry pending. |
| `/privacy` | HTTP 200 at all three target viewports. Mobile first screen visually reviewed; raw policy metadata and implementation terminology dominate the opening content. Cross-link navigation pending. |
| `/data-deletion` | HTTP 200 at all three target viewports. Read-only information page; deletion must not be initiated. Visual review and cross-links pending. |
| `/user/[userId]` | Existing public profile links are present in the feed. Follow only an observed link; do not invent identifiers or retain identity data. Pending. |
| `/s/[code]` | Source route present. Requires an already-existing public share link; do not generate a share record. Blocked until one is observed. |
| Login/signup, anonymous bookmarks | Mobile MY opens login; switching to signup exposes labeled fields, age/consent controls and disabled blank submit. Review action also opens login. `/?panel=bookmarks` reaches an anonymous login gate. No credentials, OAuth, account creation or consent submitted. |

## Responsive and visual coverage

Target viewports are **390×844**, **768×1024**, and **1440×900**, device scale factor 1. Original home captures include light and system-dark preference at each size. No distinct public dark appearance or theme switch was established; a system preference alone is not dark-theme acceptance.

The continuation captured feed, stamp, leaderboard, privacy and deletion at all three sizes (`20`–`34`). Route HTTP status, redirect destination, viewport width, visible broken-image count and dialog count are saved in the continuation JSON. These measurements support the screenshots and **do not independently establish a visual pass**.

Visually reviewed so far in this continuation: mobile feed (`20`), tablet stamp (`26`), desktop feed (`30`), mobile privacy (`23`). Prior handoff reports visual inspection of desktop light home and mobile home/login/signup. Further screenshot review is pending.

## Findings

**P2 — Non-specific accessible map-marker names.** The earlier restaurant-detail check found 39 nearby buttons with accessible name exactly `marker`, which does not identify a restaurant for screen-reader navigation. [Accessibility evidence](../../apps/web/.omx/artifacts/storyboard-public-ui-20260918/accessibility.json). Use restaurant-specific names and retain the searchable list alternative. This is not a complete accessibility conformance audit.

**P2 — Public-facing copy exposes operational terminology.** The mobile privacy opening displays hashes, publication timestamps and deployment/readback implementation conditions. The reviewed signup explanation also uses operator-approval/deployment/readback terminology. Replace the visitor-facing explanation with clear availability and policy copy while retaining verified publication metadata and fail-closed behavior. This is a usability finding, not a legal determination.

**Observation — Repeating feed cards.** The header reports two reviews while the same two cards repeat down the feed. Source `FeedContent.tsx` explicitly renders looped items. This observation concerns repeated presentation, not duplicate persisted reviews. No photo elements were available to validate review thumbnails/carousels.

## Verified interactions and limits

Earlier evidence covers map-menu opening, restaurant search/detail, anonymous review gating, mobile MY, signup switching, the separate global-country selector and Escape dismissal. All **16 consecutive Tab checks stayed inside the desktop login dialog**. No overall keyboard, screen-reader or contrast pass is claimed.

The [public health check](../../apps/web/.omx/artifacts/storyboard-public-ui-20260918/public-health.json) returned **HTTP 403**. A later read-only probe of `https://www.tzudong.app/api/health` resolved the deployed commit: **`5af1e1f6ac81a483e1e8aed2b05237ca0f62ce6a`**, release `5445fa71104b2408962c1c5d369babf3bb778838`, deployment `dpl_CpqD2F8weF6vDLUG2AgSfrruMbZa`, project `prj_sau35J5uUtShIQ9OKofRtOVVnTSl`. Every production statement below is scoped to that commit. The inventory's explicitly labeled local SHA is not deployment evidence, and no Vercel control-plane inspection was performed.

Authenticated login/OAuth, account-bound bookmarks/MY/reviews, stamp accrual and recovery completion remain blocked by the absence of an authorized test account/recovery proof. Review-photo interaction and share-route checks require existing suitable public content. All source/test results remain distinct from hosted acceptance.

## Defect closure pass (local, 2026-09-18)

A separate local pass traced the named map, filter, UI and review defects to code and measured before → after in a local Next.js dev server with Playwright at 390×844, 768×1024 and 1440×900. Evidence root: [defect-closure-observations.json](../../apps/web/.omx/artifacts/storyboard-local-mlx-20260918/defect-closure-observations.json) with raw logs, JSON reports and screenshots beside it (`.omx/` is gitignored). This is local rendered behaviour and is **not** production acceptance.

### Root causes

1. `app/globals.css` carried an **unlayered** `button, input, textarea, select { font: inherit }` reset, so it outranked every layer-ordered Tailwind utility. Every `<button>` computed 16px/24px regardless of `text-xs`/`text-[11px]`/`text-sm`, `ReviewCard`'s `border-border` computed `rgb(28,25,23)` instead of the theme token, and the restaurant name under a nickname inherited the 16px base. Fixed by declaring `@layer theme, base, components, utilities;` and moving the reset into `@layer base`.
2. The home route never loaded `app/home-detail-globals.css`, because `components/home/home-desktop-control-panel.tsx`, `components/home/home-map-container.tsx`, `components/map/naver-map-sidepanels.tsx` and `components/layout/OverlayPagePanel.tsx` imported `RestaurantDetailPanel`/`ReviewModal` directly instead of the deferred-panel barrel. `.top-2`, `.bg-black/55`, `.bg-black/70`, `.ring-1` and `.backdrop-blur-[1px]` were absent from the home CSS, which is why the video play badge and the `영상 N` chip rendered unstyled.

### Measured before → after (local)

| Defect | Before | After |
| --- | --- | --- |
| `수정 요청` / `리뷰 작성` / `길찾기` text clipped or wrapped | 16px inherited on every button | `수정 요청` 11px/13.75px in 98×56, `리뷰 작성` 11px/13.75px in 98×56, `길찾기` 12px/15px in 147×56, all `overflowX: false` |
| Restaurant name under the nickname oversized | 16px/24px | 12px/16px |
| Recent-review card harsh black border | `rgb(28,25,23)` | `rgb(214,211,209)` 1px, radius 8px |
| Cluster click lost the individual markers | 1 cluster container (`17`), 0 individual markers | cluster 0, 17 visible 32×32 individual markers with 2 review bubbles, and a marker click opens the detail panel |
| Five theme filters | not working | `조회수 폭발` 4, `댓글 폭주` 4, `최근 영상` 1, `재등장 맛집` 1, `반응 찐함` 2, each resetting to 17 |
| Bottom sheet while a filter is applied | could not open | `댓글 폭주` → 4 individual markers → click → desktop `panelPresent: true`, mobile and tablet `sheetPresent: true`, panel text `분식 | 정원분식 | 매장 정보 | … | 수정 요청 | 길찾기 | 리뷰 작성`; `scrollW == clientW` at all three sizes |
| YouTube thumbnail centre play button | unaligned/unstyled | centred circular translucent badge with the play triangle; `영상 1/2` chip at (8,8) 56×20 |
| Review images broken | — | `/feed` renders canonical and legacy review photos with 0 broken images, and map bubbles load `review-photos/…/reviews/1111…/food/1` and `…/1758000000001_food_1_legacy.png` at 320×240 |
| Horizontal overflow | — | `scrollW == clientW` at 390, 768 and 1440 on `/`, `/feed` and `/stamp` |

The location floating button is **not** a code defect. `apps/web/lib/privacy/location-readiness.ts` fails closed until an operator supplies `DEVICE_LOCATION_RELEASE_DECISION=approved` with a verified external status and four SHA-256 hashes; fabricating that evidence is out of scope and was not done.

### Production state at `5af1e1f6` (read-only)

Production predates every commit that carries these fixes, so the defects are present there. Measured read-only: the production home CSS lacks `.bg-black/70`, `.bg-black/55`, `.top-2` and `.ring-1` (play badge and chip unstyled); `/feed` shows **8 × `탈퇴한 사용자`** in visible text with 0 broken images out of 118.

The `탈퇴한 사용자` join defect has a confirmed root cause. The deployed bundle calls `read_public_profile_summaries` and `read_public_profile_leaderboard` (two chunks each; five chunks carry the `탈퇴한 사용자` fallback string), but both RPCs answer **HTTP 404 `PGRST202`** from the deployed PostgREST schema cache, and a direct `profiles` select answers **HTTP 401 `42501 permission denied for table profiles`**. No client-side fallback can resolve the join, so every reviewer falls back to the deleted-account label. The fix is a hosted migration that creates the bounded read RPCs, which exist only in the local `*_local_*` convergence migrations. That is a hosted database mutation, so it was **not** performed; see [release.md](../agents/release.md).

No commit was pushed, no pull request was opened, no deployment was triggered, no hosted migration was applied and no production data was written in this pass.

### Form-control font size follow-up (local)

The global-CSS `@layer` fix removed the unlayered `font: inherit` reset, but the
shared Input still carried `text-base … md:text-sm`, so a 768 px class device
rendered the search field at **14 px** and mobile Safari would zoom on focus. The
first repair moved the shrink step to `lg:text-sm`; the second added
`pointer-coarse:text-base` after a measurement showed the width-only rule still
left every coarse-pointer device at 14 px from 1024 px up.

`probe-form-font2.mjs` on `/global-map` (the only probed public route with
inputs — two of them; `/feed`, `/submissions`, `/mypage/reviews`, `/stamp`,
`/leaderboard` and `/privacy` expose none):

| Profile | `pointer: coarse` | `md:text-sm` | `lg:text-sm` | `lg:text-sm pointer-coarse:text-base` |
| --- | --- | --- | --- | --- |
| mobile 390 touch | true | 14 px | 16 px | 16 px |
| tablet 768 touch | true | 14 px | 16 px | 16 px |
| iPad landscape 1024 touch | true | 14 px | 14 px | 16 px |
| iPad Pro landscape 1366 touch | true | 14 px | 14 px | 16 px |
| laptop 1024 fine pointer | false | 14 px | 14 px | 14 px |
| desktop 1440 fine pointer | false | 14 px | 14 px | 14 px |

Reports: `form-font2-before.json` and `form-font2-after.json`. On a coarse
pointer the 16 px minimum now holds at every width, and fine-pointer desktops
keep the compact 14 px. One further `text-base … md:text-sm` pair remains at
`apps/web/app/mypage/reviews/page.tsx:415`; it is unchanged, and that route
redirects anonymous visitors to the login gate.

Continuation is still in progress: remaining safe navigation/visual checks, evidence-link validation and browser cleanup will be recorded before final delivery.

## Browser pass continuation (local, branch head `eb5943ed`)

A later pass re-ran the public routes and the admin storyboard workspace with
local Playwright/Chromium at the three target viewports. Evidence:
`/tmp/tz-e2e/browser-e2e/public/` (screenshots plus `public-report.json`),
`location-report.json`, `worker-offline-final.json` and `export-report.json`.
This is local rendered behaviour and is still **not** production acceptance.

### Route sweep

26 route/viewport combinations returned HTTP 200 with `scrollW == clientW`, 0
broken images, 0 `role="dialog"` elements and no page errors: `/`, `/global-map`,
`/feed`, `/stamp`, `/leaderboard`, `/privacy`, `/data-deletion` and
`/auth/required` at 390×844, 768×1024 and 1440×900, plus light and dark home.
`/stamp` reaches `/?panel=stamp` on desktop and stays at `/stamp` on mobile,
matching the recorded inventory. One hydration-mismatch console error appeared on
the desktop `/stamp` → `/?panel=stamp` transition and did not reproduce in four
dedicated re-runs (desktop light, desktop dark, mobile, direct `/?panel=stamp`),
so it is recorded as a transient observation, not a confirmed defect.

The sweep's search probe relied on DOM marker selectors; the map renders through the
provider canvas, so its zero-marker counts are not evidence about search results and
are discarded instead of being reported as a search finding.

### Location floating button is fail-closed, not broken

The `현재 위치 보기` button renders and is interactive at 390 and 1440 (one match per
viewport). With browser geolocation permission already granted to the context, the
first and second taps do not start a watcher: `GET /api/privacy/location-readiness`
answers `{"status":"unavailable","reasonCode":"DEVICE_LOCATION_OPERATOR_EVIDENCE_REQUIRED"}`
and the UI shows "현재 위치 기능은 운영자 위치 증빙 확인이 완료될 때까지 사용할 수 없어요."
The gate is `apps/web/lib/privacy/location-readiness.ts`, which is unchanged from
`main` (added by `f32e1b19`) and requires `DEVICE_LOCATION_RELEASE_DECISION=approved`
with a verified external status and four SHA-256 evidence references. Supplying that
evidence is an operator/legal decision, so the button stays blocked locally and in
production; no gate value was invented.

### Export reopened without loss

The admin storyboard download equals the server export byte for byte
(7,020,395 B, SHA-256 `ae6a8894…c093e8cd2e`), carries schema
`storyboard-export-v1`, 20 files whose base64 payloads all match their recorded
SHA-256, both `image/png` originals and `image/webp` derivatives, and a document
deep-equal to the stored document. No scene original path is missing from `files`.

### Two admin workspace defects found and fixed

Both were found by the browser pass and fixed with tests; they are in
`eb5943ed`, not deployed.

1. Every `409` from the storyboard production endpoint was mapped to
   `revision_conflict`, so the server's `nothing_to_retry` refusal (a retry when
   every scene already has a stored image) was reported as a revision conflict. The
   client now surfaces the server's own reason, the three missing Korean messages
   were added, and retry is disabled once every stored scene has an image. The
   underlying migration guard was deliberately left unchanged.
2. Reloading the admin console dropped the selected project because
   `storyboardProject` was missing from the canonical-href `preserveKeys`; the URL
   collapsed to `/admin?module=storyboard` and the workspace rendered
   "프로젝트 불러오기". The key is now preserved and a reload restores the same five
   scenes, five images and identical asset ids.

### Worker-offline admin state (Q04)

With the Mac worker stopped past its 120 s heartbeat window the workspace showed one
`· 오프라인` worker, zero online workers, the last-reported model catalog, and only
로컬 MLX / 수동 가져오기 as selectable providers while external AI stayed off. A
created request showed `로컬 워커 대기` with `텍스트: 로컬 MLX · 이미지: 로컬 MLX`,
`재시도` disabled and `작업 취소` enabled; cancelling produced `취소됨` and
"서버에 변경 사항을 저장했습니다." No non-loopback browser request occurred, and
`lsof` shows the inference port is loopback-only (`127.0.0.1:11234`), as is the
dev server (`127.0.0.1:8080`).

## Continuation: route boundaries, auth gates and two console observations (2026-09-18)

This section extends the audit with a signed-in pass over the real admin session and a
full anonymous route sweep. Everything below ran against the local dev server on
`127.0.0.1:8080` (loopback only); the machine-readable results are in
`apps/web/.omx/artifacts/storyboard-local-mlx-20260918/third-pass/sweep-report.json`,
`auth{,2,3}-report.json`, `member{,2}-report.json` and `hydration-report.json`, with
screenshots under `/tmp/tz-e2e/browser-e2e/sweep/`.

### Anonymous route sweep

Every listed route answered 200 with no horizontal overflow and no broken images:
`/auth/reset-password` (비밀번호 재설정 링크를 확인해주세요), `/home-frame`,
`/user/b15dcf64-a56f-44fa-9684-f94334c6135f` (먹보쯔양팬, 방문 도장), `/s/abcdef` and
`/s/ab` (both render the 404 page), and `/leaderboard` (redirects to
`/?panel=leaderboard`).

Gated routes redirect to the sign-in surface instead of rendering data:

| route | redirect |
| --- | --- |
| `/privacy/onboarding` | `/?auth=login&reason=privacy_onboarding` (개인정보 확인) |
| `/insights` | `/` |
| `/submissions` | `/auth/required?reason=mypage&next=%2Fmypage` |
| `/mypage/submissions/{new,edit,recommend}` | `/auth/required?reason=mypage` |
| `/admin?module=storyboard` | `/?auth=login&reason=admin&next=…` |

### Authenticated surface at 390, 768 and 1440

With the repository's real admin session (`apps/web/tests/.auth/admin.json`, whose
session is privacy-eligible; no dev bypass header or cookie was used) the sweep ran at
390, 768 and 1440 with zero overflow, zero broken images and no page errors. The home
user menu carries the account label plus 마이페이지 / 환경설정 / 관리자 콘솔 / 로그아웃,
and Escape closes it and returns focus; the tablet and mobile menus expose 마이페이지 /
관리자 콘솔 / 로그아웃. Dark mode on `/`, `/feed`, `/global-map`, `/mypage/profile`
and `/leaderboard` also had no overflow and no broken images.

A member (non-admin) session exists but cannot reach an authenticated surface locally.
The two nightly accounts have no consent record, and every
`privacy_retention.privacy_retention_classes` row is `disabled` with no
`approved_evidence_ref` or `activated_at`, so `create_privacy_onboarding_challenge`
raises `privacy_audit_retention_policy_required`, the onboarding route answers 409 and
the middleware then signs the session out and redirects to `/auth/required?reason=privacy`
on every route. That is fail-closed behaviour. Activating a retention class requires
operator and legal evidence that `docs/agents/privacy.md` forbids inventing, so it was
left disabled; the member flow is blocked, not verified.

### Two console observations, recorded but not fixed

1. `/s/<code>` renders the 404 page but logs
   `TypeError: Failed to execute 'measure' on 'Performance': 'ShortUrlRedirectPage'
   cannot have a negative time stamp.` twice per visit.
2. A signed-in session on `/mypage/*` at 390 and 768 intermittently logs a Next.js
   hydration mismatch (mobile `/mypage/bookmarks` twice; tablet `/mypage/bookmarks` and
   `/mypage/submissions/new` once each; never at 1440) while still rendering correctly.

Neither path is touched by the storyboard branch, so both are recorded here rather than
fixed in this change.

### Continuation sweep: remaining mypage routes, stamp and feed photos

A second sweep (`third-pass/sweep2-report.json`, `hydration2-report.json`) covered the
routes left out of the first pass at all three widths, all with no overflow and no broken
images:

| route | rendered |
| --- | --- |
| `/mypage/submissions/edit` | 맛집 수정 요청 |
| `/mypage/submissions/recommend` | 쯔양 맛집 제보 |
| `/stamp` | 쯔동여지도 도장 (redirects to `/?panel=stamp` at 1440 in this run) |
| `/feed` | 쯔동여지도 리뷰 (2개), 2–4 images |

`/feed` rendered a real review photo from local storage
(`…/review-photos/b15dcf64-…/reviews/1111…/food/1758000000000_food_1_plate.png`) and the
legacy `.png` fixture (`1758000000001_food_1_legacy.png`) through `next/image` at 828/640 px
widths, confirming the PNG compatibility path still resolves locally.

The hydration mismatch is intermittent rather than route-bound. Visiting each route once
per viewport across all three widths produced one hit on `/mypage/submissions/new`
(desktop) and one on `/mypage/submissions/edit` (mobile) and none on the other routes,
whereas the mixed sweep hit one per viewport; the error text names a Suspense boundary. It is logged, not fixed:
the paths belong to the mypage area this branch does not touch, the page still renders,
and the failure is not deterministic enough to attribute to a specific component without
a dedicated investigation.


## Production baseline on the deployed commit `5af1e1f6` (2026-09-18, 5th pass)

Read-only browser inspection of https://www.tzudong.app at 1440x900 and 390x844, with the
per-defect screenshot pair stored under
`apps/web/.omx/artifacts/storyboard-local-mlx-20260918/fourth-pass/prod-defects/` and the
machine-readable digest in `prod-defect-baseline.json` and `prod-filter-report.json`. No
production data was created, edited or deleted.

### Defects that reproduce on production

| defect | production `5af1e1f6` | local head `5b424d73` |
| --- | --- | --- |
| 리뷰 작성자 조인 | every card shows `탈퇴한 사용자`; `read_public_profile_summaries` answers 404 | author nickname renders (먹보쯔양팬) |
| 수정 요청 / 리뷰 작성 버튼 | text is ellipsis-truncated to `수정 …` / `리뷰 …` at both widths | full `수정 요청` / `리뷰 작성`, 98x56 / 206x56, no truncation |
| 유튜브 재생 배지 | inside `div.relative.aspect-video` (365x205) the badge renders as a pale, empty circle below centre; 0 play icons matched | dark translucent centred circle with a white play triangle |
| 테마 필터 | 최근 영상 and 재등장 맛집 filter (16 clusters -> 7); 조회수 폭발, 댓글 폭주, 반응 찐함 leave the map unchanged (16 clusters, top cluster still `379`) | all five change the map: 4 / 4 / 1 / 1 / 2 |
| 닉네임 하단 맛집명 | 16px / 24px | 12px / 16px |
| 최근 리뷰 카드 테두리 | thick dark border around each card | `border-border` (rgb(214,211,209)) |
| 리뷰 사진 | renders, 118 images / 0 broken | renders, 0 broken |

### The truncation is ellipsis, not scroll overflow

Measuring `scrollWidth` vs `clientWidth` reports `overflowX: false` on production even though the
labels are visibly cut: the cards use `text-overflow: ellipsis` with `overflow: hidden`, so the
scroll metric cannot see the loss. Only the screenshot shows `수정 …` and `리뷰 …`. This is why the
objective's instruction to look at the rendered screen rather than trust DOM checks matters here.

### Cluster click did not reproduce

Clicking the largest cluster (`379`) on production moved the map and left 380 individually visible
markers at both widths, so the reported marker evaporation did not reproduce in this scenario on
either the deployed build or the local head. The remaining filter sub-case (a marker selected while
a filter is active) did reproduce and is covered in the fourth-pass section above, where the detail
panel opens with the correct restaurant, address and review data at all three widths.

### Filter toggle evidence

Each chip is a `<button aria-pressed>`; toggling it on production produced:

| filter | pressed | clusters on | clusters off |
| --- | --- | --- | --- |
| 조회수 폭발 | false -> true | 16 | 16 |
| 댓글 폭주 | false -> true | 16 | 16 |
| 최근 영상 | false -> true | 7 | 16 |
| 재등장 맛집 | false -> true | 7 | 16 |
| 반응 찐함 | false -> true | 16 | 16 |

Identical at 1440 and 390, so the three inert filters fail consistently rather than intermittently.
The earlier `getByRole('button', { name })` sweep reported the chips as missing; that was a selector
error, not an absent control, and is corrected here.

