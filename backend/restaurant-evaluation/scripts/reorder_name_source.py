#!/usr/bin/env python3
"""
evaluation_name_source를 evaluation_results 맨 앞으로 이동하는 마이그레이션 스크립트
rule_results와 laaj_results 모두 처리
"""
import json
import sys
from pathlib import Path
from collections import OrderedDict


def reorder_evaluation_results(data: dict) -> dict:
    """evaluation_results에서 evaluation_name_source를 맨 앞으로 이동"""
    eval_results = data.get("evaluation_results", {})
    if not eval_results:
        return data

    evaluation_name_source = eval_results.get("evaluation_name_source", {})

    ordered = OrderedDict()
    ordered["evaluation_name_source"] = evaluation_name_source
    for key, value in eval_results.items():
        if key != "evaluation_name_source":
            ordered[key] = value

    data["evaluation_results"] = dict(ordered)
    return data


def migrate_folder(folder_path: Path) -> int:
    """폴더 내 모든 jsonl 파일 마이그레이션"""
    if not folder_path.exists():
        return 0

    files = list(folder_path.glob("*.jsonl"))
    updated = 0

    for f in files:
        try:
            with open(f, "r", encoding="utf-8") as file:
                lines = file.read().strip().split("\n")
                data = json.loads(lines[-1])

            data = reorder_evaluation_results(data)

            with open(f, "w", encoding="utf-8") as file:
                file.write(json.dumps(data, ensure_ascii=False) + "\n")

            updated += 1
        except Exception as e:
            print(f"⚠️ 오류: {f.name} - {e}")

    return updated


def main():
    if len(sys.argv) < 2:
        print("사용법: python reorder_name_source.py <data_path>")
        sys.exit(1)

    data_path = Path(sys.argv[1])

    # rule_results 마이그레이션
    rule_dir = data_path / "evaluation" / "rule_results"
    rule_count = migrate_folder(rule_dir)
    print(f"rule_results: {rule_count}개 업데이트")

    # laaj_results 마이그레이션
    laaj_dir = data_path / "evaluation" / "laaj_results"
    laaj_count = migrate_folder(laaj_dir)
    print(f"laaj_results: {laaj_count}개 업데이트")

    print(f"\n✅ 총 {rule_count + laaj_count}개 파일 업데이트 완료")


if __name__ == "__main__":
    main()
