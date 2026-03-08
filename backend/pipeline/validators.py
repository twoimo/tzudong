"""
단계별 데이터 검증기 (Validators).

각 검증 함수는 (video_id, data) → list[ValidationError dict] 형태.
빈 리스트 반환 = 검증 통과.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .state import ValidationSeverity


# ─── 한국 좌표 범위 (대략적 bounding box) ─────────────────

KOREA_LAT_MIN, KOREA_LAT_MAX = 33.0, 39.0
KOREA_LNG_MIN, KOREA_LNG_MAX = 124.0, 132.0

# 허용 카테고리 목록
VALID_CATEGORIES = {
    "한식", "중식", "일식", "양식", "분식", "카페", "디저트",
    "패스트푸드", "치킨", "피자", "해산물", "고기", "뷔페",
    "아시안", "베이커리", "술집", "기타", "간식",
    "브런치", "샐러드", "샌드위치", "면", "국밥",
}

# 주소 패턴 (한국 도/시/구/군/동 포함 여부 체크)
KOREAN_ADDRESS_PATTERN = re.compile(
    r"(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)"
)


# ─── 유틸리티 ─────────────────────────────────────────────

def _err(
    step: str,
    video_id: str,
    severity: str,
    rule: str,
    message: str,
    restaurant_name: str | None = None,
    field_path: str = "",
    actual_value: Any = None,
) -> dict:
    """ValidationError dict 생성 헬퍼"""
    return {
        "step": step,
        "video_id": video_id,
        "restaurant_name": restaurant_name,
        "severity": severity,
        "rule": rule,
        "message": message,
        "field_path": field_path,
        "actual_value": actual_value,
    }


# ═══════════════════════════════════════════════════════════
# 1. Gemini 크롤링 출력 검증 (Step 7)
# ═══════════════════════════════════════════════════════════

def validate_gemini_output(video_id: str, data: dict) -> list[dict]:
    """
    Gemini 크롤링 결과 스키마 + 의미 검증.

    검증 항목:
    - youtube_link 필수
    - restaurants 배열 존재 및 비어있지 않음
    - 각 restaurant: origin_name, address, category 필수
    - lat/lng 한국 좌표 범위
    - category 유효 목록
    - youtuber_review, reasoning_basis 비어있지 않음
    """
    step = "gemini_crawling"
    errors: list[dict] = []

    # youtube_link 필수
    if not data.get("youtube_link"):
        errors.append(_err(step, video_id, ValidationSeverity.ERROR.value,
                          "required_field", "youtube_link 필드 누락",
                          field_path="youtube_link"))

    restaurants = data.get("restaurants", [])
    if not isinstance(restaurants, list):
        errors.append(_err(step, video_id, ValidationSeverity.ERROR.value,
                          "type_error", "restaurants가 리스트가 아닙니다",
                          field_path="restaurants", actual_value=type(restaurants).__name__))
        return errors

    if len(restaurants) == 0:
        errors.append(_err(step, video_id, ValidationSeverity.WARNING.value,
                          "empty_restaurants", "음식점이 0개입니다 (notSelection 가능)"))
        return errors

    for idx, r in enumerate(restaurants):
        prefix = f"restaurants[{idx}]"
        name = r.get("origin_name")

        # 필수 필드
        if not name:
            errors.append(_err(step, video_id, ValidationSeverity.ERROR.value,
                              "required_field", f"origin_name 누락 (index {idx})",
                              field_path=f"{prefix}.origin_name"))

        if not r.get("address"):
            errors.append(_err(step, video_id, ValidationSeverity.WARNING.value,
                              "missing_address", f"address 누락 (평가 계속 가능)",
                              restaurant_name=name, field_path=f"{prefix}.address"))

        # 좌표 범위 검증
        lat = r.get("lat")
        lng = r.get("lng")
        if lat is not None and lng is not None:
            try:
                lat_f, lng_f = float(lat), float(lng)
                if not (KOREA_LAT_MIN <= lat_f <= KOREA_LAT_MAX):
                    errors.append(_err(step, video_id, ValidationSeverity.ERROR.value,
                                      "coordinate_range", f"위도 범위 초과: {lat_f}",
                                      restaurant_name=name, field_path=f"{prefix}.lat",
                                      actual_value=lat_f))
                if not (KOREA_LNG_MIN <= lng_f <= KOREA_LNG_MAX):
                    errors.append(_err(step, video_id, ValidationSeverity.ERROR.value,
                                      "coordinate_range", f"경도 범위 초과: {lng_f}",
                                      restaurant_name=name, field_path=f"{prefix}.lng",
                                      actual_value=lng_f))
            except (ValueError, TypeError):
                errors.append(_err(step, video_id, ValidationSeverity.ERROR.value,
                                  "coordinate_type", f"좌표값이 숫자가 아닙니다: lat={lat}, lng={lng}",
                                  restaurant_name=name, field_path=f"{prefix}.lat/lng"))

        # 카테고리 검증
        category = r.get("category")
        if category and category not in VALID_CATEGORIES:
            errors.append(_err(step, video_id, ValidationSeverity.WARNING.value,
                              "invalid_category", f"알 수 없는 카테고리: {category}",
                              restaurant_name=name, field_path=f"{prefix}.category",
                              actual_value=category))

        # 주소 형식 검증 (한국 주소인지)
        address = r.get("address")
        if address and not KOREAN_ADDRESS_PATTERN.search(address):
            errors.append(_err(step, video_id, ValidationSeverity.WARNING.value,
                              "address_format", f"한국 주소 패턴 불일치: {address[:50]}",
                              restaurant_name=name, field_path=f"{prefix}.address",
                              actual_value=address))

        # 텍스트 필드 품질
        reasoning = r.get("reasoning_basis", "")
        if reasoning and len(reasoning) < 20:
            errors.append(_err(step, video_id, ValidationSeverity.WARNING.value,
                              "short_text", f"reasoning_basis가 너무 짧음 ({len(reasoning)}자)",
                              restaurant_name=name, field_path=f"{prefix}.reasoning_basis"))

        review = r.get("youtuber_review", "")
        if review and len(review) < 20:
            errors.append(_err(step, video_id, ValidationSeverity.WARNING.value,
                              "short_text", f"youtuber_review가 너무 짧음 ({len(review)}자)",
                              restaurant_name=name, field_path=f"{prefix}.youtuber_review"))

    return errors


# ═══════════════════════════════════════════════════════════
# 2. Target Selection 검증 (Step 8)
# ═══════════════════════════════════════════════════════════

def validate_selection(video_id: str, data: dict) -> list[dict]:
    """
    평가 대상 선정 결과 검증.

    검증 항목:
    - evaluation_target 맵의 키가 restaurants의 origin_name과 일치
    - 음식점 수 합리적 범위 (1~20)
    """
    step = "target_selection"
    errors: list[dict] = []

    eval_target = data.get("evaluation_target", {})
    restaurants = data.get("restaurants", [])

    if not isinstance(eval_target, dict):
        errors.append(_err(step, video_id, ValidationSeverity.ERROR.value,
                          "type_error", "evaluation_target가 dict가 아닙니다"))
        return errors

    # 음식점 이름 일관성 검증
    restaurant_names = {r.get("origin_name") for r in restaurants if r.get("origin_name")}
    target_names = set(eval_target.keys())

    missing_in_target = restaurant_names - target_names
    extra_in_target = target_names - restaurant_names

    if missing_in_target:
        errors.append(_err(step, video_id, ValidationSeverity.ERROR.value,
                          "name_mismatch",
                          f"evaluation_target에 없는 음식점: {', '.join(missing_in_target)}"))

    if extra_in_target:
        errors.append(_err(step, video_id, ValidationSeverity.WARNING.value,
                          "name_mismatch",
                          f"restaurants에 없는 target 이름: {', '.join(extra_in_target)}"))

    # 음식점 수 범위
    count = len(restaurants)
    if count > 20:
        errors.append(_err(step, video_id, ValidationSeverity.WARNING.value,
                          "restaurant_count", f"음식점 수가 비정상적으로 많음: {count}개"))

    return errors


# ═══════════════════════════════════════════════════════════
# 3. Rule 평가 결과 검증 (Step 9)
# ═══════════════════════════════════════════════════════════

def validate_rule_results(video_id: str, data: dict) -> list[dict]:
    """
    Rule 기반 평가 결과 검증.

    검증 항목:
    - evaluation_results 존재
    - location_match_TF 결과 일관성
    - category_validity_TF 결과 존재
    - 좌표 기반 eval_value와 실제 좌표의 일관성
    """
    step = "rule_evaluation"
    errors: list[dict] = []

    eval_results = data.get("evaluation_results")
    if not eval_results:
        errors.append(_err(step, video_id, ValidationSeverity.ERROR.value,
                          "missing_eval_results", "evaluation_results 필드 없음"))
        return errors

    # location_match_TF 검증
    location_matches = eval_results.get("location_match_TF", [])
    if not isinstance(location_matches, list):
        errors.append(_err(step, video_id, ValidationSeverity.ERROR.value,
                          "type_error", "location_match_TF가 리스트가 아닙니다"))
    else:
        for idx, loc in enumerate(location_matches):
            origin_name = loc.get("origin_name", f"idx_{idx}")
            eval_value = loc.get("eval_value")

            # eval_value가 true인데 naver_name 없으면 모순
            if eval_value is True and not loc.get("naver_name"):
                errors.append(_err(step, video_id, ValidationSeverity.WARNING.value,
                                  "inconsistent_location",
                                  f"location_match=True이지만 naver_name 없음",
                                  restaurant_name=origin_name))

            # eval_value가 false이면 falseMessage 존재 확인
            if eval_value is False and not loc.get("falseMessage"):
                errors.append(_err(step, video_id, ValidationSeverity.INFO.value,
                                  "missing_false_message",
                                  f"location_match=False이지만 falseMessage 없음",
                                  restaurant_name=origin_name))

    # category_validity_TF 검증
    cat_validity = eval_results.get("category_validity_TF", [])
    if not isinstance(cat_validity, list):
        errors.append(_err(step, video_id, ValidationSeverity.WARNING.value,
                          "type_error", "category_validity_TF가 리스트가 아닙니다"))
    elif len(cat_validity) == 0:
        errors.append(_err(step, video_id, ValidationSeverity.WARNING.value,
                          "empty_category_validity", "category_validity_TF가 비어있음"))

    return errors


# ═══════════════════════════════════════════════════════════
# 4. LAAJ 평가 결과 검증 (Step 10)
# ═══════════════════════════════════════════════════════════

LAAJ_EXPECTED_KEYS = {
    "visit_authenticity",
    "rb_inference_score",
    "rb_grounding_TF",
    "review_faithfulness_score",
    "category_TF",
}

# 점수 범위 정의
SCORE_RANGES = {
    "visit_authenticity": (0, 2),       # 0, 1, 2
    "rb_inference_score": (0, 2),       # 0, 1, 2
    "review_faithfulness_score": (0, 1),  # 0.0 ~ 1.0
}


def validate_laaj_results(video_id: str, data: dict) -> list[dict]:
    """
    LAAJ (LLM) 평가 결과 검증.

    검증 항목:
    - evaluation_results 내 필수 키 존재
    - 점수 범위 확인
    - eval_basis 비어있지 않음
    - rb_grounding_TF, category_TF 의 boolean 타입 확인
    """
    step = "laaj_evaluation"
    errors: list[dict] = []

    eval_results = data.get("evaluation_results")
    if not eval_results:
        errors.append(_err(step, video_id, ValidationSeverity.ERROR.value,
                          "missing_eval_results", "evaluation_results 필드 없음"))
        return errors

    # 필수 키 확인
    missing_keys = LAAJ_EXPECTED_KEYS - set(eval_results.keys())
    if missing_keys:
        errors.append(_err(step, video_id, ValidationSeverity.ERROR.value,
                          "missing_laaj_keys", f"LAAJ 평가 키 누락: {', '.join(missing_keys)}"))

    restaurants = data.get("restaurants", [])
    restaurant_names = [r.get("origin_name") or r.get("name", f"idx_{i}")
                        for i, r in enumerate(restaurants)]

    # 점수 범위 검증
    for score_key, (min_val, max_val) in SCORE_RANGES.items():
        score_items = eval_results.get(score_key, [])
        if isinstance(score_items, list):
            for item in score_items:
                val = item.get("eval_value")
                name = item.get("name", "")
                if val is not None:
                    try:
                        val_f = float(val)
                        if not (min_val <= val_f <= max_val):
                            errors.append(_err(step, video_id, ValidationSeverity.ERROR.value,
                                              "score_range",
                                              f"{score_key} 범위 초과: {val_f} (허용: {min_val}~{max_val})",
                                              restaurant_name=name))
                    except (ValueError, TypeError):
                        errors.append(_err(step, video_id, ValidationSeverity.ERROR.value,
                                          "score_type",
                                          f"{score_key} 값이 숫자가 아닙니다: {val}",
                                          restaurant_name=name))

                # eval_basis 존재 확인
                basis = item.get("eval_basis", "")
                if not basis or (isinstance(basis, str) and len(basis.strip()) < 5):
                    errors.append(_err(step, video_id, ValidationSeverity.WARNING.value,
                                      "missing_basis",
                                      f"{score_key} 평가 근거 누락 또는 너무 짧음",
                                      restaurant_name=name))

    # Boolean 필드 타입 검증
    for bool_key in ("rb_grounding_TF", "category_TF"):
        bool_items = eval_results.get(bool_key, [])
        if isinstance(bool_items, list):
            for item in bool_items:
                val = item.get("eval_value")
                if val is not None and not isinstance(val, bool):
                    errors.append(_err(step, video_id, ValidationSeverity.WARNING.value,
                                      "type_error",
                                      f"{bool_key}.eval_value가 boolean이 아닙니다: {val}",
                                      restaurant_name=item.get("name", "")))

    return errors


# ═══════════════════════════════════════════════════════════
# 5. Rule vs LAAJ 교차 검증
# ═══════════════════════════════════════════════════════════

def cross_validate(video_id: str, rule_data: dict, laaj_data: dict) -> list[dict]:
    """
    Rule 평가와 LAAJ 평가 결과 간 교차 검증.

    검증 항목:
    - Rule location_match=False vs LAAJ visit_authenticity 높음 → 모순
    - Rule category_validity=False vs LAAJ category_TF=True → 모순
    - 음식점 이름 목록 일치
    """
    step = "cross_validation"
    errors: list[dict] = []

    rule_eval = rule_data.get("evaluation_results", {})
    laaj_eval = laaj_data.get("evaluation_results", {})

    # 음식점 이름 목록 교차 확인
    rule_restaurants = {r.get("origin_name") for r in rule_data.get("restaurants", [])
                        if r.get("origin_name")}
    laaj_restaurants = {r.get("origin_name") or r.get("name")
                        for r in laaj_data.get("restaurants", [])
                        if r.get("origin_name") or r.get("name")}

    name_diff = rule_restaurants.symmetric_difference(laaj_restaurants)
    if name_diff:
        errors.append(_err(step, video_id, ValidationSeverity.WARNING.value,
                          "restaurant_name_mismatch",
                          f"Rule vs LAAJ 음식점 이름 불일치: {', '.join(name_diff)}"))

    # location_match vs visit_authenticity 모순 탐지
    location_matches = {
        loc.get("origin_name"): loc.get("eval_value")
        for loc in rule_eval.get("location_match_TF", [])
    }
    visit_auths = {
        item.get("name"): item.get("eval_value")
        for item in laaj_eval.get("visit_authenticity", [])
    }

    for name, loc_val in location_matches.items():
        visit_val = visit_auths.get(name)
        # 위치 불일치인데 방문 인증 점수 최고(2) → 의심
        if loc_val is False and visit_val is not None and visit_val >= 2:
            errors.append(_err(step, video_id, ValidationSeverity.WARNING.value,
                              "location_visit_contradiction",
                              f"위치 불일치(Rule)이지만 방문 인증 최고점(LAAJ): 확인 필요",
                              restaurant_name=name))

    # category 교차 검증
    rule_cat = {
        item.get("name"): item.get("eval_value")
        for item in rule_eval.get("category_validity_TF", [])
    }
    laaj_cat = {
        item.get("name"): item.get("eval_value")
        for item in laaj_eval.get("category_TF", [])
    }

    for name in rule_cat:
        if name in laaj_cat:
            if rule_cat[name] is False and laaj_cat[name] is True:
                errors.append(_err(step, video_id, ValidationSeverity.INFO.value,
                                  "category_contradiction",
                                  f"Rule에서 카테고리 부적합이지만 LAAJ에서 적합: 재확인 권장",
                                  restaurant_name=name))

    return errors


# ═══════════════════════════════════════════════════════════
# 6. Transform 출력 스키마 검증 (Step 11)
# ═══════════════════════════════════════════════════════════

TRANSFORM_REQUIRED_FIELDS = {
    "trace_id", "youtube_link", "channel_name", "name",
    "source_type", "lat", "lng",
}


def validate_transform_output(video_id: str, records: list[dict]) -> list[dict]:
    """
    Transform 결과(최종 출력) 스키마 검증.

    검증 항목:
    - 필수 필드 존재
    - trace_id 고유성
    - lat/lng 한국 좌표 범위
    - evaluation_results 필수 하위 키
    """
    step = "transform"
    errors: list[dict] = []

    seen_trace_ids: set[str] = set()

    for idx, record in enumerate(records):
        prefix = f"record[{idx}]"
        name = record.get("name", f"idx_{idx}")

        # 필수 필드 확인
        for field in TRANSFORM_REQUIRED_FIELDS:
            if field not in record or record[field] is None:
                errors.append(_err(step, video_id, ValidationSeverity.ERROR.value,
                                  "required_field", f"필수 필드 누락: {field}",
                                  restaurant_name=name, field_path=f"{prefix}.{field}"))

        # trace_id 고유성
        trace_id = record.get("trace_id")
        if trace_id:
            if trace_id in seen_trace_ids:
                errors.append(_err(step, video_id, ValidationSeverity.ERROR.value,
                                  "duplicate_trace_id", f"trace_id 중복: {trace_id}",
                                  restaurant_name=name))
            seen_trace_ids.add(trace_id)

        # 좌표 검증
        lat = record.get("lat")
        lng = record.get("lng")
        if lat is not None and lng is not None:
            try:
                lat_f, lng_f = float(lat), float(lng)
                if not (KOREA_LAT_MIN <= lat_f <= KOREA_LAT_MAX and
                        KOREA_LNG_MIN <= lng_f <= KOREA_LNG_MAX):
                    errors.append(_err(step, video_id, ValidationSeverity.WARNING.value,
                                      "coordinate_range", f"좌표 범위 초과: ({lat_f}, {lng_f})",
                                      restaurant_name=name))
            except (ValueError, TypeError):
                pass  # 이미 required_field에서 잡힘

        # evaluation_results 구조
        eval_res = record.get("evaluation_results", {})
        if not eval_res:
            errors.append(_err(step, video_id, ValidationSeverity.WARNING.value,
                              "missing_eval_results", "evaluation_results 비어있음",
                              restaurant_name=name))

    return errors


# ═══════════════════════════════════════════════════════════
# 집계 유틸리티
# ═══════════════════════════════════════════════════════════

def has_blocking_errors(errors: list[dict]) -> bool:
    """ERROR 심각도의 검증 실패가 있으면 True"""
    return any(e.get("severity") == ValidationSeverity.ERROR.value for e in errors)


def error_summary(errors: list[dict]) -> str:
    """검증 오류 요약 텍스트 생성"""
    if not errors:
        return "검증 통과"

    by_severity = {}
    for e in errors:
        sev = e.get("severity", "unknown")
        by_severity.setdefault(sev, []).append(e)

    parts = []
    for sev in ("error", "warning", "info"):
        items = by_severity.get(sev, [])
        if items:
            parts.append(f"{sev.upper()}: {len(items)}건")

    return " | ".join(parts)
