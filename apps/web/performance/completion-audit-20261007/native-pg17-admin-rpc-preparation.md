# Native PG17 preparation

The current hosted project was read in explicit read-only transactions. It has 79 applied migrations, 1,659 restaurant rows, the preserved restaurant digest, automation disabled, and no queued or running review items. Neither new public RPC is installed. No hosted DDL or application data was changed in this experiment.

An isolated, network-disabled container used the arm64 image for the current hosted `17.6.1.038` release, pinned to `sha256:fbe6c858a2ea9616aead3c39e132afcc0660decc5cb7dc656208ed145f5331ab`. The schema-only snapshot was 2,035,137 bytes; the three catalog metadata tables were 815,273 bytes. User rows copied: **0**. Private source snapshots remain outside the repository.

| Deterministic check | Result | Scope |
|---|---|---|
| Original three migrations, in order | 2 isolated replays passed | Actual function bodies and restored role model |
| G014 workflow owner, public allowlist, definer, catalog | 4/4 after each replay | Original assertion code retained |
| `postgres` migration execution | NOSUPERUSER | Database ownership matched to hosted `postgres` |
| Role membership and immutable manifest | Digests preserved | 29 membership rows; 1,963 manifest rows |
| Registration helpers | Both absent | Checked within the applying session |
| Private table ACLs | 9 role/table rows passed | Audit allows service SELECT/INSERT; direct fence calls denied |
| Rollback state | Preserved | Membership, manifest and five RPC states |
| Full schema rollback | Exact hash match | `0fb5017e6d2cc9124630a411c9e9711aac5d8c52accdb0a3569ac66dbb7e20d2` before and after |

The schema dump requires declared reconstruction mappings: eight allowlist rows refer to newly allocated type OIDs; seven column positions account for two dropped attributes; one constraint has equivalent Boolean grouping. All 27 three-valued Boolean combinations agree. Mapped metadata was inserted into the empty clone through the normal initialization path. The immutable manifest trigger and assertion functions were never disabled or rewritten. `row_security=on` was restored after the dump's session setting before assertions executed. Extension ownership and database ownership were restored from current hosted metadata. The temporary superuser setting needed for extension restoration was reverted before migrations ran.

This closes the isolated PG17 registration gap left by the PG15 closed catalog projection and the earlier stub registration tests. It does not attest hosted migration application, real user happy paths, physical Storage deletion, deployment, or the entire objective. These are deterministic checks, so confidence intervals and performance improvement rates do not apply.

Raw receipts, source hashes, settings, private reproduction script hashes and failed-attempt boundaries are retained in `native-pg17-admin-rpc-preparation.json`. Current source was `685ad8648e94423cc20d1f880bb14365baff0e9f`; the original three migration files were not changed. Existing applied migrations must not be resent.
