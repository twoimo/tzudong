# Tzuyang family brand language (Goodtzu + Gardens), 2026-10-21

## References (observed 2026-10-21, visual reference only)
- Goodtzu food mall, https://www.goodtzu.co.kr: SUIT type, near-black ink `#1b1b1b`, pale canvas `#f6f8fa`, tangerine `#ff7b43`/`#f85c00`, heavy black wordmark, playful food copy, ~12px card radius.
- Gardens clothing mall, https://gardens.it.kr: Pretendard, garden green `#207846`, cream `#f5f0e9`, coral `#f76560`, small green eyebrow over bold title with emoji, green circular rank chips, black pill CTA, ~12px card radius.
- No logos, photos, product copy, prices or commerce links were copied into Tzudong.

## Applied
- Tokens: cream canvas `36 33% 97%`, ink primary `0 0% 11%`, cream secondary/muted `35 41% 94%`, tangerine ring/selection, `--radius: 0.75rem`, `--brand-ink|tangerine|tangerine-ink|tangerine-tint|garden|garden-tint|cream`. Dark primary is tangerine with ink text.
- Gardens heading pattern: `BrandSectionHeading` (desktop home sections) and `MapPanelHeader eyebrow` (stamp, leaderboard, feed).
- Goodtzu ink/tangerine: ink submit FAB, login pill, TOP 5 pill, 3D 보기 pill, 길찾기 CTA; tangerine notification badges, unread dots, presence dot, wizard progress, bottom-nav active tint, fire badge surface and marker ring.
- Green rank chips on the home popular list and leaderboard ranks 4+.
- Red stays semantic: errors, required marks, likes, YouTube.

## Verification
- Full unit suite `npm run test:unit`: exit 0 (23 batches, 0 failures) after updating pinned palette literals in four contract files.
- `npm run typecheck:parity`: passed, 0 diagnostics. ESLint on changed files: 0 warnings.
- `npm run build`: passed with route CSS boundaries home 196511 B, general 330508 B, admin 351003 B, deferred 196511 B.
- Playwright on the production build at 1440x900, 820x1180, 390x844 across home, stamp, leaderboard, feed and three restaurant deep links (21 renders): new tokens on every page, 0 page errors, no error boundary, no horizontal overflow; detail deep links still show 3 decoded evidence frames, fire flame and popularity badge. Rows are in `viewport-verification.json`; selected screenshots are in `screens/` (leaderboard and feed omitted because they show user nicknames).

## Not covered
- Physical devices and dark mode rendering were not captured.
- Hosted production readback is recorded with the release, not here.
