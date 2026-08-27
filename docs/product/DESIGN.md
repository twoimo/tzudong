# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-07-08
- Primary product surfaces: public map/home shell, admin unified console, admin moderation/evaluations, submissions/reviews, banner management, user/account management, insights, LLM operations session panel
- Evidence reviewed:
  - `apps/web/app/globals.css`: warm ivory background, red primary, muted borders, radius, semantic Pretendard UI + Noto Serif KR display typography, app header height, body overflow hidden with layout-owned scrolling.
  - `apps/web/app/app-globals.css`: runtime tokens, accessibility utilities, subtle noise/background, shadow/elevation, motion conventions.
  - `apps/web/components/layout/Header.tsx`: rounded controls, red primary actions, semantic sans typography for chrome, compact responsive behavior.
  - `apps/web/components/layout/OverlayLayout.tsx`, `apps/web/components/layout/MainLayout.tsx`: desktop overlay/panel composition and mobile-specific layout behavior.
  - `apps/web/components/admin/AdminConsoleOverview.tsx`: unified admin console, collapsible sidebar, right content canvas, direct inline modules, guarded apply and LLM workspace concepts.
  - `apps/web/components/admin/AdminUsersPanel.tsx`, `apps/web/app/api/admin/users/**`: administrator-only user/account management with server-side Supabase Auth Admin boundaries, self-lockout guards, and audit events.
  - `apps/web/app/admin/evaluations/page.tsx`, `apps/web/app/admin/banners/page.tsx`, `apps/web/app/insights/insights-client.tsx`: canonical admin modules embedded into `/admin`; standalone routes must stay stable.
  - `apps/web/design/pencil/reports/admin-unified-console-design-brief-20260512T133359Z.md`: warm editorial operations hub, clear entry flows, status summaries, guarded destructive operations.
  - `apps/web/docs/pencil-storyboard-sync.md`, `apps/web/tests-unit/pencil-storyboard-contract.test.ts`: design artifacts should be reviewable, manifest-backed, and tied to repo source.
  - `https://github.com/changeroa/StyleGallery/tree/775430bbaf4ee208a642220f440f6926d79c90a3`: unlicensed, immutable question checklist only; no upstream code, CSS, prose, names, tests, or assets are copied or translated.
  - `apps/web/stylegallery-adoption.v1.json`, `apps/web/components/home/home-map-container.tsx`, `apps/web/components/home/MobileControlOverlay.tsx`: Tzudong-owned layout vocabulary, scroll ownership, safe-area controls, and clean-room adoption evidence.
  - `apps/web/components/ui/table.tsx`, `apps/web/tests/responsive-overflow.spec.ts`: owner-gated horizontal-scroll policy via `data-horizontal-scroll-owner` and responsive overflow guard allowlisting.
  - `apps/web/performance/*`: canonical performance inputs, scorer/validator outputs, frozen-tree evidence, and artifact-map references only; the artifact-map SHA is recorded out of band.
  - `backend/naming-renames.v1.json`: bounded high-confidence taxonomy and rename evidence, not authorization for all-path naming churn.
  - StyleGallery commit `775430bbaf4ee208a642220f440f6926d79c90a3` is unlicensed and question-only; `apps/web/stylegallery-adoption.v1.json` records clean-room, no-copy adoption. Neither reference implies affiliation.

## Brand
- Personality: warm Korean food-map product, editorial, trustworthy, calm, operationally clear.
- Trust signals: visible counts/status, source/readback/audit copy, stable routes, explicit read-only/guarded-apply boundaries.
- Avoid: generic cold SaaS dashboard chrome, heavy glassmorphism, English-first admin labels, decorative jargon, iframe-like nested page UX.

## Product goals
- Goals:
  - Help users/operators quickly identify reliable restaurants, reports, reviews, banners, insights, and operational state.
  - Make `/admin` a single operating hub where sidebar selections update the right content canvas in-place.
  - Preserve existing canonical flows: `/admin/evaluations`, `/admin/banners`, `/insights`, and legacy submissions behavior.
  - Keep risky actions visibly constrained by Preview → Confirm → Apply → Readback → Audit.
- Non-goals:
  - No dependency additions for this admin-console refresh.
  - Admin-console layout changes do not alter Supabase semantics; separately scoped privacy migrations and RPCs follow the privacy-sensitive contract below.
  - No broad rewrite of large existing admin modules unless a focused embedded seam is required.
  - No iframe embedding for admin modules.
- Success signals:
  - `/admin` fills the viewport without horizontal overflow.
  - Sidebar collapse feels stable: labels hide cleanly, icons do not reflow awkwardly, accessible names remain.
  - Active module content replaces the right canvas instead of stacking under persistent overview chrome.
  - Lint/type/build and authenticated browser smoke checks pass.

## Personas and jobs
- Primary personas: admin/operator, moderator/reviewer, product maintainer checking operational health.
- User jobs:
  - Triage pending restaurant submissions and review queues.
  - Manage approved restaurants, geocoding gaps, deleted/restored candidates.
  - Manage banner exposure and priority safely.
  - Manage user profiles, administrator roles, and account disabled/reactivated states without exposing privileged keys to the browser.
  - Inspect insights without leaving the admin workspace.
  - Use LLM operation helpers as advisory/read-only support.
- Key contexts of use: desktop operations sessions, tablet spot checks, narrow mobile fallback, authenticated admin-only access.

## Information architecture
- Primary navigation: left admin sidebar with grouped Korean labels and direct module buttons.
- Core routes/screens: `/admin`, `/admin/evaluations`, `/admin/banners`, `/admin/submissions`, `/admin?module=users`, `/insights`.
- Content hierarchy:
  - Sidebar: concise navigation/state only.
  - Right canvas: active module or overview; overview summaries should not persist above every module.
  - Module chrome: minimal local context only; avoid redundant global title cards inside active work screens.

## Design principles
- Principle 1: 운영 허브 우선. The admin console should feel like a workspace, not a marketing page or link directory.
- Principle 2: 안전한 변경 우선. Risky actions must surface preview, confirmation, readback, and audit language.
- Principle 3: 한국어 우선. Primary admin chrome and navigation should use concise Korean labels.
- Principle 4: 기존 흐름 보존. Standalone routes and large admin modules stay compatible while `/admin` embeds them directly.
- Tradeoffs: overview cards may duplicate some live counts, but active module screens should stay clean and focused; decorative warmth is acceptable only when readability and scroll behavior remain strong.
- Principle 5: 레이아웃 소유권 명시. StyleGallery-style primitives document the one spatial job each surface owns; horizontal scan areas must expose a narrow owner instead of hiding overflow broadly.

## Visual language
- Color: warm ivory/off-white surfaces (`hsl(38 30% 98%)`), red primary (`hsl(0 74% 42%)`) for high-emphasis actions/active states, muted border/status colors for secondary information.
- Typography: Pretendard for Korean UI/body density; Noto Serif KR remains the intentional display/editorial role. Compact strong headings are allowed, but avoid sterile enterprise typography and avoid global serif body text.
- Spacing/layout rhythm: full-width admin viewport, tight but readable operational density, `min-h-0` and layout-owned scroll containers.
- Shape/radius/elevation: rounded cards/pills/sidebar controls (`rounded-xl`/`rounded-2xl`), subtle borders, soft shadow/glow only for hierarchy.
- Motion: subtle transitions; collapse/expand should not show text squeezing or awkward reflow.
- Imagery/iconography: lucide icons are supporting cues; text remains the source of meaning.

## Components
- Existing components to reuse: `Button`, `Badge`, `Card`, `Separator`, `GlobalLoader`, existing admin modules, existing sidebar icon set.
- New/changed components:
  - Admin sidebar header: single-line Korean label, no English `Admin`, no wrap.
  - Admin overview: exactly two viewport-bounded panes: left pane reuses the public home Naver map/marker visual for administrator map operations, right pane shows selected marker details, management summary, creator layer controls, and route candidates. Do not add a separate hero, task queue, or status strip above the panes.
  - Admin user-management panel: searchable user list, server-backed create/profile/role/status actions, self-lockout copy, readback/audit result messages.
  - Admin sidebar order editor: sidebar-owned compact control for administrator-specific menu ordering. Keep it outside the two-pane overview, persist through `/api/admin/preferences/sidebar-order`, and provide keyboard buttons plus `aria-live` feedback instead of drag-only interaction.
  - Overview cards/guarded-apply panels: card/pill rhythm consistent with 맛집/제보/리뷰/배너/user management surfaces.
- Variants and states: active, hover, focus-visible, collapsed, loading, empty, error, read-only, guarded.
- Token/component ownership: prefer repo tokens and existing shadcn-style components; do not introduce a new design-system layer.
- StyleGallery layout contracts:
  - Public home map root owns the `viewport-shell overlay-stack cluster` contract and has the Korean region label `쯔동여지도 홈 지도 화면`.
  - Mobile home theme filters are the only current home `reel cluster`; the approved horizontal owner is `mobile-theme-filter-reel`.
  - Admin KPI dashboard management uses the `command-surface` recipe for the order/report/period command row.
  - Shared table horizontal scrolling is owner-gated: `allowHorizontalScroll` may preserve visual overflow, but policy allowlisting requires an explicit `data-horizontal-scroll-owner` such as `stamp-restaurant-list-table` or `admin-evaluation-table`.

## Accessibility
- Target standard: WCAG 2.2 AA for new UI and regressions; it is a target, not a certification claim.
- Keyboard/focus behavior: sidebar, collapse control, active canvas, and module actions are reachable in predictable order; focus rings remain visible, are not clipped, and the layout-owned scroll container scrolls the focused control into view.
- Contrast/readability: red-on-ivory, muted text on tinted cards, and status badges remain readable.
- Screen-reader semantics: icon-only/collapsed controls require stable accessible names; active navigation exposes `aria-current` or equivalent; content canvas has a clear label.
- Mobile controls respect safe-area insets. Motion honors `prefers-reduced-motion`, remains subtle, and is never required to understand state.
- Accessibility and visual evidence is sanitized: retain only route, viewport, visible control labels, fixed state codes/counts, and approved scroll owners; exclude cookies, tokens, headers, local storage, precise coordinates, raw OCR, raw admin/table data, and Supabase payloads.

## Responsive behavior
- Supported breakpoints/devices: mobile/narrow admin fallback, tablet, desktop, large desktop.
- Layout adaptations:
  - Narrow screens stack sidebar above content without horizontal overflow.
  - Desktop uses two-pane workspace and maximizes right canvas.
  - Collapsed desktop sidebar should be narrower and icon-stable without squeezing text.
- Mobile/desktop admin parity: authenticated admin user menus should expose a single “관리자 콘솔” entry that lands on `/admin`; detailed 맛집/제보/리뷰/배너/인사이트 task switching belongs inside the admin console sidebar/canvas so mobile and desktop do not drift.
- Touch/hover differences: touch targets should be approximately 44px high where practical; hover affordances must not be the only state cue.
- Horizontal scroll policy: `data-allow-horizontal-scroll="true"` is not a generic escape hatch. It must be paired with an approved owner: `mobile-theme-filter-reel`, `admin-dashboard-action-bar`, `admin-dashboard-series-toggle`, `admin-dashboard-card-title-actions`, `admin-dashboard-kpi-title-actions`, `stamp-restaurant-list-table`, `admin-evaluation-table`, `storyboard-canvas-toolbar`, `storyboard-chat-examples`, or `storyboard-chat-attachments`. Naver map cluster marker overflow remains a provider-specific exception outside this policy.

## Interaction states
- Loading: use `GlobalLoader` only for full auth/page gates. Inline admin moderation modules should render the work screen shell immediately and place skeletons inside the actual elements that are loading: header counts, filters, table rows, list cards, badges, and action cells. Avoid large route-level loading cards such as “제보 큐를 여는 중”, “리뷰 검수 큐를 여는 중”, or “맛집 검수 화면을 여는 중”; operators should see the target screen shape first, with per-element loading affordances and reduced-motion-safe animation.
- Empty: show concise next action, not a dead end.
- Error: preserve navigation and show read-only fallback where possible.
- Embedded admin modules: do not add a second explanatory header above the real work surface; avoid repeated context badges like “독립 라우트 보존” or “문서 스크롤 없음” in the visible canvas.
- Success: confirm state with readback/audit copy for risky operations.
- Disabled: explain why when action is blocked by upload/loading/permission.
- Offline/slow network, if applicable: keep existing routes usable; summary counts may show `—` rather than blocking module entry.

## Content voice
- Tone: concise, calm, operational Korean.
- Terminology: use “관리자 콘솔”, “운영 요약”, “읽기 전용”, “검토 필요”, “적용 전 확인”, “감사 기록”. Avoid wrapper-context labels such as “이 화면에서 처리” when the active module title already explains the task.
- Microcopy rules:
  - Avoid English-first admin chrome such as “Unified admin console” unless it is internal-only and visually hidden from primary UI.
  - Answer: “현재 상태는 무엇이고, 다음 안전한 행동은 무엇인가?”
  - Keep LLM helper copy clearly advisory/read-only.
  - Use Korean-first KPI/report chrome: `쯔양 KPI 대시보드` and `쯔양 KPI 대시보드 보고서` are user-facing; English dashboard names are internal-only at most.

## Implementation constraints
- Framework/styling system: Next.js App Router, React, Tailwind utility classes, existing local UI components.
- Design-token constraints: use current color/radius/shadow/typography tokens; no new dependency or parallel token system.
- Performance constraints: avoid iframe embedding and avoid unnecessary module rewrites; keep dynamic imports for large admin modules.
- Performance constraints: keep admin pending-count/data summaries centralized in the `/admin` workspace where possible; avoid duplicating Supabase count queries in lightweight global/mobile shell menus.
- Compatibility constraints: preserve `/admin`, `/admin/evaluations`, `/admin/banners`, `/admin/submissions`, `/insights`; preserve Supabase query/mutation semantics.
- Supabase admin constraints: privileged user-management writes stay behind server-only service-role routes after `requireAdmin`; user-role mutation remains service-only; `admin_audit_events` records intent/applied status; `admin_user_preferences` stores only per-admin UI ordering preferences under RLS and explicit Data API grants.
- Layout-contract constraints: keep StyleGallery primitive hooks source-visible (`data-layout-primitives`, `data-layout-recipe`, `data-scroll-owner`) and avoid adding decorative primitives that do not match the real spatial job.
- Performance evidence constraints: use only `apps/web/performance/*` with its scorer/validator and an artifact map whose SHA is stored out of band. Reports state absolute, relative, and noise budgets and retain frozen-tree evidence; zero admitted slices is valid. No current G003 measured improvement is established without retained raw and scored artifacts.
- Load-test constraints: run only authorized, bounded, non-production tests with explicit stop conditions, rollback, and readback receipts. This is not a capacity certification.
- Recovery/release constraints: the dirty original worktree is immutable and the isolated recovery candidate is the only edit surface; never reset, stash, or clean. Start each serialized content-patch PR from a fresh head and promote `develop -> data -> main` only under external approval and branch protection.
- Hosting constraints: verify the exact Git-integrated `tzudong` Vercel project before an action; do not use a stale `web` project or mutate DNS. A release or rollback requires external approval, branch-protection evidence, rollback planning, and a deployment readback receipt. No merge or deployment is asserted here.
- Test/screenshot expectations:
  - `cd apps/web && npx eslint components/admin/AdminConsoleOverview.tsx --max-warnings=0`
  - `cd apps/web && npx tsc --noEmit --pretty false`
  - `cd apps/web && npm run build`
  - Authenticated browser smoke for `/admin`: sidebar label Korean-only, active module switching, no horizontal overflow, no console errors.
  - Responsive overflow QA: `cd apps/web && bunx playwright test tests/responsive-overflow.spec.ts --project "Samsung Galaxy S20 Ultra" --project "iPhone 14 Pro Max" --project "iPad Pro" --project "Surface Pro 7"`.
  - Privacy-safe browser QA evidence: device/route, viewport size, overflow counts, approved owner list, and narrowly scoped visible headings/buttons only; do not persist cookies, headers, localStorage, raw admin body text, raw table content, or Supabase payloads.
  - Visual verdict target: current admin console should score 90+ against this repo-local design contract, with any remaining issues recorded.
  - AHP committee target for the admin console: weighted score must be 99+ before claiming the expert-committee UI loop complete; source-honest pending data, canonical module URL state, typed confirmation for destructive operations, and task-first overview hierarchy are part of the scoring contract.

### Admin console AHP rubric
- Visual hierarchy/readability: 25%
- Operational IA/task flow clarity: 20%
- Accessibility/WCAG 2.2 AA: 20%
- Responsive/layout/scroll robustness: 15%
- Brand/design-system consistency: 15%
- Implementation simplicity/regression risk: 5%
- Required evidence for a 98+ scoped UI cleanup claim: scoped source-contract tests, lint, typecheck, production build or documented build blocker, source grep for removed visible chrome, canonical URL-backed module state preserved, exactly two admin overview panes with home Naver map/marker reuse, no visible English-first chrome, and saved AHP/quality-gate note.
- Required evidence for a 99+ aggregate claim: full unit suite or scoped source-contract tests, lint, typecheck, production build, admin-only access smoke, no missing accessible names in source contracts, no horizontal overflow contract, focus/scroll reset on module switch, canonical URL-backed module state with stale-param cleanup, no visible English-first chrome, typed confirmation before destructive admin operations, and saved AHP/quality-gate JSON. Authenticated DB-mutating browser smoke is a separate production-readback gate when credentials are available.

## Open questions
- [ ] Production analytics/ops data contract / owner: product/backend / impact: needed before advisory LLM UI becomes write-capable.
- [ ] Stable authenticated visual regression screenshots / owner: frontend QA / impact: would improve visual-verdict comparisons beyond heuristic screenshots.
- [ ] Production privacy migration/RLS/RPC/type readback / owner: backend/privacy owner / impact: required before release; local schema tests do not prove the deployed catalog.

## Privacy-sensitive interaction contract
- Privacy onboarding precedes account creation. The UI must show the exact Korean policy version and content-hash-bound notice, require an explicit policy acknowledgement, and keep optional marketing choices visually and semantically separate.
- Registration for users under 14 remains unavailable until an operator-approved guardian-verification provider is deployed and independently read back. The blocked state must explain that limitation without collecting a birth date, guardian contact, or resident registration number.
- Marketing controls are purpose- and channel-specific (`email`, `sms`, `push`). A separate control is required for advertising between 21:00 and 08:00; ordinary consent must never imply night-time consent.
- Device location uses a just-in-time disclosure immediately before the browser permission prompt. Coordinates remain in memory, the watcher is stopped on cancellation or unmount, and stored restaurant/business coordinates are presented as a separate data category.
- Account deletion keeps the existing risky-action grammar: Preview → exact `계정 삭제` confirmation → Apply → Readback → Audit. Legal holds, last-admin protection, recent reauthentication, and session revocation are visible blockers rather than hidden retries.
- The privacy-incident workspace is an operator decision aid. It displays awareness time, the bounded 72-hour assessment window, named approval and receipt fields, and fixed status/reason codes; it must not say an authority or user notice was filed or accepted without an external receipt.
- Privacy-safe visual evidence may retain route, viewport, control labels, state codes, counts, and approved scroll owners only. It must not retain cookies, tokens, headers, local storage, email/phone values, precise coordinates, raw OCR, free-form incident evidence, admin tables, or Supabase payloads.
- These interaction controls are product safeguards, not a legal-compliance certification. Policy publication, retention periods, guardian/provider approval, location-business filing or non-applicability, incident notices, and Korean legal review remain external release gates.
- External production evidence remains required for policy publication, Korean legal/privacy-owner review, location filing or non-applicability, guardian/provider approval, incident submission/receipt, retention/operator approval, approved HTTPS provider capability, and hosted migration/RLS/grant/RPC/type/catalog, backup/PITR, key-management, and operator-access readback. Source safeguards do not prove any of those facts.
