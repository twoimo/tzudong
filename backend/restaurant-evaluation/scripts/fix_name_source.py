#!/usr/bin/env python3
"""
rule_results 데이터 마이그레이션:
category_validity_TF에서 name_source 제거하고 evaluation_name_source로 이동
"""
import json
import sys
from pathlib import Path
from collections import OrderedDict


def migrate_rule_results(data_path: Path):
    """rule_results 폴더 마이그레이션"""
    rule_dir = data_path / "evaluation" / "rule_results"

    if not rule_dir.exists():
        print(f"❌ rule_results 폴더 없음: {rule_dir}")
        return

    files = list(rule_dir.glob("*.jsonl"))
    print(f"마이그레이션 대상: {len(files)}개 파일")

    updated = 0

    for f in files:
        try:
            with open(f, "r", encoding="utf-8") as file:
                lines = file.read().strip().split("\n")
                data = json.loads(lines[-1])

            eval_results = data.get("evaluation_results", {})

            # location_match_TF에서 origin_name -> naver_name 매핑 생성
            naver_name_map = {}
            for loc_item in eval_results.get("location_match_TF", []):
                origin_name = loc_item.get("origin_name")
                naver_name = loc_item.get("naver_name")
                if origin_name:
                    naver_name_map[origin_name] = naver_name

            # category_validity_TF 마이그레이션
            evaluation_name_source = {}
            if "category_validity_TF" in eval_results:
                new_category_list = []
                for item in eval_results["category_validity_TF"]:
                    # name에서 origin_name 역추적
                    name = item.get("name")

                    # origin_name 찾기 (naver_name_map에서 역추적)
                    origin_name = None
                    for orig, naver in naver_name_map.items():
                        if naver == name or orig == name:
                            origin_name = orig
                            break
                    if not origin_name:
                        origin_name = name  # 못 찾으면 name이 origin_name

                    # name_source 결정
                    name_source = item.get("name_source")
                    if not name_source:
                        name_source = (
                            "naver_name"
                            if naver_name_map.get(origin_name)
                            else "origin_name"
                        )

                    evaluation_name_source[origin_name] = name_source

                    # name_source 제거하고 새 항목 생성
                    new_item = OrderedDict()
                    new_item["name"] = name
                    new_item["eval_value"] = item.get("eval_value")
                    new_category_list.append(dict(new_item))

                eval_results["category_validity_TF"] = new_category_list

            # location_match_TF 키 순서 정리
            if "location_match_TF" in eval_results:
                new_loc_list = []
                for item in eval_results["location_match_TF"]:
                    new_item = OrderedDict()
                    for k in ["origin_name", "naver_name", "eval_value"]:
                        if k in item:
                            new_item[k] = item[k]
                    for k, v in item.items():
                        if k not in new_item:
                            new_item[k] = v
                    new_loc_list.append(dict(new_item))
                eval_results["location_match_TF"] = new_loc_list

            # evaluation_name_source 추가/업데이트
            eval_results["evaluation_name_source"] = evaluation_name_source

            data["evaluation_results"] = eval_results

            with open(f, "w", encoding="utf-8") as file:
                file.write(json.dumps(data, ensure_ascii=False) + "\n")

            updated += 1
            if updated % 100 == 0:
                print(f"  {updated}개 업데이트...")

        except Exception as e:
            print(f"⚠️ 오류: {f.name} - {e}")

    print(f"\n✅ 마이그레이션 완료!")
    print(f"   업데이트: {updated}개")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("사용법: python fix_name_source.py <data_path>")
        sys.exit(1)

    data_path = Path(sys.argv[1])
    migrate_rule_results(data_path)
