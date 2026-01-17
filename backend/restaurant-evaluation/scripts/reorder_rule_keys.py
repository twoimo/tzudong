#!/usr/bin/env python3
"""
rule_results 데이터 키 순서 정리:
1. category_validity_TF: name 맨 앞
2. location_match_TF: origin_name, naver_name 순서로
"""
import json
import sys
from pathlib import Path
from collections import OrderedDict


def reorder_category_item(item: dict) -> dict:
    """category_validity_TF 키 순서: name, name_source 맨 앞"""
    ordered = OrderedDict()
    priority_keys = ["name", "name_source", "eval_value"]
    for k in priority_keys:
        if k in item:
            ordered[k] = item[k]
    for k, v in item.items():
        if k not in priority_keys:
            ordered[k] = v
    return dict(ordered)


def reorder_location_item(item: dict) -> dict:
    """location_match_TF 키 순서: origin_name, naver_name, eval_value, ..."""
    ordered = OrderedDict()
    priority_keys = ["origin_name", "naver_name", "eval_value"]
    for k in priority_keys:
        if k in item:
            ordered[k] = item[k]
    for k, v in item.items():
        if k not in priority_keys:
            ordered[k] = v
    return dict(ordered)


def migrate_rule_results(data_path: Path):
    """rule_results 폴더 키 순서 정리"""
    rule_dir = data_path / "evaluation" / "rule_results"

    if not rule_dir.exists():
        print(f"❌ rule_results 폴더 없음: {rule_dir}")
        return

    files = list(rule_dir.glob("*.jsonl"))
    print(f"키 순서 정리 대상: {len(files)}개 파일")

    updated = 0

    for f in files:
        try:
            with open(f, "r", encoding="utf-8") as file:
                lines = file.read().strip().split("\n")
                data = json.loads(lines[-1])

            eval_results = data.get("evaluation_results", {})

            # category_validity_TF 키 순서 정리
            if "category_validity_TF" in eval_results and isinstance(
                eval_results["category_validity_TF"], list
            ):
                eval_results["category_validity_TF"] = [
                    reorder_category_item(item)
                    for item in eval_results["category_validity_TF"]
                ]

            # location_match_TF 키 순서 정리
            if "location_match_TF" in eval_results and isinstance(
                eval_results["location_match_TF"], list
            ):
                eval_results["location_match_TF"] = [
                    reorder_location_item(item)
                    for item in eval_results["location_match_TF"]
                ]

            data["evaluation_results"] = eval_results

            with open(f, "w", encoding="utf-8") as file:
                file.write(json.dumps(data, ensure_ascii=False) + "\n")

            updated += 1
            if updated % 100 == 0:
                print(f"  {updated}개 업데이트...")

        except Exception as e:
            print(f"⚠️ 오류: {f.name} - {e}")

    print(f"\n✅ 키 순서 정리 완료!")
    print(f"   업데이트: {updated}개")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("사용법: python reorder_rule_keys.py <data_path>")
        sys.exit(1)

    data_path = Path(sys.argv[1])
    migrate_rule_results(data_path)
