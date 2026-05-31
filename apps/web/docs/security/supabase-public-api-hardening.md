# Supabase public API hardening verification

Date: 2026-05-31

## Scope

This verification covers exposed Supabase `public` schema API grants, default privileges, and browser-callable RPC execution grants for the current hardening work.

## Evidence summary

- Live DB read-only baseline before applying the new migrations still shows the previously identified exposure:
  - `serviceOnlyRpcBrowserExecutableCount=13`
  - `anonTableUnexpectedPrivilegeTableCount=23`
  - `violationCount=59`
- Applying the hardening migrations inside a rollback transaction validates the intended post-migration state without persisting live changes:
  - `rollback_audit_status=passed`
  - `rollback_service_only_rpc_browser_executable_count=0`
  - `rollback_anon_table_unexpected_privilege_table_count=0`
  - `rollback_violation_count=0`
- The audit script prints object names/counts only. It does not print `SUPABASE_DB_PASSWORD`, service-role keys, anon keys, or other secret values.

## Commands

```bash
python3 ../../scripts/security/audit_supabase_public_api.py --json
python3 ../../scripts/security/audit_supabase_public_api.py \
  --rollback-migration backend/supabase/migrations/20260531084217_harden_public_api_grants_and_rpcs.sql \
  --rollback-migration backend/supabase/migrations/20260531084516_tighten_public_table_data_api_grants.sql \
  --json
```

## Migration artifacts

- `backend/supabase/migrations/20260531084217_harden_public_api_grants_and_rpcs.sql`
- `backend/supabase/migrations/20260531084516_tighten_public_table_data_api_grants.sql`

## Operational note

The live DB baseline is expected to remain failed until the new migrations are applied by the normal Supabase migration/deploy path. The rollback validation proves the SQL syntax, target object signatures, and expected post-migration grants against the live schema without committing changes.

## Public-read compatibility review

The table-grant migration keeps anonymous `SELECT` only for product surfaces that are intentionally public:

- public content/config: `ad_banners`, `announcements`, `restaurants`, `reviews`, `review_likes`, `short_urls`
- public profile/social counters already exposed by RLS: `profiles`, `user_bookmarks`, `user_stats`
- public analytics/search display data: `restaurant_popular_rank_snapshots`, `videos`, `video_frame_captions`, `transcript_embeddings_bge`

Authenticated-only mutations are preserved for signed-in UX flows:

- profile/review/bookmark CRUD: `profiles`, `reviews`, `review_likes`, `user_bookmarks`
- user submission flows: `restaurant_requests`, `restaurant_submissions`, `restaurant_submission_items`
- notifications/OCR logs: `notifications`, `ocr_logs`
- admin-authenticated console tables: `ad_banners`, `announcements`, `admin_workflow_runs`, `admin_workflow_signals`, `admin_workflow_steps`

Anonymous write access is intentionally limited to `search_logs INSERT` because the existing product flow records anonymous searches; `SELECT` is not granted to `anon`.
