# Admin user RPC forward launch-reachability amendment

Status: source/planner amendment passed; launch remains held.

The earlier dedicated manifest stored `protectedRevision`. A ready manifest would therefore need to contain the SHA of the commit that contains that same manifest, which is not constructible without a self-reference. Tests could inject a fake record, but a tracked frozen checkout could not satisfy the contract.

The manifest now contains only stable protected-source identity:

- remote: `origin`
- repository: `https://github.com/twoimo/tzudong.git`
- ref: `refs/heads/main`

The private admission continues to carry `sourceRevision`. Its existing `protectedSourceReadbackSha256` must now equal the canonical digest of schema version, project ref, repository URL, ref and that exact revision. Before any database URL or transport is accessed, the planner requires:

1. a fresh private admission whose manifest hash and protected-source digest are exact;
2. a clean detached checkout whose `HEAD` equals `admission.sourceRevision`; and
3. a fresh `git ls-remote --exit-code --refs origin refs/heads/main` readback whose repository, ref and revision equal the same admission binding.

The default manifest is still `held`. Exact PostgreSQL `170006`, project, 80 to 85 to 86 ledger, source/vector, catalog, ACL, target-absence, freshness, advisory-lock and no-resend contracts are unchanged.

Nine Bun tests passed. The new real-Git test creates a local bare protected `main`, commits a revision-independent ready fixture manifest before its commit SHA exists, pushes it, detaches a clean checkout at that SHA, prepares the private admission afterward and reaches the mocked atomic apply. Advancing protected `main` to a second commit makes the same admission fail with `FORWARD_PROTECTED_SOURCE_MISMATCH` before any database transport call. A separately injected wrong main revision fails the same way.

At evidence capture, the read-only protected-main readback was `f31904e6dca2d9b608259cf150c5d0894db0928e`. The current candidate checkout was `c90544c813a89b077084953e42fb1431a4b1efed`, attached and dirty, so it is intentionally not launch-ready. No hosted database access, project commit, push or launch-state change occurred. Existing SQL and runtime proof files were not modified.
