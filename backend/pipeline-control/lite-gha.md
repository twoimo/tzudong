# lite_gha topology

GitHub Actions runs a Postgres service container plus a one-shot `pipeline-worker`.
`check_env_contract.py --profile daily` remains the crawler secret preflight.
`check_env_contract.py --profile pipeline-control` gates `TZUDONG_DATA_ENV` and `PIPELINE_CONTROL_DSN`.

Do not apply `pipeline_control` to hosted Supabase without a separate approval.
`run_daily.sh` operator path was removed after N=3 healthy live parity. GHA calls `python3 -m backend.pipeline_control.worker`.

Default `TZUDONG_COMPUTE_PROFILE` is `lite_gha` (GHA or explicit). The graph skips heavy steps 04/08 and downstream-skips 09–13.1. Live `artifact_only` omits mutating DB steps (`02-1`, `13`, `13.1`) instead of refusing the run.
