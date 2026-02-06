#!/usr/bin/env python3
"""
기존 laaj_results 데이터 마이그레이션:
1. 모든 LAAJ 평가 항목에서 origin_name → name 으로 변경
2. evaluation_name_source 추가 (기존 데이터는 전부 origin_name 기준)
"""
import json
import sys
from pathlib import Path


def migrate_eval_item(item: dict) -> dict:
    """평가 항목에서 origin_name을 name으로 변경"""
    if "origin_name" in item:
        item["name"] = item.pop("origin_name")
    return item


def migrate_laaj_results(data_path: Path):
    """laaj_results 폴더의 모든 파일을 마이그레이션"""
    laaj_dir = data_path / "evaluation" / "laaj_results"

    if not laaj_dir.exists():
        print(f"[ERROR] laaj_results 폴더 없음: {laaj_dir}")
        return

    files = list(laaj_dir.glob("*.jsonl"))
    print(f"마이그레이션 대상: {len(files)}개 파일")

    updated = 0

    for f in files:
        try:
            with open(f, "r", encoding="utf-8") as file:
                lines = file.read().strip().split("\n")
                data = json.loads(lines[-1])

            eval_results = data.get("evaluation_results", {})

            # 1. evaluation_name_source 생성 (기존 데이터는 전부 origin_name 기준)
            evaluation_name_source = {}
            loc_match_list = eval_results.get("location_match_TF", [])
            for item in loc_match_list:
                origin_name = item.get("origin_name")
                if origin_name:
                    evaluation_name_source[origin_name] = "origin_name"
            eval_results["evaluation_name_source"] = evaluation_name_source

            # 2. LAAJ 평가 항목들에서 origin_name → name 변경
            # visit_authenticity
            if "visit_authenticity" in eval_results:
                va = eval_results["visit_authenticity"]
                if isinstance(va, dict) and "values" in va:
                    va["values"] = [
                        migrate_eval_item(item) for item in va.get("values", [])
                    ]
                    if "missing" in va:
                        va["missing"] = [
                            migrate_eval_item(item) if isinstance(item, dict) else item
                            for item in va.get("missing", [])
                        ]

            # rb_inference_score
            if "rb_inference_score" in eval_results:
                eval_results["rb_inference_score"] = [
                    migrate_eval_item(item)
                    for item in eval_results["rb_inference_score"]
                ]

            # rb_grounding_TF
            if "rb_grounding_TF" in eval_results:
                eval_results["rb_grounding_TF"] = [
                    migrate_eval_item(item) for item in eval_results["rb_grounding_TF"]
                ]

            # review_faithfulness_score
            if "review_faithfulness_score" in eval_results:
                eval_results["review_faithfulness_score"] = [
                    migrate_eval_item(item)
                    for item in eval_results["review_faithfulness_score"]
                ]

            # category_TF
            if "category_TF" in eval_results:
                eval_results["category_TF"] = [
                    migrate_eval_item(item) for item in eval_results["category_TF"]
                ]

            # category_validity_TF (rule evaluation에서 생성)
            if "category_validity_TF" in eval_results:
                eval_results["category_validity_TF"] = [
                    migrate_eval_item(item)
                    for item in eval_results["category_validity_TF"]
                ]

            data["evaluation_results"] = eval_results

            # 저장
            with open(f, "w", encoding="utf-8") as file:
                file.write(json.dumps(data, ensure_ascii=False) + "\n")

            updated += 1
            if updated % 100 == 0:
                print(f"  {updated}개 업데이트...")

        except Exception as e:
            print(f"[WARN] 오류: {f.name} - {e}")

    print(f"\n[OK] 마이그레이션 완료!")
    print(f"   업데이트: {updated}개")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("사용법: python migrate_laaj_format.py <data_path>")
        sys.exit(1)

    data_path = Path(sys.argv[1])
    migrate_laaj_results(data_path)
