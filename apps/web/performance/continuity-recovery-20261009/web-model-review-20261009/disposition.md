# Independent Web review disposition

Two Web models completed independent High reviews. GPT-6 Web reviewed frozen source text after its first local-read request was rejected by automatic approval review. GPT-5.6 Web inspected local source and artifact maps. Neither reviewer ran tests or providers. These reports are hypotheses, not independent runtime proof.

## SQL

- `psql --single-transaction` with stdin and no `--file=-`: confirmed in both real runners. A followup adds explicit file mode and tests the actual runner on PostgreSQL 17.6. The earlier full-schema replay exercised a separate explicit-file transport, so it remains valid synthetic evidence but did not validate the old production runner.
- Database target allowed an arbitrary host when the user was `postgres.<projectRef>`: confirmed. A followup restricts direct/pooler targets and rejects connection redirection parameters.
- Atomic-body parser CASE/comment/identifier behavior: differential review and exact provider vector parity are in progress. Do not label every speculative parser example a confirmed defect before comparing the pinned provider.
- Admission hashes and writer-state declarations: they are operator-supplied launch inputs, not verified original receipts. The controller remains held. Protected revision, current rollback, receipt artifacts and actual writer fences must be read back before enabling launch. No new reviewer or personal signing-key requirement is introduced.

## Gemini

The input identity is `I = (videoId, durationSeconds, contentSha256)` plus segment bounds. If `contentSha256` is absent, equal `I` cannot prove unchanged audiovisual content. Same-ID, same-duration edits are therefore an explicit unverified freshness condition. Existing cache reuse and immutable historical evidence are preserved; no automatic paid reanalysis is triggered solely to disguise the missing evidence. Full audiovisual freshness requires a trusted content revision/hash before making that claim.

The 5,335→365-byte schema change is exactly 4,970 fewer bytes (93.1584%). It is a deterministic serialized-schema measurement. It is not a measured latency, token, model-quality or cash-cost reduction. The real no-video control is n=1, 253 tokens, 2.838956 seconds; no applicable 95% interval or matched-condition improvement estimate is available.

The bounded predecessor-continuity fixtures are synthetic. The stored 113-pass/8-skip report is prior test evidence; neither Web reviewer re-ran it. Full-video independent quality and actual operating cost remain unverified.

## Additional release reachability review

GPT-6 Web independently confirmed the tracked protectedRevision self-reference defect. The followup removed that field from the tracked manifest, bound the actual revision in private admission, and verifies current exact origin/main plus clean detached HEAD before database access. Nine planner tests pass, including a real local Git remote and stale-main rejection with zero DB calls. Default launch stays held; this is a functional release-contract fix and not an operating apply.
