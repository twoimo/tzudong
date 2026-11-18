# Tzudong verification map

This directory is the maintained source for verifying Tzudong's user-facing web behavior. Read this index before you drive the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Run every command from the root of the checkout under test. `tzv` means `.claude/skills/verify-tzudong/scripts/tzv`.
- `tzv up` reached `[tzv] stack ready`, and `tzv web` reached `[tzv] web ready`.
- `tzv doctor` ends with `[tzv] doctor ok`. It confirms the 14 Supabase services, the 2 seeded restaurants, the web port owned by this run, and the seeded login.
- The seeded restaurants are `정원분식` (`00000000-0000-4000-8000-000000000101`) and `명동칼국수` (`00000000-0000-4000-8000-000000000102`), both in Seoul.
- The only account is `nightly-ci@local.invalid`. It is an active, privacy-eligible admin. Its password lives in the private `stack.env` and the journeys read it from there.
- Never drive an app or stack that `tzv` did not start from this checkout.

## Driving conventions

- Drive through `tzv drive <journey>`. It runs `scripts/journeys.mjs` in headless Chromium at 1440x900 with locale `ko-KR`. It aborts every request that does not go to a loopback host.
- Sign in through the real login dialog at `/?auth=login`. Never use the `tzudong-dev-admin-bypass` cookie, the `x-e2e-admin-bypass` headers, or a hand-built session cookie as proof.
- Prefer roles, accessible names, labels, and `data-testid` over CSS or DOM position. Korean strings are literal. Keep them unchanged.
- Direct SQL arranges the account state a journey tests, such as a disabled admin, or reads back a side effect. It never stands in for the user action, and it never patches a seed or schema gap to make a journey pass. Restore any arranged state in the same journey.
- To cover a new entry point, add a function to `journeys` in `scripts/journeys.mjs` that uses `step`, `capture`, and `readback`, then list it in the feature file.

## Proof and skip reporting

- Each journey writes to `artifacts/verify-tzudong/<run-id>/<journey>/`. `steps.log` has one `ok` or `FAIL` line per step and a final `PASS` or `FAIL`.
- UI proof is a numbered screenshot and ARIA snapshot pair taken after the action, with the app state visible.
- Mutation proof is a `readback-<name>.txt` file that holds the query and its count or status. A visible change without a readback is not proof.
- On failure the journey saves `failure-<n>.png` for every open page and exits 1. `browser-problems.log` lists page errors, console errors, and HTTP 4xx and 5xx responses by method and path.
- Report an entry point that cannot be driven with the failed step line and the unmet precondition. Do not report it as verified through another entry point.
- Evidence must not contain cookies, headers, storage state, tokens, `stack.env` values, or Supabase response payloads.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph that describes the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with tzv` starts with `Preconditions:` and pairs each user action with the journey step, its handles, and the observable result.
4. `Gotchas` lists traps that can waste or invalidate a run.

## Features

- [Home map and restaurant detail](./home-map-detail.md) covers the map, the popular list, and the detail panel.
- [Bookmarks](./bookmarks.md) covers adding a bookmark from the detail panel and removing it from `/mypage/bookmarks`.
- [Restaurant edit request](./edit-request.md) covers the home detail panel entry and the `/global-map` entry.
- [Online presence](./online-presence.md) covers the map viewer count across two visitors.
- [Admin console access](./admin-access.md) covers the signed-out, admin, and disabled-admin outcomes.
- [Legal contact text](./legal-contact.md) covers the public privacy and data-deletion pages leaving no email address in the server HTML.
