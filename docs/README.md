# Documentation

[Project overview](../README.md) · [한국어 소개](../README.ko.md) · [Contributing](../CONTRIBUTING.md) · [Repository layout](repository-layout.md)

Start with the task you want to complete. Package-specific setup and contracts
live beside their code; this directory connects them with shared guides and
dated records.

## Start here

| I want to… | Read |
| --- | --- |
| Run the web app locally | [Web setup](../apps/web/README.md), [local Supabase stack](../backend/supabase/README.md), then the [bootstrap runbook](operations/nightly-regression.md#local-compose-bootstrap). |
| Make a change and choose checks | [Contributing](../CONTRIBUTING.md) and [verification by impact](agents/verification.md). |
| Understand the UI and navigation | [Product guides](product/README.md). |
| Understand the data pipeline | [Backend architecture](../backend/ARCHITECTURE.md), [data contracts](../backend/DATA_CONTRACTS.md), and [architecture diagrams](architecture/README.md). |
| Work on restaurant evidence | [Evidence engineering contracts](evidence-engineering/README.md). |
| Operate or diagnose the system | [Operations index](operations/README.md) and [backend operations](../backend/README.md). |
| Find a release or prepare release notes | [Release channels and procedure](releases/README.md), [English changelog](../CHANGELOG.md), or [한국어 변경 기록](../CHANGELOG.ko.md). |
| Check a claim or recover context | [Evidence index](evidence/README.md) and [historical records](archive/README.md). |

## Documentation map

| Directory | Purpose |
| --- | --- |
| [product/](product/README.md) | Product design, navigation contracts, and app-submission preparation. |
| [architecture/](architecture/README.md) | Diagram sources, HTML exports, and their rendering evidence. |
| [operations/](operations/README.md) | Runbooks, transition plans, and dated operational investigations. |
| [releases/](releases/README.md) | Release channels, note format, and links to published records. |
| [evidence-engineering/](evidence-engineering/README.md) | Restaurant evidence, scoring, identity, and persistence contracts. |
| [evidence/](evidence/README.md) | Dated reports, artifact maps, checksums, and verification receipts. |
| [performance/](performance/) | Cross-project performance guidance; canonical measurements remain in [apps/web/performance/](../apps/web/performance/). |
| [agents/](agents/) | Conditional [verification](agents/verification.md), [privacy](agents/privacy.md), and [release](agents/release.md) guidance. |
| [archive/](archive/README.md) | Historical handoffs, changelog detail, and parked release-gate text. |
| [build-ship/](build-ship/README.md) | A retained delivery record for one earlier change. |

## Where new documentation belongs

Keep component setup next to the component: [apps/web/docs/](../apps/web/docs/)
and [backend/docs/](../backend/docs/). Update the existing canonical guide before
creating another setup or operating procedure.

Use descriptive lowercase names for new guides. Put dated session notes under
`archive/handoffs/YYYY-MM-DD-topic.md`; put reproducible reports and their
artifacts together under `evidence/topic-YYYYMMDD/`. Link the source commit and
state what was actually checked. Keep current instructions separate from dated
observations, and preserve paths and bytes referenced by existing artifact maps.

Root-level entry points are the READMEs, contribution guide, license, security
policy, agent guidance, and bilingual changelogs. See the [repository layout](repository-layout.md)
for placement of source code, scripts, assets, and configuration.
