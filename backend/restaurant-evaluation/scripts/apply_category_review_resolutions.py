#!/usr/bin/env python3
"""Apply audited category review resolutions for the remaining category validity queue.

This script handles the 63 rows that were intentionally excluded from the
previous safe projection batch:
- taxonomy_review_required: canonicalize granular labels to the existing app taxonomy
- missing_category_review: fill a conservative category inferred from the row name/context

The mutation is intentionally narrow: only the top-level category and
`evaluation_results.category_validity_TF` are updated.  No Supabase writes are
performed.
"""

from __future__ import annotations

import argparse
import json
import shutil
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

DEFAULT_TRANSFORMS_PATH = Path("restaurant-evaluation/data/tzuyang/evaluation/transforms.jsonl")
DEFAULT_BLOCKED_PATH = Path(
    "../.omx/reports/refined-data/category-validity-safe-apply-20260501T141011Z/"
    "category-validity-safe-apply-blocked.jsonl"
)
DEFAULT_REPORT_ROOT = Path("../.omx/reports/refined-data")
VALID_CATEGORIES = {
    "치킨",
    "중식",
    "돈까스·회",
    "피자",
    "패스트푸드",
    "찜·탕",
    "족발·보쌈",
    "분식",
    "카페·디저트",
    "한식",
    "고기",
    "양식",
    "아시안",
    "야식",
    "도시락",
}
EXPECTED_QUEUES = {"taxonomy_review_required", "missing_category_review"}

# Source-line keyed decisions are deliberately explicit.  They are review
# decisions, not a general-purpose classifier.
CATEGORY_REVIEW_DECISIONS: dict[int, dict[str, Any]] = {
    # taxonomy_review_required: replace/drop granular labels outside the app taxonomy.
    44: {"categories": ["한식", "중식", "아시안", "양식", "고기", "찜·탕", "분식", "카페·디저트"], "reason": "일식 label canonicalized to 아시안 inside existing taxonomy"},
    124: {"categories": ["고기"], "reason": "소곱창/막창/대창 are granular meat labels covered by 고기"},
    203: {"categories": ["한식", "아시안"], "reason": "일식 label canonicalized to 아시안 while retaining 한식"},
    237: {"categories": ["야식", "아시안"], "reason": "야키토리 일식 label canonicalized to 아시안"},
    287: {"categories": ["아시안", "한식"], "reason": "일식 제면 label canonicalized to 아시안 while retaining 한식"},
    311: {"categories": ["아시안"], "reason": "일식 단일 label canonicalized to 아시안"},
    371: {"categories": ["한식", "찜·탕"], "reason": "해산물 찜 context is represented by 찜·탕 within existing taxonomy"},
    380: {"categories": ["돈까스·회", "야식", "분식"], "reason": "초장집 해산물 context is represented by 돈까스·회 within existing taxonomy"},
    392: {"categories": ["돈까스·회", "아시안"], "reason": "일식 label canonicalized to 아시안 while retaining 돈까스·회"},
    412: {"categories": ["한식", "고기", "야식"], "reason": "곱창 is a granular meat label covered by 고기"},
    643: {"categories": ["한식", "아시안", "야식"], "reason": "일식 label canonicalized to 아시안 while retaining 한식/야식"},
    837: {"categories": ["패스트푸드"], "reason": "기타 dropped because 패스트푸드 is the valid taxonomy label for sandwich food-truck context"},
    895: {"categories": ["아시안", "돈까스·회"], "reason": "해외 해산물 context represented by 아시안 plus 돈까스·회"},
    907: {"categories": ["아시안", "돈까스·회"], "reason": "터키음식/해산물 canonicalized to existing overseas/seafood taxonomy labels"},
    922: {"categories": ["한식"], "reason": "한정식 is a granular Korean label covered by 한식"},
    926: {"categories": ["아시안"], "reason": "일식 라멘 label canonicalized to 아시안"},
    931: {"categories": ["한식", "족발·보쌈", "찜·탕"], "reason": "낙지 label represented by 한식/찜·탕 while retaining 족발·보쌈"},
    1044: {"categories": ["도시락", "아시안"], "reason": "편의점 food context represented by 도시락 within existing taxonomy"},
    1103: {"categories": ["돈까스·회", "아시안"], "reason": "스시/일식 label represented by 돈까스·회 plus 아시안"},
    # missing_category_review: conservative category fill from origin_name/context.
    7: {"categories": ["중식"], "reason": "짜장 name context"},
    73: {"categories": ["패스트푸드"], "reason": "콘도그 food-truck context"},
    74: {"categories": ["야식", "한식"], "reason": "닭발 food-truck context"},
    75: {"categories": ["패스트푸드"], "reason": "소시지/오징어바 booth context"},
    76: {"categories": ["고기", "야식"], "reason": "닭염통꼬치 food-truck context"},
    139: {"categories": ["한식", "고기"], "reason": "장어 restaurant context"},
    274: {"categories": ["분식"], "reason": "정원분식 name context"},
    306: {"categories": ["한식", "야식"], "reason": "주막 name context"},
    329: {"categories": ["아시안", "패스트푸드"], "reason": "라오허제 야시장 후추빵 context"},
    441: {"categories": ["한식"], "reason": "팔도식당 name context"},
    456: {"categories": ["아시안"], "reason": "홍콩식 카레 context"},
    655: {"categories": ["한식"], "reason": "광주 푸드 페스타 aggregate row; category validity only, category_TF remains separate"},
    656: {"categories": ["치킨"], "reason": "수일통닭 name context"},
    657: {"categories": ["한식", "분식"], "reason": "칼국수 name context"},
    658: {"categories": ["한식"], "reason": "면가 name context"},
    659: {"categories": ["한식", "찜·탕"], "reason": "추어탕 name context"},
    660: {"categories": ["한식", "고기"], "reason": "떡갈비 name context"},
    661: {"categories": ["한식", "찜·탕"], "reason": "낙지마당 name context"},
    662: {"categories": ["카페·디저트"], "reason": "테스팅노트 festival booth treated as cafe/dessert queue item"},
    663: {"categories": ["돈까스·회"], "reason": "돈까스 name context"},
    664: {"categories": ["한식", "찜·탕"], "reason": "곰탕 name context"},
    665: {"categories": ["한식"], "reason": "철판 food booth context"},
    666: {"categories": ["카페·디저트"], "reason": "베이커리 brand context"},
    667: {"categories": ["카페·디저트"], "reason": "붕어빵 dessert/snack context"},
    668: {"categories": ["한식", "찜·탕"], "reason": "국밥 name context"},
    669: {"categories": ["양식"], "reason": "마리오셰프 western-food booth context"},
    670: {"categories": ["분식"], "reason": "상추튀김 snack context"},
    671: {"categories": ["한식"], "reason": "festival booth conservative Korean category"},
    672: {"categories": ["한식"], "reason": "festival booth conservative Korean category"},
    680: {"categories": ["분식"], "reason": "마포분식 name context"},
    739: {"categories": ["분식", "한식"], "reason": "만두/만둣국 context"},
    745: {"categories": ["한식"], "reason": "문터골연가 conservative Korean restaurant context"},
    786: {"categories": ["카페·디저트"], "reason": "투썸플레이스 cafe context"},
    787: {"categories": ["패스트푸드"], "reason": "맥도날드 fast-food context"},
    861: {"categories": ["카페·디저트"], "reason": "bakery/dessert brand context"},
    862: {"categories": ["카페·디저트"], "reason": "bread brand context"},
    863: {"categories": ["카페·디저트"], "reason": "베이커리 name context"},
    864: {"categories": ["카페·디저트"], "reason": "bakery/dessert route context"},
    865: {"categories": ["카페·디저트"], "reason": "bakery/dessert route context"},
    866: {"categories": ["카페·디저트"], "reason": "bakery/dessert route context"},
    867: {"categories": ["카페·디저트"], "reason": "쌀로빵 bakery context"},
    937: {"categories": ["분식"], "reason": "시장 떡볶이 context"},
    938: {"categories": ["분식"], "reason": "붕어빵 street snack context"},
    1142: {"categories": ["한식"], "reason": "문턱골 row conservative Korean category"},
}


class CategoryReviewResolutionError(RuntimeError):
    """Raised when a category review resolution cannot be safely applied."""


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def timestamp_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise FileNotFoundError(path)
    rows = []
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            row = json.loads(line)
            row["__jsonl_line_number"] = line_number
            rows.append(row)
    return rows


def read_jsonl_lines(path: Path) -> list[str]:
    if not path.exists():
        raise FileNotFoundError(path)
    return path.read_text(encoding="utf-8").splitlines()


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def normalize_categories(value: Any) -> list[str]:
    if isinstance(value, str):
        stripped = value.strip()
        return [stripped] if stripped else []
    if isinstance(value, list):
        output: list[str] = []
        for item in value:
            if isinstance(item, str) and item.strip():
                stripped = item.strip()
                if stripped not in output:
                    output.append(stripped)
        return output
    return []


def category_value(categories: list[str]) -> str | list[str]:
    return categories[0] if len(categories) == 1 else categories


def validate_decisions(blocked_rows: list[dict[str, Any]]) -> None:
    blocked_source_lines = {row.get("source_line") for row in blocked_rows if row.get("review_queue") in EXPECTED_QUEUES}
    decision_source_lines = set(CATEGORY_REVIEW_DECISIONS)
    missing = blocked_source_lines - decision_source_lines
    extra = decision_source_lines - blocked_source_lines
    if missing or extra:
        raise CategoryReviewResolutionError(f"decision coverage mismatch missing={sorted(missing)} extra={sorted(extra)}")
    for source_line, decision in CATEGORY_REVIEW_DECISIONS.items():
        categories = normalize_categories(decision.get("categories"))
        if not categories:
            raise CategoryReviewResolutionError(f"empty decision categories for line {source_line}")
        invalid = [category for category in categories if category not in VALID_CATEGORIES]
        if invalid:
            raise CategoryReviewResolutionError(f"invalid decision categories for line {source_line}: {invalid}")


def validate_target_match(blocked_row: dict[str, Any], target_row: dict[str, Any]) -> None:
    source_line = blocked_row.get("source_line")
    for field in ("trace_id", "youtube_link", "origin_name"):
        if blocked_row.get(field) != target_row.get(field):
            raise CategoryReviewResolutionError(
                f"line {source_line} target guard mismatch on {field}: "
                f"blocked={blocked_row.get(field)!r} target={target_row.get(field)!r}"
            )
    queue = blocked_row.get("review_queue")
    if queue not in EXPECTED_QUEUES:
        raise CategoryReviewResolutionError(f"line {source_line} unsupported queue: {queue}")


def build_changes(transforms_lines: list[str], blocked_rows: list[dict[str, Any]]) -> tuple[list[str], list[dict[str, Any]], dict[str, Any]]:
    validate_decisions(blocked_rows)
    output_lines = list(transforms_lines)
    changes: list[dict[str, Any]] = []
    queue_counter: Counter[str] = Counter()

    rows_by_source_line = {row["source_line"]: row for row in blocked_rows if row.get("review_queue") in EXPECTED_QUEUES}
    for source_line in sorted(CATEGORY_REVIEW_DECISIONS):
        blocked_row = rows_by_source_line[source_line]
        if source_line > len(transforms_lines):
            raise CategoryReviewResolutionError(f"source_line out of range: {source_line}")
        target_row = json.loads(transforms_lines[source_line - 1])
        validate_target_match(blocked_row, target_row)
        decision = CATEGORY_REVIEW_DECISIONS[source_line]
        categories = normalize_categories(decision["categories"])
        before_category = target_row.get("category")
        before_eval_results = target_row.get("evaluation_results")
        if not isinstance(before_eval_results, dict):
            target_row["evaluation_results"] = {}
        before_category_validity = target_row["evaluation_results"].get("category_validity_TF")
        target_row["category"] = category_value(categories)
        target_row["evaluation_results"]["category_validity_TF"] = {
            "eval_value": True,
            "normalized_categories": categories,
            "projection_source": "category_review_resolution",
            "review_queue": blocked_row.get("review_queue"),
            "resolution_reason": decision.get("reason"),
        }
        output_lines[source_line - 1] = json.dumps(target_row, ensure_ascii=False)
        queue_counter[blocked_row.get("review_queue")] += 1
        changes.append(
            {
                "source_line": source_line,
                "trace_id": blocked_row.get("trace_id"),
                "youtube_link": blocked_row.get("youtube_link"),
                "origin_name": blocked_row.get("origin_name"),
                "review_queue": blocked_row.get("review_queue"),
                "before_category": before_category,
                "after_category": target_row["category"],
                "before_category_validity_TF": before_category_validity,
                "after_category_validity_TF": target_row["evaluation_results"]["category_validity_TF"],
                "changed_fields": ["category", "evaluation_results.category_validity_TF"],
                "resolution_reason": decision.get("reason"),
            }
        )

    summary = {
        "decision_rows": len(CATEGORY_REVIEW_DECISIONS),
        "planned_or_applied_changes": len(changes),
        "target_total_rows": len(transforms_lines),
        "queue_counter": dict(queue_counter),
        "changed_field_counter": dict(Counter(field for change in changes for field in change["changed_fields"])),
    }
    return output_lines, changes, summary


def write_report(output_dir: Path, *, mode: str, target_path: Path, blocked_path: Path, changes: list[dict[str, Any]], summary: dict[str, Any], backup_path: Path | None) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    changes_path = output_dir / f"category-review-resolution-{mode}-changes.jsonl"
    summary_path = output_dir / f"category-review-resolution-{mode}-summary.json"
    write_jsonl(changes_path, changes)
    report = {
        **summary,
        "generated_at": utc_now(),
        "mode": mode,
        "safety_scope": "category_and_category_validity_only_no_supabase_write",
        "target_transforms_path": str(target_path),
        "blocked_queue_path": str(blocked_path),
        "changes_jsonl": str(changes_path),
        "summary_json": str(summary_path),
        "backup_path": str(backup_path) if backup_path else None,
    }
    summary_path.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return report


def apply_category_review_resolutions(target_path: Path, blocked_path: Path, output_dir: Path, *, apply: bool) -> dict[str, Any]:
    transforms_lines = read_jsonl_lines(target_path)
    blocked_rows = load_jsonl(blocked_path)
    for row in blocked_rows:
        row.pop("__jsonl_line_number", None)
    output_lines, changes, summary = build_changes(transforms_lines, blocked_rows)

    mode = "apply" if apply else "dry-run"
    backup_path: Path | None = None
    if apply:
        output_dir.mkdir(parents=True, exist_ok=True)
        backup_path = output_dir / f"{target_path.name}.before-category-review-resolution.bak"
        shutil.copy2(target_path, backup_path)
        target_path.write_text("\n".join(output_lines) + "\n", encoding="utf-8")

    return write_report(
        output_dir,
        mode=mode,
        target_path=target_path,
        blocked_path=blocked_path,
        changes=changes,
        summary=summary,
        backup_path=backup_path,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--transforms", type=Path, default=DEFAULT_TRANSFORMS_PATH)
    parser.add_argument("--blocked", type=Path, default=DEFAULT_BLOCKED_PATH)
    parser.add_argument("--output-dir", type=Path, default=None)
    parser.add_argument("--apply", action="store_true", help="mutate transforms after writing a backup")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_dir = args.output_dir or DEFAULT_REPORT_ROOT / f"category-review-resolution-execution-{timestamp_slug()}"
    report = apply_category_review_resolutions(args.transforms, args.blocked, output_dir, apply=args.apply)
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
