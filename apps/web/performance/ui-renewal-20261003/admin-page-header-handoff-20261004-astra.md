# Admin page header consistency — local handoff

Completed 2026-10-04 in the pipeline-performance-20261002 candidate. No commit, server restart, hosted write or deployment.

- One `AdminPageHeader` now owns heading, icon, adjacent summary and right-side actions. All 15 sidebar modules consume it directly or through `AdminEmbeddedModuleShell`. Pipeline source was integrated by its separate owner.
- Overview title remains visible on mobile; storyboard archive remains available below its primary header. Restaurant context portals and its single automation instance are unchanged.
- Desktop baseline header heights 28–59px became 57px in all 15 modules. Before horizontal padding varied 0/8/12px; final is 12px on each side. All 45 final cases use 16px/600/24px titles, 36px title inset (12px padding + icon slot), and 12px right action inset. Desktop action center deviation is 0px; adjacent summary gap is 8px.
- Tablet 834px: 14 headers are 57px, restaurant is 105px because its controls wrap. Mobile 390px: 61–193px according to content, no header/document overflow, all header controls at least 44×44px. No title or necessary header action is hidden.

## Evidence

- Final rendered audit: `admin-sidebar-pages-browser-20261004-header-followup-astra.json` and SHA256. 45 menu navigations, source manifest stable throughout, source signature `b6ce33453b8e6707a8c7e7cfe900ebbf24f59d83b686ec4c678d31176e6a75bb`.
- Numeric comparison: `admin-page-header-comparison-20261004-astra.json` and SHA256. Header contract assertions 45/45 passed.
- Before: `admin-page-header-before-20261004-astra.json`. Three detached zero rectangles (llm 390/834, audit 390) are explicitly excluded. Mobile overview title was hidden before.
- Header crops: `admin-header-before-*-20261004-astra.png`, `admin-header-after-*-20261004-astra.png`.
- The earlier `admin-sidebar-pages-browser-20261004-header-contract-astra.json` is retained but superseded for geometry; its overview selector matched an sr-only heading and source changed during one case.

## Checks and limits

77 existing tests across 7 files passed; 15 changed TS/TSX files passed ESLint; pinned Node 24 typecheck parity passed with 0 diagnostics / 3173 logical inputs; diff check passed. Source-shape expectations were updated where old markup changed; no new wording-only tests.

Final body verdicts: 42 rendered checks pass and 3 Sentry not configured. Submission/review read evidence comes from the earlier restaurant navigation and shared query cache. The read-only harness blocked three route calculation POSTs and external requests; no server-bound writes were forwarded. Those three route console errors are not header rendering failures. The generic body-control name collector reports unnamed elements in submissions/reviews/banners (1/4/3 per viewport), while every header control has a recorded name. This is not a complete body accessibility audit. Local fixture rendering does not establish real providers, production data, or deployment.

## Owned source paths (relative to apps/web)

- New `components/admin/AdminPageHeader.tsx`
- `components/admin/AdminEmbeddedModuleShell.tsx`, `AdminConsoleOverview.tsx`, `AdminUsersPanel.tsx`, `AdminOperationsPanel.tsx`, `AdminSentryPanel.tsx`, `AdminKnowledgeGraphPanel.tsx`, `RestaurantManagementWorkspace.tsx`
- `components/admin/storyboard/AdminStoryboardGenerator.tsx`, `LocalStoryboardWorkspace.tsx`
- `app/admin/banners/page.tsx`, `app/admin/evaluations/page.tsx`
- `styles/admin-ui.css`
- `scripts/verify-admin-sidebar-pages-browser.ts`
- `tests-unit/admin-console-uiux-source.test.ts`, `admin-user-management-source.test.ts`

Other pipeline, migration/backend, package/version/type/ledger and rollout changes belong to other work. The original d44d and Documents project checkouts were not modified.
