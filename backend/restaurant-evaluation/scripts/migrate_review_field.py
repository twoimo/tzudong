#!/usr/bin/env python3
"""
tzuyang_review → youtuber_review 마이그레이션
crawling, selection, rule_results, laaj_results, transforms.jsonl 모두 처리
"""
import json
import sys
from pathlib import Path
BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from utils.privacy_log import safe_error_name


def migrate_review_field(data: dict) -> dict:
    """restaurants 배열 내 tzuyang_review를 youtuber_review로 변경"""
    restaurants = data.get("restaurants", [])
    for r in restaurants:
        if "tzuyang_review" in r:
            r["youtuber_review"] = r.pop("tzuyang_review")
    return data


def migrate_folder(folder_path: Path, file_pattern: str = "*.jsonl") -> int:
    """폴더 내 모든 파일 마이그레이션"""
    if not folder_path.exists():
        return 0

    files = list(folder_path.glob(file_pattern))
    updated = 0

    for f in files:
        try:
            with open(f, "r", encoding="utf-8") as file:
                content = file.read().strip()
                if not content:
                    continue
                lines = content.split("\n")
                data = json.loads(lines[-1])

            # tzuyang_review가 있는지 확인
            has_old_field = any(
                "tzuyang_review" in r for r in data.get("restaurants", [])
            )
            if not has_old_field:
                continue

            data = migrate_review_field(data)

            with open(f, "w", encoding="utf-8") as file:
                file.write(json.dumps(data, ensure_ascii=False) + "\n")

            updated += 1
        except Exception as e:
            print(
                f"[WARN] operation=review_field_migration_file_failed "
                f"error={safe_error_name(e)} code=REVIEW_FIELD_FILE_MIGRATION_FAILED"
            )

    return updated


def main():
    if len(sys.argv) < 2:
        print("REVIEW_FIELD_MIGRATION_ARGUMENTS_INVALID code=ARGUMENTS_INVALID")
        sys.exit(1)

    data_path = Path(sys.argv[1])
    total = 0

    # crawling 폴더
    crawling_dir = data_path / "crawling"
    count = migrate_folder(crawling_dir)
    print(f"operation=review_field_migration_group_complete updated={count}")
    total += count

    # evaluation 하위 폴더들
    for folder_name in ["selection", "notSelection", "rule_results", "laaj_results"]:
        folder = data_path / "evaluation" / folder_name
        count = migrate_folder(folder)
        print(f"operation=review_field_migration_group_complete updated={count}")
        total += count

    # transforms.jsonl (한 줄씩 처리)
    transforms_file = data_path / "evaluation" / "transforms.jsonl"
    if transforms_file.exists():
        try:
            with open(transforms_file, "r", encoding="utf-8") as f:
                lines = f.readlines()

            new_lines = []
            trans_count = 0
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                data = json.loads(line)
                if "tzuyang_review" in data:
                    data["youtuber_review"] = data.pop("tzuyang_review")
                    trans_count += 1
                new_lines.append(json.dumps(data, ensure_ascii=False))

            with open(transforms_file, "w", encoding="utf-8") as f:
                f.write("\n".join(new_lines) + "\n")

            print(f"operation=review_field_migration_transforms_complete updated={trans_count}")
            total += trans_count
        except Exception as e:
            print(
                f"[WARN] operation=review_field_migration_transforms_failed "
                f"error={safe_error_name(e)} code=REVIEW_FIELD_TRANSFORMS_MIGRATION_FAILED"
            )

    print(f"\n[OK] 총 {total}개 파일/레코드 업데이트 완료")


if __name__ == "__main__":
    main()
