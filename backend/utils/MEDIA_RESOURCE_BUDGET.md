# Shared FFmpeg admission

`mediaPool` retains the existing process-local queue/CPU-derived limit (at most 4).
`sharedMediaInvocation` separately admits native tools through four permanent
POSIX file-lock slots. Frame extraction, frame version probes, and the chunk
supervisor use it. Models, network/provider limits and extraction arguments are
unchanged.

The default directory is `<Git commondir>/tzudong-media-leases-v1`, so worktrees
of one repository share admission. A source distribution without Git uses
`backend/.runtime/media-leases`. An explicitly assigned absolute
`PIPELINE_MEDIA_RESOURCE_DIR` identifies another shared context. Every process
in that context must use the same directory. This is a guarantee for participating
new callers, not older/non-participating processes, other projects/users, or the
whole host. Runtime directories are created only on execution, not import.

The directory must be owned by the current OS user with mode0700; slots are
regular, singly linked, no-follow files with mode0600. **Never delete or rename
live context directories/slot files.** Empty lock files are reusable state,
not evidence that a slot is free. Test contexts may be removed only after all
owned native children have terminated.

The helper acquires `flock`, makes its descriptor inheritable and execs the
actual tool at the same PID/group. Native FFmpeg owns the lock until it exits,
including when its Node parent is killed. No TTL, PID-death lease reclamation,
or registry deletion releases a slot. Existing process-group timeout/cancellation
still kills the owned native process; OS descriptor close releases its lease.
An expected requesting-parent PID cancels only a request that has not executed;
it never reclaims a live lease. A queued child cannot start after that parent exits.

Configured tool wrappers must preserve `PIPELINE_MEDIA_LEASE_FD` when spawning
children that can outlive them. Transparent exec wrappers inherit it; a Python
subprocess wrapper must explicitly pass the descriptor. The retained benchmark
instrument does this. Arbitrary wrappers that drop descriptors are outside this
native-lifetime guarantee and must not be used to claim safe admission.

Version probe timeout stays 5 seconds. The helper emits fixed WAITING/ACQUIRED
markers for probes only. A timeout still waiting on admission becomes
`FRAME_MEDIA_RESOURCE_BUSY`, not a missing-tool result; after release the probe
can be repeated. Invalid lease state is `FRAME_MEDIA_LEASE_UNAVAILABLE`; actual
tool exec failure remains a tool fallback/exit failure. Neither case logs paths,
credentials or provider diagnostics.

This implementation uses POSIX OS locks/exec and is actually verified on macOS.
Windows has no silent process-local fallback; admission fails closed until a
native Windows lease implementation and actual lifecycle tests exist. Linux
and container execution are not proven by the macOS tests. No shared runtime
directory, operator setting, container or deployment was changed by preparation.

Evidence: `apps/web/performance/media-resource-followthrough-20261009/shared-cap/`.
Final actual-media source/input/config hashes were fsynced before measurement.
Two participating Node processes reached aggregate peak4 with equivalent JPEGs;
restart dispatched zero FFmpeg commands. Real native parent death, queued parent
death, busy/release probes, cache failure/success and existing group-cancellation
tests are separate correctness observations. These are not speedup claims.
Earlier cold wall/CPU regressions, RSS uncertainty and withheld performance
admission remain preserved.
