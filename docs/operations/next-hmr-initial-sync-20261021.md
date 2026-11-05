# Next 16.3.8 initial HMR SYNC

New parallel browser connections could reload existing pages during local admin verification. `WebpackHotMiddleware.onHMR` published its initial `SYNC` to every connection. A changed compilation hash then made existing clients reload, interrupting RSC navigation. The one-line fix sends this initial snapshot only to the joining client with the existing `publishToClient` method. Build/error broadcasts and the SYNC payload remain unchanged.

## Installation and scope

- `apps/web/scripts/apply-next-sync-patch.mjs` runs from the root `postinstall` for both npm and Bun. It checks the exact Next 16.3.8 pin in the manifest, authoritative npm lock and installed package, then accepts only the original or patched module hash. Unknown versions or bytes fail closed.
- The installer bounds reads, rejects symlinked paths/metadata and replaces a temporary inode atomically. It leaves a hardlinked package-cache inode untouched. Install/apply operations must be serialized per checkout; the file checks are not a filesystem compare-and-swap guarantee.
- `clean-next.mjs` verifies the patch before a managed `next dev` launch. After `npm ci --ignore-scripts` or `bun install --ignore-scripts`, run `node scripts/apply-next-sync-patch.mjs` explicitly. A missing patch prevents the dev child from starting. Direct manual Next CLI calls bypass this wrapper.
- No production request handling, dependency version, sample count, scorer, browser parallelism, HMR setting or retry policy changes. npm lock adds only the root `hasInstallScript` flag; the Bun lock is unchanged.
- Initial module SHA-256: `dfe8d350b7d13436f8409892c992cf90f20d7795a25235c4ca30764353b6afcc`. Applied SHA-256: `a8e1623f41b8df1d17e6e90c4ae3d439b24b654ba035a03b3d91e8b22c11d56c`.

## Verification

From `apps/web`, with the pinned project runtimes:

```sh
npm ci
node scripts/apply-next-sync-patch.mjs --verify-only
bun test tests-unit/next-sync-patch.test.ts tests-unit/next-hmr-initial-sync.test.ts
```

Use a separate clean directory for `bun install --frozen-lockfile` and verify the same module hash. The installer tests cover refusal/no-op/cache-preservation paths; the HMR tests load both exact module revisions in a separate Node process and compare delivery, payloads, builds, errors, middleware recovery, legacy clients, reconnect and close. The existing same-request-ID late-close race is outside this fix. Windows junction behavior requires the Windows CI run; macOS evidence does not establish it.

The retained local counterfactual used source `f1f8fee0204437fb14dbb25fb39765fd46d482ee`, fresh canonical synthetic fixtures, the unchanged full 27-browser suite, HMR and parallelism enabled, and zero retries. Original Next bytes produced 20 passes and 7 failures; the one-line installed-module overlay produced 27 passes and 0 failures. This was an experimental runtime overlay, not a claim that unmodified f1 passed. The committed installer source `981d8e5390f89de28a17bb845925ec18cd4064be` then passed the same full 27 tests through the actual postinstall and managed dev entry, again with a fresh 17-stage canonical local preparation, every attempt equal to one and no retries. That final-source evidence index has SHA-256 `a23e5220d15f085fa296369eb29b5c4a25aecf2de0a08bdb405ce4a6c1c19c29`. The local database was PostgreSQL 15.8; this is not operating PostgreSQL 17 evidence.

For three accumulated clients with completed compiler stats, initial SYNC deliveries fell from 6 to 3. More generally, the demonstrated join path changes from n(n+1)/2 to n deliveries for n joins, conditional on retained clients and available stats. These fixed cases are not a population estimate, a 95% performance interval, a production-speed claim or measured cost savings.

Private evidence index SHA-256: `6084fd51e10cb003bd7dc9794df1bda8cdd49472809a72f8f86506043f6d96ea`. Keep that runtime evidence distinct from source/clean-install, protected CI, external research and hosted deployment evidence. The external thesis/adversarial/reverse audit and protected promotion remain separate delivery gates.

When upgrading Next, remove or replace this version-bound patch only after reproducing initial-SYNC isolation and preserving build/error behavior on the new package. Do not relax the byte check to accept an unknown module.
