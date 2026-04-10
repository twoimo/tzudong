# Admin evaluations smoke checklist + report template

Support artifact for task 4. This stays intentionally lightweight so worker-1 can wire the eventual harness without inheriting implementation-specific selectors from this draft.

## Scope
- `/admin/evaluations` smoke only.
- Disposable rows only.
- Use `.omx/fixtures/admin-evaluations-smoke.json` as the editable source of row ids / trace ids / names.
- Do **not** treat this as a CI suite; it is an operator checklist plus a harness-friendly data shape.

## Recommended invocation target
When the harness exists, keep the plan’s canonical shape:

```bash
BASE_URL="${BASE_URL:-http://localhost:8080}"
STATE_PATH="${STATE_PATH:-apps/web/tests/.auth/admin.json}"
NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-https://<project>.supabase.co}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-<service-role-key>}"
node apps/web/scripts/admin-evaluations-smoke.mjs \
  --base-url "$BASE_URL" \
  --storage-state "$STATE_PATH" \
  --fixture .omx/fixtures/admin-evaluations-smoke.json
```

### Validation-only mode
Use this to validate the fixture, selected cases, and report paths without opening a browser:

```bash
node apps/web/scripts/admin-evaluations-smoke.mjs \
  --fixture .omx/fixtures/admin-evaluations-smoke.json \
  --validate-only
```

## Preflight checklist
- [ ] Environment is staging or an explicitly disposable production-like row set.
- [ ] Admin session is available via `INSIGHTS_CHAT_ADMIN_COOKIE` or `apps/web/tests/.auth/admin.json`.
- [ ] `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set for DB read-backs.
- [ ] Every source/target row id is filled into `.omx/fixtures/admin-evaluations-smoke.json`.
- [ ] `trace_id` is captured where available.
- [ ] Current admin user id is known before starting.
- [ ] A report destination is chosen under `.omx/reports/admin-evaluations-smoke/`.

## DB read-back fields to capture for every action
Use these fields for before/after snapshots unless a case needs more detail:

- `id`
- `trace_id`
- `status`
- `approved_name`
- `updated_by_admin_id`
- `updated_at`
- `road_address`
- `jibun_address`
- `categories`
- `youtube_link`
- `youtube_meta`
- `tzuyang_review`
- `geocoding_success`
- `is_missing`
- `db_error_message`
- `db_error_details`

### Suggested SQL template
```sql
select
  id,
  trace_id,
  status,
  approved_name,
  updated_by_admin_id,
  updated_at,
  road_address,
  jibun_address,
  categories,
  youtube_link,
  youtube_meta,
  tzuyang_review,
  geocoding_success,
  is_missing,
  db_error_message,
  db_error_details
from restaurants
where id in ('<SOURCE_ID>', '<TARGET_ID>');
```

Remove `<TARGET_ID>` for non-merge cases.

## Action checklist
| Case | Fixture id | UI action | Minimum before snapshot | Expected after snapshot |
| --- | --- | --- | --- | --- |
| Quick approve | `quick-approve` | Approve a pending row from the table or slide view | source `status=pending` | source `status=approved`, `updated_by_admin_id` set, error fields cleared |
| Quick delete | `quick-delete` | Soft-delete a disposable row | source `status=pending` | source `status=deleted`, `updated_by_admin_id` set |
| Quick restore | `quick-restore` | Restore the deleted row from the deleted filter | source `status=deleted` | source `status=pending`, `updated_by_admin_id` set |
| Edit save | `edit-save` | Save edits from `EditRestaurantModal` without approving | source `status=hold` | source still `status=hold`, edited fields persisted, `updated_by_admin_id` set |
| Edit approve | `edit-approve` | Approve from `EditRestaurantModal` after geocoding selection | source `status=hold` | source `status=approved`, `approved_name` updated, `geocoding_success=true` |
| Missing merge | `missing-merge` | Merge a missing row into an existing canonical restaurant | source `status=missing`, target canonical row recorded | source `status=deleted`; target admin stamp updated and merge fields preserved/extended |
| Missing register | `missing-register` | Register a missing row as a canonical restaurant | source `status=missing` | source `status=approved`, `is_missing=false`, geocode fields populated |
| DB conflict merge | `db-conflict-merge` | Merge db-conflict row into the existing restaurant | source `status=db_conflict`, target canonical row recorded | source `status=deleted`; target admin stamp updated and merge fields preserved/extended |
| DB conflict hold | `db-conflict-hold` | Hold the incoming db-conflict row | source `status=db_conflict` | source `status=hold`, `updated_by_admin_id` set |

## Per-case manual procedure
For each case above:
1. Read the source (and target, if applicable) row from the DB and save the before snapshot.
2. Perform exactly one UI action in `/admin/evaluations`.
3. Re-read the same row ids from the DB.
4. Confirm the expected status/admin stamp/field deltas.
5. Record PASS/FAIL plus a short note if anything drifted.

## Report template
Create a run artifact like `.omx/reports/admin-evaluations-smoke/2026-04-10T10-30Z.md`.

```md
# Admin evaluations smoke report

- Run at: <ISO timestamp>
- Operator: <name>
- Environment: <staging | disposable prod-like>
- Base URL: <url>
- Storage state: <path>
- Fixture: .omx/fixtures/admin-evaluations-smoke.json
- Admin user id: <uuid>

## Summary
- Overall: <PASS | FAIL>
- Cases passed: <n>
- Cases failed: <n>
- Notes: <one-line summary>

## Case results
| Case | Source id | Target id | UI result | DB read-back result | PASS/FAIL | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| quick-approve | <id> |  | <toast/button outcome> | `pending -> approved` | <PASS/FAIL> | <note> |
| quick-delete | <id> |  | <confirm accepted> | `pending -> deleted` | <PASS/FAIL> | <note> |
| quick-restore | <id> |  | <restore accepted> | `deleted -> pending` | <PASS/FAIL> | <note> |
| edit-save | <id> |  | <save accepted> | `hold -> hold`, fields changed | <PASS/FAIL> | <note> |
| edit-approve | <id> |  | <approve accepted> | `hold -> approved` | <PASS/FAIL> | <note> |
| missing-merge | <source> | <target> | <merge accepted> | `source deleted`, target updated | <PASS/FAIL> | <note> |
| missing-register | <id> |  | <register accepted> | `missing -> approved` | <PASS/FAIL> | <note> |
| db-conflict-merge | <source> | <target> | <merge accepted> | `source deleted`, target updated | <PASS/FAIL> | <note> |
| db-conflict-hold | <id> |  | <hold accepted> | `db_conflict -> hold` | <PASS/FAIL> | <note> |

## Before/after snapshot references
- quick-approve: <path or query id>
- quick-delete: <path or query id>
- quick-restore: <path or query id>
- edit-save: <path or query id>
- edit-approve: <path or query id>
- missing-merge: <path or query id>
- missing-register: <path or query id>
- db-conflict-merge: <path or query id>
- db-conflict-hold: <path or query id>

## Follow-ups
- <unexpected drift>
- <possible selector/harness gaps>
- <operator cleanup steps>
```
