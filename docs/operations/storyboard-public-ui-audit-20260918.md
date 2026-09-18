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
rendered the search field at **14 px** and mobile Safari would zoom on focus.
Measured with `probe-form-font.mjs` before → after the `lg:text-sm` change:
mobile 390 16 px → 16 px, tablet 768 14 px → 16 px, laptop 1024 14 px → 14 px,
desktop 1440 14 px → 14 px (`form-font-after-report.json`). The shared Input is
the only input on the probed public routes; `/feed`, `/submissions`,
`/mypage/reviews`, `/stamp`, `/leaderboard` and `/privacy` expose none. One
further `text-base … md:text-sm` pair remains at
`apps/web/app/mypage/reviews/page.tsx:415` and was left unchanged.

Continuation is still in progress: remaining safe navigation/visual checks, evidence-link validation and browser cleanup will be recorded before final delivery.
