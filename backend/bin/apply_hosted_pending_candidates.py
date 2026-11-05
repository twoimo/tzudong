#!/usr/bin/env python3
"""Apply preview-selected pending restaurants to hosted Supabase.

Does not flip PIPELINE_HOSTED_APPLY_ENABLED. The shared RPC reconciles the
complete current candidate set for each video and preserves existing rows.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from functools import partial
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "backend" / "supabase" / "scripts"))

from backend.supabase.scripts.hosted_data_plane import (  # noqa: E402
    APPROVAL_ENV, APPLY_CANDIDATE_LABELS, classify_evaluation_row, pending_insert_payload,
    HostedDataPlaneError,
    assert_apply_authorized,
    assert_hosted_target,
    build_apply_preview,
    fetch_hosted_restaurant_snapshot,
    load_evaluation_rows,
)


from backend.supabase.scripts.hosted_pending_operation import (
    current_source_revision, rpc_transport, reconcile_request, apply_current_sets,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--evaluation",
        default=str(
            REPO_ROOT
            / "backend"
            / "restaurant-evaluation"
            / "data"
            / "tzuyang"
            / "evaluation"
            / "transforms.jsonl"
        ),
    )
    parser.add_argument("--preview-out", default="")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--reconcile-request", default="")
    parser.add_argument("--channel", default="tzuyang")
    args = parser.parse_args(argv)

    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    try:
        assert_hosted_target(url)
        transport=partial(rpc_transport,service_role_key=key)
        if args.reconcile_request:
            result=reconcile_request(args.reconcile_request,transport=transport)
            print(json.dumps({'requestId':result.get('requestId'),'state':result.get('state'),'replayAllowed':False}))
            return 0 if result.get('state')=='committed' else 2
        hosted_ids, hosted_youtube = fetch_hosted_restaurant_snapshot(
            url=url, service_role_key=key
        )
        rows = load_evaluation_rows(args.evaluation)
        preview = build_apply_preview(
            local_restaurant_ids=[],
            hosted_restaurant_ids=hosted_ids,
            hosted_youtube_ids=hosted_youtube,
            evaluation_rows=rows,
        )
    except HostedDataPlaneError as exc:
        print(f"error={exc}")
        return 2

    if args.preview_out:
        out = Path(args.preview_out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(
            json.dumps(preview, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    print(f"previewSha256={preview['previewSha256']}")
    print(f"applyCandidateCount={preview['applyCandidateCount']}")
    print(f"evaluationClasses={preview['evaluationClasses']}")
    if args.dry_run or preview["applyCandidateCount"] == 0:
        print("apply=skipped")
        return 0
    try:
        assert_apply_authorized(preview,environment=os.environ,presented_preview_sha256=preview['previewSha256'])
        evaluation=Path(args.evaluation).resolve().parent.parent
        crawling=REPO_ROOT/'backend/restaurant-crawling/data'/args.channel
        revision=current_source_revision(REPO_ROOT)
        videos=preview['applyCandidateVideoIds']
        result=apply_current_sets(evaluation=evaluation,crawling=crawling,channel=args.channel,
            revision=revision,environment=os.environ,videos=videos,transport=transport,
            expected_payloads=[pending_insert_payload(r) for r in rows if classify_evaluation_row(r,[]) in APPLY_CANDIDATE_LABELS])
    except HostedDataPlaneError as exc:
        print(f"error={exc}")
        return 2
    print('requests='+json.dumps(result['requests'],sort_keys=True))
    reflection = result.get("reflection") or {
        "applied": [],
        "skippedAlreadyPresent": [],
        "unresolved": [],
    }
    # Per-candidate reflection accounting (stable video-id identity only, never
    # raw payloads) so it can be emitted into the Run_Manifest reflection field.
    print(f"reflectionApplied={reflection['applied']}")
    print(f"reflectionSkippedAlreadyPresent={reflection['skippedAlreadyPresent']}")
    print(f"reflectionUnresolved={reflection['unresolved']}")
    print(
        "reflection="
        + json.dumps(reflection, ensure_ascii=False, sort_keys=True)
    )
    if reflection["unresolved"]:
        print("error=hosted_apply_unresolved")
        return 2
    if APPROVAL_ENV not in os.environ:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
