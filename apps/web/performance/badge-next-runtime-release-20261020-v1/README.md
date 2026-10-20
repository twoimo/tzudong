# PopularityBadge real Next server verification

Node24.22.0 / Next16.3.8 webpack production build/start / React19.3.0 / Chromium151.0.7922.34. Actual product source SHA35eed050e8c73b5b1c58301ac63fa19681cb33a733eec63002c5e206dc82596b. Fresh release candidate from develop604867645198dd653de1a2000837af0ba4f39af4.

`next-server-attempt4/result.json` records6passing browser journeys with no page/hydration errors: default-off, delayed chunk Close/Escape/parent unmount and late-resolution/reopen cleanup, actual HTTP503chunk failure localized to static fallback with Close/reopen/Escape and no route ErrorBoundary, unknown-mobile static/no viewer request. Raw server-rendered HTML for off/on has server-rendered badge and no canvas; client hydration transitions to true. Actual webpack chunk paths/bytes/SHA and buildID are retained. Framework/compiler/type checks were not bypassed. WebGL uses software GL and navigator is synthetic. This closes the isolated real Next server/component boundary, not the whole application's SSR/physical/field behavior.

Run from repository root using pinned Node24 and the installed Chromium:

```sh
TZUDONG_TEST_CHROMIUM=/absolute/path/to/chromium /opt/homebrew/opt/node@24/bin/node apps/web/scripts/verify-badge-next-runtime.mjs --out=/existing/parent/new-output-directory
```

The command refuses an existing output directory, builds a temporary actual App Router route with the real product component/dependencies (no loader alias/mock), starts only its own loopback production server, and cleans up its own server/browser/temp project after retaining evidence. No database/phone/account/service setting change is required. `@/*` uses the project-equivalent relative TypeScript mapping and the existing product three.d.ts contract.

Attempts1–3 preserve fixture preparation failures: absolute path mapping, deprecated baseUrl, then missing project three.d.ts include. Product bytes did not change while correcting those test setup issues. The first parity attempt used symlinked dependencies and failed; authoritative npm11.6.2 clean install plus correctly located fixture sources gave parity0diagnostics/3203inputs. Final unit11pass/59expects and ESLint0 are retained.

Prior actual final cross-audit694cdb96 reviewed these exact product bytes; final reviewer accepted local AppRouter ErrorBoundary and asked for this stronger runtime evidence. This is deterministic validation of that existing reviewed direction, not a duplicate external audit. Original full reports and sealed evidence are preserved in the original audit checkout.

Production before verification: live health and provider alias readback bound rollback to main7d76c2b0a2e9566160a051f7c3520b3acc427923 / dpl_3wE2S6nWaeUMtmwAKbVsvy2JFWnR. This README does not claim deployment of the new patch. Protected Release/Promotion Path must pass for feature→develop→data→main, then provider READY/exactSHA/aliases/live health are required.

Nightly39335785643 remains a separate failure: receipt_ledger_state in local publication boundary verification. It was not rerun, bypassed or reclassified by these tests; see nightly-separate-v1.json.
