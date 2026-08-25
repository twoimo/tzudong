# Stitch UX prototype v3 critique and next-quality bar

Date: 2026-05-20
Scope: Tzudong UX-only Google Stitch prototype
Status: v2 is useful for direction, not final product-quality

## Honest answer

The current Stitch v2 prototype is not the best achievable result.

It is good enough to validate the broad direction:
- desktop should be headerless with a left panel and right map,
- modal-like desktop flows should move into the left panel,
- mobile should keep map-first layout and use bottom sheets,
- detail panels must restore Tzuyang video thumbnails/reviews,
- ads/monetization remain excluded.

But it is not yet good enough for final product/design approval.

## Main weaknesses in v2

1. Map fidelity is inconsistent
   - Some screens show believable Seoul map tiles.
   - Some generated maps are too abstract or low-information.
   - Best next version should use actual app/Naver-map screenshots as visual reference, not purely generated map art.

2. Component fidelity is still generic
   - Cards, chips, controls, and icon spacing are close but not yet tied to the real React/Tailwind component system.
   - Mobile circular icon sizing is improved but still should be checked against actual 40x40 tokens.

3. Interaction is only click-through, not true prototype logic
   - The local HTML prototype links static states.
   - It does not demonstrate sheet drag, scroll positions, panel transitions, loading/content progressive behavior, or keyboard/focus behavior.

4. Korean content needs production polish
   - Copy is understandable, but not fully product-owned.
   - Restaurant metadata, review excerpt, menu labels, and trust badges should be normalized from actual data models.

5. Desktop left panel needs real density tuning
   - The direction is correct, but exact width, scroll behavior, sticky actions, and result/detail transitions need implementation-grounded validation.

6. Mobile detail sheet still needs hierarchy tuning
   - Tzuyang review is visible, but the top fold could better balance restaurant identity, actions, and video content.
   - Bottom nav and sheet overlap/safe-area behavior should be matched to real device viewport.

## Better v3 standard

The next prototype should be judged against this bar:

### Desktop
- 392px left panel, map fills remaining viewport.
- No global header or transient header flash.
- Search/categories/toggles are compact and stable.
- Result list and detail panel use same left-panel shell.
- Account/settings/notice flows are panel states, not modal overlays.
- Right map uses actual or near-actual Naver-map visual reference.
- Selected marker, hover card, cluster markers, zoom/location/layer controls are consistent.

### Mobile
- Initial route shows map immediately.
- Search row has identical 40x40 user/bookmark/notification circular icons.
- Category chips, domestic/overseas toggle, and region selector have compact vertical height.
- Bottom nav is static immediately, not progressive/loading.
- Marker tap opens bottom sheet.
- Detail sheet shows core info/actions first, then Tzuyang video thumbnail and review.
- No popup, no fullscreen loading page, no red-dot skeleton.

### Content
- Tzuyang video thumbnail appears in desktop and mobile detail.
- Tzuyang review excerpt appears near the thumbnail.
- Organic restaurant content is clearly separate from any future commercial content.
- For now: no ads, no Coupang, no AdSense, no sponsor, no partner-link card.

## Best next method

Stitch-only generation is not enough for final quality. The best next method is:

1. Capture current real app screenshots for desktop `/` and mobile `/`.
2. Use those screenshots as the visual baseline.
3. Use Stitch only for divergent layout exploration.
4. Convert the preferred layout into actual React/Tailwind implementation or a local HTML prototype with real tokens.
5. Validate in browser with screenshots and visual diff.

## v3 Stitch prompt direction

Use this wording for a stronger Stitch v3 pass:

```text
Create a production-grade UX-only prototype for 쯔동여지도 using real map-service conventions. Do not include ads, monetization, AdSense, Coupang, sponsors, affiliate, partner links, or commercial placements.

This should look like a real Korean map product, not a generic concept mockup. Use a crisp Naver/Kakao-style map visual with roads, district labels, POI labels, selected marker, clusters, zoom/location/layer controls. Keep map visible as the primary surface.

Desktop: no global header. Use a 392px left panel and full remaining map. The left panel must support states: search results, restaurant detail, account/settings/notice. Do not use centered modals or dimmed overlays. Make search, categories, domestic/overseas toggle, and region selector compact. Use real Korean copy and dense but readable restaurant cards.

Mobile: map visible immediately. Search row has identical 40x40 circular user/bookmark/notification icons. Category chips and toggles are compact. Bottom nav is static immediately. Marker tap opens a bottom sheet. Detail bottom sheet shows restaurant identity/actions, then Tzuyang video thumbnail, title, metadata, and review excerpt. No spinner page, no red-dot skeleton, no popup.

The output should include five screens: desktop search, desktop detail, desktop account/settings panel, mobile search, mobile detail sheet. Add subtle state labels only if they help prototype review.
```

## Current artifact references

- Stitch project: `7942565647095284068`
- v2 prototype: `http://127.0.0.1:4188/prototype-v2.html`
- v2 assets: `/tmp/tzudong-stitch-ux-prototype-assets-v2/`

## Decision

Do not treat v2 as final. Treat it as a direction prototype. The final design should be implementation-grounded using real app screenshots/components.
