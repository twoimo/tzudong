# Operations

[Documentation](../README.md) · [Backend operations](../../backend/README.md) · [Release guide](../agents/release.md)

Use the runbooks for procedures and the dated records for investigation context.
A recorded deployment, completed checkbox, or successful local run describes its
stated commit and environment; check the current state before another operation.

## Runbooks and active transition work

| Task | Entry point |
| --- | --- |
| Bootstrap the local stack; run or diagnose regression lanes | [Nightly regression](nightly-regression.md) and [local stack setup](../../backend/supabase/README.md). |
| Operate the crawler and interpret run summaries | [Backend operations](../../backend/README.md) and [daily operations](../../backend/docs/run-daily-operations.md). |
| Understand the local PostgreSQL transition | [PostgreSQL 17 transition plan](local-postgres17-transition.md); use its named revisions and measured results. |
| Recover restaurant evidence | [Evidence recovery](restaurant-evidence-recovery.md); request and worker execution are separate steps. |
| Choose checks | [Verification guide](../agents/verification.md). |
| Prepare a release or rollback | [Release channels](../releases/README.md) and [hosted operations guidance](../agents/release.md). |

## Investigations and delivery records

These are entry points into dated work, not a claim that every described runtime
or deployment is still current. Their linked receipts retain the detailed scope.

| Area | Records |
| --- | --- |
| CI performance and monitoring | [Performance analysis, 2026-10-10](github-ci-performance-20261010.md) · [Monitor, 2026-10-11](github-ci-monitor-20261011.md). |
| Crawler input and recovery | [Input freshness](crawler-input-freshness-20261025.md) · [Live recovery](crawler-live-recovery-20261025.md) · [Terminal cache](crawler-terminal-cache-20261025.md). |
| Admin console and data | [Admin/database map](admin-page-database-20261004.md) · [Admin and knowledge graph](admin-and-knowledge-graph-20261004.md) · [Incremental admin work](admin-incremental-20261021.md). |
| Review processing | [Recovery](review-recovery-20261019.md) · [Activation lock](restaurant-review-activation-lock-20261025.md) · [Held-input custody](hosted-pending-custody-20261025.md). |
| Thumbnail workers | [Outbound worker](thumbnail-outbound-worker-20261023.md) · [Gemini worker](thumbnail-gemini-worker-20261023.md) · [Integration](thumbnail-integration-20261024.md). |
| Provider budgets | [Budget bridge](provider-budget-bridge-20261024.md). |
| Product delivery | [Mobile map stabilization](mobile-home-map-ux-stabilization.md) · [Storyboard restoration evidence](evidence/storyboard-restore-20260920/README.md). |
| Monitoring | [Sentry integration](sentry-integration-20261004.md) · [Release binding](sentry-release-binding-20261015.md). |

## Earlier plans and proposals

[Proposals](proposals/) are review material; their presence does not mean they
were adopted. The [storyboard RAG operating profiles](storyboard-rag-operating-profiles.md)
and [local-MLX acceptance record](storyboard-local-mlx-acceptance.md) retain earlier
provider designs. Start current provider configuration from the
[web guide](../../apps/web/README.md), which documents the Gemini worker path.

The [September release-readiness record](production-release-readiness-20260918.md),
[October operating-release record](operating-release-20261010.md), and
[build/ship record](../build-ship/README.md) are historical snapshots. Current
promotion requirements are in the [release guide](../agents/release.md).

## Adding operational documentation

Update a descriptive runbook when the procedure changes. For a new investigation,
use `topic-YYYYMMDD.md` and state its commit, environment, result, and unresolved
work. Put session handoffs in [archive/handoffs/](../archive/handoffs/), and keep
artifact bundles in [evidence/](../evidence/README.md). Preserve existing receipt
paths when linking older work.
