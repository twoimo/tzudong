# Repository map

[Documentation](README.md) · [Contributing](../CONTRIBUTING.md)

Tzudong keeps application code, pipeline code, and cross-project documentation
under separate owners. The [layout manifest](../backend/layout-manifest.v1.json)
records every in-scope first- and second-level directory; its checker also reads
new candidate files.

## Main directories

| Directory | Owns | Entry point |
| --- | --- | --- |
| `apps/web/` | Public Next.js app and guarded admin console | [Web guide](../apps/web/README.md) |
| `backend/` | Crawlers, pipeline control, evaluation, media, and database work | [Backend guide](../backend/README.md) |
| `docs/` | Guides shared across components and retained delivery records | [Documentation index](README.md) |
| `scripts/` | Repository-wide operator and security tools | [Scripts index](../scripts/README.md) |
| `.github/` | Workflows, promotion checks, contribution forms, and release-note settings | [GitHub maintenance](../.github/README.md) |
| `assets/source-fonts/` | Source font assets | [Font files](../assets/source-fonts/) |

The root keeps reader entry points (`README*`, `CONTRIBUTING.md`, `CHANGELOG*`),
project policies (`LICENSE`, `SECURITY.md`, `AGENTS.md`), and configuration that
tools resolve from the root. `Package.swift` is an existing crawler support
manifest. The short root [TASKS.md](../TASKS.md) preserves the old entry point to
the [evidence-engineering task ledger](evidence-engineering/TASKS.md).

## Web app

| Path within `apps/web/` | Purpose |
| --- | --- |
| `app/`, `pages/` | Next.js routes and existing route entry points |
| `components/`, `hooks/`, `contexts/` | UI components and client state |
| `lib/`, `integrations/`, `types/` | Domain logic, service boundaries, and shared types |
| `public/`, `styles/`, `design/` | Served assets, styles, and design resources |
| `scripts/` | Web development, build, verification, and operator commands |
| `tests-unit/`, `tests/`, `tests-formal/`, `fixtures/` | Unit, browser, formal checks, and fixtures |
| `docs/` | Web-specific setup and feature guides |
| `performance/` | Canonical web measurement inputs, reports, and validators |

The web package owns its npm manifest and lockfile. Run web package commands
from `apps/web`. The repository root is not an npm workspace.

## Backend

| Path within `backend/` | Purpose |
| --- | --- |
| `pipeline_control/` | Importable Python control-plane and worker implementation |
| `pipeline-control/` | Operational configuration, observability, and runbooks |
| `pipeline/`, `utils/`, `bin/` | Pipeline contracts, shared helpers, and command-line tools |
| `restaurant-crawling/`, `restaurant-evaluation/` | Video ingestion and restaurant evaluation |
| `storyboard-agent/`, `thumbnail-agent/` | Media planning and worker integrations |
| `supabase/` | Migrations, local stack, fixtures, and database tooling |
| `docs/` | Backend operation guides |

`pipeline_control/` and `pipeline-control/` have different owners. Use the
[backend architecture](../backend/ARCHITECTURE.md) and
[layout manifest](../backend/layout-manifest.v1.json) when changing their
contents. Long-running jobs belong in backend workers.

## Where new files belong

| New material | Destination |
| --- | --- |
| A how-to specific to one component | That component's `README.md` or `docs/` |
| Product behavior or UX contract | [product/](product/README.md) |
| System diagrams and their source models | [architecture/](architecture/README.md) |
| Maintained operational procedure | [operations/](operations/README.md) |
| Release channels, process, and note template | [releases/](releases/README.md) |
| Dated verification report and retained artifacts | [evidence/](evidence/README.md); web performance measurements remain in `apps/web/performance/` |
| Session handoff or superseded narrative | [archive/handoffs/](archive/handoffs/) with a `YYYY-MM-DD-topic.md` name |
| Local logs, build output, caches, or credentials | Existing ignored locations in [.gitignore](../.gitignore) |

Use a descriptive `kebab-case.md` filename for new guides and a `README.md`
entry point for a substantial directory. Include the date and scope in historical
records. Link to the canonical guide instead of duplicating its setup commands.

## Changing the layout

Before moving a file, find its callers and references. Update relative links and
any path-based contracts in the same PR. Register new first- or second-level
directories in the layout manifest, then run:

```sh
python3 backend/bin/check_layout_manifest.py --json
git diff --check
```

Keep published release assets, applied migrations, and evidence manifests with
their referenced bytes and paths. Older receipts can remain in place and be
identified through an archive index. This preserves their reproducibility.
