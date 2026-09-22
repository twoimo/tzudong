# Stable Mac hosted scheduler installation

Install only from the protected, promoted checkout selected for the operator
runtime. Keep the original development worktree unchanged. The installer writes
a bash wrapper under `~/Library/Application Support/tzudong`, puts logs under
`~/Library/Logs/tzudong`, and registers one 05:15 calendar event. It does not
kick-start the job, replay missed dates, or enable hosted publication approval.

`G037_WRITE_FREEZE` defaults to `active` during installation. The generated wrapper
and plist still record that state. The pending-review pipeline does not stop on
it. Account deletion, retention, migration apply, data-branch publication, and
approved-restaurant refresh stay behind the freeze. This runner only evaluates
new videos and inserts `pending` rows when `TZUDONG_HOSTED_DATA_PLANE_APPROVED=1`
and the preview hash matches. It never marks a row approved. GitHub Actions uses
the same runner and the same approval variable. Do not clear `G037_WRITE_FREEZE`
to resume this catalog path.

An explicit `--dry-run` retains the existing preview path and cannot reach hosted
apply.

After installation, independently read the plist and `launchctl print` top-level
state: verify the wrapper path, stable repository root, 05:15 calendar, log paths,
and active freeze. Do not retain environment secret values. A manual invocation
or dry-run is not evidence of a real sleep/wake coalescing event.
