# Evidence and verification records

[Documentation](../README.md) · [Verification guide](../agents/verification.md) · [Performance measurements](../../apps/web/performance/)

Reports and receipts in this directory describe a specific source revision,
environment, and observation. Read the report's limits and artifact bindings
before using a result to support a current claim.

## Browse reports

| Subject | Entry point |
| --- | --- |
| Brand and responsive screens | [Brand family report](brand-family-20261021-v1/REPORT.md). |
| Device-location behavior | [Direct-location report](device-location-direct-20261021-v1/REPORT.md). |
| Formal map behavior | [Map invariants audit](formal-map-invariants-20261023-v1/AUDIT.md). |
| Earlier product restoration | [Storyboard restoration](../operations/evidence/storyboard-restore-20260920/README.md). |

Other bundles in this directory retain their own reports, validation JSON,
artifact maps, and detached checksum files. File names containing `readback`,
`validation`, or `complete` describe the recorded check; inspect their contents
and source bindings before interpreting the result.

## Keep evidence reproducible

- Keep a report and its artifacts in a descriptive dated directory, such as
  `topic-YYYYMMDD/`, and record the exact source revision and check commands.
- State what passed, failed, or was not run, along with the environment and
  remaining limits. Local checks and hosted readback are different observations.
- Preserve paths and bytes referenced by artifact maps and checksums. Add a new
  version or a correction record instead of overwriting an earlier receipt.
- Keep canonical web performance inputs and scored results in
  [apps/web/performance/](../../apps/web/performance/), as described in the
  [verification guide](../agents/verification.md).
- Put narrative session handoffs in [archive/handoffs/](../archive/handoffs/).
  Evidence must exclude credentials, cookies, session tokens, raw private rows,
  request bodies, and provider diagnostics.
