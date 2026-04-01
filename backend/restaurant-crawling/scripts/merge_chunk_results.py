#!/usr/bin/env python3
"""
청크별 크롤링 결과 병합 및 중복 제거

여러 청크에서 추출된 레스토랑 정보를 하나로 병합합니다.
동일 식당이 여러 청크에 걸쳐 언급될 수 있으므로 origin_name 기반으로 중복 제거합니다.

사용법:
    python merge_chunk_results.py <response_file1> <response_file2> ...
    python merge_chunk_results.py --dir <responses_directory>

출력 (stdout JSON):
    {"restaurants": [...]}
"""

import json
import re
import sys
import argparse
from pathlib import Path
from typing import List, Dict, Any


def normalize_name(name: str) -> str:
    """식당 이름 정규화 (비교용)"""
    if not name:
        return ""
    normalized = re.sub(r"[\s\-·•.,()（）「」『』\[\]【】]", "", name)
    return normalized.lower().strip()


def names_are_similar(name1: str, name2: str) -> bool:
    """두 식당 이름이 동일 또는 포함 관계인지 판단"""
    n1 = normalize_name(name1)
    n2 = normalize_name(name2)

    if not n1 or not n2:
        return False
    if n1 == n2:
        return True

    return (n1 in n2 or n2 in n1) and min(len(n1), len(n2)) >= 2


def merge_restaurant_pair(
    existing: Dict[str, Any], incoming: Dict[str, Any]
) -> Dict[str, Any]:
    """두 식당 정보를 병합 (non-null 우선, 텍스트 필드는 합침)"""
    merged = dict(existing)

    for key in ["address", "lat", "lng"]:
        if merged.get(key) is None and incoming.get(key) is not None:
            merged[key] = incoming[key]

    if incoming.get("reasoning_basis"):
        existing_basis = merged.get("reasoning_basis", "") or ""
        incoming_basis = incoming["reasoning_basis"]
        if incoming_basis not in existing_basis:
            merged["reasoning_basis"] = (
                f"{existing_basis}\n---\n{incoming_basis}".strip("- \n")
                if existing_basis
                else incoming_basis
            )

    if incoming.get("youtuber_review"):
        existing_review = merged.get("youtuber_review", "") or ""
        incoming_review = incoming["youtuber_review"]
        if incoming_review not in existing_review:
            merged["youtuber_review"] = (
                f"{existing_review}\n{incoming_review}".strip()
                if existing_review
                else incoming_review
            )

    existing_cats = set(merged.get("category", []) or [])
    incoming_cats = set(incoming.get("category", []) or [])
    merged["category"] = sorted(existing_cats | incoming_cats)

    return merged


def parse_response_file(filepath: Path) -> tuple:
    """Gemini 응답 파일에서 레스토랑 목록 및 no_restaurant_reason 추출.

    Returns:
        (restaurants_list, no_restaurant_reason_or_none)
    """
    if not filepath.exists():
        return [], None

    text = filepath.read_text(encoding="utf-8").strip()
    if not text:
        return [], None

    if "```json" in text:
        start = text.find("```json") + 7
        end = text.rfind("```")
        if end > start:
            text = text[start:end].strip()
    elif "```" in text:
        start = text.find("```") + 3
        end = text.rfind("```")
        if end > start:
            text = text[start:end].strip()

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        print(f"[WARN] JSON 파싱 실패: {filepath}", file=sys.stderr)
        return [], None

    if isinstance(data, dict) and "restaurants" in data:
        restaurants = data["restaurants"]
        reason = data.get("no_restaurant_reason")
        if isinstance(restaurants, list):
            return restaurants, reason

    return [], None


def merge_all_restaurants(
    all_restaurants: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """모든 청크의 레스토랑을 병합하고 중복 제거"""
    merged: List[Dict[str, Any]] = []

    for restaurant in all_restaurants:
        name = restaurant.get("origin_name", "")
        if not name:
            continue

        found_idx = next(
            (i for i, existing in enumerate(merged)
             if names_are_similar(existing.get("origin_name", ""), name)),
            None,
        )

        if found_idx is not None:
            merged[found_idx] = merge_restaurant_pair(merged[found_idx], restaurant)
        else:
            merged.append(dict(restaurant))

    return merged


def main():
    parser = argparse.ArgumentParser(
        description="청크별 크롤링 결과 병합 및 중복 제거"
    )
    parser.add_argument("files", nargs="*", help="응답 JSON 파일 목록")
    parser.add_argument("--dir", help="응답 파일이 있는 디렉토리 경로")
    args = parser.parse_args()

    files: List[Path] = []
    if args.dir:
        dir_path = Path(args.dir)
        files = sorted(dir_path.glob("chunk_response_*.json"))
    if args.files:
        files.extend(Path(f) for f in args.files)

    if not files:
        print('{"restaurants": []}')
        return

    all_restaurants: List[Dict[str, Any]] = []
    all_reasons: List[str] = []
    for f in files:
        restaurants, reason = parse_response_file(f)
        all_restaurants.extend(restaurants)
        if reason:
            all_reasons.append(reason)
        if restaurants:
            print(
                f"[INFO] {f.name}: {len(restaurants)}개 식당 발견",
                file=sys.stderr,
            )

    merged = merge_all_restaurants(all_restaurants)
    print(
        f"[INFO] 총 {len(all_restaurants)}개 → 병합 후 {len(merged)}개",
        file=sys.stderr,
    )

    result: Dict[str, Any] = {"restaurants": merged}
    # 모든 청크에서 음식점이 없고 사유가 존재하면 전달
    if not merged and all_reasons:
        result["no_restaurant_reason"] = all_reasons[0]
    json.dump(result, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
