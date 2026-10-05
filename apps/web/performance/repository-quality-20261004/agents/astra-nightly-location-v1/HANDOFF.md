# Nightly same-spec failure location handoff

Implemented in `/Users/twoimo/.codex/worktrees/nightly-quality-20261004/tzudong`, branch `codex/nightly-failure-diagnostics-20261004`, HEAD `e39635a89a3d7e9570ca9f67cda4906af3816004`. Changes are uncommitted. Source hashes and baseline hashes are in `source-hashes.json`.

Changed files:

- `apps/web/scripts/nightly-playwright-failure-evidence.mjs`
- `apps/web/tests-unit/nightly-playwright-failure-evidence.test.ts`
- `.github/scripts/verify-nightly-local-publication.py`
- `backend/supabase/tests/test_local_publication_verifier.py`

The existing evidence schema gains optional `failures[].source_location: {line, column}`. Both values must be one-based integers, line <= 100000 and column <= 10000. These are diagnostic schema bounds, not source-file length checks. Only the final failed/interrupted/timed-out attempt's first error can supply metadata. The raw `error.location` takes precedence; if absent, the JSON reporter's formatted `errors[0].location` is used. A malformed/foreign primary location is omitted, never repaired from another retry, error, stack, or declaration.

File identity must exactly match the curated spec basename, `tests/<basename>`, or the absolute spec path anchored to the sanitizer module's checkout. No basename-only comparison of absolute paths and no trust in report `config.rootDir`. Only numeric coordinates are retained; raw location requires exactly file/line/column, and no path, title, message, stack, snippet, request, header, cookie, URL, provider string, or credential canary enters output. Optional invalid metadata is omitted without changing the failure. The verifier rejects malformed or extra fields and locations on no-result/unexpected-pass/error-free entries. Legacy payloads and all existing status/count/exit/identity/custody/8-KiB bounds remain enforced.

Evidence from installed and lockfile-matched Playwright 1.63.0: `lib/runner/index.js` lines 1854-1858 populate TestError.location, lines 4193-4225 serialize raw error and formatted errors; `formatError` at 1489 returns location and message. `types/testReporter.d.ts` defines TestError.location. Source inspection only; no SDK, browser, phone, or hosted execution.

Checks (all passed):

- From `apps/web`: `bun test tests-unit/nightly-playwright-failure-evidence.test.ts` — Bun 1.4.0 (34cbb9a40), 18 passed, 0 failed, 161 assertions. Includes synthetic 27-test PW-ADMIN/index-3/three-attempt reporter fixtures, exclusion canaries, malformed/foreign inputs, final-attempt selection, and located/legacy JavaScript-to-Python round trips.
- From repository root: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest backend.supabase.tests.test_local_publication_verifier` — Python 3.14.8, 44 passed in 64.986 seconds. Includes strict numeric/type/field/semantic rejection and unchanged failure gates.
- From `apps/web`: `/opt/homebrew/opt/node@24/bin/node --check scripts/nightly-playwright-failure-evidence.mjs` — passed.
- From `apps/web`: `/opt/homebrew/opt/node@24/bin/node node_modules/eslint/bin/eslint.js scripts/nightly-playwright-failure-evidence.mjs tests-unit/nightly-playwright-failure-evidence.test.ts --max-warnings=0` — passed.
- Node v24.21.0 inline fixture smoke — same-spec 693:35 extracted, secret/path excluded, Python verifier accepted serialized output; passed. Synthetic fixture, not the canonical Nightly assertion location.
- `git diff --check` on owned paths — passed; branch/HEAD read back unchanged. The shared workspace also contains concurrent parent-owned unit-runner/workflow/unit-diagnostics changes; those were not edited by this task.

Runtime/model evidence: local session `01a10736-bac8-7242-8c20-5903736706a8`, trace `/Users/twoimo/.codex/sessions/2026/10/04/rollout-2026-10-04T22-59-49-01a10736-bac8-7242-8c20-5903736706a8.jsonl`: session_meta reports CLI 0.160.0 and provider openai; latest turn_context reports model gpt-6-astra and effort xhigh. This is local configured/runtime-record evidence, not a server attestation. No model/provider change was made. Bun matches the workflow's exact 1.4.0 pin. Node checks used available v24.21.0 (package-supported 24.x), not the workflow's exact 24.6.0. Default PATH Node v26.10.0 was not used for the Node checks. Installed Playwright 1.63.0 matches package-lock.

No commits, pushes, branch switches, source promotion, hosted writes, paid capacity/API calls, or messages to other chats were performed. Broad app suites and typecheck parity were not rerun: production changes are MJS/Python, and tests-unit is excluded by apps/web/tsconfig.json. Existing unit tests invoke only pre-browser admission/cleanup failure paths.

Local implementation is complete. Parent integration and an authorized future canonical Nightly run are still needed to confirm a real emitted source location. Nightly37204476815 was not rerun, and already-redacted evidence cannot recover its assertion coordinates. Neither 693:43 (unit fixture) nor 693:35 (Node smoke) is a claim about that run.
