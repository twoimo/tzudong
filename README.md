<div align="center">
  <p>
    <img src="apps/web/public/logo.png" width="72" alt="Tzudong Map logo" />
  </p>
  <h1>Tzudong Map</h1>
  <p><strong>A map-first restaurant product for places featured in Tzuyang videos.</strong></p>
  <p>
    <a href="https://tzudong.app">Live app (external status; not verified by this candidate)</a>
    ·
    <a href="https://github.com/twoimo/tzudong/releases/tag/v1.2.3">Latest release (external status; not verified by this candidate)</a>
    ·
    <a href="README.ko.md">한국어</a>
    ·
    <a href="LICENSE">MIT</a>
  </p>
  <p>
    <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs" />
    <img alt="React 19" src="https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
    <img alt="Supabase" src="https://img.shields.io/badge/Supabase-PostgreSQL%20%2B%20Auth-3ecf8e?logo=supabase&logoColor=white" />
    <img alt="Runtime" src="https://img.shields.io/badge/runtime-Node%2024.x%20%2B%20Bun-c8a2c8" />
  </p>
</div>

---

Tzudong Map turns mukbang video evidence into a usable restaurant map: users discover places on mobile, operators verify data in an admin console, and the storyboard workspace creates visual cuts for content production.

## Highlights

| Product surface | What it does |
| --- | --- |
| **Map discovery** | Search, filters, clustered food markers, current-location flows, and restaurant detail bottom sheets. |
| **Community loops** | Reviews, stamp passport, ranking, likes, and profile surfaces for repeat engagement. |
| **Admin operations** | Guarded moderation, source readback, approve/delete/restore flows, and audit-friendly mutations. |
| **Storyboard workspace** | Chat-driven storyboard planning, 10-cut generation, cut metadata, image refresh, and provider readiness UX. |
| **Evidence pipeline** | Crawling, Rule/LLM-as-a-Judge evaluation, fail-closed validation, and Supabase-ready payloads. |
## Recovery-candidate engineering and release evidence

- **Toolchain.** The web runtime is Node 24.x. Bun remains supported for day-to-day install and unit flows, while npm 11.6.2, `package.json`, and `package-lock.json` are the release package authority; `bun.lock` must be reconciled with that authority.
- **Compiler evidence.** The native TypeScript CLI is the exact `@typescript/native` alias at `7.0.2`; TypeScript `6.0.2` is the stable API/compatibility bridge. Use `npm run typecheck:parity` and `npm run typecheck:benchmark`; never suggest a global compiler.
- **Performance evidence.** Canonical performance material lives in `apps/web/performance/*`, uses its scorer/validator, and maps artifacts to an out-of-band SHA. Reports state absolute, relative, and noise budgets and retain frozen-tree evidence; zero admitted slices is valid. No current G003 measured improvement is established without retained raw and scored artifacts.
- **Style and naming evidence.** `apps/web/stylegallery-adoption.v1.json` records Tzudong-owned clean-room adoption. The unlicensed StyleGallery commit `775430bbaf4ee208a642220f440f6926d79c90a3` is question-only and no code, CSS, prose, names, tests, or assets are copied; this does not imply affiliation. `backend/naming-renames.v1.json` is bounded high-confidence taxonomy/rename evidence, not authorization for all-path churn.
- **Accessibility, visual, and load evidence.** WCAG 2.2 AA is a target, not certification. Focus stays visible and is scrolled into the owning region; mobile controls respect safe areas; reduced motion is honored. Keep only sanitized visual evidence. Load tests require authorization, non-production scope, bounded volume, explicit stop conditions, rollback, and readback receipts.
- **Worktree, release, and Vercel evidence.** The dirty original worktree is immutable; edits belong in an isolated recovery candidate with no reset, stash, or clean. Fresh-head serialized content-patch PRs move `develop -> data -> main` under external approval and branch protection. Before any hosting action, verify the exact Git-integrated `tzudong` Vercel project; do not use a stale `web` project or mutate DNS. Release and rollback require approval, branch-protection, rollback, and readback receipts. No merge, deployment, or live URL state is verified by this candidate.

## Product tour

### Desktop

**Map discovery and restaurant detail**

<p align="center">
  <img src="apps/web/public/images/readme-product-tour.gif" width="900" alt="Tzudong Map desktop product tour" />
</p>

**Admin storyboard workspace**

![Storyboard workspace generating a 10-cut storyboard](apps/web/public/images/readme-storyboard-demo.gif)

### Mobile

<table>
  <tr>
    <td width="50%"><strong>Home map</strong><br /><small>Browse markers → expand restaurant detail</small><br /><img src="apps/web/public/images/readme-mobile-home-map.gif" alt="Home map marker browsing and expanded restaurant detail mobile demo" /></td>
    <td width="50%"><strong>Review feed</strong><br /><small>Scroll reviews → open restaurant detail</small><br /><img src="apps/web/public/images/readme-mobile-reviews-feed.gif" alt="Reviews feed mobile demo" /></td>
  </tr>
  <tr>
    <td width="50%"><strong>Stamp passport</strong><br /><small>Browse stamped places → read detail</small><br /><img src="apps/web/public/images/readme-mobile-stamp-passport.gif" alt="Stamp passport mobile demo" /></td>
    <td width="50%"><strong>Ranking profile</strong><br /><small>Open top profile → switch tabs</small><br /><img src="apps/web/public/images/readme-mobile-leaderboard-ranking.gif" alt="Ranking and profile mobile demo" /></td>
  </tr>
</table>

## Privacy safeguards and release prerequisites

G010/G013/G014 source safeguards implement fail-closed privacy boundaries:

- Account creation is bound to an explicit acknowledgement of the exact published Korean policy version and content hash.
- Registration for users under 14 is unavailable until a verified guardian workflow is deployed and read back; the flow does not request a birth date, guardian contact, or resident registration number.
- Marketing consent is purpose- and channel-specific, with a separate grant for advertising between 21:00 and 08:00.
- Shared sanitization keeps credentials, personal data, precise location, raw OCR, arbitrary bodies, and provider diagnostics out of logs and minimized audit evidence.
- Device location is disclosed just in time, held in memory only, and stopped when the user cancels or leaves the flow.
- Account deletion, retention, and privacy incidents use Preview → Confirm → Apply → Readback → Audit with fixed codes, legal-hold/authorization checks, and human-owned external notices.

These source safeguards are not legal compliance or production proof. Release remains blocked pending external evidence of exact policy publication; Korean legal/privacy-owner review; location-business filing or documented non-applicability; guardian/provider approval before any under-14 support; incident submission and receipt; operator-approved retention classes; an approved HTTPS marketing provider with production secrets and internal capability controls; and hosted migration/RLS/grant/RPC/type/catalog, backup/PITR, key-management, and operator-access readback. The external links above are status references only and are not verified by this candidate.
