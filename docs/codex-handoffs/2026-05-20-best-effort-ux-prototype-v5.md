# Best-effort UX prototype v5

Date: 2026-05-20
Scope: UX-only prototype for 쯔동여지도 desktop/mobile map-first redesign. Ads/monetization work remains deferred and gated by explicit approval.

## Prototype URL

- Local board: http://127.0.0.1:4192/
- Source directory: /tmp/tzudong-best-prototype-v5
- Board screenshot: /tmp/tzudong-best-prototype-v5/prototype-v5_1-board.png

## Source of truth used

- Real localhost desktop screenshot: /tmp/tzudong-real-app-screenshots/desktop-1440x900-after-15s.png
- Real localhost mobile screenshot: /tmp/tzudong-real-app-screenshots/mobile-390x844-after-15s.png
- Existing app logo and food marker assets from apps/web/public
- Food thumbnail asset from previous Stitch output only as visual placeholder; implementation must use real selected restaurant/video data.

## Design decision

1. Desktop target
   - Remove top route header on `/` desktop.
   - Replace bottom-center search/popular overlay with persistent fixed left panel.
   - Left panel owns search, category filters, domestic/overseas, selected restaurant detail, Tzuyang thumbnail/review, and popular list.
   - Map stays full and dominant on the right.

2. Mobile home target
   - Preserve the current app's map-first home because it is already stronger than Stitch's generated mobile-home outputs.
   - Keep top search shell and circular icons equal-sized.
   - Keep bottom nav static.
   - Continue density tuning only, not structural replacement.

3. Mobile detail target
   - Bottom sheet must expose Tzuyang thumbnail and `쯔양 리뷰` immediately after marker click.
   - Detail content should remain in sheet/panel, not modal.
   - Bottom nav must not cover sheet actions.

## Known limitation

The prototype uses real screenshots as map backdrops, so some old-map UI remnants are masked rather than truly removed. Implementation should remove those source components directly, not mask them.

## Verification

- `curl -I http://127.0.0.1:4192/` returned 200 OK.
- Playwright captured `/tmp/tzudong-best-prototype-v5/prototype-v5_1-board.png` at 1440x2200.
- Visual inspection confirmed desktop left-panel target, mobile map-first target, and mobile detail Tzuyang-review target are visible.
