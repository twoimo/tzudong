# Daily compute and the optional data publication base

The [daily crawler workflow](../../.github/workflows/daily-crawler.yml) binds its
compute source to the protected default branch before running the worker. Its
binding step explicitly refreshes the `data` branch only when the repository
variable `TZUDONG_DATA_BRANCH_PUBLISH` is exactly `1`. The existing full-history
checkout remains unchanged; this does not claim that checkout omits data-branch
history or that checkout time has been reduced.

| Publication setting | Source validation | Data base binding |
| --- | --- | --- |
| Unset, empty, or any value other than `1` | Required | No explicit `data` refresh in the binding step; no `base_sha` or `base_tree` output |
| Exactly `1` | Required | Fetch `data`; require its commit and tree; emit the exact base SHA and tree |

An absent `origin/data` therefore does not prevent compute when legacy Git
publication is disabled. A missing remote `data` branch still fails the binding
step when publication is enabled, including when a stale local tracking ref
exists.

## Source and publication trust

Both modes require the workflow repository to match the event repository, the
run to name the protected default branch, and checkout `HEAD` to equal the
triggering SHA. The step refreshes the default-branch ref and requires that SHA
to be its ancestor. A later default-branch commit is permitted; an unrelated
source is rejected.

The publication artifact upload and `daily-publish` job retain their explicit
opt-in. Publication also requires the existing freeze admission, ready bundle,
compute-bound manifest digest, artifact digest, exact source and data base
checks, and verified content commit. The
[bundle validator](../../backend/bin/validate_daily_publication_bundle.py)
continues to enforce those data and digest contracts.

The current compute entrypoint is
[`backend.pipeline_control.worker`](../../backend/pipeline_control/worker.py).
It does not produce the legacy `daily-data-publication` bundle or `.ready`
marker. This change does not create either, so selecting `1` alone does not
establish a ready publication artifact.

## Delivery paths and rollout

GDrive uploads retain `RUN_DAILY_TARGET_BRANCH=data`, the existing `status/main`
scope, and the residual queue and staging locations defined by the
[GDrive data contracts](../../backend/DATA_CONTRACTS.md). Separating compute
source binding does not move durable upload state.

This is a source preparation step. Repository variables, branch protection,
hosted write gates, and the `develop -> data -> main` promotion order continue
to govern activation. The `data` branch remains part of that promotion order.

## Verification

Run the focused governance suite from the repository root:

```sh
python -m unittest backend.utils.tests.test_governance_boundaries
```

Its source-binding tests execute the workflow's actual shell step against local
Git repositories. They exercise missing remote refs, exact flag semantics,
independent data commit/tree binding, source mismatches, and trigger ancestry.
These checks establish local behavior; hosted workflow completion and release
readback remain separate evidence.
