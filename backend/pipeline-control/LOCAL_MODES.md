# Local pipeline services on demand

The default Compose selection runs only `pipeline-api`. The batch worker runs
when explicitly invoked. Event transport, Elasticsearch diagnostics, and
telemetry are separate opt-in selections.

This changes the pipeline Compose layer only. The existing full local Supabase
stack, its lifecycle commands, migrations, and frontend runtime requirements
remain unchanged. These commands do not start Supabase or create another
Postgres database.

## Selections

Run the examples from `backend/pipeline-control`. Every selection keeps the
base file first and therefore uses project `tzudong-pipeline-control`.

| Work | Files after `docker-compose.pipeline.yml` | Profiles | Services selected by `up` |
| --- | --- | --- | --- |
| Control API | None | None | API |
| One batch invocation | None | Worker target activates `batch` | Worker exits after its invocation |
| Event transport | `docker-compose.pipeline.events.yml` | `events` | API, publisher, Kafka, Kafka UI |
| Search diagnostics | Events file, then `docker-compose.pipeline.search.yml` | `events`, `search` | Event services plus indexer and Elasticsearch |
| Telemetry | Append `docker-compose.pipeline.telemetry.yml` to any selection | No extra profile | Selected application services plus collector, Loki, Prometheus, Grafana; a storage initialization helper completes once |

Profiles determine which long-running application processes are present. Feature
overrides configure their producers and reuse the existing infrastructure files
through Compose `extends`. A publisher or indexer profile without its required
feature files is invalid. A feature file without its required profile is also
invalid, because the API depends on that feature's application process.

The standalone Kafka, Elasticsearch, and observability files remain available
to `backend/bin/observability_up.py`. They retain their own project names and
exact service inventories. Do not launch the combined selection over already
running standalone instances on the same ports/network; inventory those
instances before the later runtime transition.

## Prerequisites

Docker Compose must support profiles, service `extends`, and JSON `config`
output. A Docker engine is needed to run services; `compose config` only renders
the model. The existing local Supabase network must already exist. Its name is
read from `TZUDONG_LOCAL_SUPABASE_NETWORK`, with the same existing default as the
standalone infrastructure files.

API and worker share the existing repository mount, FileStore, and filesystem
queue. These selections do not set `TZUDONG_PIPELINE_STORE`,
`TZUDONG_PIPELINE_PERSIST`, or `TZUDONG_PIPELINE_LIVE`. The worker retains its
existing environment/data-sink/runtime preflights and `init: true` process
cleanup. Feature selection is not live-run authorization.

Events additionally require the existing **local** `pipeline_control` outbox
schema and RPCs, including
`backend/supabase/migrations/20260820050000_pipeline_outbox.sql`, to have been
applied by the normal local migration process. The DB must be ready and the
existing allowlisted `postgresql://postgres@db:5432/postgres` connection must be
usable before the publisher starts. No Compose file applies a migration.
Missing local schema/readiness is a failed prerequisite, not a reason to point
the service at a hosted database or enable a different job store.

## API and batch

Validate and start the API:

```bash
docker compose -f docker-compose.pipeline.yml config --quiet
docker compose -f docker-compose.pipeline.yml up -d --build
```

Run the worker explicitly when batch work is needed:

```bash
docker compose -f docker-compose.pipeline.yml run --rm --build pipeline-worker
```

Explicit service targeting activates that service's profile and starts only its
dependencies. It does not launch all peers in a profile. There is no worker
restart loop. The existing worker is one batch invocation, which can process
queued work; it is not a promise to claim exactly one queued item. Its existing
dry-run/live and queue-safety rules still apply.

## Events and search

Events select `kafka` mode and the shared **local Postgres outbox** for API,
worker, and publisher. This matters because a Kafka-mode publisher with the
default `none` outbox has nothing to drain. It does not switch the authoritative
job store away from FileStore. Existing event allowlists and publication/ack
behavior remain unchanged.

```bash
docker compose -f docker-compose.pipeline.yml \
  -f docker-compose.pipeline.events.yml --profile events config --quiet
docker compose -f docker-compose.pipeline.yml \
  -f docker-compose.pipeline.events.yml --profile events up -d --build
```

For search, add the search override and profile to that same selection:

```bash
docker compose -f docker-compose.pipeline.yml \
  -f docker-compose.pipeline.events.yml \
  -f docker-compose.pipeline.search.yml \
  --profile events --profile search config --quiet
docker compose -f docker-compose.pipeline.yml \
  -f docker-compose.pipeline.events.yml \
  -f docker-compose.pipeline.search.yml \
  --profile events --profile search up -d --build
```

Search enables `es` mode for the indexer and the batch worker's direct raw
diagnostic writes. The publisher forwards the outbox's allowlisted events to
Kafka; the indexer consumes those topics into Elasticsearch. Elasticsearch
remains non-authoritative diagnostics. Kafka and Elasticsearch keep their
existing image versions, loopback ports, and storage declarations.

The publisher retries temporary local DB/outbox failures and verifies each
Kafka send result before acknowledging its outbox row. The indexer retries
temporary broker or indexing failures, verifies every bulk item before
committing offsets, and closes each consumer it owns without auto-commit.
Configuration and host-admission failures remain terminal. This supports
starting an optional mode while its dependencies become ready; it does not
replace the local schema and connection prerequisites.

Use the same feature files when invoking a batch that should emit those events
and diagnostics:

```bash
docker compose -f docker-compose.pipeline.yml \
  -f docker-compose.pipeline.events.yml \
  -f docker-compose.pipeline.search.yml \
  --profile events --profile search run --rm --build pipeline-worker
```

## Telemetry

The base and event/search selections contain no OTLP exporter endpoint. Metrics
keep their existing no-export behavior until the telemetry file is selected.
That file adds both the exporters and their collector dependency. It also
retains the unprivileged collector, persistent offsets/export queue, loopback
bindings, Grafana authentication, and CSP settings from the standalone file.

Set the existing `GRAFANA_ADMIN_PASSWORD` through the operator's normal secret
handling, then append the telemetry file. For API metrics alone:

```bash
docker compose -f docker-compose.pipeline.yml \
  -f docker-compose.pipeline.telemetry.yml config --quiet
docker compose -f docker-compose.pipeline.yml \
  -f docker-compose.pipeline.telemetry.yml up -d --build
```

This does not activate publisher, indexer, Kafka, Elasticsearch, or the batch
worker. When added to an events/search selection, it configures exporters for
those selected processes too. Add it to the worker command when batch metrics
are wanted. `config --quiet` checks configuration without printing the expanded
dashboard password.

When returning to a smaller selection, first render that desired selection and
recreate the affected application services with it. Removing a file/profile
from a command does not stop previously running containers. In particular,
remove exporter configuration from running applications before retiring their
collector. Existing containers, volumes, jobs, and stored outbox rows require
an inventory and a separate deliberate runtime transition; this source change
does not remove them or migrate collector state between Compose projects.

## Verification and remaining runtime evidence

Source regression checks:

```bash
python -m unittest \
  backend.pipeline_control.tests.test_compose_modes \
  backend.pipeline_control.tests.test_metrics \
  backend.pipeline_control.tests.test_events \
  backend.pipeline_control.tests.test_events_observability \
  backend.pipeline_control.tests.test_es_index \
  backend.pipeline_control.tests.test_container_runtime \
  backend.pipeline_control.tests.test_queue \
  backend.pipeline_control.tests.test_live_and_cutover
```

Run those commands from the repository root. The native render tests skip with
an explicit missing-prerequisite message when Docker Compose is absent. That
skip is not render proof. The `Security` workflow's orchestration job requires
the actual renderer, and its result feeds the required `Security` aggregate.
The same job installs the pinned pipeline clients and exercises event delivery,
recovery, and metrics contracts before it can succeed:

```bash
REQUIRE_DOCKER_COMPOSE=1 python -m unittest \
  backend.pipeline_control.tests.test_compose_modes.ComposeRenderTests
```

The native matrix checks API/batch/events/search with and without telemetry,
incomplete-selection rejection, project identity, dependencies, local network,
inherited mounts, named storage, loopback bindings, and exporter/collector
co-selection. It uses an isolated interpolation fixture and starts no services.

Rendering and source tests do not establish container readiness, event delivery,
local DB connectivity, image behavior on Apple Silicon, Mac memory/CPU savings,
or production rollout. Those require actual Mac inventory and runtime readback
when the local connection is available. The expected reduction is in selected
background processes; no measured performance improvement is claimed here.
