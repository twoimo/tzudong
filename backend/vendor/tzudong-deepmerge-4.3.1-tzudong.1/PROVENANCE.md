# Local deepmerge security fork provenance

- Package identity: `@tzudong/deepmerge@4.3.1-tzudong.1` (local fork; not an upstream release). Consumed under the `deepmerge` dependency alias because npm aliases do not support local tarball specs; the lockfile records the scoped package identity.
- Base: the published npm `deepmerge@4.3.1` tarball from `https://registry.npmjs.org/deepmerge/-/deepmerge-4.3.1.tgz`.
- SHA-256 of downloaded upstream tarball: `4003a0a348276a95543fa969f561f6b5968629acbbb59d66018dd23e7b8f1d5c`.
- Upstream advisory: https://github.com/advisories/GHSA-gcqx-w48m-w2h4 (CVE-2026-93753).
- No upstream patched release was published when this fork was prepared. The minimal code change follows upstream's merged fix at https://github.com/TehShrike/deepmerge/pull/286, commit `9add7d91abb595703679faf7b7942bbe7f87642b`: filter own enumerable `__proto__` from the shared key enumeration used for both target copying and source merging. `constructor`, `prototype`, enumerable symbols, arrays, custom merge callbacks and cloning behavior remain unchanged.
- MIT license retained verbatim in `license.txt`.

## Repacking

From `backend/`, with no build tools or network required:

```sh
npm pack --ignore-scripts --json --pack-destination "$TMPDIR" ./vendor/tzudong-deepmerge-4.3.1-tzudong.1
shasum -a 256 "$TMPDIR/deepmerge-4.3.1-tzudong.1.tgz"
```

Compare the resulting SHA-256 to the tracked tarball's digest before replacing it. This packs only the local source directory and uses npm's built-in packer; it adds no build dependency.
