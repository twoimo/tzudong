---
name: verify-tzudong
description: Launch the Tzudong (쯔동여지도) web app from apps/web against a disposable local Supabase stack, sign in as the synthetic seeded admin without hosted credentials, drive user journeys in headless Chromium, and capture screenshot, ARIA, and database-readback evidence. Use to prove a web change in the real app, to verify a web PR before shipping, or when asked to run, screenshot, or click through Tzudong.
---

# Verify Tzudong

`tzv` (`.claude/skills/verify-tzudong/scripts/tzv`) does every step below. Run it from the root of the checkout under test. Each checkout path gets its own Supabase project, `tzudong-local-<hash of path>`, so a worktree never shares a database with another checkout.

The feature map in [features/README.md](features/README.md) lists the journeys and what each one proves. Read it before you drive.

## Launch

```sh
export LOCAL_STACK_PORT_BASE=28000   # pick a free base; read once, when stack.env is first written
.claude/skills/verify-tzudong/scripts/tzv up
TZV_WEB_PORT=18080 .claude/skills/verify-tzudong/scripts/tzv web   # 3000, 8080, or 18080 only
```

- Prerequisites are a reachable Docker daemon, `docker compose` 2.39.4, Node 24, `apps/web/node_modules` (`cd apps/web && bun install --frozen-lockfile`), and the Playwright Chromium build (`cd apps/web && bunx playwright install chromium`). `.cursor/scripts/lib.sh` finds Node 24 under nvm, `/usr/local/node24`, or Homebrew `node@24`.
- `up` brings up the stack that the nightly local lane uses. `tzv` exports `LOCAL_STACK_REPLAY_STACK=1`, so `local-stack.py start` runs PostgreSQL 15 and skips the PostgreSQL 17 schema baseline. On an empty database `up` then applies the prerequisite, the migration chain, the function closure patch, the synthetic seed, and the schema convergence check, in the order `.github/workflows/nightly-local-regression.yml` uses. It is ready at `[tzv] stack ready project=<name> supabase=http://127.0.0.1:<kong port>`. A cold `up` took 646 s on a 10-core Mac with a load average near 66.
- `LOCAL_STACK_PORT_BASE` takes effect only when the project's `stack.env` is first written. Any `local-stack.py` command writes it, `status` included. Kong is the base, Postgres is base+5432, and the Inbucket mail UI is base+900. The default base 8000 collides with any other default stack.
- `web` runs `node scripts/run-local-dev.mjs --port <port>` in its own process group, records the port for later `tzv` commands, and waits until `GET /` returns 200. It is ready at `[tzv] web ready app=<url> run=<run-id> evidence=<dir>`, about 30 s after start. A port outside 3000, 8080, and 18080 fails with `[local-supabase] browser_origin`.
- `run-local-dev.mjs` merges `apps/web/.env.local` and the root `.env.local` under the shell environment. It drops hosted Supabase and database keys and points the app at the local stack. `tzv web` also blanks `NEXT_PUBLIC_NAVER_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_PUBLIC_DEMO_MODE`, and `NEXT_PUBLIC_LIMITED_PUBLIC_MODE`, so the map uses the offline Naver stub `/__local/naver-maps.js` and `/global-map` shows its fallback list. Other `.env.local` keys still reach the server, for example a `GITHUB_TOKEN` that the admin dashboard uses to read GitHub Actions status.

## Doctor

Run `tzv doctor` first whenever anything looks off. It changes nothing and exits 1 on any `FAIL`. It prints the checkout HEAD and branch, the project, and the URLs. It then checks that the 14 Supabase services run, that the 2 seeded restaurants exist, that `tzv`'s process group owns the web port, that `GET /` returns 200, and that the seeded admin can log in through the local password grant. The login check reports only pass or fail.

## Identities

- The seed creates one account, `nightly-ci@local.invalid`. It is an active admin with privacy eligibility, so it is also the signed-in user for user journeys. Its password is `NIGHTLY_ADMIN_PASSWORD` in `backend/supabase/volumes/.local-stack/<project>/stack.env` (mode 0600). Never print, copy, or commit that file.
- There is no non-admin or disabled fixture. A journey that needs another identity creates a synthetic `*@local.invalid` account through the loopback GoTrue admin API and deletes it before it exits. The seed refuses to rerun while a second auth user exists.
- Never sign in with hosted credentials or a real account. A journey that needs one cannot be verified locally. Say so in that feature's Gotchas.
- The dev bypass cookie `tzudong-dev-admin-bypass` and the `x-e2e-admin-bypass` headers skip the real session and admin gate. They are never proof.

## Drive

```sh
.claude/skills/verify-tzudong/scripts/tzv drive <journey>
```

- Journeys are `map-detail`, `bookmark`, `edit-request`, `edit-request-global`, `presence`, and `admin-gate`.
- `scripts/journeys.mjs` runs headless Chromium through `@playwright/test` from `apps/web/node_modules`, on the `chromium` channel. The viewport is 1440x900 with locale `ko-KR`. Every request to a host other than `127.0.0.1` or `localhost` is aborted. Set `TZV_HEADED=1` to watch.
- Exit 0 means every step passed. Exit 1 means a step failed. `steps.log` names that step, `failure-<n>.png` shows each open page, and `browser-problems.log` lists page errors, console errors, and HTTP 4xx and 5xx responses by method and path.
- To add an entry point, add a function to `journeys` in `scripts/journeys.mjs` built from `step`, `capture`, `readback`, `signIn`, `openHome`, and `openDetail`. Then add it to the feature file.

## Evidence

- Evidence for a run goes to `artifacts/verify-tzudong/<run-id>/` at the checkout root. The run id is the UTC start time of `tzv web` plus the short HEAD. Set `TZV_RUN_ID` to group a drive under another name. `artifacts/` is gitignored.
- The run dir holds `web.log`, and one folder per journey with `steps.log`, numbered `NN-<name>.png` and `NN-<name>.aria.yml` pairs, `readback-<name>.txt` files with the query and its count or status, and `browser-problems.log` when something failed in the page.
- Proof drives the real user path: the login dialog, visible buttons, real routes. Internal setters, test-only endpoints, and bypasses are not proof. Capture the action and the resulting state. Pair every visible mutation with a database readback.
- Direct SQL only arranges a precondition the seed lacks, such as a disabled admin. The same journey restores it.
- Evidence never holds cookies, headers, storage state, tokens, `stack.env` values, or Supabase response bodies. Step captures happen before the login form is filled or after it closes. A failure capture can show a filled login form, with the synthetic email and a masked password. Read `web.log` before you share it.
- Removing a worktree deletes its `artifacts/`. Copy the run dir out first if the proof has to outlive the checkout.

## Cleanup

```sh
.claude/skills/verify-tzudong/scripts/tzv down             # stop what tzv started
.claude/skills/verify-tzudong/scripts/tzv down --destroy   # also delete this project's volumes and state
```

- `down` stops the web process group from the pid file in `<state dir>/verify/`. It stops the Supabase stack only if `tzv up` started it, and it keeps the volumes.
- `--destroy` runs a project-scoped `docker compose down --volumes` and removes the state dir, only when `tzv up` created that state dir.
- Cleanup never touches `artifacts/verify-tzudong/`. Never kill by process name. Never use `docker system prune` or an unscoped `docker compose down`.

## Isolation

- Two checkouts run side by side when their `LOCAL_STACK_PORT_BASE` and web ports differ. `tzv web` refuses a port another process holds.
- `tzv up` refuses a partial stack for this checkout that it did not start.
- Drive only an instance that `tzv` started from this checkout. Doctor's port-ownership check catches another server on the same port.
- Run one journey at a time per stack. `admin-gate` disables the seeded account for one step, and every session of that account loses admin access until the restore step.

## Gotchas

- Without `LOCAL_STACK_REPLAY_STACK=1`, `local-stack.py start` builds the PostgreSQL 17 application stack from the schema-only baseline. On 2026-11-16 that database had 0 migration ledger rows, 0 auth users, and 0 restaurants, and `run-local-dev.mjs` refused it with `[local-supabase] migration_ledger`. `.cursor/scripts/start.sh` takes that path. Use `tzv`.
- `stack.env` records the image the selector chose (`POSTGRES_IMAGE`). If any `local-stack.py` command ran without `LOCAL_STACK_REPLAY_STACK=1` first, `tzv up` fails at render. Run `tzv down --destroy` if `tzv` created the state dir. Otherwise remove the project with a project-scoped `docker compose down --volumes` and delete its state dir.
- `start` checks every host port first and fails with `port_in_use` if one is taken. Right after a `down --destroy` on Docker Desktop this happened once, and no listener showed in `lsof` a few seconds later. Run `tzv down --destroy`, then `tzv up` again.
- A failed `start` keeps its volumes, and the retry fails differently, for example `compose_local_analytics_namespace_unknown`. Run `tzv down --destroy`, then `tzv up` again. `LOCAL_STACK_PRESERVE_FAILURE_STATE=1` keeps the containers for diagnosis.
- `up` runs the migrations and the seed only when `public.restaurants` is absent. A warm restart reuses the database as the last run left it.
- `user_bookmarks`, `restaurant_submission_items`, `reviews`, and `search_logs` reference `restaurants_backup.id`, and the synthetic seed writes only `public.restaurants`. Bookmark and edit-request journeys stop at their precondition step on a stock seed. See those feature files.
- The first request to each route compiles it. Under load that takes minutes. The journeys wait up to 120 s for the map and the admin console.
- `.cursor/scripts/start.sh` also starts a Linux Docker daemon with `sudo`. Do not run it on macOS.

## Helpers

- `tzv up | web | doctor | drive <journey> | down [--destroy] | paths`. `paths` prints the evidence root and the private state dir.
- `scripts/journeys.mjs <journey>` is the driver behind `tzv drive`. It reads `TZV_APP_ORIGIN`, `TZV_EVIDENCE_DIR`, `TZV_STATE_DIR`, and `TZV_DB_CONTAINER` from `tzv`. `tzv doctor` also runs its `login-check` mode.
