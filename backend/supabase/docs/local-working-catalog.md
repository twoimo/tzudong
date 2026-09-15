# Local working catalog

The working database now holds all 1,641 restaurant rows from the verified hosted
source: 543 approved, 399 pending, and 699 deleted (2026-09-08 snapshot). All 543
approved rows have coordinates. The existing UI merge represents these as 529
places, retaining all 543 source rows across repeated visits. Region counts use
places, not database rows.

Use Node 24 (`.nvmrc`), run `npm run dev:local` from `apps/web`, then open
http://localhost:8080. On an Apple Silicon Mac using Homebrew without nvm, use
`PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm run dev:local` when the system
default Node is a different major version. The launcher preserves the selected
Node executable through prewarm and Next; `.nvmrc` itself does not switch Node.
This uses
the checkout-bound Docker database. Local edits stay local. Hosted updates remain
subject to the existing preview, approval, readback, and release gates.

In this admitted local runtime, both `localhost` and `127.0.0.1` work for browser
mutations on the configured app port. The incoming Origin must still exactly
match the actual request origin. Production, cross-origin, mismatched-port and
unbound database requests retain the existing rejection behavior.

## Keep one working stack running

The active catalog stack is `tzudong-local-94b16f077221`, bound to this recovery
checkout. On 2026-09-08 the older original-checkout fixture stack,
`tzudong-local-bb9024d6b0b8`, was stopped after confirming it contained only the
two synthetic restaurant IDs, no active client transaction, no cron job table,
no queued HTTP request and no established host connection to its API ports.
The only project web listener was the current checkout's `127.0.0.1:8080` server.

This reduced running project containers from 28 to 14. The old containers and
named data volumes were retained; no source, worktree, database volume or build
evidence was deleted. Readback confirmed the fixture restaurant digest, original
source diff/status digest, volume bindings and all current working container IDs
were unchanged. The current working stack then passed its startup integrity check.
This is an operational resource reduction, not an application latency benchmark
or a claim of reclaimed host RAM.

The private stop plan/readback is retained under generated state `local-operations`
with hash `06a47bd763263d730a7cc7327e0983f1112fd4683e9d70b3d3049771b0942bf8`.
All old containers have the existing `unless-stopped` restart policy; it was not
changed. To deliberately resume that exact retained fixture environment, start
its existing containers rather than recreating or removing volumes:

```sh
for service in db analytics vector kong auth rest realtime storage imgproxy meta functions supavisor mail studio; do
  docker start "tzudong-local-bb9024d6b0b8-$service-1"
done
```

Wait for service health before using the resumed fixture. Its two test restaurants
are separate from the real working catalog; continue normal development from this
checkout's `apps/web` with `npm run dev:local`.

For the real Naver background map, `apps/web/.env.local` must contain the existing
`NEXT_PUBLIC_NAVER_CLIENT_ID` (owner-only permissions, excluded from Git). Copy
only this public map client setting from your operator configuration; Maps does
not need a client secret or hosted DB credentials. Restart `dev:local` after
changing it. Without this setting, local test mode uses an offline grid and the
workspace banner identifies it as a test map. A working marker layer alone does
not prove the provider map: verify real roads, labels, and zoomed tiles in Aside.

## Bootstrap and preservation

From the repository root:

```sh
python3 backend/supabase/scripts/local_working_schema.py
python3 backend/supabase/scripts/local_working_schema.py --apply-preview-sha256 <printed-hash>
python3 backend/supabase/scripts/local_catalog_workspace.py preview --source-env <absolute-owner-controlled-backend-env>
python3 backend/supabase/scripts/local_catalog_workspace.py apply --preview-sha256 <printed-hash>
```

The schema extension checks every existing migration source hash and preserves
the frozen 96-unit replay ledger. Its transaction records a separate
`_tzudong_local.working_schema_extensions` receipt. Dev startup verifies both the
frozen base proofs and this exact extension. This working database is **not** a
deterministic nightly fixture or production migration receipt. The fresh replay,
nightly runner, and publication validators now require all 97 source units.
Existing 96-unit receipts remain historical evidence. A separate fresh database
completed the 97-unit replay on 2026-09-08, including prerequisite/bootstrap,
function closure, fixture seed, schema convergence, identity behavior, and final
readback. The working catalog was not reset and its old receipts were not relabeled.

The fresh `local-receipt-v2` has 97 ledger entries and five sequence markers:

- Source chain: `5d44f19c94663729e15de7c9ea563208389e6d0fad8361ed0defbfae4f545c85`
- Receipt file SHA-256: `96aa6d74b0c938a65e9a27088d45bf0815688fddf9c4dcdb12d111dd5a6ef622`
- Catalog SHA-256: `ae6e71fb8c5ffe07ce525cfda56dd71f6595ef1c96deedb1c610a6420732df95`

The receipt is retained in the separate `tzudong-local-replay97-20260908`
checkout's generated stack state as
`tzudong-local-7fcbdbb6ddf0/local-receipt-97.json`. This proves one fresh local
replay; it is not a hosted release, a second-reset equivalence proof, or a full
nightly browser-suite result.

The catalog command performs GET requests only against the exact configured
hosted project, compares two complete projected reads, and uses local
Preview → hash-bound Apply → Readback. It replaces only the two verified,
unreferenced synthetic fixtures or an empty table. It refuses to overwrite
changed local data. Repeating an unchanged import is a no-op; this is not a
bidirectional synchronization tool. Keep ongoing catalog edits in the working DB.

Private preview files and receipts are in the checkout's generated stack state,
under `working-catalog`, with directory/file permissions 0700/0600. They are not
Git artifacts. The projection includes restaurant names, addresses, coordinates,
categories, source IDs/statuses, public video metadata and review text; it excludes
Auth users, actor IDs, phone numbers, provider diagnostics, and evaluation blobs.

## Review local changes before production work

From `apps/web`, review local changes without looking up a baseline hash:

```sh
npm run catalog:review
npm run catalog:review -- --restaurant-id <restaurant-uuid>
```

When exactly one applied-import receipt exists, the command verifies its hash,
project, source, permissions and readback before using it. Missing or multiple
receipts require an explicit baseline; it never chooses by file modification time.
The output includes the private review file path and changed-record count.
This local review does not need deployment approval or hosted credentials.

For an explicit baseline, use the hash of the **applied import** with its matching readback receipt:

```sh
python3 backend/supabase/scripts/local_catalog_workspace.py review --baseline-sha256 <applied-import-hash>
# Optionally restrict the review to chosen records; repeat --restaurant-id as needed.
python3 backend/supabase/scripts/local_catalog_workspace.py review --baseline-sha256 <applied-import-hash> --restaurant-id <restaurant-uuid>
```

This reads the local catalog twice and refuses an intervening change. It writes
an owner-only `<review-sha256>.review.json` next to the import receipt, containing
before/after values for changed names, categories, business addresses, coordinates,
status, video links, and Tzuyang review text. Timestamps, video counters, and
internal pipeline fields are outside this review projection. A zero-change review
is valid. Unknown selected IDs fail rather than silently producing an empty review.
Rows present on only one side are flagged for manual review, with no inferred
insert/delete instruction. Identical repeated reviews reuse the same file.

The command makes no hosted request and performs no database write. Its output
always has `safe_to_apply=false` and `hosted_revalidation_required=true`:
it is a local review artifact, **not** a production apply plan or approval.
Any later publish operation must compare the current hosted rows with this
baseline, resolve conflicts, validate the hosted schema/identity contract, and
follow the existing operator approval, readback and audit requirements. The
bootstrap `apply` command does not accept these review files.

On 2026-09-08, the real working catalog produced a zero-change review against
applied import `221c485332823c8698567ca04c87084bfa196ed3b66679b0f71222dfe25355b1`.
The resulting review hash is
`0b799e877e6e0d2c27ddb226dd6ba8695be5eb3135cef0914619e5053536426b`.

## Select fields and revalidate against hosted data

The [publish review planner](../scripts/local_catalog_publish_plan.py) compares
the applied import baseline, current local rows and two matching current hosted
GET projections. Its owner-only selection JSON explicitly lists each restaurant
and its chosen fields; it never defaults to exporting all local changes:

```json
[{"id": "<restaurant-uuid>", "fields": ["approved_name", "categories"]}]
```

Save the selection file with permissions `0600`, then run from the repository root:

```sh
python3 -B backend/supabase/scripts/local_catalog_publish_plan.py \
  --baseline-sha256 <applied-import-hash> \
  --selection-file <absolute-owner-only-selection.json> \
  --source-env <absolute-owner-controlled-backend-env>
```

Only selected business fields can become candidates. Unselected hosted changes
remain untouched. A field changed differently on both sides blocks the entire
selected record; already-current values and unchanged local values produce no
patch. Membership differences and status changes require separate review and
never infer inserts, deletes or approval transitions. Phone and internal fields
cannot be selected. An empty selection is a valid zero-candidate review.

Addresses and coordinates form one selection group: choose `lat`, `lng`,
`road_address`, `jibun_address` and `english_address` together. The planner carries
both coordinates when location changes and refuses to combine new local location
data with a conflicting hosted address. A changed source or local snapshot during
capture prevents artifact creation.

The immutable `<hash>.publish-review.json` is kept under private `working-catalog`
state. It contains selected comparisons, bounded business-field patches, expected
hosted review values, and source/local bindings. Console output contains only
hashes and counts. Two equal GET projections detect observed changes; they are
not a transactional snapshot or a lock against subsequent hosted writes.

On 2026-09-08, a live single-record/name selection returned zero candidates,
zero blocked records and one unchanged record, with review hash
`72fcb676c182caa337c6a6d738d6471b943785a48f4fe090944afc92a8c44b3e`.
The planner always reports `safe_to_apply=false`: an atomic hosted writer with
fresh compare-and-set validation, operator approval, readback and minimized audit
is still required. This file is not accepted by the local bootstrap apply command
or the existing pending-candidate ingestion writer. No hosted mutation is made.

```sh
cd backend/supabase/scripts
python3 -B -m unittest test_local_catalog_publish_plan
```

### Publication implementation and activation boundary

The operator implementation now exists as
[local_catalog_publish.py](../scripts/local_catalog_publish.py), with separate
[operation state handling](../scripts/catalog_publish_operator.py) and
[bounded RPC transport](../scripts/catalog_publish_transport.py). It handles one
selected restaurant per confirmed operation; repeat for other chosen candidates.
It does not reuse or weaken the pending-insert-only ingestion writer.

The [private publication core](../candidates/restaurant_catalog_publish_core.sql)
depends on the immutable edit core and links the complete publication envelope
to its edit audit in the same transaction. The envelope binds actor, restaurant,
review hash, selection, exact patch, expected hosted review values and operation
ID. Prepare locks and compares the hosted row, then produces a database preview
hash. Apply rejects any whole-row change since that preview, serializes retries,
and atomically records the field update, edit audit and publication receipt.
Metadata updates (`updated_by_admin_id`, `updated_at`) and derived geocoding
effects are explicitly listed in the preview. Readback checks both receipt linkage
and the current row hash.

The [publication API candidate](../candidates/restaurant_catalog_publish_api.sql)
adds distinct service-role-only RPCs owned by `privacy_workflow_owner`, with exact
column grants, G014 allowlisting and all three catalog assertions. It does not
grant role membership. Installation requires an already authorized maintenance
context and the existing admin-metadata/G014 dependencies.

**These publication SQL files are uninstalled candidates, outside the canonical
97-source migration stream.** Do not run them directly against hosted production.
They require a reviewed migration through `develop -> data -> main`, current
hosted catalog verification and the existing external release gates. Deployment
must provision the shared edit-core dependency without overwriting any applied
source. Do not add the publication policies to the current local editor installation
without a new feature receipt/version: its startup fingerprint intentionally
detects such changes.

After that separately approved activation, the operator sequence is:

```sh
python3 -B backend/supabase/scripts/local_catalog_publish.py prepare \
  --review-sha256 <publish-review-hash> --restaurant-id <selected-candidate-uuid> \
  --actor-id <active-admin-uuid> --source-env <private-backend-env>
# Inspect the returned owner-only preview_file: before/after and derived fields.
# Apply only after actual external approval and write-freeze clearance.
python3 -B backend/supabase/scripts/local_catalog_publish.py apply \
  --prepared-sha256 <prepared-hash> --confirmation '운영 변경 적용' \
  --approval-file <private-operation-approval.json> --source-env <private-backend-env>
python3 -B backend/supabase/scripts/local_catalog_publish.py readback \
  --prepared-sha256 <same-prepared-hash> --source-env <private-backend-env>
```

Apply requires `TZUDONG_CATALOG_PUBLISH_APPROVED_SHA256` to equal the prepared hash
and the externally cleared `G037_WRITE_FREEZE` value. The CLI never sets those
variables or clears a freeze. The owner-only approval JSON must contain exactly
`schema="catalog-publish-approval-v1"`, `source` (the pinned hosted project ref),
`operation_id`, `prepared_sha256`, `actor_user_id`, `approved=true`, and
`release_evidence_sha256`. The latter references actual externally reviewed
release evidence; this metadata check is not an independent legal or release
certification. Do not fabricate an approval record to make the command pass.

Before sending apply, the operator durably writes an exclusive pending marker
for that restaurant and an immutable attempt record. Restarting, another local
process or another prepared operation cannot automatically retry an uncertain
request. Use the same prepared hash for readback; an absent/mismatched result
remains pending and requires operator investigation. Verified success requires a
separate RPC readback and a minimized, hash-addressed local receipt. Request bodies,
provider errors and credentials are never printed; private preview files contain
only the selected business projection and operation bindings.

Verification on 2026-09-08:

- The isolated PG17 tests cover permission denial, stale review/preview,
  selection/location restrictions, concurrent retry and changed-envelope
  collisions, audit rollback and immutable receipt/readback linkage.
- One real SQL/operator integration test executed prepare → synthetic fixture
  approval → apply → independent readback → restart/readback across four separate
  database connections. It produced one edit audit and one publication receipt.
  Synthetic approval existed only in a disposable fixture; no hosted transport
  was instantiated by this test.
- The real working PG15 catalog accepted both candidates, all three G014
  assertions and a service-role prepare call inside a transaction that was then
  rolled back. A separate read confirmed candidate namespace/RPC absence and the
  existing local editor's unchanged installation fingerprint. No business apply
  was performed by this probe.

Verified candidate source hashes:

- Private core: `2f7eea2c17144f937e98a1e143b924fcc602366200c3e549f1674c24c68412e1`
- Public API: `93e9e3cce1b999df81a55a792db7afce48106c2cda36ba8f1e8d5962b08e7087`

## Admin workflow verification and remaining gap

The anonymous `/admin` route was verified in Aside to require login. A separate
browser check using the existing generated local admin account passed password
login, administrator routing, and search for a real imported restaurant. The
check retained only bounded outcomes/counts, with no credentials or admin bodies.

These login observations alone do not prove the editing/publishing workflow.
The guarded field-edit implementation and its verification are documented below.
Legacy approval and other mutation paths remain separate; do not enable
`NEXT_PUBLIC_ADMIN_LEGACY_BROWSER_MUTATIONS` to work around their rejection.
Selective publication now has an implementation and isolated verification, as
documented above, but its SQL candidates remain uninstalled. It requires reviewed
activation and the external release gates before it can publish working-catalog
reviews to production.

The candidate [atomic edit core](../candidates/restaurant_catalog_edit_core.sql)
implements private-schema prepare/apply/readback routines for business display
fields. It checks the active admin actor, binds the preview to the complete
current row and exact patch, serializes repeated operation IDs, updates the row
and a minimized append-only audit in one transaction, and independently detects
later readback drift. Audit rows contain IDs, hashes and field names, not old/new
content. Status transitions, phone data, inserts and deletes are not accepted by
this field-edit core.

Its behavior is exercised in a disposable, isolated PG17 database:

```sh
TZUDONG_CATALOG_EDIT_LOCAL_PG=1 python3 -m unittest backend.supabase.tests.test_restaurant_catalog_edit_core
```

The [local API SQL candidate](../candidates/restaurant_catalog_edit_api.sql) adds
the three public RPC wrappers using the G014-required trusted definer owner,
exact service-role grants, and limited restaurant column-update permissions.
Actor checks reuse the existing admin metadata RPC; service-role access to role
and account-status tables remains revoked. The complete candidate passed the real
working PG15 catalog's three G014 assertions and prepare call in a transaction
that was rolled back. Separate PG17 tests cover the actual definer wrapper with
RLS and column grants. No role membership changes are required.

The server route `/api/admin/restaurants/[restaurantId]/local-edit` now has
preview/apply/readback handlers, a session-aware `requireAdmin` gate, local-only
runtime/target admission, bounded strict input, exact confirmation and operation
binding. It reports uncertain delivery/readback separately and retains the same
operation ID instead of claiming success or retrying with a new ID. Tests cover
these branches; real unauthenticated local HTTP requests return 401 and foreign
origins return 403, both with `no-store`.

A live local administrator login followed by a preview-only HTTP request returned
200, `no-store`, a valid preview hash and an operation ID. A separate DB read
confirmed zero edit audit events and all 1,641 restaurant rows afterward. This
proves authenticated preview without claiming a business-data apply was performed.

The checkout-bound [local installer](../scripts/local_catalog_edit_install.py)
has installed `restaurant-catalog-edit-v1` in the working DB. The two SQL files
are now immutable applied feature sources: corrections require a new version.
This optional feature has its own private immutable receipt and does not change
the canonical migration ledger. Installation preserved the full digest of all
1,641 restaurant rows. Its independently observed verification SHA is
`6c29c317e60708167c750fb3b310b93ac7613d817d98c8c0592b9a000cc69736`.

```sh
python3 -B backend/supabase/scripts/local_catalog_edit_install.py status
# A fresh local workspace: preview, then apply the returned exact hash.
python3 -B backend/supabase/scripts/local_catalog_edit_install.py preview
python3 -B backend/supabase/scripts/local_catalog_edit_install.py apply --preview-sha256 <preview-hash>
```

The local development startup checks this receipt and the installed function,
ACL, policy, trigger and allowlist fingerprint. Partial installations and drift
block startup; an absent optional feature is allowed. After an uncertain apply,
run `status` before considering a retry.

`EditRestaurantModal` now uses this API for field edits. It displays the immutable
before/after preview, requires the exact `변경 적용` phrase, and reports success
only after matching readback. An uncertain result retains only the operation ID
in tab session storage and offers result lookup, without automatic reapplication.
Phone changes are explicitly rejected. Approval remains a separate action.
Verified field edits update the matching list record from the readback and
invalidate discovery caches without reloading the page. The dedicated callback
preserves search/filter state and does not invoke linked-submission approval writes.
Display-state unit tests cover field aliases, stale video metadata removal and
preservation of approval state and original record objects.

The live local administrator UI was verified through preview, initially disabled
Apply, exact-confirmation enablement, and cancellation. No real restaurant was
modified by this UI check. SQL apply/audit/readback behavior is covered by the
isolated database tests; this is not a claim of a live business-data apply or
production publishing. Existing direct browser writes must not be enabled as an
integration shortcut.

## Multiple restaurants in one video

The correction retains the existing video + restaurant-name unique index.
Only crawler candidate rows carry `is_ingestion_candidate=true`; their active
video identities remain unique. Existing active videos receive one claim during
the migration. Additional places can share that video without claiming it.
Publisher payloads now set this flag; coordinate their deployment with schema
promotion. Historical migrations are unchanged. Hosted promotion cannot blindly
replay the old video-only index over a catalog containing multiple places; its
unapplied history requires a separately reviewed migration plan. No hosted
migration or publisher write was performed by this local bootstrap.

Database behavior is verified by running `verify_ingestion_identity.sql` inside a
transaction that is always rolled back. Python tests cover import preservation,
idempotency, source consistency, and bounded metadata. UI checks use Aside against
the running local server and do not certify hosted behavior or performance gains.

## Public map readback after overseas matching fixes (2026-09-08)

The current local approved catalog contains 543 rows. Running the application's
merge function produces 529 places: 516 with coordinates within the home map's
Korea bounds and 13 outside those bounds. All 529 have finite, valid, nonzero
coordinate pairs; all 13 overseas places match a configured overseas region.
These are current local readback counts, not a guarantee about future imports.
The unfiltered `전체 맛집` count includes both domestic and overseas places.

Address matching now recognizes `İstanbul` and `Krung Thep Maha Nakhon` from the
stored business addresses. This restores two Istanbul places and one Bangkok
place to region queries. Exact city selection excludes other cities in the same
country, and PostgREST patterns quote reserved characters in region labels.
Local anonymous REST readback returned Bangkok 1, Istanbul 2, Osaka 0 and Sapporo 4.

Aside verified the country menu totals, Istanbul's two markers, matching category
count and cards, and search for `Helal` followed by the matching detail panel with
business information and a video button. The video itself was not played.
The previous check also verified Budapest and Sapporo counts of four each.
The related 39 tests, compiler parity (zero diagnostics) and targeted ESLint passed.
This verifies data matching and the exercised public flow; it is not a latency
benchmark, full UI coverage or production publication evidence.

## Local video statistics and discovery (2026-09-08)

The popular list combines logarithmically scaled video views (45%), likes (25%),
comments (20%) and weekly searches (10%). Reference scales are one million views,
ten thousand likes, one thousand comments and one hundred searches. These are
product weights, not a prediction of restaurant quality. Each place uses its
highest-scoring distinct video's engagement; duplicate URLs do not add appearances.
Without engagement/search data, repeat appearances and the connected video's
publication date provide an explicitly labelled fallback. Search-only historical
rank snapshots do not produce movement badges for composite video rankings.
The home panel and search dropdown use the same ranking.

From this checkout's `apps/web`, refresh the verified channel and locally approved restaurant videos:

```sh
npm run catalog:stats -- --youtube-env-file /absolute/path/to/backend/.env --youtube-key-name YOUTUBE_API_KEY_BYEON
```

The operator file supplies only the named YouTube key. The target database always
comes from the verified checkout-bound local runtime. Collection runs outside
request handlers. It resolves `channels.list?forHandle=@tzuyang6145` and requires
exactly one valid channel ID with the matching returned `snippet.customUrl`, then
requests 50 public videos per batch. Videos from another channel are excluded and
counted separately as `otherChannelExcluded`. Incomplete/private/unavailable video
statistics are excluded, not filled with zero. Restaurant records and hosted
databases remain unchanged.

The collector inserts the channel and video snapshots separately, each followed by
independent full-field readback. These are two atomic table inserts, **not one
cross-table transaction**. A prepared minimized receipt includes channel identity,
source and both snapshot hashes; `channelStatus` and `videoStatus` record each
verified stage. Overall `verified` requires both readbacks; a failed stage retains
`readback_unverified` and any already verified stage. An uncertain insert is never
automatically retried. Inspect the receipt and database before any manual rerun.
Reload the page after an explicit refresh to clear the ten-minute query cache.

The first verified refresh requested 492 videos and admitted 490 complete snapshots;
2 were unavailable or incomplete. Its minimized receipt is under the local stack's
`local-operations/youtube-kpis-b21f53b2-dac7-415c-a520-a67cf0335091.json`, snapshot
SHA-256 `b76a1641c95c3427b01c4aaf0e21ddcfc80ef7b44ea7165ae47ccb4b20fcc117`.

Theme filters read stored snapshots in batches of at most 120 IDs, with at most
three requests in flight. View/comment filters use the positive top 20% including
ties. Fresh video means the 90 days preceding the latest publication in the current
candidate set. Repeat appearances count distinct video IDs. Fan signal requires
the same video's views to meet the median baseline before its comment/view ratio
qualifies for the top 20%.


### Verified channel collection and dashboard handoff

Implementation verification on 2026-09-08 used mocked API/insert responses and a
read-only query against `tzudong-local-94b16f077221-db-1`. No live channel fetch or
collector write was executed in this change. Coordinate the one real refresh with
the parent dashboard task before execution to avoid snapshot timestamp/test races.
The existing operator input is the original checkout's `backend/.env`, selected
with `--youtube-key-name YOUTUBE_API_KEY_BYEON`; its contents must never appear in
logs, receipts or source. The earlier 490-video receipt above predates channel
collection and does not establish a real channel snapshot.

The local database query confirmed the following existing mapping in
`public.youtube_channel_kpi_snapshots` (no schema change):

| YouTube response / collector value | Existing database column/type |
| --- | --- |
| `id`, `snippet.title`, `snippet.customUrl` | `channel_id`, `channel_title`, `channel_handle` — text |
| `statistics.subscriberCount`, `statistics.viewCount` | `subscriber_count`, `view_count` — bigint |
| `statistics.videoCount` | `video_count` — integer |
| `statistics.hiddenSubscriberCount` | `hidden_subscriber_count` — boolean |
| Current collection timestamp | `bucket_started_at`, `fetched_at` — timestamptz |
| `youtube-data-api-v3` | `source` — text |
| Explicit unknown history | `previous_bucket_started_at`, `subscriber_delta`, `view_delta`, `video_delta` — null |

Hidden subscribers remain null. API integer strings must be nonnegative safe
integers; video count must also fit PostgreSQL integer. Subscriber counts reflect
YouTube's published rounding, not an exact private subscriber total. API references:
[channels.list](https://developers.google.com/youtube/v3/docs/channels/list) and
[channel statistics](https://developers.google.com/youtube/v3/docs/channels#statistics).

The read-only query found one channel row: the legacy fixture, and zero rows for
`@tzuyang6145`. Its source-defined identity is:

- UUID: `00000000-0000-4000-8000-000000000401`
- Channel: `local-nightly-channel`; handle: `@local-nightly`
- Source: `LOCAL_TEST_ONLY:NOT_PRODUCTION:nightly-ci:youtube-channel-snapshot-v1`
- Bucket/fetched time: `2026-01-01T00:00:00Z`
- Fixture counts: 1,000 subscribers, 100,000 views, 100 videos; fixture deltas: zero.

The collector preserves this row and never reads it as a prior observation. Parent
snapshot helpers must filter **both latest and period-comparison reads** to the
API-resolved real `channel_id`, `channel_handle=@tzuyang6145`, and
`source=youtube-data-api-v3`. Exclude `LOCAL_TEST_ONLY:*` from every comparison;
never use an unfiltered latest row or a plausible-count heuristic. On the first
real observation there is no established period comparison: display an unavailable
comparison rather than zero growth or a fixture-derived delta. Subsequent period
comparisons require independently collected real observations and their actual
interval; this collector intentionally does not manufacture historical rows or
deltas.
