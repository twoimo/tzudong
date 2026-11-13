# Admin console and OpenAI storyboard

## Scope

The console preserves the 15 existing module IDs and their URLs while grouping navigation by purpose. Restaurant refresh history remains a restaurants subview. Existing standalone evaluations, submissions, banners and privacy-incident routes retain their guards and compatibility behavior. The audit workspace links to privacy incidents; it does not merge their authorization boundaries.

Dashboard charts and the public/admin Insights treemap use the pinned `ztd-charts` adapter. Tables remain available alongside visualizations. Missing observations are not converted to measured zero. Shared loading placeholders use the existing `skullet` surface. Compact square-edged styling uses the shared 4px spacing scale.

## Storyboard execution

Creation remains an authenticated queue operation. Web request handlers do not invoke paid models. Outbound workers claim jobs, check database readiness and selected capabilities, and persist results through the existing guarded worker API. Existing Gemini execution and read-only archived projects remain supported.

Allowed OpenAI models are defined in `apps/web/lib/admin/storyboard/openai-models.ts`. The worker checks account-visible model availability rather than treating a model name in source as readiness. Text uses Responses with structured output; image generation uses one low-quality PNG per requested scene. Provider responses are size-bounded, errors are reduced to fixed codes, and paid POSTs are not automatically retried. An uncertain generation remains held for explicit reconciliation.

A mixed Gemini/OpenAI request requires one worker that advertises and can execute both selected models. Two separately online single-provider workers do not form an executable pair.

## Credentials and activation

- Keep API credentials in a private operator environment file or process environment, never `NEXT_PUBLIC_*`, the browser, the repository, or Supabase rows. Use a directory restricted to the operator and mode `0600` for the environment/token files.
- API-key authentication, worker authentication and database readiness are separate prerequisites. A successful direct model call does not prove the production queue is ready.
- The additive migration is `backend/supabase/migrations/20261113090000_storyboard_openai_execution.sql`. Apply it only through the authorized hosted release procedure. Its source-drift guard must fail rather than silently rewriting an unexpected installed function.
- Register/provision a worker through the existing authenticated operator procedure. Do not invent a token, skip readiness, or start a paid worker in CI.
- Source commits, local tests and a synthetic browser fixture are not hosted migration or deployment receipts. Follow `docs/agents/release.md` before hosted actions.

From `apps/web`, after those prerequisites are independently verified:

```sh
bun --env-file=/absolute/private/storyboard.env scripts/storyboard-openai-worker.ts \
  --origin https://www.tzudong.app --token-file /absolute/private/worker-token --once
```

For deliberately configured mixed-provider work, use `scripts/storyboard-multi-provider-worker.ts` with its `--env-file` option. Removing `--once` starts a persistent worker and is an operational action, not a verification shortcut.

## Bounded direct smoke

`verify-storyboard-openai-live.ts` is an explicitly invoked, paid verification tool, not a CI test. It makes at most one text POST and one image POST, and writes a durable phase record before each. The output directory must be absolute and private. An existing receipt/output blocks another invocation at that location.

```sh
bun scripts/verify-storyboard-openai-live.ts \
  --env-file /absolute/private/storyboard.env \
  --output-dir /absolute/private/new-smoke-directory
```

The receipt records actual token usage and output hashes separately from an estimate. A pricing estimate is not an account-level billing cap. Preserve an uncertain receipt and reconcile the original request before considering another invocation. Never rerun merely to improve the screenshot.

The initial operator smoke on 2026-11-13 returned five structured scenes and one valid 1024×1024 PNG in two successful POSTs. It reported text usage 382 input / 1,184 output tokens and image usage 32 input / 824 output tokens. This is direct API evidence, not a deployed queue or hosted database claim. The private receipt and generated files stay outside Git.

## Local verification

```sh
# Repository root: disposable networkless PostgreSQL, no existing volumes or hosted DB.
PATH="/opt/homebrew/bin:$PATH" python3 backend/supabase/tests/storyboard_openai_execution_integration.py -v

# apps/web: deterministic provider/queue tests and isolated browser UI fixtures.
bun test tests-unit/storyboard-openai-client.test.ts tests-unit/storyboard-outbound-worker.test.ts
node node_modules/@playwright/test/cli.js test --config=playwright.storyboard.config.ts
npm run typecheck:parity
```

The SQL harness reports its exact migration hash and container image, and removes only its owned disposable container. Browser fixtures use synthetic data and block external requests; their success is never reported as production content or live provider execution.

## Responsive console acceptance

The loopback design fixture is a synthetic read-only environment, not an alternate production login. Its current cookie-generation, account-status, knowledge-graph, privacy-incident and thumbnail-list response shapes match their inspected consumers. Existing production authentication and authorization are unchanged. All generation and other server-bound writes remain blocked during the browser audit.

With the owned fixture gateway on `127.0.0.1:18794` and its isolated upstream already running, from `apps/web`:

```sh
ADMIN_AUDIT_OUTPUT_DIR=/absolute/private/admin-audit \
  bun scripts/verify-admin-sidebar-pages-browser.ts --owned-headless \
  --widths=390,834,1423 --colors=light,dark --screenshots=true \
  --report-suffix=operator-check
ADMIN_AUDIT_OUTPUT_DIR=/absolute/private/admin-audit \
  bun scripts/verify-admin-legacy-routes-browser.ts
```

The first check covers 15 modules at three widths in both themes, including horizontal clipping, touch/input sizes, keyboard entry, safe read-only interactions, KPI title geometry and pipeline node overlap. The second waits for the canonical destination and rendered data state for five legacy/standalone addresses at three widths. Both retain source-bound evidence outside Git. An unconfigured Sentry connection and a blocked external map provider remain explicit limitations, not successful provider checks. The storyboard schema-held state is also intentionally visible; no creation is implied.

The mobile pipeline reserves space from its seven ranks, node height and gaps rather than squeezing the graph into a short viewport. Mobile thumbnail output keeps its actual 16:9 bounds before the editing/chat controls; desktop retains the side-by-side workspace. Shared badges are square only inside the admin shell, and the real account avatar keeps its shape.
