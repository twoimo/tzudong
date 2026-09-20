# Local feed readback

Observed at: 2026-09-20T16:44:58.339350+00:00

- Runtime: existing Next development server on 127.0.0.1:3000; local Supabase endpoint 127.0.0.1:18000.
- Browser: IAB tab 27, /feed. Initial stale-session request reached /auth/required?reason=privacy; navigating back to /feed after the middleware rejected that session loaded the public feed without logging in or weakening guards.
- Rendered heading: 쯔동여지도 리뷰 (2개).
- Visible restaurants: 데일리픽스 강남본점 and 스시린 불당본점. Both cards display 쯔동마스터 and 인증, with the imported review text and visit dates.
- 정원분식 seed cards were absent from the observed rendered feed.
- No query-cache source change was necessary. The earlier placeholderData/cache explanation remains unproven.

## Limits

This verifies the earlier local snapshot import only. It does not prove live hosted reads, automatic synchronization, correct hosted Auth identity linkage, photo rendering, hosted migration deployment, or production readiness. Imported review authors are linked to a local test identity. Do not describe this as a live hosted DB connection.

The existing continuation task 01a0bec9-7163-7ec0-b81b-2050c7c7e117 has been asked to inspect/implement a read-only hosted public-feed connection, preserving local Auth and worker behavior. No hosted mutation or whole-app hosted switch is authorized by this handoff.
