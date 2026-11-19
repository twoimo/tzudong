# deepmerge local fork receipt

- Local package identity: `@tzudong/deepmerge@4.3.1-tzudong.1`; the backend consumes it under the `deepmerge` alias via a local tarball. The lockfile preserves the scoped package identity. This is not an upstream release.
- Fork tarball: `deepmerge-4.3.1-tzudong.1.tgz`.
- Fork tarball SHA-256: `4726ec8ea74485627aefcd40afdc411eb1d7b623e7315b0788877a0b757ba158`.
- Lockfile SRI: `sha512-0WWLDXio6Z3HVjumWbZUuzJkR5H9CvmJUMzLyZvWOoqB9YzpeMpWKFdDodCBaXEcudA0e6670CTPPZwN10TKZw==`.
- Published source tarball SHA-256: `4003a0a348276a95543fa969f561f6b5968629acbbb59d66018dd23e7b8f1d5c`.
- Upstream vulnerable `index.js` SHA-256: `12440c84957c1990ea2d5e33dc0091722dc1dc1585c6d20e0c780e568ffa9d30`.
- Local patched entry hashes:
  - `index.js`: `88954d9205a959c75e684cc47d86e721e1d294bbac75f00581d2e851af182e8f`
  - `dist/cjs.js`: `504bdae0ffe576c54474af336472fcfc3cbb57f4a43315803240b2ac8ee2a737`
  - `dist/umd.js`: `fe1997a4215b8705ad8ea538cec5910d4fadf72a0a0927bc69c7406977901081`
  - `package.json`: `de32b5bd9162af58fdda2e6be405804b1c2296ad344f65e535a43d5609fbbc55`
- Retained TypeScript declarations SHA-256: `146ba4b99c5feb82663e17a671bf9f53bb39c704cd76345d6c5a801c26372f44`.
- Retained MIT `license.txt` SHA-256: `6cfc4687cb2f2d86f4a77e6b526290d3878e5e512f3fec2f4cb36a9cb36f798b`.
- Upstream issue: GHSA-gcqx-w48m-w2h4 / CVE-2026-93753; no published fixed version. Change follows upstream merged PR #286, commit `9add7d91abb595703679faf7b7942bbe7f87642b`.
- OSV identity spot-check: queried npm package `@tzudong/deepmerge`, version `4.3.1-tzudong.1`; response was `{}` (no matching advisory). This identity check does not claim the package has no other vulnerabilities.
- Determinism check: repeated `npm pack --ignore-scripts --json --pack-destination "$TMPDIR" ./vendor/tzudong-deepmerge-4.3.1-tzudong.1` produced byte-identical output (`cmp` passed).

Repack instructions and source provenance are embedded in the package's `PROVENANCE.md`.
