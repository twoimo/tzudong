#!/usr/bin/env python3
"""
평가 대상 선정 스크립트
crawling 데이터에서 평가 대상을 선정하고 selection 파일을 생성합니다.

채널별 폴더 구조:
- 입력: data/{channel}/crawling/{video_id}.jsonl
- 출력: data/{channel}/evaluation/selection/{video_id}.jsonl
        data/{channel}/evaluation/notSelection/{video_id}.jsonl

기존 backup 로직 유지:
- name이 있고 address도 있음 → evaluation_target[name] = True
- name이 있고 address가 null → evaluation_target[name] = False
- name이 모두 null → notSelection에 저장
"""

import json
import os
import sys
import argparse
from pathlib import Path
from datetime import datetime, timezone, timedelta

# 한국 시간대
KST = timezone(timedelta(hours=9))


def create_evaluation_targets(video_id: str, data_path: Path, channel: str) -> dict:
    """
    하나의 video에 대해 평가 대상을 생성합니다.
    기존 backup 로직 그대로 유지.
    """
    crawling_file = data_path / "crawling" / f"{video_id}.jsonl"

    if not crawling_file.exists():
        return None

    # 최신 줄 로드
    with open(crawling_file, "r", encoding="utf-8") as f:
        data = None
        for line in f:
            data = json.loads(line.strip())

    if not data:
        return None

    youtube_link = data.get("youtube_link")
    restaurants = data.get("restaurants", [])

    # evaluation_target 생성
    evaluation_target = {}
    has_null_address = False
    has_no_restaurants = len(restaurants) == 0
    has_valid_name = False

    for restaurant in restaurants:
        origin_name = restaurant.get("origin_name")
        address = restaurant.get("address")

        if origin_name:
            has_valid_name = True
            # address가 null이면 False, 아니면 True
            is_valid = address is not None
            evaluation_target[origin_name] = is_valid
            if not is_valid:
                has_null_address = True

    # recollect_version 가져오기
    recollect_version = data.get("recollect_version", {})

    # 출력 데이터 구조 (youtube_meta는 저장하지 않음 - 10-transform에서 recollect_version 기반으로 조회)
    new_data = {
        "youtube_link": youtube_link,
        "channel_name": channel,
        "evaluation_target": evaluation_target,
        "restaurants": restaurants,
        "recollect_version": recollect_version,
    }

    # 분류 결과
    result = {
        "data": new_data,
        "is_not_selected": False,
        "not_selected_reason": None,
        "has_null_address": has_null_address,
    }

    # 음식점 0개이거나 모든 name이 null인 경우 notSelection
    if has_no_restaurants:
        result["is_not_selected"] = True
        result["not_selected_reason"] = "no_restaurants"
        new_data["is_notSelected"] = True
        new_data["notSelected_reason"] = "no_restaurants"
    elif not has_valid_name:
        result["is_not_selected"] = True
        result["not_selected_reason"] = "all_names_null"
        new_data["is_notSelected"] = True
        new_data["notSelected_reason"] = "all_names_null"

    return result


def main():
    parser = argparse.ArgumentParser(description="평가 대상 선정")
    parser.add_argument("--channel", "-c", required=True, help="채널 이름")
    parser.add_argument("--crawling-path", required=True, help="크롤링 데이터 경로")
    parser.add_argument("--evaluation-path", required=True, help="평가 결과 저장 경로")
    args = parser.parse_args()

    channel = args.channel
    crawling_path = Path(args.crawling_path)
    evaluation_path = Path(args.evaluation_path)

    print(
        f"\n[{datetime.now(KST).strftime('%H:%M:%S')}] 평가 대상 선정 시작: {channel}"
    )
    print(f"크롤링 경로: {crawling_path}")
    print(f"평가 경로: {evaluation_path}")

    # 출력 폴더 생성
    selection_dir = evaluation_path / "evaluation" / "selection"
    not_selection_dir = evaluation_path / "evaluation" / "notSelection"
    selection_dir.mkdir(parents=True, exist_ok=True)
    not_selection_dir.mkdir(parents=True, exist_ok=True)

    # crawling 폴더에서 video_id 수집
    crawling_dir = crawling_path / "crawling"
    if not crawling_dir.exists():
        print(f"❌ crawling 폴더 없음: {crawling_dir}")
        return

    video_ids = set()
    for f in crawling_dir.glob("*.jsonl"):
        video_ids.add(f.stem)

    print(f"대상 비디오: {len(video_ids)}개")

    # 통계
    stats = {
        "total": len(video_ids),
        "processed": 0,
        "skipped": 0,
        "selection": 0,
        "not_selection": 0,
        "address_null": 0,
    }

    for video_id in sorted(video_ids):
        selection_file = selection_dir / f"{video_id}.jsonl"
        not_selection_file = not_selection_dir / f"{video_id}.jsonl"

        # 중복 검사: 이미 처리됨
        if selection_file.exists() or not_selection_file.exists():
            stats["skipped"] += 1
            if stats["skipped"] % 50 == 1:
                print(f"⏭️ 이미 처리됨 (스킵 {stats['skipped']}개)")
            continue

        # 처리
        result = create_evaluation_targets(video_id, crawling_path, channel)

        if result is None:
            continue

        data = result["data"]

        if result["is_not_selected"]:
            # notSelection에 저장
            with open(not_selection_file, "w", encoding="utf-8") as f:
                f.write(json.dumps(data, ensure_ascii=False) + "\n")
            stats["not_selection"] += 1
        else:
            # selection에 저장
            with open(selection_file, "w", encoding="utf-8") as f:
                f.write(json.dumps(data, ensure_ascii=False) + "\n")
            stats["selection"] += 1

            # address가 null인 것도 notSelection에 복사 (기존 로직)
            if result["has_null_address"]:
                with open(not_selection_file, "w", encoding="utf-8") as f:
                    f.write(json.dumps(data, ensure_ascii=False) + "\n")
                stats["address_null"] += 1

        stats["processed"] += 1
        if stats["processed"] % 10 == 0:
            print(f"✓ {stats['processed']}개 처리 완료...")

    print(f"\n{'='*50}")
    print(f"✅ 평가 대상 선정 완료!")
    print(f"   총 비디오: {stats['total']}개")
    print(f"   처리됨: {stats['processed']}개")
    print(f"   건너뜀: {stats['skipped']}개")
    print(f"   Selection: {stats['selection']}개")
    print(f"   NotSelection: {stats['not_selection']}개")
    print(f"   Address Null: {stats['address_null']}개")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()
