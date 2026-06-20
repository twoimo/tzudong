# Pending geocoding backlog report (2026-06-20)

## Summary

- Full transform backlog count: `636` of `1267`
- Stage counts: `{'1': 316, '2': 319, 'unknown': 1}`
- Same-name unique coordinate suggestions: `11`
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

## Initial safe suggestion candidates

| line | originName | videoId | stage | suggested lat,lng | sourceCount |
| ---: | --- | --- | --- | --- | ---: |
| 10 | 향원 | uMLZaJ4Xwuo | 2 | 37.6416864, 127.0365375 | 1 |
| 36 | 지린성 | Pr0I7zpL3dQ | 2 | 35.9796688, 126.7139601 | 5 |
| 192 | 노가네우동 | YxPnR4idxN0 | 2 | 37.5121545, 126.9158669 | 1 |
| 232 | 양평솥뚜껑닭볶음탕 | os614J8b_ak | 1 | 37.5605012, 127.7350726 | 1 |
| 251 | 유포리막국수 | 1SxiNnPoa1o | 2 | 37.9462684, 127.7784604 | 1 |
| 406 | 지하식당 | j1CqEj3awPg | 1 | 35.1591149, 126.8957214 | 1 |
| 419 | 미우 | NksEaXk7e3c | 1 | 37.5247165, 127.0196745 | 1 |
| 467 | 곱창파는고깃집 | GPBfFGgLQSs | 2 | 37.551009, 126.9536014 | 2 |
| 513 | 대성식품 | oRWZAJN4ZFQ | 2 | 37.5648308, 126.9991128 | 2 |
| 537 | 스시도쿠 왕십리본점 | rRAEFB6CiD0 | 2 | 37.5609583, 127.0360935 | 1 |
| 634 | 제일분식 | Lm9JRlYxFG4 | 2 | 37.6126742, 127.0289241 | 2 |

## Guardrail

- This report does not fabricate coordinates.
- Automatic correction is intentionally disabled; only reviewed `traceId` corrections are applied.
- `pending_geocoding` remains a warning backlog, while ready-state null coordinates remain validator errors.
