#!/usr/bin/env python3
"""
평가 결과 변환 스크립트
laaj_results, map_url_crawling 데이터를 최종 형식으로 변환합니다.

채널별 폴더 구조:
- 입력:
  - evaluation/laaj_results/{video_id}.jsonl
  - evaluation/notSelection/{video_id}.jsonl
  - map_url_crawling/{video_id}.jsonl  ← 정육왕 전용
- 출력:
  - evaluation/transforms.jsonl (채널별로 각각)

- trace_id = hash(youtube_link + provider-backed matched_name/name + youtuber_review)
- trace_id_name_source: "naver", "google", 또는 "original"
- source_type: "geminiCLI" 또는 "map_url_crawling"
"""

from __future__ import annotations

import json
import os
import hashlib
import sys
import argparse
import re
import unicodedata
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone, timedelta

import sys
import hashlib
import os
import tempfile
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from utils.stage_cache import atomic_write, stage_lock, fingerprint, input_digest, canonical_digest
from utils.jsonl_utils import load_last_jsonl_record

class LazyMetaCache(dict):
    """Load historical metadata only for invalidated videos, once each."""
    def __init__(self, directory):
        super().__init__()
        self.paths = {path.stem: path for path in directory.glob("*.jsonl")} if directory.exists() else {}
    def __bool__(self):
        return bool(self.paths)
    def __len__(self):
        return len(self.paths)
    def get(self, key, default=None):
        if key not in self.paths:
            return default
        if not super().__contains__(key):
            values = []
            with open(self.paths[key], encoding="utf-8") as source:
                for line in source:
                    try:
                        value = json.loads(line)
                        if isinstance(value, dict): values.append(value)
                    except json.JSONDecodeError:
                        continue
            super().__setitem__(key, values)
        return super().get(key, default)

# 한국 시간대
KST = timezone(timedelta(hours=9))


# [PERF] Meta 파일 사전 로딩 캐시 (비디오별 반복 파일 I/O 방지)
def preload_meta_cache(meta_dir: Path) -> Dict[str, List[dict]]:
    """모든 meta 파일의 JSONL 라인을 사전 로드"""
    cache: Dict[str, List[dict]] = {}
    if not meta_dir or not meta_dir.exists():
        return cache
    for f in meta_dir.glob("*.jsonl"):
        lines = []
        with open(f, "r", encoding="utf-8") as file:
            for line in file:
                try:
                    lines.append(json.loads(line.strip()))
                except Exception:
                    pass
        if lines:
            cache[f.stem] = lines
    return cache


def _extract_youtube_meta(meta_obj: dict) -> dict:
    """meta 객체에서 youtube_meta 필드 추출"""
    return {
        "title": meta_obj.get("title"),
        "viewCount": meta_obj.get("viewCount") or meta_obj.get("view_count"),
        "likeCount": meta_obj.get("likeCount") or meta_obj.get("like_count"),
        "commentCount": meta_obj.get("commentCount") or meta_obj.get("comment_count"),
        "publishedAt": meta_obj.get("publishedAt") or meta_obj.get("published_at"),
        "is_shorts": meta_obj.get("is_shorts", False),
        "duration": meta_obj.get("duration"),
        "ads_info": meta_obj.get("ads_info") or {"is_ads": False, "what_ads": None},
    }


def get_youtube_meta_cached(
    meta_cache: Dict[str, List[dict]], video_id: str, target_meta_id: int
) -> Optional[dict]:
    """메타 캐시에서 youtube_meta 추출 (recollect_id 매칭 -> 마지막 줄 fallback)"""
    lines = meta_cache.get(video_id, [])
    if not lines:
        return None
    for meta_obj in lines:
        if meta_obj.get("recollect_id", 0) == target_meta_id:
            return _extract_youtube_meta(meta_obj)
    return _extract_youtube_meta(lines[-1])


def generate_trace_id(youtube_link: str, name: str, review: str) -> str:
    """
    trace_id 생성
    youtube_link, name(또는 naver_name), youtuber_review를 조합하여 SHA-256 해시 ID 생성
    """
    key_string = str(youtube_link or "") + str(name or "") + str(review or "")
    return hashlib.sha256(key_string.encode("utf-8")).hexdigest()


def normalize_evaluation_name(name: Any) -> str:
    if not isinstance(name, str):
        return ""
    compact = re.sub(r"[\s\-_.·ㆍ()\[\]{}]+", "", name.strip().lower())
    if compact.endswith("본점"):
        compact = compact[:-2]
    return compact


def tokenize_evaluation_name(name: Any) -> List[str]:
    if not isinstance(name, str):
        return []
    text = unicodedata.normalize("NFKC", name)
    text = re.sub(r"\(([^)]*)\)|（([^）]*)）", r" \1 \2 ", text)
    text = re.sub(r"[·・ㆍ._\-–—,，\[\]{}<>《》\"'`´’‘“”:：]", " ", text)
    stopwords = {"구", "현", "전", "내", "본점"}
    return [
        token
        for token in (part.strip() for part in text.split())
        if len(token) >= 2 and token not in stopwords
    ]


def strip_branch_suffix(token: str) -> str:
    return re.sub(r"점$", "", token or "").strip()


def are_provider_names_compatible(origin_name: Any, provider_name: Any) -> bool:
    origin = normalize_evaluation_name(origin_name)
    provider = normalize_evaluation_name(provider_name)
    if not origin or not provider:
        return True
    if origin == provider:
        return True
    if len(origin) >= 3 and origin in provider:
        return True
    if len(provider) >= 3 and provider in origin:
        return True

    origin_tokens = [
        normalize_evaluation_name(strip_branch_suffix(token))
        for token in tokenize_evaluation_name(origin_name)
    ]
    provider_tokens = [
        normalize_evaluation_name(strip_branch_suffix(token))
        for token in tokenize_evaluation_name(provider_name)
    ]
    return any(
        origin_token
        and provider_token
        and (
            origin_token == provider_token
            or (len(origin_token) >= 3 and origin_token in provider_token)
            or (len(provider_token) >= 3 and provider_token in origin_token)
        )
        for origin_token in origin_tokens
        for provider_token in provider_tokens
    )


def build_evaluation_name_candidates(
    rest_name: str, loc_match_item: Optional[dict] = None
) -> List[str]:
    candidates = [rest_name]
    if loc_match_item:
        candidates.extend(
            [
                loc_match_item.get("naver_name"),
                loc_match_item.get("google_name"),
                loc_match_item.get("matched_name"),
            ]
        )

    deduped: List[str] = []
    seen = set()
    for candidate in candidates:
        if not isinstance(candidate, str) or not candidate.strip():
            continue
        if candidate in seen:
            continue
        seen.add(candidate)
        deduped.append(candidate)
    return deduped


def get_eval_item(
    eval_results: dict, rest_name: str, key: str, name_candidates: Optional[List[str]] = None
) -> Optional[dict]:
    """evaluation_results에서 항목 찾기
    - Rule/LAAJ 평가 항목은 평가 시점의 canonical name으로 저장될 수 있음
    - origin_name 외에 location_match_TF의 naver/google/matched name alias도 함께 매칭
    """
    if not eval_results:
        return None

    value = eval_results.get(key)
    if not value:
        return None

    item_list = []
    if isinstance(value, dict) and "values" in value:
        item_list = value["values"]
    elif isinstance(value, list):
        item_list = value

    # 모든 평가 항목이 이제 name으로 매칭됨 (location_match_TF는 별도 처리)
    match_key = "name"
    candidates = name_candidates or [rest_name]
    normalized_candidates = {
        normalize_evaluation_name(candidate)
        for candidate in candidates
        if normalize_evaluation_name(candidate)
    }

    found_item = next(
        (item for item in item_list if item.get(match_key) in candidates), None
    )
    if not found_item and normalized_candidates:
        found_item = next(
            (
                item
                for item in item_list
                if normalize_evaluation_name(item.get(match_key)) in normalized_candidates
            ),
            None,
        )

    if found_item:
        new_item = found_item.copy()
        if match_key in new_item:
            del new_item[match_key]
        return new_item
    return None


def has_independent_provider_evidence(loc_match_item: dict) -> bool:
    evidence_families = loc_match_item.get("evidence_families")
    if not isinstance(evidence_families, list):
        return False
    unique_families = {
        str(item).strip()
        for item in evidence_families
        if isinstance(item, str) and item.strip()
    }
    return len(unique_families) >= 2


def resolve_trace_identity(
    restaurant_name: str, loc_match_item: Optional[dict]
) -> tuple[str, str]:
    """Only promote trace identity when a canonical provider-backed match is True."""
    if not loc_match_item or loc_match_item.get("eval_value") is not True:
        return restaurant_name, "original"

    matched_provider = loc_match_item.get("matched_provider")
    matched_name = (
        loc_match_item.get("matched_name")
        or loc_match_item.get("naver_name")
        or loc_match_item.get("google_name")
    )
    if matched_provider and matched_name:
        if (
            not are_provider_names_compatible(restaurant_name, matched_name)
            and not has_independent_provider_evidence(loc_match_item)
        ):
            return restaurant_name, "original"
        return matched_name, matched_provider

    return restaurant_name, "original"


def get_location_data(
    eval_results: dict, rest_name: str, is_missing_flag: bool, source_file_type: str
) -> dict:
    """location_match_TF에서 위치 데이터 추출 (기존 백업 로직 유지)"""
    loc_data = {
        "naver_name": None,  # ★ 추가
        "google_name": None,  # ★ 구글맵 지원 추가
        "matched_provider": None,
        "matched_name": None,
        "eval_value": False,
        "roadAddress": None,
        "jibunAddress": None,
        "englishAddress": None,
        "addressElements": None,
        "geocoding_success": False,
        "geocoding_false_stage": None,
        "lat": None,
        "lng": None,
    }

    loc_match_item = None
    if eval_results:
        loc_match_list = eval_results.get("location_match_TF", [])
        loc_match_item = next(
            (item for item in loc_match_list if item.get("origin_name") == rest_name),
            None,
        )

    if loc_match_item:
        loc_data["naver_name"] = loc_match_item.get("naver_name")  # ★ 추가
        loc_data["google_name"] = loc_match_item.get("google_name")  # ★ 구글맵 지원 추가
        loc_data["matched_provider"] = loc_match_item.get("matched_provider")
        loc_data["matched_name"] = loc_match_item.get("matched_name")
        loc_data["eval_value"] = bool(loc_match_item.get("eval_value", False))
        loc_data["geocoding_success"] = loc_data["eval_value"]

        if not loc_data["geocoding_success"]:
            false_message = loc_match_item.get("falseMessage", "")
            if "1단계 실패" in false_message:
                loc_data["geocoding_false_stage"] = 1
            elif "2단계 실패" in false_message:
                loc_data["geocoding_false_stage"] = 2

        matched_address = loc_match_item.get("matched_address")
        naver_address = loc_match_item.get("naver_address")
        if isinstance(matched_address, dict):
            naver_address_data = matched_address
        elif naver_address and len(naver_address) > 0:
            naver_address_data = naver_address[0]
        else:
            naver_address_data = None

        if naver_address_data:
            loc_data["roadAddress"] = naver_address_data.get("roadAddress")
            loc_data["jibunAddress"] = naver_address_data.get("jibunAddress")
            loc_data["englishAddress"] = naver_address_data.get("englishAddress")
            loc_data["addressElements"] = naver_address_data.get("addressElements")
            # 좌표 추가 (x=경도, y=위도)
            x = naver_address_data.get("x")
            y = naver_address_data.get("y")
            if x and y:
                try:
                    loc_data["lng"] = float(x)  # x = 경도 (longitude)
                    loc_data["lat"] = float(y)  # y = 위도 (latitude)
                except (ValueError, TypeError):
                    pass

    if source_file_type == "results" and is_missing_flag:
        loc_data["geocoding_false_stage"] = None
    elif source_file_type == "notSelection":
        loc_data["geocoding_false_stage"] = 0

    return loc_data


def transform_json_object(
    original_data: dict,
    source_file_type: str,
    channel_name: str,
    meta_cache: Dict[str, List[dict]] = None,
    video_id: str = None,
) -> List[dict]:
    """
    하나의 원본 JSON 객체를 변환 (기존 백업 로직 유지)
    [PERF] meta_dir -> meta_cache 로 변경 (사전 로딩된 캐시 사용)
    """
    flattened_results = []

    youtube_link = original_data.get("youtube_link")
    original_eval_results = original_data.get("evaluation_results")
    restaurants_list = original_data.get("restaurants", [])
    evaluation_targets = original_data.get("evaluation_target", {})

    # [PERF] recollect_version 기반으로 meta 캐시에서 youtube_meta 조회 (파일 I/O 제거)
    recollect_version = original_data.get("recollect_version", {})
    target_meta_id = recollect_version.get("meta", 0)
    youtube_meta = (
        get_youtube_meta_cached(meta_cache, video_id, target_meta_id)
        if meta_cache and video_id
        else None
    )

    # results 파일 처리
    if source_file_type == "results":
        processed_names = set()

        # 1A. restaurants 리스트 기준 처리
        for restaurant_data in restaurants_list:
            # Gemini 출력이 origin_name 필드 사용
            restaurant_name = restaurant_data.get("origin_name")
            if not restaurant_name:
                continue

            processed_names.add(restaurant_name)
            is_target = evaluation_targets.get(restaurant_name, True)

            loc_data = get_location_data(
                original_eval_results,
                restaurant_name,
                is_missing_flag=False,
                source_file_type=source_file_type,
            )

            # 평가 결과 추출
            new_eval_results = {}
            if original_eval_results:
                # location_match_TF는 항상 추가 (Rule 평가 결과 포함)
                loc_match_list = original_eval_results.get("location_match_TF", [])
                loc_match_item = next(
                    (item for item in loc_match_list if item.get("origin_name") == restaurant_name),
                    None
                )
                if loc_match_item:
                    new_eval_results["location_match_TF"] = loc_match_item
                eval_name_candidates = build_evaluation_name_candidates(
                    restaurant_name, loc_match_item
                )

                for key in original_eval_results:
                    if key == "location_match_TF":
                        continue
                    if key == "visit_authenticity":
                        visit_auth_item = get_eval_item(
                            original_eval_results,
                            restaurant_name,
                            key,
                            eval_name_candidates,
                        )
                        if visit_auth_item:
                            new_eval_results["visit_authenticity"] = visit_auth_item
                    else:
                        eval_item = get_eval_item(
                            original_eval_results,
                            restaurant_name,
                            key,
                            eval_name_candidates,
                        )
                        if eval_item:
                            new_eval_results[key] = eval_item

            youtuber_review = restaurant_data.get("youtuber_review")

            naver_name = loc_data.get("naver_name")
            google_name = loc_data.get("google_name")
            trace_id_name, trace_id_name_source = resolve_trace_identity(
                restaurant_name, new_eval_results.get("location_match_TF")
            )

            output = {
                "youtube_link": youtube_link,
                "trace_id": generate_trace_id(
                    youtube_link, trace_id_name, youtuber_review
                ),
                "channel_name": channel_name,
                "status": "pending",
                "youtube_meta": youtube_meta,
                "origin_name": restaurant_name,
                "naver_name": naver_name,  # 없으면 null 그대로
                "google_name": loc_data.get("google_name"),
                "trace_id_name_source": trace_id_name_source,
                "category": restaurant_data.get("category"),
                "reasoning_basis": restaurant_data.get("reasoning_basis"),
                "youtuber_review": youtuber_review,
                "origin_address": {
                    "address": restaurant_data.get("address"),
                    "lat": restaurant_data.get("lat"),
                    "lng": restaurant_data.get("lng"),
                },
                "roadAddress": loc_data["roadAddress"],
                "jibunAddress": loc_data["jibunAddress"],
                "englishAddress": loc_data["englishAddress"],
                "addressElements": loc_data["addressElements"],
                "lat": loc_data["lat"],
                "lng": loc_data["lng"],
                "geocoding_success": loc_data["geocoding_success"],
                "geocoding_false_stage": loc_data["geocoding_false_stage"],
                "is_missing": False,
                "is_notSelected": not is_target,
                "evaluation_results": new_eval_results if new_eval_results else None,
                "source_type": "geminiCLI",
                "description_map_url": None,  # 쯔양은 null
                "recollect_version": recollect_version,
            }
            flattened_results.append(output)

        # 1B. evaluation_target에만 있는 항목 (Missing)
        for restaurant_name, is_target in evaluation_targets.items():
            if restaurant_name not in processed_names:
                processed_names.add(restaurant_name)
                loc_data = get_location_data(
                    original_eval_results,
                    restaurant_name,
                    is_missing_flag=True,
                    source_file_type=source_file_type,
                )

                # Missing 항목은 평가 안 됐으므로 naver_name 없음
                output = {
                    "youtube_link": youtube_link,
                    "trace_id": generate_trace_id(youtube_link, restaurant_name, None),
                    "channel_name": channel_name,
                    "status": "pending",
                    "youtube_meta": youtube_meta,
                    "origin_name": restaurant_name,
                    "naver_name": None,  # Missing은 항상 null
                    "google_name": None,
                    "trace_id_name_source": "original",
                    "category": None,
                    "reasoning_basis": None,
                    "youtuber_review": None,
                    "origin_address": None,
                    "roadAddress": loc_data["roadAddress"],
                    "jibunAddress": loc_data["jibunAddress"],
                    "englishAddress": loc_data["englishAddress"],
                    "addressElements": loc_data["addressElements"],
                    "lat": loc_data["lat"],
                    "lng": loc_data["lng"],
                    "geocoding_success": loc_data["geocoding_success"],
                    "geocoding_false_stage": loc_data["geocoding_false_stage"],
                    "is_missing": True,
                    "is_notSelected": not is_target,
                    "evaluation_results": None,
                    "source_type": "geminiCLI",
                    "description_map_url": None,  # 쯔양은 null
                    "recollect_version": recollect_version,
                }
                flattened_results.append(output)

        # 1C. visit_authenticity.missing에만 있는 항목
        if original_eval_results:
            missing_list = original_eval_results.get("visit_authenticity", {}).get(
                "missing", []
            )
            for missing_item in missing_list:
                if isinstance(missing_item, str):
                    missing_name = missing_item
                elif isinstance(missing_item, dict):
                    missing_name = missing_item.get("name")
                else:
                    continue

                if not missing_name or missing_name in processed_names:
                    continue

                processed_names.add(missing_name)
                loc_data = get_location_data(
                    original_eval_results,
                    missing_name,
                    is_missing_flag=True,
                    source_file_type=source_file_type,
                )

                # Missing 항목은 평가 안 됐으므로 naver_name 없음
                output = {
                    "youtube_link": youtube_link,
                    "trace_id": generate_trace_id(youtube_link, missing_name, None),
                    "channel_name": channel_name,
                    "status": "pending",
                    "youtube_meta": youtube_meta,
                    "origin_name": missing_name,
                    "naver_name": None,  # Missing은 항상 null
                    "google_name": None,
                    "trace_id_name_source": "original",
                    "category": None,
                    "reasoning_basis": None,
                    "youtuber_review": None,
                    "origin_address": None,
                    "roadAddress": loc_data["roadAddress"],
                    "jibunAddress": loc_data["jibunAddress"],
                    "englishAddress": loc_data["englishAddress"],
                    "addressElements": loc_data["addressElements"],
                    "lat": loc_data["lat"],
                    "lng": loc_data["lng"],
                    "geocoding_success": loc_data["geocoding_success"],
                    "geocoding_false_stage": loc_data["geocoding_false_stage"],
                    "is_missing": True,
                    "is_notSelected": False,
                    "evaluation_results": None,
                    "source_type": "geminiCLI",
                    "description_map_url": None,  # 쯔양은 null
                    "recollect_version": recollect_version,
                }
                flattened_results.append(output)

    # notSelection 파일 처리
    elif source_file_type == "notSelection":
        for restaurant_data in restaurants_list:
            restaurant_name = restaurant_data.get("origin_name")
            if not restaurant_name:
                continue

            youtuber_review = restaurant_data.get("youtuber_review")

            output = {
                "youtube_link": youtube_link,
                "trace_id": generate_trace_id(
                    youtube_link, restaurant_name, youtuber_review
                ),
                "channel_name": channel_name,
                "status": "pending",
                "youtube_meta": youtube_meta,
                "origin_name": restaurant_name,
                "naver_name": None,  # notSelection은 평가 안 하므로 null
                "google_name": None,
                "trace_id_name_source": "original",
                "category": restaurant_data.get("category"),
                "reasoning_basis": restaurant_data.get("reasoning_basis"),
                "youtuber_review": youtuber_review,
                "origin_address": {
                    "address": restaurant_data.get("address"),
                    "lat": restaurant_data.get("lat"),
                    "lng": restaurant_data.get("lng"),
                },
                "roadAddress": None,
                "jibunAddress": None,
                "englishAddress": None,
                "addressElements": None,
                "lat": None,
                "lng": None,
                "geocoding_success": False,
                "geocoding_false_stage": 0,
                "is_missing": False,
                "is_notSelected": True,
                "evaluation_results": None,
                "source_type": "geminiCLI",
                "description_map_url": None,  # 쯔양은 null
                "recollect_version": recollect_version,
            }
            flattened_results.append(output)

    return flattened_results


def transform_map_url_crawling_object(
    original_data: dict, channel_name: str, meta_cache: Dict[str, List[dict]] = None
) -> List[dict]:
    """
    map_url_crawling 데이터를 변환 (정육왕 전용, 평가 스킵)
    [PERF] meta_dir -> meta_cache 로 변경 (사전 로딩된 캐시 사용)
    """
    flattened_results = []

    youtube_link = original_data.get("youtube_link")
    recollect_version = original_data.get("recollect_version", {})
    restaurants_list = original_data.get("restaurants", [])

    # [PERF] recollect_version 기반 meta 캐시에서 youtube_meta 조회
    youtube_meta = None
    if recollect_version.get("meta") is not None:
        video_id = youtube_link.split("v=")[-1].split("&")[0] if youtube_link else None
        if video_id and meta_cache:
            target_meta_id = recollect_version.get("meta", 0)
            youtube_meta = get_youtube_meta_cached(meta_cache, video_id, target_meta_id)

    for restaurant_data in restaurants_list:
        origin_name = restaurant_data.get("origin_name")  # 크롤링에서 받은 원본
        if not origin_name:
            continue

        youtuber_review = restaurant_data.get("youtuber_review")
        naver_name = restaurant_data.get("naver_name")  # 네이버 검색 결과

        google_name = restaurant_data.get("google_name")
        loc_match_item = None
        if isinstance(restaurant_data.get("evaluation_results"), dict):
            loc_match_item = restaurant_data["evaluation_results"].get("location_match_TF")
        if loc_match_item:
            trace_id_name, trace_id_name_source = resolve_trace_identity(
                origin_name, loc_match_item
            )
        else:
            trace_id_name = naver_name or google_name or origin_name
            trace_id_name_source = "naver" if naver_name else ("google" if google_name else "original")

        output = {
            "youtube_link": youtube_link,
            "trace_id": generate_trace_id(youtube_link, trace_id_name, youtuber_review),
            "channel_name": channel_name,
            "status": "pending",
            "youtube_meta": youtube_meta,
            "origin_name": origin_name,  # 크롤링에서 받은 원본 상호명
            "naver_name": naver_name,  # 네이버 검색 결과 상호명
            "google_name": google_name,
            "trace_id_name_source": trace_id_name_source,
            "category": restaurant_data.get("category"),
            "reasoning_basis": restaurant_data.get(
                "reasoning_basis"
            ),  # map_url_crawling에서 추출
            "youtuber_review": youtuber_review,
            "origin_address": None,  # map_url_crawling은 origin_address 없음 (지오코딩 주소가 최종)
            "roadAddress": restaurant_data.get("roadAddress"),
            "jibunAddress": restaurant_data.get("jibunAddress"),
            "englishAddress": restaurant_data.get("englishAddress"),
            "addressElements": restaurant_data.get("addressElements"),
            "lat": restaurant_data.get("lat"),
            "lng": restaurant_data.get("lng"),
            "geocoding_success": True,  # map_url_crawling은 항상 성공 (검증 통과했으므로)
            "geocoding_false_stage": None,
            "is_missing": False,
            "is_notSelected": False,
            "evaluation_results": None,  # 평가 스킵
            "source_type": "map_url_crawling",
            "description_map_url": restaurant_data.get(
                "description_map_url"
            ),  # 원본 네이버 지도 URL
            "recollect_version": recollect_version,
        }
        flattened_results.append(output)

    return flattened_results


def merge_rule_results_into_laaj(rule_data: dict, laaj_data: dict) -> dict:
    """Prefer fresh rule-evaluation payloads when laaj_results carries stale rule fields."""
    merged = laaj_data.copy()

    rule_eval = rule_data.get("evaluation_results")
    laaj_eval = laaj_data.get("evaluation_results")

    if isinstance(laaj_eval, dict):
        merged_eval = laaj_eval.copy()
    else:
        merged_eval = {}

    if isinstance(rule_eval, dict):
        for key in ("evaluation_name_source", "category_validity_TF", "location_match_TF"):
            if key in rule_eval:
                merged_eval[key] = rule_eval[key]

    merged["evaluation_results"] = merged_eval
    merged["evaluation_target"] = rule_data.get(
        "evaluation_target", laaj_data.get("evaluation_target", {})
    )
    merged["restaurants"] = rule_data.get("restaurants", laaj_data.get("restaurants", []))
    merged["recollect_version"] = rule_data.get(
        "recollect_version", laaj_data.get("recollect_version", {})
    )
    return merged


def run_transform(channel: str, crawling_path: Path, evaluation_path: Path):
    output = evaluation_path / "evaluation" / "transforms.jsonl"
    receipt_path = output.parent / ".receipts" / "transform.json"
    with stage_lock(receipt_path):
        try:
            ledger = json.loads(receipt_path.read_bytes())
            if (not isinstance(ledger, dict) or ledger.get("schemaVersion") != 2
                or not isinstance(ledger.get("groups"), dict)
                or any(not isinstance(group, dict) for group in ledger["groups"].values())
                or not isinstance(ledger.get("recordCount"), int)
                or ledger["recordCount"] < 0): raise ValueError()
        except (OSError, ValueError):
            ledger = {"schemaVersion": 2, "groups": {}, "files": {}}
        file_cache = ledger.get("files", {})
        if not isinstance(file_cache,dict): file_cache = {}
        observed = {}

        def file_signature(path):
            try:
                stat = path.stat()
            except FileNotFoundError:
                return None
            return [stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns]

        def file_hash(path):
            signature = file_signature(path)
            observed[path] = signature
            if signature is None: return None
            previous = file_cache.get(str(path), {})
            if isinstance(previous,dict) and previous.get("signature") == signature and isinstance(previous.get("hash"),str) and re.fullmatch(r"[a-f0-9]{64}",previous["hash"]): return previous["hash"]
            value = input_digest(path, latest=False)
            # A file modified during the read cannot become a validated input.
            if signature != file_signature(path):
                raise ValueError("transform_input_changed")
            file_cache[str(path)] = {"signature": signature, "hash": value}
            return value
        script_hash = file_hash(Path(__file__))
        meta_dir = crawling_path / "meta"
        base = evaluation_path / "evaluation"
        def input_groups():
            result = []
            for path in sorted((base / "rule_results").glob("*.jsonl")):
                laaj = base / "laaj_results" / path.name
                result.append(("results", path.stem, [path,laaj] if laaj.is_file() else [path]))
            for kind,directory in [("notSelection",base/"notSelection"),("map_url_crawling",crawling_path/"map_url_crawling")]:
                result.extend((kind,path.stem,[path]) for path in sorted(directory.glob("*.jsonl")))
            return result

        groups = input_groups()

        def verify_snapshot():
            # Hashing and parsing are separate reads. Check every observed input
            # again before publishing; additions and removals also invalidate it.
            if groups != input_groups() or any(signature != file_signature(path) for path,signature in observed.items()):
                raise ValueError("transform_input_changed")

        keys = {}
        for kind,video,inputs in groups:
            keys[kind+":"+video] = canonical_digest([channel,kind,script_hash,file_hash(meta_dir/(video+".jsonl")),*[file_hash(path) for path in inputs]])
        verified = output.is_file() and file_hash(output) == ledger.get("outputHash")
        if verified and set(ledger["groups"]) == set(keys) and all(ledger["groups"].get(identity,{}).get("inputHash") == key for identity,key in keys.items()):
            verify_snapshot()
            stats = {"groups":len(groups),"reused":len(groups),"new":0,"updated":0,"records":ledger["recordCount"]}
            print(json.dumps({"operation":"transform_complete",**stats},sort_keys=True))
            return stats
        records = {}
        damaged_lines = 0
        if output.is_file():
            with output.open("rb") as source:
                for line in source:
                    if not line.strip(): continue
                    try:
                        row = json.loads(line)
                        if not isinstance(row,dict) or not isinstance(row.get("trace_id"),str): raise ValueError()
                        records[row["trace_id"]] = row
                    except (ValueError, UnicodeError):
                        damaged_lines += 1
        meta = LazyMetaCache(meta_dir)
        stats = {"groups":len(groups),"reused":0,"new":0,"updated":0}
        claimed, superseded = set(), {}
        for kind,video,inputs in groups:
            identity = kind+":"+video
            key = keys[identity]
            previous = ledger["groups"].get(identity,{})
            if (verified and previous.get("inputHash") == key
                and previous.get("blocked",[]) == sorted(trace for trace in previous.get("candidates",[]) if trace in claimed)):
                claimed.update(previous.get("records",[])); stats["reused"] += 1
                continue
            payload = load_last_jsonl_record(inputs[-1])
            if not isinstance(payload,dict): raise ValueError("transform_input_invalid")
            if kind == "results" and len(inputs) == 2:
                rule = load_last_jsonl_record(inputs[0])
                if not isinstance(rule,dict): raise ValueError("transform_rule_invalid")
                payload = merge_rule_results_into_laaj(rule,payload)
            transformed = (transform_map_url_crawling_object(payload,channel,meta)
                if kind == "map_url_crawling" else transform_json_object(payload,kind,channel,meta,video))
            candidates = [record["trace_id"] for record in transformed]
            blocked = sorted(trace for trace in candidates if trace in claimed)
            contributed = []
            for record in transformed:
                trace = record["trace_id"]
                if trace in claimed: continue
                claimed.add(trace); contributed.append(trace)
                old = records.get(trace)
                if old != record:
                    if old is None: stats["new"] += 1
                    else: superseded[trace] = old; stats["updated"] += 1
                    records[trace] = record
            ledger["groups"][identity] = {"inputHash":key,"records":contributed,"candidates":candidates,"blocked":blocked}
        ledger["groups"] = {identity: ledger["groups"][identity] for identity in keys}
        verify_snapshot()
        if not verified or stats["new"] or stats["updated"]:
            if damaged_lines:
                damaged = output.read_bytes()
                atomic_write(output.parent / ".history" / ("damaged-" + hashlib.sha256(damaged).hexdigest() + ".jsonl"), damaged)
            if superseded:
                history = output.parent/".history"/(canonical_digest(superseded)+".jsonl")
                atomic_write(history,"".join(json.dumps(record,ensure_ascii=False)+"\n" for record in superseded.values()).encode())
            descriptor, temporary = tempfile.mkstemp(prefix=".transform-",dir=output.parent)
            digest = hashlib.sha256()
            try:
                with os.fdopen(descriptor,"wb") as target:
                    for record in records.values():
                        encoded = (json.dumps(record,ensure_ascii=False)+"\n").encode()
                        target.write(encoded); digest.update(encoded)
                    target.flush(); os.fsync(target.fileno())
                os.replace(temporary,output)
            finally:
                if os.path.exists(temporary): os.unlink(temporary)
            ledger["outputHash"] = digest.hexdigest()
            file_cache.pop(str(output),None)
            file_hash(output)
        else:
            ledger["outputHash"] = file_hash(output)
        ledger["recordCount"] = len(records)
        ledger["files"] = file_cache
        atomic_write(receipt_path,json.dumps(ledger,separators=(",", ":")).encode()+b"\n")
        print(json.dumps({"operation":"transform_complete",**stats,"records":len(records)},sort_keys=True))
        return stats


def main():
    parser = argparse.ArgumentParser(description="평가 결과 변환")
    parser.add_argument("--channel", "-c", required=True)
    parser.add_argument("--crawling-path", required=True)
    parser.add_argument("--evaluation-path", required=True)
    args = parser.parse_args()
    return run_transform(args.channel, Path(args.crawling_path), Path(args.evaluation_path))


if __name__ == "__main__":
    main()
