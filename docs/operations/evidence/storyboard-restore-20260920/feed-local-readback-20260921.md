# Hosted public feed readback from local development

Observed at: 2026-09-21 (Asia/Seoul)

- Runtime: Next development server on 127.0.0.1:3000 started with the explicit hosted development marker and hosted public Supabase environment variables. The browser did not use the local 127.0.0.1:18000 Supabase endpoint.
- Browser: IAB tab 29, /feed (the app resolves this to `/?panel=feed`). The public feed loaded without weakening auth or privacy guards.
- Direct hosted readback: the public `reviews` endpoint returned 8 rows, two of which are `is_verified = true`; `read_public_profile_summaries` returned the two referenced public profile summaries. The feed's verified filter therefore renders two cards.
- Rendered heading: 쯔동여지도 리뷰 (2개).
- Visible restaurants: 데일리픽스 강남본점 and 스시린 불당본점. Both cards display 쯔동마스터 and 인증, with the imported review text and visit dates.
- No `Nightly CI` author was present in the rendered feed.
- No query-cache source change was necessary. The earlier placeholderData/cache explanation remains unproven.
- The hosted profile summary migration was read back after application: direct `profiles` SELECT remained denied to public roles, while the bounded RPC returned `user_id`, `nickname`, and `avatar_url` only.

## Limits

This verifies a read-only hosted connection from local development and public profile resolution. It does not prove hosted writes, automatic synchronization, hosted Auth identity writes, photo rendering, production deployment, or production readiness. The default local development command remains isolated; this path requires explicit hosted opt-in. Earlier local snapshot evidence is historical and is not used by this readback.

No hosted write or whole-app default switch is implied by this evidence.
