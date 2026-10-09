# Public panel integration and release preparation

Integrated `origin/develop` at `8bd6cf5c`, including compact map controls, common public-panel headers and the content-addressed public font route. Resolved three conflicts in FeedContent, map-panel-chrome and the parity source contract by retaining the shared header composition and its close/count semantics. Existing candidate pipeline, Gemini, automation and admin-density changes remain.

The source-contract expectation for the common header button was updated to its actual 36px rounded-square contract. The unit runner now starts each of its ten isolated files in a separate process. A process-tree fixture previously relied on the grandchild runtime writing its PID before a 500ms deadline; the spawning process now also records the actual OS-assigned PID immediately. The deadline, child termination, output cleanup and all 129 bridge assertions remain. Intermediate failures are recorded in the task's private test logs; no test was skipped to obtain success.

Verification: 2,663 web tests pass, 9 platform/evidence tests skip, failures 0. Native/compat compiler parity has zero diagnostics. Conflict-file lint, Next 16.3.8 build with 48 static pages and route CSS ownership pass. Original environment bytes are unchanged. This does not prove production behavior or full visual acceptance.

The font endpoint returns HTTP200, font/otf, and CORS permission for the production origin. Its 11,420,784-byte body SHA256 matches the repository's content-addressed source. This is a delivery integrity check, not a measured first-screen performance improvement.

GitGuardian reported four generic high-entropy occurrences in the copied dual-replay JSON, representing two incident IDs. The entire report has only typed checksums, a commit OID and a verdict. All 51 reported SHA256 values were independently recomputed against both downloaded replay sets and match. No credential value is present in that report. The scanner's status remains failed; security checks and Git history were not disabled or rewritten. Evidence is `catalog-checksum-content-review.json`; do not describe that review as a scanner pass.

Source still requires protected `develop -> data -> main` promotion, current production rollback-SHA capture and deployed/live readback. The active goal also retains whole-pipeline measurement, all-page visual acceptance, actual Gemini worker/requests, automatic-review activation and the payment-method dependency.
