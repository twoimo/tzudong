# Online presence

The map tells a visitor how many people are viewing it with a brief `N명이 함께 보는 중` notice. Signed-in desktop visitors also see a header counter with the tooltip `현재 접속 중인 사용자`. Both counts come from Supabase Realtime presence, so a second visitor raises the count that the first visitor sees.

## Sub-features

- `presence-map-one` shows the map notice for a single visitor.
- `presence-map-two` raises the map count when a second visitor opens the map.
- `presence-map-leave` lowers the map count after a visitor leaves.
- `presence-header` shows the header counter for signed-in desktop visitors.

## How to get to it (user POV)

- Open `/` and wait for the map notice.
- Sign in on a desktop viewport and look at the header counter.

## Driving it with tzv

Preconditions:

- Baseline preconditions from the index hold.
- The `realtime` service is running. `tzv doctor` checks this as part of the 14 services.
- No other browser has the map open on this stack, or the start count is higher than 1.

- **First visitor.** Run `tzv drive presence`. Step `first visitor opens the map` opens `/` in one context and polls for up to 75 s for a `status` element that contains `명이 함께 보는 중`. It captures `01-one-viewer` and logs the count.
- **Second visitor.** Step `second visitor joins and the first sees the count rise` opens `/` in a second browser context. It polls the first page for up to 75 s until the count rises. It captures `02-two-viewers` and logs `<start> -> <now>`. On 2026-11-16 it logged `1 -> 2`.
- **Leave and header entries.** Not in the journey yet. Leaving closes the second context and polls for the lower count. The header counter mounts only for signed-in desktop visitors. Since #3851 it counts connections, so two contexts signed in as the seeded account should count 2.

## Gotchas

- The map notice appears 5 s after the first sync, hides after 4 s, and comes back every 30 s. Poll for it. A single fixed wait misses it.
- The notice is suppressed while another map overlay is active (loading, a toast, an announcement, the theme notice, or the restaurant count). The poll covers that.
- `NEXT_PUBLIC_PUBLIC_DEMO_MODE` or limited-public mode disables presence.
- The two counters use separate channels (`map-online-users` and `online-users`) and count different audiences. A branch that changes what a counter tracks can change the expected number. Read that branch's description before you assert an exact value.
- Each browser context is one visitor. Two pages in one context share storage but still track separately on the map channel.
