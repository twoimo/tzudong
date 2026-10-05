# v2 read-only process-boundary sidecar

Reviewed 2026-10-04; PR/head and local hashes rechecked at 10:38 UTC. Scope: static source/contract comparison only. No reproduction or root-cause conclusion about the three macOS failures; those remain the source owner's work. No tests, installs, application/fixture processes, process inspection/signals, source edits, or Git/remote mutations were performed. This report is the only written file; v1 artifacts remain untouched.

Read current task-checkout `AGENTS.md`, `docs/agents/verification.md`, and `docs/agents/privacy.md`. Relevant requirements: preserve other owners' work; verify affected failure paths; missing prerequisites are not passes; retain fixed failure codes and sanitized evidence.

## Exact comparison evidence

- Checkout: `/Users/twoimo/.codex/worktrees/python-dependency-quality-20261004/tzudong`.
- Branch: `codex/python-dependency-quality-20261004`; HEAD/baseline: `4295fd54411ac8a4c304dce89efbb6f96e90935c`.
- [PR3099](https://github.com/twoimo/tzudong/pull/3099): OPEN, head `fd1fbcaaef92786c07f48ee6066aea284dff6041`, branch `codex/pipeline-performance-restart-20261002`; observed develop base `d0e38f333a8d9dbd9ed4e14d3e113732ad58ef9a`.
- `gh pr view` plus paginated `gh api repos/twoimo/tzudong/pulls/3099/files?per_page=100` returned all 787 changed files. Neither target file is changed or renamed there. Exact-head Contents API bytes were compared with the checkout and `git show <baseline>:<path>`; both target files match in all three places. This is a snapshot comparison, not merge/deployment evidence.

| File | PR head Git blob | SHA-256, identical in baseline/checkout/PR head |
| --- | --- | --- |
| `backend/pipeline/nodes.py` | `b3c2eafbe07445decd6594b5a8cf715800622f75` | `f1170e09ba459331af52ae2e6155bb4f7d8bdfa95d2c36ab6666af8c759dd788` |
| `backend/pipeline/test_nodes_unittest.py` | `b19ea8615f9b2275e8597be8a162fbd486c521d1` | `16ed22ec3086ab90047984a4d7fd92095862bba05e76c5821ba3190428c3ee54` |

## PR3099 boundary that must remain separately owned

The relevant overlap is behavioral, not a competing edit to these two files. Existing `nodes.run_laaj` invokes `11-laaj-evaluation.sh` (`nodes.py:1347–1368`). At the inspected PR head, that shell dispatches even sequential eligible work through `run_parallel_laaj.py` (shell lines 580–591). Its `run_video` creates a new POSIX session, passes selection/rule/output-lock descriptors to the child, waits with a timeout, and sends TERM/KILL to that child's group (Python lines 80–127). Preserve this PR's lock lifetime, serialized fallback, bounded admission, usage accounting, failure/75 deferral semantics and output-receipt checks. Do not transplant or rewrite its source in the cleanup repair.

**Static integration risk, not a reproduced leak:** the nested `start_new_session=True` creates a different session/group. Therefore an outer `nodes.py` group-empty result cannot establish that PR3099's nested LAAJ workers have stopped after outer cancellation. Its Windows timeout path uses parent `terminate()`/`kill()`; standalone execution is not evidence of a Job Object, although execution under the existing outer supervisor can inherit job containment. Before claiming cross-PR containment, the PR3099 owner needs a synthetic outer-cancellation/worker-lifetime check that also preserves the inherited locks. Its existing `test_killed_coordinator_does_not_release_a_live_child_video_lock` intentionally tests lock retention by a living child; preserve that distinct contract.

Sources: [PR head LAAJ runner](https://github.com/twoimo/tzudong/blob/fd1fbcaaef92786c07f48ee6066aea284dff6041/backend/bin/run_parallel_laaj.py#L80), [shell dispatch](https://github.com/twoimo/tzudong/blob/fd1fbcaaef92786c07f48ee6066aea284dff6041/backend/restaurant-evaluation/scripts/11-laaj-evaluation.sh#L580), [restart tests](https://github.com/twoimo/tzudong/blob/fd1fbcaaef92786c07f48ee6066aea284dff6041/backend/utils/tests/test_pipeline_restart_integration.py), [Python session semantics](https://docs.python.org/3/library/subprocess.html#subprocess.Popen).

## Existing contracts to preserve

- `nodes.py:124–142,799–918`: timeout is 124, output limit 125, launch failure 127, cleanup failure 126. A nonzero child exit retains its original code. Cleanup uncertainty overrides the original reason; later leader exit or pipe EOF must not erase it. All seven nodes raise `PipelineCommandFailure` before publishing completion (`test_nodes_unittest.py:264–375`).
- `nodes.py:379–475,777–791`: a verified dedicated POSIX group, TERM then bounded KILL escalation, and the pinned-interpreter full-group fallback remain required. Signal success is not empty-group proof; a leader's exit does not prove descendant termination. Permission/probe/helper failures cannot become empty-group success.
- `nodes.py:514–641,979–1010`: Windows launch stays suspended until kill-on-close Job creation, assignment and membership verification succeed. No resume before containment, no breakaway flags. Group creation alone does not replace the Job. A valid accounting query with exact returned length and zero active processes is the present empty-job contract.
- `nodes.py:745–774`: if Job termination and taskkill cannot establish cleanup, closing the Job can stop descendants but still returns failure. Preserve `windows_job_released` and sticky `SUBPROCESS_CLEANUP_FAILED`; `test_taskkill_failure_closes_job_without_descendant_leak` explicitly requires it. Parent-only kill is restricted to an unresumed suspended child. Close-handle failure remains cleanup failure.
- Preserve stage-scoped environments, executable validation, unchanged provider/model defaults, 1 MiB aggregate output limit, 64 KiB per-stream capture, pipe draining and non-daemon reader joins. Logs must remain fixed enums/timings rather than captured diagnostics.

Microsoft documents [termination across a Job hierarchy](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-terminatejobobject) and [kill-on-close on the last Job handle](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information). These establish API semantics; this sidecar provides no native Windows execution result.

## Extra cases if reaping/group-empty logic changes

These are owner test recommendations, not executed checks or diagnoses. Keep the original three expectations. Use only fixture-owned handles/PIDs/groups and sanitized readiness/exit/group/reader counts; install fixture cleanup before assertions.

| Boundary | Required observation |
| --- | --- |
| Leader exits before descendants | An already-reaped leader cannot imply an empty group; a TERM-resistant owned grandchild still requires KILL. Check both inherited-open and closed output pipes. |
| Reaping preserves outcomes | Success, nonzero exit, timeout and overflow retain their respective contracts after verified cleanup; any unverifiable cleanup stays 126. A second poll/wait must not overwrite the original exit status. |
| Scope of reaping | Only the recorded child/group is reaped. A second task-owned sibling remains live and retains its own wait status. Avoid `waitpid(-1, ...)` or `waitpid(0, ...)`, which can consume unrelated children. |
| Group-probe failure | Direct probe permission/error, pinned-helper failure/timeout and persistent membership stay unclean; only established disappearance succeeds. Include direct TERM failure and helper TERM failure followed by full-group KILL. |
| Identity/startup race | Invalid/unverified targets never become signal targets; cover immediate child exit during supervisor setup and preserve bounded failure handling without inventing a successful containment proof. |
| Reader/resource boundary | Leader exit with an owned descendant holding a pipe cannot hang indefinitely or pass early. Verify reader count zero, pipes closed, bounded capture and temporary-home cleanup; cleanup errors remain failures. |
| Windows setup/resume | Job creation/assignment/membership failure prevents resume. Resume failure distinguishes launch failure after verified cleanup from cleanup failure. POSIX-only reaping code must never run on this branch. |
| Windows accounting/close | Query failure, short structure length and active count greater than zero stay unclean. Preserve ordinary-exit success, termination/taskkill/close fallback ordering, released-handle behavior and close failure=126. |
| PR3099 integration, separate owner | Cancel the outer command with a nested worker in its own session; prove recorded worker termination and intended lock/receipt behavior before claiming whole-tree coverage. |

[Python waitpid semantics](https://docs.python.org/3/library/os.html#os.waitpid) distinguish PID/group selection and Unix/Windows behavior. Keep OS-specific additions gated; Linux-only facilities or `/proc` assumptions do not establish macOS/Windows behavior. Existing Windows-only tests provide no Windows runtime evidence on a Mac; keep them intact and report that evidence gap rather than counting a skip as success.

## Native sidecar execution evidence and remaining work

Own session `01a10679-5312-7d21-adbc-2147215fd37a`, nickname `Mill`, native `thread_spawn` parent `01a10657-0201-7350-a73d-88dd8ce446ca`, depth 2. Own rollout `rollout-2026-10-04T19-32-56-01a10679-5312-7d21-adbc-2147215fd37a.jsonl`: line 1 records provider `openai` and the native child source; line 19 records current turn `01a10679-5368-72b2-9710-bd76229dfa88`, model `gpt-6-astra`, effort `xhigh`. Lines 24/27 record an executed tool call/result; line 26 ties an actual usage record to this same thread and turn. Inherited parent metadata was excluded from the identity conclusion. This verifies persisted native session/turn and execution evidence, not an independent provider wire trace.

Disposition: read-only review complete; no repair or tests claimed. Source owner retains reproduction/root-cause work, minimal repair and targeted verification. PR3099 nested-session coverage and native Windows runtime coverage remain explicit evidence gaps; nothing here completes, closes or discards either PR or the v1 failures.
