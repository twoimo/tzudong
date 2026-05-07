#!/usr/bin/env python3
"""Export and optionally apply reviewed pending-geocoding corrections.

The exporter is intentionally conservative: it reports unresolved transform
records with nullable coordinates and can produce a CSV correction template. It
never invents coordinates. Updates require an explicit reviewed CSV containing
trace_id, lat, and lng.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Iterable, Optional, Sequence

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_TRANSFORMS = REPO_ROOT / "backend" / "restaurant-evaluation" / "data" / "tzuyang" / "evaluation" / "transforms.jsonl"


def utc_now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def iter_jsonl(path: Path) -> Iterable[tuple[int, dict]]:
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        value = json.loads(line)
        if not isinstance(value, dict):
            raise ValueError(f"line {line_number}: expected JSON object")
        yield line_number, value


def is_pending_geocoding(record: dict) -> bool:
    return (
        record.get("source_type") == "geminiCLI"
        and record.get("status") == "pending"
        and record.get("geocoding_success") is False
        and record.get("geocoding_false_stage") in {None, 1, 2}
        and not bool(record.get("is_missing"))
        and not bool(record.get("is_notSelected"))
        and (record.get("lat") is None or record.get("lng") is None)
    )


def youtube_id(value: object) -> str:
    text = str(value or "")
    for marker in ("v=", "youtu.be/", "shorts/", "embed/"):
        if marker in text:
            return text.split(marker, 1)[1].split("&", 1)[0].split("?", 1)[0].split("/", 1)[0]
    return ""


def identity_key(record: dict) -> str:
    return str(record.get("origin_name") or "").strip()


def collect_known_coordinates(records: list[tuple[int, dict]]) -> dict[str, list[dict]]:
    known: dict[str, list[dict]] = defaultdict(list)
    for line_number, record in records:
        key = identity_key(record)
        if not key or record.get("lat") is None or record.get("lng") is None:
            continue
        try:
            lat = float(record.get("lat"))
            lng = float(record.get("lng"))
        except (TypeError, ValueError):
            continue
        known[key].append({
            "lineNumber": line_number,
            "traceId": record.get("trace_id"),
            "youtubeLink": record.get("youtube_link"),
            "videoId": youtube_id(record.get("youtube_link")),
            "lat": lat,
            "lng": lng,
            "roadAddress": record.get("roadAddress"),
            "jibunAddress": record.get("jibunAddress"),
            "naverName": record.get("naver_name"),
            "googleName": record.get("google_name"),
        })
    return known


def unique_coordinate_suggestion(candidates: list[dict]) -> Optional[dict]:
    unique = {(item["lat"], item["lng"]) for item in candidates}
    if len(unique) != 1:
        return None
    first = candidates[0]
    return {
        "lat": first["lat"],
        "lng": first["lng"],
        "sourceCount": len(candidates),
        "sourceTraceIds": [item.get("traceId") for item in candidates[:5] if item.get("traceId")],
        "sourceVideoIds": [item.get("videoId") for item in candidates[:5] if item.get("videoId")],
        "sourceLineNumbers": [item.get("lineNumber") for item in candidates[:5]],
        "roadAddress": first.get("roadAddress"),
        "jibunAddress": first.get("jibunAddress"),
    }


def build_report(path: Path, *, checked_at: str = "") -> dict:
    records = list(iter_jsonl(path))
    known = collect_known_coordinates(records)
    entries = []
    stage_counts: Counter[str] = Counter()
    channel_counts: Counter[str] = Counter()
    reusable_count = 0

    for line_number, record in records:
        if not is_pending_geocoding(record):
            continue
        stage = record.get("geocoding_false_stage")
        stage_key = "unknown" if stage is None else str(stage)
        stage_counts[stage_key] += 1
        channel_counts[str(record.get("channel_name") or "unknown")] += 1
        candidates = known.get(identity_key(record), [])
        suggestion = unique_coordinate_suggestion(candidates)
        if suggestion:
            reusable_count += 1
        entries.append({
            "lineNumber": line_number,
            "traceId": record.get("trace_id"),
            "youtubeLink": record.get("youtube_link"),
            "videoId": youtube_id(record.get("youtube_link")),
            "channelName": record.get("channel_name"),
            "originName": record.get("origin_name"),
            "category": record.get("category"),
            "geocodingFalseStage": stage,
            "originAddress": record.get("origin_address"),
            "naverName": record.get("naver_name"),
            "googleName": record.get("google_name"),
            "reviewPreview": str(record.get("youtuber_review") or "")[:120],
            "suggestedKnownCoordinate": suggestion,
        })

    return {
        "schemaVersion": 1,
        "generatedAt": checked_at or utc_now_iso(),
        "sourcePath": str(path),
        "status": "backlog" if entries else "ok",
        "pendingCount": len(entries),
        "stageCounts": dict(sorted(stage_counts.items())),
        "channelCounts": dict(sorted(channel_counts.items())),
        "sameNameUniqueCoordinateSuggestionCount": reusable_count,
        "entries": entries,
    }


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def write_csv(path: Path, entries: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "lineNumber", "traceId", "videoId", "youtubeLink", "channelName", "originName",
        "category", "geocodingFalseStage", "suggestedLat", "suggestedLng",
        "suggestionSourceCount", "roadAddress", "jibunAddress", "reviewPreview",
    ]
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        for entry in entries:
            suggestion = entry.get("suggestedKnownCoordinate") or {}
            writer.writerow({
                "lineNumber": entry.get("lineNumber"),
                "traceId": entry.get("traceId"),
                "videoId": entry.get("videoId"),
                "youtubeLink": entry.get("youtubeLink"),
                "channelName": entry.get("channelName"),
                "originName": entry.get("originName"),
                "category": entry.get("category"),
                "geocodingFalseStage": entry.get("geocodingFalseStage"),
                "suggestedLat": suggestion.get("lat", ""),
                "suggestedLng": suggestion.get("lng", ""),
                "suggestionSourceCount": suggestion.get("sourceCount", ""),
                "roadAddress": suggestion.get("roadAddress") or "",
                "jibunAddress": suggestion.get("jibunAddress") or "",
                "reviewPreview": entry.get("reviewPreview"),
            })


def load_corrections(path: Path) -> dict[str, dict]:
    corrections: dict[str, dict] = {}
    with path.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            trace_id = str(row.get("traceId") or "").strip()
            if not trace_id:
                continue
            lat_raw = str(row.get("lat") or row.get("correctedLat") or "").strip()
            lng_raw = str(row.get("lng") or row.get("correctedLng") or "").strip()
            if not lat_raw or not lng_raw:
                continue
            corrections[trace_id] = {
                "lat": float(lat_raw),
                "lng": float(lng_raw),
                "roadAddress": row.get("roadAddress") or None,
                "jibunAddress": row.get("jibunAddress") or None,
                "englishAddress": row.get("englishAddress") or None,
                "naverName": row.get("naverName") or None,
                "googleName": row.get("googleName") or None,
            }
    return corrections


def apply_corrections(input_path: Path, output_path: Path, corrections_path: Path) -> dict:
    corrections = load_corrections(corrections_path)
    updated = 0
    output_lines = []
    for _, record in iter_jsonl(input_path):
        trace_id = str(record.get("trace_id") or "")
        correction = corrections.get(trace_id)
        if correction and is_pending_geocoding(record):
            record["lat"] = correction["lat"]
            record["lng"] = correction["lng"]
            record["geocoding_success"] = True
            record["geocoding_false_stage"] = None
            if correction.get("roadAddress"):
                record["roadAddress"] = correction["roadAddress"]
            if correction.get("jibunAddress"):
                record["jibunAddress"] = correction["jibunAddress"]
            if correction.get("englishAddress"):
                record["englishAddress"] = correction["englishAddress"]
            if correction.get("naverName"):
                record["naver_name"] = correction["naverName"]
            if correction.get("googleName"):
                record["google_name"] = correction["googleName"]
            updated += 1
        output_lines.append(json.dumps(record, ensure_ascii=False, sort_keys=False))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(output_lines) + "\n", encoding="utf-8")
    return {"updatedCount": updated, "correctionCount": len(corrections), "outputPath": str(output_path)}


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Export pending geocoding backlog and reviewed correction templates")
    parser.add_argument("--input", default=str(DEFAULT_TRANSFORMS))
    parser.add_argument("--output", default="")
    parser.add_argument("--csv", default="")
    parser.add_argument("--apply-corrections", default="")
    parser.add_argument("--corrected-output", default="")
    parser.add_argument("--checked-at", default="")
    args = parser.parse_args(argv)

    input_path = Path(args.input)
    report = build_report(input_path, checked_at=args.checked_at)
    if args.output:
        write_json(Path(args.output), report)
    else:
        print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    if args.csv:
        write_csv(Path(args.csv), report["entries"])
    if args.apply_corrections:
        if not args.corrected_output:
            print("--corrected-output is required with --apply-corrections", file=sys.stderr)
            return 2
        correction_report = apply_corrections(input_path, Path(args.corrected_output), Path(args.apply_corrections))
        if args.output:
            report["correctionApplication"] = correction_report
            write_json(Path(args.output), report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
