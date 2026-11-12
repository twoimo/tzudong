# Architecture diagrams

[Documentation](../README.md) · [Backend architecture](../../backend/ARCHITECTURE.md) · [Data contracts](../../backend/DATA_CONTRACTS.md)

These diagrams explain a recorded source revision. Use the linked code and
contracts when changing behavior; a diagram's verification receipt establishes
its recorded rendering checks, not the current hosted state.

## Browse diagrams

| Topic | Diagram | Source |
| --- | --- | --- |
| System overview | [System architecture](tzudong-system-architecture.html) | [Architecture JSON](tzudong-system-architecture.archify.json) |
| Restaurant data flow | [Data pipeline](data-pipeline/tzudong-data-pipeline.html) | [Dataflow JSON](data-pipeline/tzudong-data-pipeline.dataflow.json) |
| Pipeline worker flow | [Worker boosting](data-pipeline/worker-boosting.html) | [Workflow JSON](data-pipeline/worker-boosting.workflow.json) |
| Map discovery | [Map discovery](map-discovery/map-discovery.html) | [Workflow JSON](map-discovery/map-discovery.workflow.json) |
| Admin crawler console | [Crawler console, 2026-10-04](admin-crawler-console-20261004.html) | [Dataflow JSON](admin-crawler-console-20261004.dataflow.json) |

Download an HTML file and open it locally to use its interactive viewer; GitHub
displays the file's source. Adjacent `visual-check` files record the viewport,
theme, and source version used for their checks.

## Retained earlier designs

- [Storyboard workflow](storyboard-local-mlx/storyboard-local-mlx.html),
  [lifecycle](storyboard-local-mlx/storyboard-local-mlx.lifecycle.html), and
  [verification notes](storyboard-local-mlx/VERIFICATION.md) retain the local-MLX
  design and restoration evidence. Current provider setup is documented in the
  [web guide](../../apps/web/README.md).
- [Earlier worker workflow](tzudong-worker-boosting.workflow.html) retains its
  [architecture source](tzudong-worker-boosting.workflow.archify.json).

Keep a diagram's HTML, JSON, delivery record, and visual checks together. When
updating a diagram, identify the source revision and distinguish new checks from
receipts retained for an earlier export.
