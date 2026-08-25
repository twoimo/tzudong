# Ads/monetization deferred gate

Date: 2026-05-20
Scope: Tzudong UX roadmap / planning handoff

## Decision

Advertising and monetization are the lowest-priority future workstream.

Do not start any of the following without a fresh explicit user approval:
- Google AdSense
- Coupang Partners
- direct sponsorship
- partner-link cards
- monetization event pipelines
- public monetization slots
- ad provider scripts
- public `ad_banners` migration
- any UI that looks or behaves like a commercial placement

## Mandatory question

Before any advertising/monetization-related work, ask exactly:

`광고 수익화 관련 작업을 진행할까요?`

Proceed only if the user explicitly answers yes in that future turn.

## Current priority

Continue UX-only work first:
1. Core map-first UX.
2. Desktop headerless left-panel experience.
3. Mobile bottom-sheet usability.
4. Restaurant detail content completeness, including Tzuyang video thumbnails/reviews.
5. Performance, accessibility, admin/operator usability.
6. No-popup/no-overlay guardrails.

## Source artifacts

- `.omx/plans/prd-ux-first-monetization-20260520.md`
- `.omx/plans/test-spec-ux-first-monetization-20260520.md`
- `.omx/context/ux-first-monetization-ads-affiliate-20260519T132854Z.md`
- Runtime state: `ux-monetization-priority-gate-state.json`
