# Description sponsorship supplement v1

`restaurant-crawling/scripts/02-collect-meta.py` and
`apps/web/app/api/youtube-meta/route.ts` use the same offline, deterministic
`first-party-disclosure-v1` contract. They do not initialize an OpenAI client,
read an OpenAI key/model setting, reserve its budget, or fall back to a model.
Other uses of OpenAI and existing dependency/budget schema definitions are unchanged.

## Fresh result

| `sponsor_analysis.outcome` | `status` | `is_ads` | `what_ads` | Meaning |
| --- | --- | --- | --- | --- |
| `detected` | `completed` | `true` | nonempty original-spelling name array | Explicit affirmative first-party disclosure with extractable company names |
| `confirmed_none` | `completed` | `false` | `null` | Explicit blanket first-party negative statement, with no contradictory recognized positive |
| `unknown` | `unknown` | `null` | `null` | Missing text, no supported evidence, ambiguity, unnamed disclosure, conflicting statements, or disabled supplement |

`confirmed_none` means the description explicitly disclaims advertising or
sponsorship; it does not independently verify the creator's commercial relationship.
Keyword absence, a named-company denial, a URL, third-party mention, and parser
uncertainty **never** establish `confirmed_none`. UNKNOWN is not a completed
sponsorship supplement and must not be coerced to `false` or an empty success list.

Every fresh analysis carries `source: "description_rules"`,
`version: "first-party-disclosure-v1"`, and `source_sha256`, the SHA-256 of the
original full UTF-8 description (null for an unavailable non-string description).
The bounded `reason` distinguishes positive evidence, explicit denial, ambiguous
disclosure, no supported evidence, missing input, and disabled analysis. No raw
description or provider diagnostic is added to logs or evidence reports.

## Supported grammar and conservative exclusions

The full provider description is examined, including disclosures after 100/500/
5,000 characters. The route retains its 512 KiB provider JSON response bound;
oversized responses fail instead of silently truncating sponsor evidence. Python
now retains the full description in newly collected metadata, not a 500-character
preview. No existing stored description is rewritten.

Examples: `본 영상은 하이트진로의 유료광고를 포함합니다`,
`영양군청으로부터 협찬받았습니다`, `This video is sponsored by ACME`, and
`We received a sponsorship from ACME`. Explicit blanket negatives include
`본 영상은 광고가 아닙니다`, `본 영상은 협찬 없이 제작되었습니다`, and
`This video is not sponsored`. Quoted/example/code paragraphs, third-party
subjects, conditional or negated claims, and URLs are not first-party evidence.

Matching normalizes Unicode compatibility forms, combining marks/Hangul Jamo,
whitespace/newlines and zero-width space/BOM. Names are source slices, **not**
normalized spellings. Case/space-normalized duplicates keep their first original
spelling. Commas, semicolons, `및`, and `그리고` separate companies; `&`
stays part of a company. English `and` is ambiguous between a list and a company
name: `Johnson and Johnson` and `ACME and Beta` remain UNKNOWN rather than
emitting truncated identities. At most five distinct names of at most 80 normalized
code points (and at most 160 original code points) are accepted; overflow is UNKNOWN, not a truncated successful list.
Candidates must contain a letter. Digit-only or phone-like tokens, email/URL
shapes and bare domains remain UNKNOWN, including when prefixed by a contact
label. Mixed-letter number brands such as `3M` and `7-Eleven` remain eligible.
Contact regression cases use synthetic numbers and reserved `.invalid` domains.

Complete sentences can be recognized before or after ordinary introduction or
closing text on the same line. Paragraph-level quotation, example and reported
speech exclusions apply before splitting. Questions and contradictory recognized
negative statements cannot become affirmative evidence. Dotted abbreviations
and initials do not establish a boundary that could truncate a company name.
Up to three wrapped physical lines and a 1,024-code-point statement are supported.
These are grammar limits, not description truncation. Ambiguous Korean `A와 B`
lists, names with sentence-like `. ` punctuation (e.g. `Dr. Pepper`), quoted names,
unrecognized phrasing, and prose in a purported company name can remain UNKNOWN.
The helper does not claim general named-entity recognition or measured accuracy.
Synthetic parity cases and the previously mentioned 11 samples are not precision
or recall estimates.

## Saved data and collection completion

The collector's schema-1 daily checkpoint and `metadata_scoped_complete` certify
**base metadata/thumbnail persistence**, not sponsor supplement completion. A
fresh UNKNOWN is stored separately in `ads_info.sponsor_analysis`; it does not
fail/retry otherwise complete metadata. The checkpoint's base recipe no longer
depends on OpenAI configuration or the sponsor rule version. A valid same-day
checkpoint bound to the actual saved output remains complete even if its recipe
predates this implementation. Date-only entries, changed output hashes, failed
YouTube retrieval, and thumbnail/persistence failures remain incomplete.

Rule upgrades alone never cause historical metadata appends, replay completed
records, or automatically supplement old records. Existing scheduling/change
detection still chooses new collection work. Title/duration/thumbnail changes
and scheduled collections remain the base triggers; a description-only change
is observed at the next eligible collection. No batch backfill is introduced.

For unchanged descriptions, previously saved positive/negative values (including `true` without company names)
are retained without being relabeled as v1 rule evidence. On a changed description,
UNKNOWN or `--skip-ads` retains existing positive/negative `is_ads` and `what_ads`
values, while the **current** `sponsor_analysis` remains UNKNOWN and sets
`retained_previous: true`, `retained_version` (or `legacy`), and
`retained_source_sha256` (nullable when unavailable). Repeated retention does not
nest histories. A definitive result for changed input may replace those effective
fields in a new append-only metadata row. Earlier rows are never overwritten.

Legacy `ads_info` without analysis/provenance remains legacy. Its boolean/name
fields must not be advertised as a new v1 confirmed result. Old provider statuses
(`failed`, `unavailable`, `rate_limited`, `not_requested`, or provider-completed)
remain historical data; no mapping upgrades them to deterministic evidence.
The collector keeps its legacy positional `openai_client` argument inert for
call compatibility; `skip_ads` is now the explicit keyword controlling analysis.

## Consumer integration and persisted boundaries

The shared client helper `apps/web/lib/sponsorship-state.ts` separates display,
normalization and the existing guarded write DTO. UNKNOWN (including a retained
historical boolean/name pair) emits **neither** `is_ads` nor `what_ads`; null is
not used as an update placeholder. Unchanged legacy booleans without supplement
provenance remain legacy confirmations. A legacy positive with unknown company
names updates `is_ads` only, preserving existing names. An explicit confirmed
negative can send `is_ads=false, what_ads=null`; a confirmed positive sends a flat
array. String-valued legacy company text stays one string, not a nested array.

The five admin consumers and submission approval builder use that projection.
Display distinguishes `광고 미확인`, `광고 아님`, positive attribution, and UNKNOWN
with retained historical values. Basic metadata remains readable even without
`ads_info`; its normalization produces a nullable UNKNOWN supplement rather than
losing the title/date/duration. Submission's basic metadata completion does not
claim sponsorship completion. All mutation paths still use the existing
Preview → Confirm → Apply → Readback → Audit client and strict DTO validator;
provenance is never smuggled through an unallowlisted field.

The video metadata migrator uses `confirmed_sponsorship_fields` and stable-ID
insert-if-absent followed by partial UPDATE. The source baseline's `videos.is_ads`
is nullable but defaults to false, so a **new** UNKNOWN explicitly inserts
`is_ads=NULL, advertisers=NULL`. Insert conflicts are ignored; the subsequent
UNKNOWN UPDATE omits both columns, preserving any existing or concurrently
inserted confirmed fields. Confirmed negatives may clear advertisers; a legacy
positive without names does not clear them. Every base UPDATE must return the
requested ID before counting completion. A failed/partial batch remains a
failure and retry uses the same IDs. No operational writes were run to validate
this code; SDK-boundary tests use synthetic in-memory rows.

The additive forward migration
`20261028195647_sponsorship_base_metadata_manual_confirmation.sql` addresses the
remaining base-index and explicit-manual-confirmation contracts. It replaces only
`admin_eval_valid_meta(jsonb)` and `admin_record_compose(jsonb,jsonb)` with their
existing signatures, owners, execution modes and ACLs. No RPC admission, RLS,
identity/custody, audit, or applied migration is rewritten.

Base validation now depends only on title/date/duration/shorts metadata, not
`ads_info`. The migration selectively recomputes only previously excluded
base-valid rows in `pipeline_control.admin_evaluation_read_index`. A SHARE lock on
restaurants serializes concurrent writers while taking this derived snapshot.
It does not update restaurant business rows, timestamps or revisions. A two-second
lock timeout fails the caller's transaction instead of waiting indefinitely.
The file has no transaction delimiter or concurrent index operation; the caller
must execute it in a transaction (the parent tests the exact file under rollback).

An explicit human choice sends `youtube_meta.sponsorship_confirmation` as
`detected` or `confirmed_none`, together with matching `is_ads` and an explicit
nonempty name array or null respectively. Both DTO and SQL reject contradictory,
empty, nullable and arbitrary-provenance inputs. Automatic fetch/legacy
projection never emits this marker. The admin editor defaults to preserving the
saved judgment; a human selection creates only a row-bound guarded action.

Compose atomically replaces `ads_info.sponsor_analysis` with `status: completed`,
the chosen outcome, `source: manual_admin`, `version: manual-sponsorship-v1`,
`reason: explicit_admin_confirmation`, and `source_sha256: null`. It removes stale
UNKNOWN/retained markers by replacing that object, preserves other metadata and
ad keys, and uses no timestamps, randomness or client-supplied analysis fields.
The existing operation/audit binds actor, identity and payload; no new provenance
identity mechanism is introduced. Base-only or ordinary legacy field updates
retain the prior analysis unchanged. Explicit no-ad confirmation clears names;
confirmed advertising replaces them with the supplied original company text.

The source change and offline checks do not establish SQL execution. Parent-owned
PG15 verification uses `supabase/tests/sponsorship_contract_before.sql`, the exact forward
migration, then `supabase/tests/sponsorship_contract_assertions.sql`, all inside one
BEGIN/ROLLBACK. A snapshot of nonempty affected and unaffected synthetic rows is
needed to establish actual selective backfill coverage; a zero-row snapshot is
not that proof. Tests also exercise pure SQL NULL/UNKNOWN metadata descriptors,
manual composition, rejection, custody and role boundaries without new accounts.
`supabase/tests/sponsorship_guarded_action_assertions.sql` additionally exercises
the real Preview → Apply → Readback → Audit transaction, idempotency, base-only
edits and rejection of a per-target edit outside the preview target set. It takes
an existing active fixture admin and an existing synthetic UNKNOWN restaurant
as psql `sponsor_actor`/`sponsor_target` variables, creates no account, and rolls
its changes back to a savepoint inside the parent's outer rollback transaction.
Apply the additive database contract before exposing the new manual UI; older
SQL rejects the new field rather than silently accepting an incomplete transition.

`videos` still has no remote sponsorship-attempt/history column. Current attempts
remain in collector JSONL and existing effective video ad values are preserved.
No remote history schema is needed for this task. Hosted application, actual SQL
execution and protected delivery remain separate parent-owned verification.

The golden fixture retains the original 55 inputs and adds 30 review cases for
sentence boundaries, reported speech, negative conflicts, company names and
contact-shaped candidates.
The original English `and` list expectation is corrected to UNKNOWN. All 85
cases are shared by Python and TypeScript. Consumer tests reuse this fixture
and add actual submission/admin handler DTOs, unknown-vs-negative labels,
retention, explicit permitted boolean edits, synthetic video migration,
concurrent insert preservation and failed readback cases. Synthetic tests are
not extraction accuracy measurements or hosted acceptance receipts. Browser
bundle and local runtime-import graph tests verify that the client state helper
and five admin consumers do not pull in the server's `node:crypto` analyzer.
