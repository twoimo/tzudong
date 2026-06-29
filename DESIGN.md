# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-06-29
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
  - No Supabase schema/RLS/mutation behavior changes except explicitly scoped admin audit persistence for user-management actions.
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

## Accessibility
- Target standard: WCAG 2.2 AA for new UI and regressions.
- Keyboard/focus behavior: sidebar, collapse control, active canvas, module actions reachable in predictable order; focus rings visible and not clipped.
- Contrast/readability: red-on-ivory, muted text on tinted cards, and status badges must remain readable.
- Screen-reader semantics: icon-only/collapsed controls require stable accessible names; active navigation exposes `aria-current` or equivalent; content canvas has clear label.
- Reduced motion and sensory considerations: transitions are subtle and not required to understand state; no motion-only state communication.

## Responsive behavior
- Supported breakpoints/devices: mobile/narrow admin fallback, tablet, desktop, large desktop.
- Layout adaptations:
  - Narrow screens stack sidebar above content without horizontal overflow.
  - Desktop uses two-pane workspace and maximizes right canvas.
  - Collapsed desktop sidebar should be narrower and icon-stable without squeezing text.
- Mobile/desktop admin parity: authenticated admin user menus should expose a single “관리자 콘솔” entry that lands on `/admin`; detailed 맛집/제보/리뷰/배너/인사이트 task switching belongs inside the admin console sidebar/canvas so mobile and desktop do not drift.
- Touch/hover differences: touch targets should be approximately 44px high where practical; hover affordances must not be the only state cue.

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

## Implementation constraints
- Framework/styling system: Next.js App Router, React, Tailwind utility classes, existing local UI components.
- Design-token constraints: use current color/radius/shadow/typography tokens; no new dependency or parallel token system.
- Performance constraints: avoid iframe embedding and avoid unnecessary module rewrites; keep dynamic imports for large admin modules.
- Performance constraints: keep admin pending-count/data summaries centralized in the `/admin` workspace where possible; avoid duplicating Supabase count queries in lightweight global/mobile shell menus.
- Compatibility constraints: preserve `/admin`, `/admin/evaluations`, `/admin/banners`, `/admin/submissions`, `/insights`; preserve Supabase query/mutation semantics.
- Supabase admin constraints: privileged user-management writes stay behind server-only service-role routes after `requireAdmin`; user-role mutation remains service-only; `admin_audit_events` records intent/applied status; `admin_user_preferences` stores only per-admin UI ordering preferences under RLS and explicit Data API grants.
- Test/screenshot expectations:
  - `cd apps/web && npx eslint components/admin/AdminConsoleOverview.tsx --max-warnings=0`
  - `cd apps/web && npx tsc --noEmit --pretty false`
  - `cd apps/web && npm run build`
  - Authenticated browser smoke for `/admin`: sidebar label Korean-only, active module switching, no horizontal overflow, no console errors.
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
- [ ] Future audit persistence schema / owner: backend/product / impact: required before the audit placeholder becomes a real write/read surface.
