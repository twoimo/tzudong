# Pending geocoding backlog report (2026-06-21)

## Summary

- Full transform backlog count: `637` of `1269`
- Stage counts: `{'1': 317, '2': 319, 'unknown': 1}`
- Same-name unique coordinate suggestions: `11`
- Browser review preview quality counts: `{'missing': 7, 'thin': 23, 'usable': 596}`
- Note: direct same-name suggestions are only a first-pass manual review lane; no coordinate correction is applied until a reviewed trace-id keyed correction CSV is supplied.

## Export commands

```bash
python3 backend/bin/export_pending_geocoding_backlog.py \
  --output /tmp/tzudong-guardrails/pending-geocoding-backlog.json \
  --csv /tmp/tzudong-guardrails/pending-geocoding-backlog.csv \
  --direct-candidates-csv /tmp/tzudong-guardrails/pending-geocoding-direct-candidates.csv \
  --browser-queue-json /tmp/tzudong-guardrails/pending-geocoding-browser-queue.json \
  --browser-queue-csv /tmp/tzudong-guardrails/pending-geocoding-browser-queue.csv
```

## Correction workflow

1. Review the CSV rows, especially rows with `suggestedLat`/`suggestedLng`.
2. Create a reviewed correction CSV with `traceId,lat,lng,reviewDecision` plus optional address/name columns. `reviewDecision` must be `approved` (or an accepted approval synonym) before the row is applied.
3. Apply to a distinct new JSONL output; the tool rejects `--corrected-output` when it resolves to the input transforms path:

```bash
python3 backend/bin/export_pending_geocoding_backlog.py \
  --apply-corrections reviewed-pending-geocoding-corrections.csv \
  --corrected-output /tmp/tzudong-guardrails/transforms.corrected.jsonl
```

The JSON report also includes `reviewLanes.directCoordinateReuse` and
`reviewLanes.browserReview` so operators can inspect the direct candidate
lane before opening the larger browser-review lane.

## Current direct review lane

- The current direct same-name lane still contains `11` reviewed-first candidates.
- Do **not** rely on stale checked-in line numbers or a copied table when preparing corrections.
- Always regenerate the latest direct lane CSV/JSON from the export command above, review by `traceId`, and keep corrections manual + explicit.

## Guardrail

- This report does not fabricate coordinates.
- Automatic correction is intentionally disabled; only reviewed `traceId` corrections are applied.
- `pending_geocoding` remains a warning backlog, while ready-state null coordinates remain validator errors.
