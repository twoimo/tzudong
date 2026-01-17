#!/usr/bin/env python3
"""
laaj_results 데이터 키 순서 정리:
1. LAAJ 평가 항목: name을 맨 앞으로
2. location_match_TF: origin_name, naver_name 순서로
"""
import json
import sys
from pathlib import Path
from collections import OrderedDict


def reorder_laaj_item(item: dict) -> dict:
    """LAAJ 평가 항목 키 순서: name 맨 앞"""
    ordered = OrderedDict()
    if "name" in item:
        ordered["name"] = item["name"]
    for k, v in item.items():
        if k != "name":
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


def migrate_laaj_results(data_path: Path):
    """laaj_results 폴더 키 순서 정리"""
    laaj_dir = data_path / "evaluation" / "laaj_results"

    if not laaj_dir.exists():
        print(f"❌ laaj_results 폴더 없음: {laaj_dir}")
        return

    files = list(laaj_dir.glob("*.jsonl"))
    print(f"키 순서 정리 대상: {len(files)}개 파일")

    updated = 0

    for f in files:
        try:
            with open(f, "r", encoding="utf-8") as file:
                lines = file.read().strip().split("\n")
                data = json.loads(lines[-1])

            eval_results = data.get("evaluation_results", {})

            # LAAJ 평가 항목 키 순서 정리
            for key in [
                "rb_inference_score",
                "rb_grounding_TF",
                "review_faithfulness_score",
                "category_TF",
            ]:
                if key in eval_results and isinstance(eval_results[key], list):
                    eval_results[key] = [
                        reorder_laaj_item(item) for item in eval_results[key]
                    ]

            # visit_authenticity 특별 처리 (values 안에 있음)
            if "visit_authenticity" in eval_results:
                va = eval_results["visit_authenticity"]
                if isinstance(va, dict) and "values" in va:
                    va["values"] = [
                        reorder_laaj_item(item) for item in va.get("values", [])
                    ]
                    if "missing" in va and isinstance(va["missing"], list):
                        va["missing"] = [
                            reorder_laaj_item(item) if isinstance(item, dict) else item
                            for item in va["missing"]
                        ]

            # location_match_TF 키 순서 정리
            if "location_match_TF" in eval_results and isinstance(
                eval_results["location_match_TF"], list
            ):
                eval_results["location_match_TF"] = [
                    reorder_location_item(item)
                    for item in eval_results["location_match_TF"]
                ]

            # category_validity_TF 키 순서 정리 (name 맨 앞)
            if "category_validity_TF" in eval_results and isinstance(
                eval_results["category_validity_TF"], list
            ):
                eval_results["category_validity_TF"] = [
                    reorder_laaj_item(item)
                    for item in eval_results["category_validity_TF"]
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
        print("사용법: python reorder_keys.py <data_path>")
        sys.exit(1)

    data_path = Path(sys.argv[1])
    migrate_laaj_results(data_path)
