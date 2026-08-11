# Nightly regression operations

The nightly regression is a read-only, bounded browser/unit check. GitHub Actions
runs it at **18:30 UTC (03:30 KST)** from the `nightly-hosted` environment, and
`workflow_dispatch` supports `all`, `unit`, or `e2e`. The scheduled workflow is
not a deployment, migration, crawler, recovery, or data-publication job.

## Security boundary

- The hosted workflow maps only `NIGHTLY_*` test-project secrets from the
  `nightly-hosted` GitHub environment. It does not map `SUPABASE_SERVICE_ROLE_KEY`,
  a database DSN, production credentials, crawler credentials, provider keys, or
  any deployment token.
- `NIGHTLY_SUPABASE_PROJECT_REF` and `NIGHTLY_SUPABASE_URL` identify one isolated,
  disposable project. `NIGHTLY_ADMIN_EMAIL` and `NIGHTLY_ADMIN_PASSWORD` belong to
  a dedicated non-production account (the email must contain `nightly`). Never
  use a personal or production account.
- The runner always receives an explicit `--mode hosted` in Actions. Local
  execution always receives `--mode local`; there is no implicit or fallback
  mode. Hosted validation rejects loopback URLs and local-only markers.
- The browser lane uses exactly four curated specs. Its shared fixture denies
  unknown hosts and real mutating requests; no live provider response is a
  fixture input. The app health check is bounded at two minutes and fails closed
  when `/api/health` does not become ready.
- Summary lines, redacted artifacts, and the optional failure notification
  contain only run URL, commit, lane status, and bounded diagnostic classes.
  They must not contain URLs with credentials, tokens, passwords, raw rows,
  request bodies, cookies, provider payloads, or service-role values. GitHub
  Actions masking is not a substitute for the workflow's redaction step.

## Hosted operation

Store only these values in the `nightly-hosted` environment:

| Secret | Purpose |
| --- | --- |
| `NIGHTLY_SUPABASE_PROJECT_REF` | isolated project reference |
| `NIGHTLY_SUPABASE_URL` | HTTPS URL for that project |
| `NIGHTLY_SUPABASE_ANON_KEY` | public client key for that project |
| `NIGHTLY_ADMIN_EMAIL` | disposable nightly account |
| `NIGHTLY_ADMIN_PASSWORD` | disposable nightly account password |
| `NIGHTLY_SLACK_WEBHOOK` | optional failure-only notification endpoint |
| `TS7_RELEASE_ID` | release identity required by the health contract |
| `VERCEL_GIT_COMMIT_SHA` | deployed commit identity |
| `VERCEL_DEPLOYMENT_ID` | deployment identity |
| `VERCEL_PROJECT_ID` | deployment project identity |

The workflow checks that the URL contains the configured project reference and
that the account is dedicated before starting a suite. A manual run should be
dispatched from the workflow page with one of the three suite choices. Rerun a
failure at the same commit only after reviewing the redacted artifact and
summary; a retry is diagnostic and is not a pass override.
## GitHub Actions local operation

`nightly-local-regression.yml` reconstructs the disposable local stack on an
Ubuntu runner. “Local” means loopback Compose services and synthetic data; it
does not mean that the workflow connects to a developer workstation. The job
pins Node 24.6.0, Bun 1.3.14, Docker Compose v2.39.4, and the Linux namespace
preflight before it resets the stack, applies the source-bound prerequisite and
migrations, closes and smokes function paths, seeds fixed local fixtures, and
runs `test:nightly -- --mode local`.
The runner attempts only the disposable user-namespace sysctl settings needed
by the containment probe. Missing privileged sysctl access is not silently
replaced with a weaker runtime; the preflight fails closed.
The GitHub-hosted runner's root-owned `/var/run/docker.sock` is accepted only
for the default local socket when both `GITHUB_ACTIONS=true` and `CI=true`;
remote Docker contexts and non-default sockets remain rejected.
Core and Studio Compose startup commands each have a 600-second bound for
first-run image pulls; readiness remains separately bounded and fail closed.
Failure receipts use stage-specific fixed codes and never expose raw Compose
stderr.
Core and Studio starts retry twice after bounded command failures to absorb
transient image-registry or runner startup errors; persistent failures remain
fail closed.
The lifecycle creates the pinned services once and starts them individually
instead of relying on one collective `up` orchestration call.
A failed reset may add a bounded `local-stack-failure-diagnostics-v1` receipt to
the short-retention Actions artifact. It contains only fixed service state,
health, exit-code, and Compose-status fields; it is never in the public release.
Before reset, the workflow pulls the exact Compose image tags with a bounded
retry and records only fixed image/status/failure-class fields. A failed pull
stops the lane before Docker Compose or publication.
The preflight also runs a no-network container probe from a pulled image so
Docker runtime failures are separated from Compose configuration failures.
When container creation succeeds, it starts each Core service separately and
retains only fixed service/failure-class fields for the first failing service.
The same receipt records whether the collective `up` orchestration succeeds,
which distinguishes Compose orchestration failures from per-service starts.

The scheduled regression job has `contents: read` only. It uploads a
short-retention `nightly-local-<run-id>` Actions artifact containing only the
fixed-schema receipts, provenance hashes, and loopback browser diagnostics.
It does not retain or publish the raw unit or Next logs. It never uploads
`stack.env`, generated passwords, JWTs, DSNs, raw database rows, provider
payloads, or arbitrary workspace files. The job stops and removes only its
generated Compose project and state root after artifact collection.

A successful regression is followed by a separate publication job. That job
runs only when the regression succeeds on `refs/heads/main`, verifies that the
run SHA is still the current `main` SHA, downloads the exact artifact allowlist,
enforces a size and secret-marker boundary, and then publishes a public
prerelease named `nightly-local-<run-id>-<attempt>`. `contents: write` is
granted only to that publication job. The unique tag is an operational
identifier; this source does not claim GitHub release or tag immutability.
The release is always marked prerelease and never becomes the repository's
latest stable release. Release notes and assets contain no credentials,
`stack.env`, raw rows, DSNs, provider payloads, or hosted/production state.

To run the same lane manually, dispatch **Nightly Local Regression** and choose
`all`, `unit`, or `e2e`. A GitHub-hosted Ubuntu runner must pass the namespace
preflight; a self-hosted runner is not a silent fallback.
A manual dispatch from any non-main ref is read-only and cannot publish a
prerelease; publication is limited to the protected default branch.

## Local Compose bootstrap

Local nightly is separate from hosted nightly. It uses the pinned local-only
Compose overlays, generated inputs, a disposable database, and synthetic
fixtures. It never imports hosted rows, blobs, Auth state, or secrets.

From the repository root:

```sh
test "$(docker compose version --short)" = v2.39.4
python3 backend/supabase/scripts/local-stack.py render
python3 backend/supabase/scripts/local-stack.py start \
  | tee /tmp/tzudong-nightly-stack-receipt.json
```

`start` performs the final-model and readiness checks and creates a
project-scoped state directory under
`backend/supabase/volumes/.local-stack/<project>/`. The state directory contains
`stack.env` (mode `0600`), `stack.env.provenance.json`,
`stack.inputs.provenance.json`, and sanitized `last-receipt.json`. Do not print,
copy, upload, or commit `stack.env`; it contains generated local credentials.
The provenance files contain hashes and metadata, not secret values.
When a host port is already in use, choose a project-scoped base before
starting (the default base is `8000`):

```sh
export LOCAL_STACK_PORT_BASE=18000
python3 backend/supabase/scripts/local-stack.py start \
  | tee /tmp/tzudong-nightly-stack-receipt.json
```

The pinned plugin reports `2.39.4` with `version --short` on current Docker
installs and `Docker Compose version v2.39.4` with the full version command;
both forms are accepted only as the same pinned renderer. The generated
loopback ports are recorded in the sanitized receipt and environment.

Capture the project name from the sanitized start receipt and apply only the
canonical backend migration source to the local database container:

```sh
PROJECT="$(python3 -c \
  'import json; print(json.load(open("/tmp/tzudong-nightly-stack-receipt.json"))["project_name"])')"
STATE="backend/supabase/volumes/.local-stack/${PROJECT}"
set -a
. "${STATE}/stack.env"
set +a
DB_CONTAINER="$(docker ps \
  --filter "label=com.docker.compose.project=${PROJECT}" \
  --filter 'label=com.docker.compose.service=db' \
  --format '{{.ID}}')"
python3 backend/supabase/scripts/local-migrate.py verify
```

The migration command is the only local application path; it uses one in-stack
`psql` executor and emits a source-chain hash. Do not pass a hosted DSN or a
historical bundle. If the migration executor reports an ambiguous transaction,
stop and perform a fresh reset; do not infer success or replay in place.
Apply the source-bound prerequisite and migrations, close every source-declared
function path in the same database, then seed and emit the sanitized receipt:
```sh
BIND=(--project "${PROJECT}" --state-dir "${STATE}" --env-file "${STATE}/stack.env")
python3 backend/supabase/scripts/local-migrate.py apply-prerequisite \
  --container "${DB_CONTAINER}" --allow-local "${BIND[@]}"
python3 backend/supabase/scripts/local-migrate.py apply \
  --container "${DB_CONTAINER}" --allow-local "${BIND[@]}"
python3 backend/supabase/scripts/local-function-runtime-scan.py generate \
  --output "${STATE}/local-function-path-patch-local.sql"
python3 backend/supabase/scripts/local-function-runtime-scan.py apply \
  --container "${DB_CONTAINER}" --patch "${STATE}/local-function-path-patch-local.sql"
python3 backend/supabase/scripts/local-function-runtime-scan.py rescan \
  --container "${DB_CONTAINER}" --patch "${STATE}/local-function-path-patch-local.sql"
python3 backend/supabase/scripts/local-function-runtime-scan.py smoke \
  --container "${DB_CONTAINER}"
python3 backend/supabase/scripts/local-migrate.py seed \
  --container "${DB_CONTAINER}" --allow-local "${BIND[@]}"
python3 backend/supabase/scripts/local-migrate.py receipt \
  --container "${DB_CONTAINER}" --allow-local "${BIND[@]}" \
  --output "${STATE}/local-receipt-v1.json"
```
The generated smoke transaction attempts every source-declared closure
candidate with fixed typed `NULL` arguments and rolls back all mutations. Trigger
context SQLSTATE `0A000` is reported only for the enumerated trigger-context
functions; the two named legacy candidates whose source references schema
objects intentionally absent from the local prerequisite (`check_restaurant_duplicate`
→ `42703` and `get_ncp_monthly_usage` → `42P01`) and other fixed-claim guard
outcomes are exact source-signature classifications in the scanner. There is no
global SQLSTATE allowlist; any unlisted status fails the smoke gate.

`stack.env` contains a generated `NIGHTLY_ADMIN_PASSWORD` for the fixed
`nightly-ci@local.invalid` fixture. The seed command passes that value to
PostgreSQL's bcrypt helper; the password and hash never enter receipts.
Verify the disposable login without printing tokens:
```sh
status="$(curl -sS -o /tmp/local-auth-login.json -w '%{http_code}' \
  -X POST "${SUPABASE_PUBLIC_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${ANON_KEY}" -H 'content-type: application/json' \
  --data "$(python3 -c 'import json,os; print(json.dumps({"email":os.environ["NIGHTLY_ADMIN_EMAIL"],"password":os.environ["NIGHTLY_ADMIN_PASSWORD"]}))')")"
python3 - "$status" <<'PY'
import json
import sys
payload = json.load(open("/tmp/local-auth-login.json", encoding="utf-8"))
print({"http_status": int(sys.argv[1]), "authenticated": bool(payload.get("access_token"))})
PY
rm -f /tmp/local-auth-login.json
```
`receipt-v1` is ordered and compact; it excludes raw rows, credentials,
passwords, provider URLs, and function bodies. Reset the project and replay
these phases whenever an executor result is ambiguous or a receipt differs.
Capture two receipts from independent resets and compare their ordered ledger
units plus catalog, seed, and service digests:

```sh
python3 backend/supabase/scripts/local-migrate.py compare-receipts \
  --first "${STATE}/receipt-a.json" \
  --second "${STATE}/receipt-b.json" \
  --allow-local
```

A mismatch is a hard failure; do not replay an ambiguous migration in place.

## Local nightly modes and provenance

`local-stack.py` generates the dedicated env and provenance pair. Export only the
`stack.env` file; `.env.local`, `*.env.local`, and `backend/.env` are rejected.
The generated `SUPABASE_DB_URL` already points at the project-scoped host database
port; do not replace it with an internal Compose port or use a repository env file:

```sh
set -a
. "${STATE}/stack.env"
set +a
```

Run a no-start contract check, one lane, or the full curated run as follows:
The local browser runner also requires an explicit `APP_PORT` that is not the
existing development listener (`8080`) and does not overlap any generated
Supabase service port. Use a disposable loopback port such as `18080`; the
runner refuses missing, protected, or conflicting values before starting Next.

```sh
cd apps/web
export APP_PORT=18080
bun install --frozen-lockfile
bunx playwright install chromium
bun run test:nightly -- --mode local --suite all \
  --env-file "../../${STATE}/stack.env" \
  --provenance-file "../../${STATE}/stack.env.provenance.json"
# Replace --suite all with unit or e2e for one lane.
# Add --validate-only to validate mode, URLs, permissions, and provenance only.
```

The env file must be the generated regular `stack.env` file, mode `0600`, with
its adjacent matching provenance receipt. Local validation requires
`NIGHTLY_LOCAL_ENV_ONLY=1`, `NIGHTLY_ENV_FILE_ONLY=1`, `NODE_ENV=test`, an
explicit loopback Supabase URL and database URL, and a generated local anon key;
it rejects cloud endpoints, project refs, cloud credentials, symlinks, and
ambient env-file fallbacks. Next's development server promotes its runtime
`NODE_ENV` to `development`; the runner therefore adds the separate
`NIGHTLY_BROWSER_RUNTIME=1` marker only after the generated provenance is
verified. The health response accepts that marker only with verified
provenance on a loopback request and remains exactly `{ok, service, mode}`.

## Reset, stop, and cleanup

- `python3 backend/supabase/scripts/local-stack.py status` emits service state
  and digests without exposing env values.
- `python3 backend/supabase/scripts/local-stack.py stop` stops only this
  project and keeps its named volumes for inspection.
- `python3 backend/supabase/scripts/local-stack.py reset` performs a
  project-scoped `down -v`, removes only this state root, generates fresh local
  inputs/env/provenance, and starts a clean stack. Reapply migrations and rerun
  the seed/readback gates after every reset.
- For final cleanup, use the exact generated project/env and all three canonical
  Compose files, then remove the same state directory:

```sh
python3 backend/supabase/scripts/local-stack.py stop
docker compose --project-name "${PROJECT}" \
  --env-file "${STATE}/stack.env" \
  -f backend/supabase/docker-compose.yml \
  -f backend/supabase/docker-compose.local.yml \
  -f backend/supabase/docker-compose.mail.yml \
  down --volumes --remove-orphans
rm -rf -- "${STATE}"
```

Never use `docker system prune`, an unscoped `docker compose down`, a generic
Supabase reset helper, or cleanup that can remove another project's resources.
Keep the sanitized receipts until the run is reviewed, then delete them with
the project state. Receipts may be shared only after checking that they contain
hashes/statuses and no DSNs, keys, passwords, cookies, rows, or provider data.

## Explicit exclusions

This workflow and the local runner **do not invoke or certify**:

- `.github/workflows/daily-crawler.yml`, `backend/run_daily.sh`, or any daily
  crawler/batch publication path;
- GDrive/frame backfill or other GDrive jobs;
- admin mutation/destructive flows, admin setup, or live-provider E2E (Naver,
  YouTube, Google, Naver Maps, image, or other provider calls);
- hosted migration apply, hosted migration preflight, release migration, or
  hosted recovery/restore tools.

Those controls have separate owners, credentials, and verification. Adding one
to nightly requires a new scope/security review; it must not be smuggled into
`all` by widening the four-spec allowlist.

## Focused verification commands

Run only the checks relevant to the lane and preserve sanitized output:

```sh
# Workflow/source contract (from apps/web)
bun test tests-unit/nightly-regression-workflow.test.ts

# Local stack and migration contracts (from repository root)
python3 -m unittest \
  backend.supabase.tests.test_local_compose_inputs \
  backend.supabase.tests.test_local_migration_contract \
  backend.supabase.tests.test_local_seed_receipt_contract

# Runner contracts; no Docker lifecycle is implied by validate-only
bun run test:nightly -- --mode local --suite all --validate-only \
  --env-file "../../${STATE}/stack.env" \
  --provenance-file "../../${STATE}/stack.env.provenance.json"
```

A passing focused check is evidence for that source contract only. It is not
permission to run a hosted migration, daily crawler, recovery operation, or
live-provider test.
