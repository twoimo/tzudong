# CI simplification rollout

This runbook describes the first implementation phase of the approved CI/CD
simplification. Source changes alone do not prove that branch protection was
updated, that a deployment occurred, or that a Mac runtime was measured.

## Phase 1: select checks, then require their results

`web-admin-ci.yml` starts on every PR and every existing protected branch push.
It no longer uses workflow-level path filters, so its stable `CI` result can be
required without leaving a documentation-only PR waiting for an absent check.
The `scope` job reads the complete Git diff for the event's exact checkout.
Renames are treated as a deletion and an addition. Missing history or an unknown
input selects the full set; a source mismatch fails the scope job.

| Input | Web checks |
| --- | --- |
| Explicit documentation paths | Scope tests and the final `CI` result; Release remains independent |
| Ordinary web runtime | Linux npm authority, eight unit shards, production build, Install browser proof, Admin |
| Backend, DB and governance source | Unit and Admin contracts; dependency/tooling inputs can expand this |
| Web tooling, dependencies, compiler proof inputs | All existing jobs, including Windows/Bun compatibility |
| PR/push to data/main, weekly/manual, unknown scope | All existing jobs |

The Install job still includes real map/select/panel browser behavior. It cannot
be limited to lockfile changes until those browser assertions have their own
reviewed affected-input graph. The unit inventory and eight-way partition are
unchanged. A selected full benchmark always retains all four profile owners.

`security-audit.yml` also starts for every PR. Its original 220 path patterns are
retained in `.github/ci-security-paths.json`, together with the new scope/gate
inputs and previously uncovered `*requirements*.txt` filenames. The scope job
selects the existing seven security jobs together. A documentation-only or
unrelated runtime change skips those jobs explicitly; scheduled/manual runs and
protected promotions run them all. This phase does not subdivide the seven
security jobs or remove any audit, PostgreSQL probe, or orchestration check.

The `CI` and `Security` result jobs use `always()` with the complete fixed `needs`
set. `verify-ci-results.mjs` rejects missing/unknown dependencies, invalid scope
outputs, contradictory scope reasons, a failed/cancelled/skipped selected job,
or an unexpectedly executed non-selected job. Matrix jobs must not use
job-level `continue-on-error` to turn a failed shard into a successful result.
These are separate result contexts: `CI` success does not prove Security or
CodeQL success.

### Dependency PR metadata

Per-PR dependency checks use the event's PR number, base SHA, base ref, and actual
checked-out head. The collector reads that PR directly, even after it closes or
merges, and reads changed files from an immutable base/head comparison. It checks
source identity again after collection. A changed head/target, missing metadata,
or the API's incomplete 300-file comparison boundary fails closed. Scheduled
open-PR discovery retains its existing pagination. Diagnostic output uses fixed
codes rather than raw provider errors.

## Activation and verification

1. Run the scope/result failure tests, workflow wiring contracts, dependency
   candidate race cases, and affected source checks on the candidate.
2. Open the candidate against `develop` through the current protected PR path.
   For this policy-changing PR, retain the full proof and security jobs.
3. Verify exact candidate SHA and the completed remote `CI`, `Security`, Release,
   Promotion Path, and applicable CodeQL/dependency checks. A local test run is
   not remote execution evidence.
4. After the new contexts have actually appeared, add `CI` and `Security` as
   required GitHub Actions contexts on `develop`, preserving all existing
   required contexts and strict/protection settings. Read back the saved rule.
   Record administration access as pending if the connected tool cannot perform
   this step; never claim the YAML alone activated a required check.
5. Merge through the existing policy after the relevant checks pass. Observe the
   next ordinary change and a documentation-only change before replacing more
   release structure. Compare changed-input type, wall time, queue time, and
   summed job time; do not present a projected saving as a measurement.

The existing `develop -> data -> main` promotion path remains in this phase.
Push verification is retained until final merge-tree and release-artifact
identity have a replacement contract. The current production SHA approval gate
and deployment integration are unchanged. Branch consolidation must first move
or retire the data-branch publisher and prepare staged production, its single
promotion owner, and rollback. Do not enable feature-to-main before those
conditions are verified.

## Hosted rollout record: 2026-11-13 (KST)

The following protected PRs were merged into `develop` after their applicable
remote checks passed:

| Phase | PR | Merge commit |
| --- | --- | --- |
| CI scope and result gates | [#3810](https://github.com/twoimo/tzudong/pull/3810) | `98642719` |
| On-demand pipeline modes and delivery recovery | [#3811](https://github.com/twoimo/tzudong/pull/3811) | `8b5b6c22` |
| Optional data-publication binding | [#3812](https://github.com/twoimo/tzudong/pull/3812) | `f764fd65` |
| Retired release helper and staged-production preparation | [#3813](https://github.com/twoimo/tzudong/pull/3813) | `8a759654` |

The saved `develop` protection was read back with GitHub Actions contexts
`Release`, `Promotion Path`, `CI`, and `Security` required. Existing strict
up-to-date and no-bypass settings were preserved. The backend changes in PRs
#3811 and #3812 each skipped six unrelated web jobs while retaining their selected
unit, Admin, and result checks. This is an observed job-selection result; no
wall-time, summed-job-time, queue-time, or Mac memory saving is established here.

The post-merge runs for `8a759654` also completed successfully:
[CI](https://github.com/twoimo/tzudong/actions/runs/43259833379),
[Release](https://github.com/twoimo/tzudong/actions/runs/43259833593), and
[CodeQL](https://github.com/twoimo/tzudong/actions/runs/43259833260).
The documentation-only lane was subsequently verified in
[#3814](https://github.com/twoimo/tzudong/pull/3814), exact head
`592e713c6968e07c254aaf30a12787e173d02609`.
Its [CI run](https://github.com/twoimo/tzudong/actions/runs/43266364981) succeeded
in 32 seconds from run creation to the last job completion, with two successful
and eight skipped job records. The skipped unit matrix is one unexpanded API
record, not eight separately executed jobs. The PR body retains the timing
definitions and observations; these are not a controlled speedup measurement.

At the earlier observation above, `main` was `36a6a3b5` and `data` was `20fd13c9`.
Protected [#3815](https://github.com/twoimo/tzudong/pull/3815) then promoted
`develop` to `data` after the full promotion checks passed, producing commit
`8af98ee68890925dddc4f145911774b3e70fa0cf` and tree
`f6853410d1b49deca57de9310281dfa470ba5bf3`.
The `data -> main` [#3816](https://github.com/twoimo/tzudong/pull/3816) remains a
draft at this record, pending the protected promotion conditions and fresh
Vercel production and rollback identity.

This documentation update accompanies a candidate reconciliation of the current
`main`, `data`, and `develop` commit ancestry. Runtime, test, and configuration
files retain their bytes from the tree recorded above. The existing strict
protection and serial `develop -> data -> main` path remain in force. This record
does not establish a production deployment, main-only activation, or Mac cleanup.
The Vercel connection listed the `twoimos-projects` team with zero linked Git
projects, and the known project lookup returned 404. That leaves the deployment
identity unverified; it does not establish project deletion or a service outage.
Actual Mac/Dots runtime access was also unavailable. Continue independent source
promotion under the existing policy while those execution inputs are resolved.

## Rollback

Revert this phase through a protected PR, keeping required contexts satisfiable
throughout the transition. If reverting the new result jobs, change the required
check configuration only as a reviewed paired operation after the replacement
verification path is available. Preserve source, migration, data publication,
and deployment evidence; no force push or branch-protection bypass is needed.

## Later phases

The [on-demand pipeline modes](../../backend/pipeline-control/LOCAL_MODES.md)
are implemented on `develop`; activation and measurement on the actual Mac are
separate execution steps. The current web app uses Auth, REST, Storage, Realtime,
and Edge Functions, and its local development entrypoint requires a verified
Supabase runtime. A minimal mode must preserve these features and cannot imply
that the current `npm run dev` works without Docker. The full platform and
historical replay modes retain their existing contracts. Actual Mac cleanup needs a measured inventory,
active-job/volume ownership, and restart verification before changing services.

The [optional compute/data binding](daily-compute-data-binding.md) is also
implemented on `develop`; it does not retire the publisher or its remaining
consumers. Main-only source flow, deployment ownership, and obsolete branch
cleanup follow the prerequisites in the
[staged-production transition](staged-production-transition.md). Each phase gets
its own relevant verification and remote readback.
