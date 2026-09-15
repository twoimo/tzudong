# Local-first readiness — 2026-09-08

This is a completion audit of the requested local-first development workflow.
It does not certify production readiness or guarantee perfect performance.
Continue development in `/Users/twoimo/Documents/projects/tzudong-local-replay-v2-20260908`;
the original dirty checkout remains preserved.

| Requested outcome | Evidence and present status | Remaining condition |
| --- | --- | --- |
| Real restaurant data in the local app | Current anonymous local REST readback: 543 approved source rows, merged by the application into 529 places. All have valid coordinates; 516 are inside Korea bounds and 13 outside, with no unmatched overseas region. | Future imports need their own validation. |
| Usable local map and search | Aside verified domestic Naver clusters, overseas country selection and markers, category counts, and search → matching business detail. The local banner identifies the working catalog. | This is exercised-flow coverage, not every browser/device or action. |
| Isolated development environment | Current checkout-bound startup integrity check passes. One working Docker stack has 14 running containers; the idle original fixture stack remains stopped with volumes retained. Node 24 launch instructions are documented. | No claim of measured host RAM or user-latency improvement. |
| Remove unnecessary generated files | Historical retained cleanup receipt records removal of the obsolete port-21080 build (254,349,312 bytes) and two generated TypeScript includes. Current active build, source and evidence remain preserved. | Do not delete retained data or evidence merely to reduce file count. |
| Manage edits locally | Guarded field-edit API/UI implements preview, typed confirmation and readback. Existing local UI verification covers preview and cancellation; isolated SQL tests cover apply/audit/readback. | Approval and other legacy actions are separate. A real business-data edit was not applied merely for testing. |
| Publish only selected important data | Hash-bound review planner, publication operator and SQL candidates exist. The guide records isolated end-to-end publication and working-catalog rollback probes. Current SQL hashes match those recorded results. | SQL candidates are uninstalled. Reviewed migration activation, external release evidence and operation-specific approval are required. |
| World-class performance | Correctness/scaling guards and static inventories exist; the retained records explicitly admit zero G003 measured slices. | No retained measurement establishes production latency improvement or a world-best claim. |
| Updated agent guidance | Candidate `AGENTS.md` links focused verification, privacy and release rules, preserving the original-worktree and release boundaries. | Guidance cannot replace external approval or runtime evidence. |

## Scope and normal local workflow

Actual production deployment is not a prerequisite for completing local workflow
improvements. External release approvals apply only when an operator chooses to
activate or execute production writes; do not suspend independent local work for
them. The goal is a useful local workspace plus selective, reviewable publication
preparation, not an unsolicited deployment.

From this checkout's `apps/web`, use `npm run dev:local` to launch the workspace
and `npm run catalog:review` to compare local edits with the single verified import
baseline. The latter reports the review artifact path and change count without
hosted requests or database writes. Explicit record selection is available through
`npm run catalog:review -- --restaurant-id <uuid>`.

## When actual production activation is requested

Provide the actual reviewed release-evidence location required by
[the release guide](../agents/release.md). The publication SQL must then move
through the protected `develop -> data -> main` sequence with a reviewed activation
plan. Do not install it directly, invent an approval JSON, clear `G037_WRITE_FREEZE`,
or apply a business change solely to make the audit green.

The full [working-catalog guide](../../backend/supabase/docs/local-working-catalog.md)
contains startup, preservation, preview/apply/readback commands, candidate hashes
and the exact activation boundary. Normal local map development and local review
can continue at `http://localhost:8080` independently of that boundary.
