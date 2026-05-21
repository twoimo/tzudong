# Stitch UX prototype v4 — implementation-grounded verdict

Date: 2026-05-20
Scope: UX-only map-first redesign exploration for Tzudong. Ads/monetization is explicitly deferred and must not be worked on without asking: `광고 수익화 관련 작업을 진행할까요?`

## Current verified app baseline

- Local dev server was restarted with `npm run dev:webpack` and verified at `http://localhost:8080/`.
- `http://127.0.0.1:8080/` produced blank screenshots because Next dev blocked HMR for cross-origin dev resources; `localhost:8080` rendered correctly.
- Captured real app screenshots:
  - `/tmp/tzudong-real-app-screenshots/desktop-1440x900-after-15s.png`
  - `/tmp/tzudong-real-app-screenshots/mobile-390x844-after-15s.png`
  - `/tmp/tzudong-real-app-screenshots/desktop-1440x900-prod-after-10s.png`
  - `/tmp/tzudong-real-app-screenshots/mobile-390x844-prod-after-10s.png`

## Stitch project

- Project ID: `7942565647095284068`
- Current useful generated assets:
  - Desktop left-panel target: `/tmp/tzudong-stitch-ux-prototype-assets-v3/desktop-left-panel-v3.png`
  - Mobile detail target: `/tmp/tzudong-stitch-ux-prototype-assets-v4/mobile_detail_v4_screen.png`
- Rejected asset:
  - Mobile home v4: `/tmp/tzudong-stitch-ux-prototype-assets-v4/mobile_home_v4.png` because Stitch kept English labels and produced a low-fidelity abstract map.

## Verdict

1. Desktop: Use the v3 desktop Stitch output as the IA target.
   - Remove the top header on `/` desktop.
   - Put search, category filters, domestic/overseas, region, popular list, and selected restaurant detail in a fixed left panel.
   - Keep Naver map full-bleed on the right.
   - Do not keep the current bottom-center search/popular overlay on desktop.

2. Mobile home: Do not use Stitch art as the source of truth.
   - The real app mobile screenshot is better and should be preserved as baseline.
   - Continue only minor compactness/fidelity tuning on real components.

3. Mobile detail: Use v4 detail Stitch as content target.
   - The bottom sheet must visibly include Tzuyang thumbnail and `쯔양 리뷰` after marker click.
   - Keep all content inside sheet/panel, not modal.
   - Bind to real selected restaurant data, not generated placeholder copy.

## Visual QA state

Persisted to `.omx/state/visual-prototype-v4/ralph-progress.json`.
