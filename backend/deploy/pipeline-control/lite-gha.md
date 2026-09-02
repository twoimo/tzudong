# lite_gha topology

GitHub Actions runs a Postgres service container plus a one-shot `pipeline-worker`.
`check_env_contract.py --profile daily` remains the crawler secret preflight.
`check_env_contract.py --profile pipeline-control` gates `TZUDONG_DATA_ENV` and `PIPELINE_CONTROL_DSN`.

Do not apply `pipeline_control` to hosted Supabase without a separate approval.
crontab/GHA call `python3 -m backend.pipeline_control.worker`. Isolated cutover of leftover `run_daily.sh` snapshots remains gated on a real N=3 `pipeline-parity-ledger.json`. `liveEvidenceEligible` stays false until those receipts exist. Do not treat the worker entrypoint as completed N=3 parity.

Default `TZUDONG_COMPUTE_PROFILE` is `lite_gha` (GHA or explicit). The graph skips heavy steps 04/08 and downstream-skips 09–13.1. Live `artifact_only` omits mutating DB steps (`02-1`, `13`, `13.1`) instead of refusing the run.
