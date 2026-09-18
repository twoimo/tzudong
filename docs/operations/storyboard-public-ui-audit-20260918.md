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

The [public health check](../../apps/web/.omx/artifacts/storyboard-public-ui-20260918/public-health.json) returned **HTTP 403**. **The deployed commit is unknown.** The inventory's explicitly labeled local SHA is not deployment evidence. No Vercel control-plane inspection was performed.

Authenticated login/OAuth, account-bound bookmarks/MY/reviews, stamp accrual and recovery completion remain blocked by the absence of an authorized test account/recovery proof. Review-photo interaction and share-route checks require existing suitable public content. All source/test results remain distinct from hosted acceptance.

Continuation is still in progress: remaining safe navigation/visual checks, evidence-link validation and browser cleanup will be recorded before final delivery.
