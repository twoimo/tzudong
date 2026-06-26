# Storyboard eight-preset real-provider smoke

This smoke is manual operator evidence for the first eight storyboard guided starter presets. It is not part of normal CI, `test:unit`, lint, build, or Playwright.

## Safety contract

- Requires `STORYBOARD_EIGHT_PRESET_REAL_PROVIDER_SMOKE=1`.
- Refuses `CI=true` unless `STORYBOARD_ALLOW_CI_REAL_PROVIDER_SMOKE=1` is also set for an intentional operator-run smoke.
- Requires a fresh exact `gpt-image-2` local Codex proof via `STORYBOARD_LOCAL_CODEX_PROVENANCE_FILE`.
- Refuses `STORYBOARD_LOCAL_CODEX_ARGS_JSON` unless `STORYBOARD_EIGHT_PRESET_REAL_PROVIDER_ALLOW_ARGS_JSON=1` is set, so fake-provider argv does not run accidentally.
- Defaults to one preset. Use `--case <id>` or `--limit <1-7>` for bounded checks; use `--all` only when all eight quota-consuming cases are intentional.
- Writes reports only under ignored local runtime output, default `.omx/ultraqa/storyboard-eight-real-smoke/`.
- Custom `--output-dir` values must remain under `.omx/ultraqa/storyboard-eight-real-smoke/`; paths outside that ignored runtime tree are refused.
- Redacts proof path details and never logs credentials or environment dumps.

## PowerShell example

```powershell
cd apps/web
bun run storyboard:image-proof
$env:STORYBOARD_EIGHT_PRESET_REAL_PROVIDER_SMOKE = "1"
$env:STORYBOARD_LOCAL_CODEX_PROVENANCE_FILE = ".omx/artifacts/gpt-image-2-provenance/latest-verified.json"
bun run storyboard:eight-real-smoke -- --case seafood-feast
```

All eight cases, quota-consuming:

```powershell
cd apps/web
$env:STORYBOARD_EIGHT_PRESET_REAL_PROVIDER_SMOKE = "1"
bun run storyboard:eight-real-smoke -- --all
```

## POSIX example

```sh
cd apps/web
bun run storyboard:image-proof
STORYBOARD_EIGHT_PRESET_REAL_PROVIDER_SMOKE=1 \
STORYBOARD_LOCAL_CODEX_PROVENANCE_FILE=.omx/artifacts/gpt-image-2-provenance/latest-verified.json \
bun run storyboard:eight-real-smoke -- --case seafood-feast
```

## Negative guard check

```powershell
cd apps/web
Remove-Item Env:STORYBOARD_EIGHT_PRESET_REAL_PROVIDER_SMOKE -ErrorAction SilentlyContinue
bun run storyboard:eight-real-smoke -- --case seafood-feast
# Expected: exits before proof/provider execution.
```
