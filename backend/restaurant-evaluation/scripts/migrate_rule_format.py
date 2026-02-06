#!/usr/bin/env python3
"""
기존 rule_results 데이터 마이그레이션:
category_validity_TF에서 origin_name → name 으로 변경 + name_source 추가
location_match_TF에서 naver_name 유무로 name_source 결정
"""
import json
import sys
from pathlib import Path


def migrate_rule_results(data_path: Path):
    """rule_results 폴더의 모든 파일을 마이그레이션"""
    rule_dir = data_path / "evaluation" / "rule_results"

    if not rule_dir.exists():
        print(f"[ERROR] rule_results 폴더 없음: {rule_dir}")
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
            if "category_validity_TF" in eval_results:
                new_category_list = []
                for item in eval_results["category_validity_TF"]:
                    origin_name = item.get("origin_name")
                    if origin_name:
                        # name: naver_name 있으면 naver_name, 없으면 origin_name
                        naver_name = naver_name_map.get(origin_name)
                        name = naver_name or origin_name
                        name_source = "naver_name" if naver_name else "origin_name"
                        new_item = {
                            "name": name,
                            "name_source": name_source,
                            "eval_value": item.get("eval_value"),
                        }
                        new_category_list.append(new_item)
                    else:
                        # name 필드가 이미 있는 경우 (이미 마이그레이션됨)
                        new_category_list.append(item)
                eval_results["category_validity_TF"] = new_category_list

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
        print("사용법: python migrate_rule_format.py <data_path>")
        sys.exit(1)

    data_path = Path(sys.argv[1])
    migrate_rule_results(data_path)
