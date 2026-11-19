# Current handling of retained startup evidence

This directory is immutable historical measured evidence, not a runnable application. Its archived fixture manifest named Next 16.3.8 and is retired because that old runtime has security alerts. The exact original bytes now live at `fixture-inputs/package-manifest.snapshot`; this is data only, not an installable package manifest. Do not restore or install the old fixture. The historical measurements remain historical and were not re-run using a patched Next release.

The maintained app is `apps/web` and currently uses Next 16.4.2. Its dependencies and runtime are governed by the current `apps/web/package.json`, lockfile, and normal app workflows, separately from this historical fixture.

Verify retained evidence and compare its historical source bindings to the current checkout with:

```sh
node apps/web/scripts/verify-overseas-map-startup-evidence.mjs
```

The verifier checks the artifact map against the detached hash in `docs/evidence/overseas-map-startup-20261021-v1.sha256`, validates every retained artifact byte (mapping only the old `fixture-inputs/package.json` evidence entry to `fixture-inputs/package-manifest.snapshot`), and separately reports current source-binding mismatches. A clean artifact result does not imply the current source matches the historical measurements. The original `verify-artifacts.py` and historical records are intentionally unchanged.
