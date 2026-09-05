# Stable Mac hosted scheduler installation

Install only from the protected, promoted checkout selected for the operator
runtime. Keep the original development worktree unchanged. The installer writes
a bash wrapper under `~/Library/Application Support/tzudong`, puts logs under
`~/Library/Logs/tzudong`, and registers one 05:15 calendar event. It does not
kick-start the job, replay missed dates, or enable hosted publication approval.

`G037_WRITE_FREEZE` defaults to `active` during installation. The generated wrapper
and plist bind that state. A held unattended run exits with only
`pipeline=held_write_freeze`, before evaluation or hosted work. The underlying
hosted apply function independently requires an explicit `cleared` value as well
as the existing approval flag and matching preview hash. Missing and unknown
values never open the write path. GitHub Actions forwards the same repository
variable to the shared runner.

The current G037 freeze remains active. Set `G037_WRITE_FREEZE=cleared` for a later
controlled reinstall only after the successor/recovery receipts permit its exit;
do not infer clearance from a missing variable, a passing local test, or a new
calendar registration. An explicit `--dry-run` retains the existing preview path
and cannot reach hosted apply.

After installation, independently read the plist and `launchctl print` top-level
state: verify the wrapper path, stable repository root, 05:15 calendar, log paths,
and active freeze. Do not retain environment secret values. A manual invocation
or dry-run is not evidence of a real sleep/wake coalescing event.
