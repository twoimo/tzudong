# Storyboard queue recovery evidence

This evidence records a deterministic, local correction to the storyboard Gemini worker at source head `7343d92c77a0d4114db16871363c31b54b66ef82`. The worker now performs host-memory admission and a server-guarded claim before reading Gemini model availability.

## Measured result

| Condition | Before catalog GETs | After catalog GETs | Absolute change | Relative change | Generation calls after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Host-memory rejection | 3 | 0 | -3 | -100% | 0 |
| Empty queue | 3 | 0 | -3 | -100% | 0 |
| Retired provider claim | 3 | 0 | -3 | -100% | 0 |
| Retired model claim | 3 | 0 | -3 | -100% | 0 |

The catalog-authentication fixture made three bounded allowlisted metadata reads after a valid claim, made zero generation calls, and checkpointed `provider_auth_failed`. The generation-authentication fixture made one `gemini-3.8-flash` generation request, zero alternate-LLM calls, zero uploads, and checkpointed `provider_auth_failed`.

The partial-resume fixture generated and uploaded only scene 3 with `gemini-3.1-flash-image`. It made zero draft checkpoints, retained the five-scene input hash, and preserved all 5 existing asset identifiers.

Each row is one paired deterministic spy experiment (`n=1`), so no 95% confidence interval is estimated. The noise budget is exactly **0 catalog/generation calls and 0% relative deviation**: any observed count that differs from the frozen trace fails validation. This zero tolerance is a deterministic request-count contract only; it is not a timing or real-performance noise analysis and does not constitute G003 performance admission. These are request-count results, not token, latency, billing, or production-cost results.

## Verification

- Five targeted test files: 98 passed, 0 failed, 619 expectations.
- Targeted ESLint: 0 warnings and 0 errors.
- TypeScript 7.0.2 / 6.0.2 parity: 0 diagnostics across 3,129 logical inputs.
- Real provider, database, Storage, payment, deployment, and production-service operations: 0.
- Applied SQL files were not changed; no migration was added.
- `scorer-output.json` and `validator-output.json` are reproducible with the adjacent `score.mjs` and `validate.mjs`; both report `allPassed: true` and exit nonzero on any failed check.
- `negative-verification.json` records isolated temporary-copy mutations for a missing scenario, repeated scenario, and changed request count; both tools rejected all three and the canonical raw trace remained byte-exact.

`raw-cli-spy.json` is a normalized raw trace. Random fixture lease/job IDs, temporary filesystem paths, headers, credentials, and request payloads are deliberately omitted. All HTTP traffic was served by literal-loopback spies. This evidence does not establish hosted queue state, deployment, real Gemini availability, billing, latency, or persistent database/Storage behavior.
