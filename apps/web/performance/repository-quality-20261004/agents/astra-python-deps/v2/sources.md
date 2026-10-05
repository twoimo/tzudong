# v2 primary sources and local evidence

- [Python 3.12 Popen.poll](https://docs.python.org/3.12/library/subprocess.html#subprocess.Popen.poll): non-blocking child termination check that updates returncode.
- [Python 3.12 os.killpg](https://docs.python.org/3.12/library/os.html#os.killpg): signal the selected POSIX process group.
- [Python 3.12 os.waitpid](https://docs.python.org/3.12/library/os.html#os.waitpid): positive PID selects the specific child; broad negative/zero selection was not added.
- Official pages were consulted in this task. The live documentation patch release can advance; execution remained pinned to CPython 3.12.13. The installed standard library was inspected: `Popen.poll()` calls `_internal_poll()`, whose POSIX non-blocking wait selects `self.pid` with `_WNOHANG`. Source hashes are in `stdlib-reaping-proof.json`.
- The macOS zombie/group observation is measured fixture evidence, not inferred from the docs: compare `baseline-owned-os-observation.json` and `candidate-owned-os-observation.json`.
- PR3099 exact-head source links and a separate nested-session integration gap are recorded in `sidecar-review.md`. No source from that PR was transplanted.
- There is no SDK version/API change in v2. Dependency metadata, resolver, pip check/audit and upstream release reasons remain the unchanged v1 snapshot; no fresh audit result is claimed here.
