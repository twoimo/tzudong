//! Behavioral-parity port of `backend/pipeline/validators.py`.
//!
//! Each function mirrors its Python counterpart line by line: same rules, same
//! severities, same field paths, same push order, and the same
//! `restaurant_name`/`actual_value` payloads. Message text is reproduced as
//! closely as the Rust float/`str()` model allows (see `value::py_str`).
//!
//! Determinism note: a few Python branches iterate over `set` objects (name
//! diffs, missing LAAJ keys, transform required fields). CPython set iteration
//! order is hash-seed dependent and therefore already non-deterministic in the
//! reference implementation. This port sorts those collections so the Rust
//! output is stable; the Parity_Harness (task 43) normalizes such fields before
//! comparison.

use std::collections::BTreeSet;

use crate::errors::ValidationError;
use crate::state::severity::{ERROR, INFO, WARNING};
use crate::value::{char_prefix, py_float_repr, py_str, Value};

// ─── 한국 좌표 범위 ─────────────────────────────────────────
const KOREA_LAT_MIN: f64 = 33.0;
const KOREA_LAT_MAX: f64 = 39.0;
const KOREA_LNG_MIN: f64 = 124.0;
const KOREA_LNG_MAX: f64 = 132.0;

const CANONICAL_CATEGORIES: &[&str] = &[
    "치킨",
    "중식",
    "돈까스·회",
    "피자",
    "패스트푸드",
    "찜·탕",
    "족발·보쌈",
    "분식",
    "카페·디저트",
    "한식",
    "고기",
    "양식",
    "아시안",
    "야식",
    "도시락",
];
const LEGACY_SCALAR_CATEGORIES: &[&str] = &[
    "일식",
    "카페",
    "디저트",
    "해산물",
    "뷔페",
    "베이커리",
    "술집",
    "기타",
    "간식",
    "브런치",
    "샐러드",
    "샌드위치",
    "면",
    "국밥",
];
const KOREAN_PROVINCES: &[&str] = &[
    "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남",
    "전북", "전남", "경북", "경남", "제주",
];

const LAAJ_EXPECTED_KEYS: &[&str] = &[
    "visit_authenticity",
    "rb_inference_score",
    "rb_grounding_TF",
    "review_faithfulness_score",
    "category_TF",
];

/// `SCORE_RANGES` in Python dict-literal order.
const SCORE_RANGES: &[(&str, f64, f64)] = &[
    ("visit_authenticity", 0.0, 2.0),
    ("rb_inference_score", 0.0, 2.0),
    ("review_faithfulness_score", 0.0, 1.0),
];

/// `TRANSFORM_REQUIRED_FIELDS`, sorted for deterministic iteration (Python uses
/// a `set`, whose order is hash-seed dependent).
const TRANSFORM_REQUIRED_FIELDS_SORTED: &[&str] = &[
    "channel_name",
    "lat",
    "lng",
    "origin_name",
    "source_type",
    "trace_id",
    "youtube_link",
];

fn is_canonical_category(s: &str) -> bool {
    CANONICAL_CATEGORIES.contains(&s)
}

fn is_valid_category(s: &str) -> bool {
    is_canonical_category(s) || LEGACY_SCALAR_CATEGORIES.contains(&s)
}

fn has_korean_province(addr: &str) -> bool {
    KOREAN_PROVINCES.iter().any(|p| addr.contains(p))
}

/// Python's Unicode whitespace also includes the four information separators.
fn py_strip(value: &str) -> &str {
    value.trim_matches(|c: char| c.is_whitespace() || ('\u{001c}'..='\u{001f}').contains(&c))
}

/// Port of `validators._as_non_empty_string_list`.
fn as_non_empty_string_list(value: &Value) -> Vec<String> {
    match value {
        Value::List(items) => items
            .iter()
            .filter_map(|it| match it {
                Value::Str(s) if !py_strip(s).is_empty() => Some(py_strip(s).to_string()),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// Port of `validators._iter_evaluation_items`.
fn iter_evaluation_items(value: &Value) -> Vec<&Value> {
    match value {
        Value::List(items) => items.iter().filter(|it| it.is_dict()).collect(),
        Value::Dict(_) => match value.get("values") {
            Value::List(items) => items.iter().filter(|it| it.is_dict()).collect(),
            _ => Vec::new(),
        },
        _ => Vec::new(),
    }
}

/// `record.get(key, default)` returning an owned clone or the default.
fn get_or(value: &Value, key: &str, default: Value) -> Value {
    match value.get_opt(key) {
        Some(v) => v.clone(),
        None => default,
    }
}

// ═══════════════════════════════════════════════════════════
// 1. Gemini 크롤링 출력 검증
// ═══════════════════════════════════════════════════════════

pub fn validate_gemini_output(video_id: &str, data: &Value) -> Vec<ValidationError> {
    let step = "gemini_crawling";
    let mut errors: Vec<ValidationError> = Vec::new();

    if !data.get("youtube_link").truthy() {
        errors.push(
            ValidationError::new(
                step,
                video_id,
                ERROR,
                "required_field",
                "youtube_link 필드 누락".to_string(),
            )
            .with_field("youtube_link"),
        );
    }

    let default_list = Value::List(Vec::new());
    let restaurants = data.get_opt("restaurants").unwrap_or(&default_list);
    if !restaurants.is_list() {
        errors.push(
            ValidationError::new(
                step,
                video_id,
                ERROR,
                "type_error",
                "restaurants가 리스트가 아닙니다".to_string(),
            )
            .with_field("restaurants")
            .with_actual(Value::Str(restaurants.type_name().to_string())),
        );
        return errors;
    }

    let items = match restaurants {
        Value::List(items) => items,
        _ => unreachable!(),
    };

    if items.is_empty() {
        errors.push(ValidationError::new(
            step,
            video_id,
            WARNING,
            "empty_restaurants",
            "음식점이 0개입니다 (notSelection 가능)".to_string(),
        ));
        return errors;
    }

    for (idx, r) in items.iter().enumerate() {
        let prefix = format!("restaurants[{}]", idx);
        let name = r.get("origin_name").clone();

        if !name.truthy() {
            errors.push(
                ValidationError::new(
                    step,
                    video_id,
                    ERROR,
                    "required_field",
                    format!("origin_name 누락 (index {})", idx),
                )
                .with_field(&format!("{}.origin_name", prefix)),
            );
        }

        if !r.get("address").truthy() {
            errors.push(
                ValidationError::new(
                    step,
                    video_id,
                    WARNING,
                    "missing_address",
                    "address 누락 (평가 계속 가능)".to_string(),
                )
                .with_name(name.clone())
                .with_field(&format!("{}.address", prefix)),
            );
        }

        // 좌표 범위 검증
        let lat = r.get("lat");
        let lng = r.get("lng");
        if !lat.is_none() && !lng.is_none() {
            match (lat.py_float(), lng.py_float()) {
                (Ok(lat_f), Ok(lng_f)) => {
                    if !(lat_f >= KOREA_LAT_MIN && lat_f <= KOREA_LAT_MAX) {
                        errors.push(
                            ValidationError::new(
                                step,
                                video_id,
                                ERROR,
                                "coordinate_range",
                                format!("위도 범위 초과: {}", py_float_repr(lat_f)),
                            )
                            .with_name(name.clone())
                            .with_field(&format!("{}.lat", prefix))
                            .with_actual(Value::Float(lat_f)),
                        );
                    }
                    if !(lng_f >= KOREA_LNG_MIN && lng_f <= KOREA_LNG_MAX) {
                        errors.push(
                            ValidationError::new(
                                step,
                                video_id,
                                ERROR,
                                "coordinate_range",
                                format!("경도 범위 초과: {}", py_float_repr(lng_f)),
                            )
                            .with_name(name.clone())
                            .with_field(&format!("{}.lng", prefix))
                            .with_actual(Value::Float(lng_f)),
                        );
                    }
                }
                _ => {
                    errors.push(
                        ValidationError::new(
                            step,
                            video_id,
                            ERROR,
                            "coordinate_type",
                            format!(
                                "좌표값이 숫자가 아닙니다: lat={}, lng={}",
                                py_str(lat),
                                py_str(lng)
                            ),
                        )
                        .with_name(name.clone())
                        .with_field(&format!("{}.lat/lng", prefix)),
                    );
                }
            }
        }

        // 카테고리 검증
        let category = r.get("category");
        let category_is_list = category.is_list();
        let categories: Vec<&Value> = match category {
            Value::List(list_items) => list_items.iter().collect(),
            other => vec![other],
        };
        for category_item in categories {
            let invalid_category = match category_item.as_str() {
                Some(s) => {
                    if category_is_list {
                        !is_canonical_category(s)
                    } else {
                        !is_valid_category(s)
                    }
                }
                None => true,
            };
            if invalid_category && (category_is_list || category_item.truthy()) {
                errors.push(
                    ValidationError::new(
                        step,
                        video_id,
                        WARNING,
                        "invalid_category",
                        format!("알 수 없는 카테고리: {}", py_str(category_item)),
                    )
                    .with_name(name.clone())
                    .with_field(&format!("{}.category", prefix))
                    .with_actual(category_item.clone()),
                );
            }
        }

        // 주소 형식 검증
        let address = r.get("address");
        if address.truthy() {
            if let Some(addr) = address.as_str() {
                if !has_korean_province(addr) {
                    errors.push(
                        ValidationError::new(
                            step,
                            video_id,
                            WARNING,
                            "address_format",
                            format!("한국 주소 패턴 불일치: {}", char_prefix(addr, 50)),
                        )
                        .with_name(name.clone())
                        .with_field(&format!("{}.address", prefix))
                        .with_actual(address.clone()),
                    );
                }
            }
        }

        // 텍스트 필드 품질
        let reasoning = r.get("reasoning_basis");
        if reasoning.truthy() && reasoning.is_str() && reasoning.char_len() < 20 {
            errors.push(
                ValidationError::new(
                    step,
                    video_id,
                    WARNING,
                    "short_text",
                    format!("reasoning_basis가 너무 짧음 ({}자)", reasoning.char_len()),
                )
                .with_name(name.clone())
                .with_field(&format!("{}.reasoning_basis", prefix)),
            );
        }

        let review = r.get("youtuber_review");
        if review.truthy() && review.is_str() && review.char_len() < 20 {
            errors.push(
                ValidationError::new(
                    step,
                    video_id,
                    WARNING,
                    "short_text",
                    format!("youtuber_review가 너무 짧음 ({}자)", review.char_len()),
                )
                .with_name(name.clone())
                .with_field(&format!("{}.youtuber_review", prefix)),
            );
        }
    }

    errors
}

// ═══════════════════════════════════════════════════════════
// 2. Target Selection 검증
// ═══════════════════════════════════════════════════════════

pub fn validate_selection(video_id: &str, data: &Value) -> Vec<ValidationError> {
    let step = "target_selection";
    let mut errors: Vec<ValidationError> = Vec::new();

    let default_dict = Value::Dict(Vec::new());
    let default_list = Value::List(Vec::new());
    let eval_target = data.get_opt("evaluation_target").unwrap_or(&default_dict);
    let restaurants = data.get_opt("restaurants").unwrap_or(&default_list);

    if !eval_target.is_dict() {
        errors.push(ValidationError::new(
            step,
            video_id,
            ERROR,
            "type_error",
            "evaluation_target가 dict가 아닙니다".to_string(),
        ));
        return errors;
    }

    let mut restaurant_names: BTreeSet<String> = BTreeSet::new();
    let restaurant_items: &[Value] = match restaurants {
        Value::List(list_items) => list_items.as_slice(),
        _ => &[],
    };
    for r in restaurant_items {
        let on = r.get("origin_name");
        if on.truthy() {
            if let Some(s) = on.as_str() {
                restaurant_names.insert(s.to_string());
            }
        }
    }
    let target_names: BTreeSet<String> = eval_target.dict_keys().cloned().collect();

    let missing_in_target: Vec<&String> = restaurant_names.difference(&target_names).collect();
    let extra_in_target: Vec<&String> = target_names.difference(&restaurant_names).collect();

    if !missing_in_target.is_empty() {
        let joined = join_refs(&missing_in_target, ", ");
        errors.push(ValidationError::new(
            step,
            video_id,
            ERROR,
            "name_mismatch",
            format!("evaluation_target에 없는 음식점: {}", joined),
        ));
    }
    if !extra_in_target.is_empty() {
        let joined = join_refs(&extra_in_target, ", ");
        errors.push(ValidationError::new(
            step,
            video_id,
            WARNING,
            "name_mismatch",
            format!("restaurants에 없는 target 이름: {}", joined),
        ));
    }

    let count = restaurant_items.len();
    if count > 20 {
        errors.push(ValidationError::new(
            step,
            video_id,
            WARNING,
            "restaurant_count",
            format!("음식점 수가 비정상적으로 많음: {}개", count),
        ));
    }

    errors
}

// ═══════════════════════════════════════════════════════════
// 3. Rule 평가 결과 검증
// ═══════════════════════════════════════════════════════════

pub fn validate_rule_results(video_id: &str, data: &Value) -> Vec<ValidationError> {
    let step = "rule_evaluation";
    let mut errors: Vec<ValidationError> = Vec::new();

    let eval_results = data.get("evaluation_results");
    if !eval_results.truthy() {
        errors.push(ValidationError::new(
            step,
            video_id,
            ERROR,
            "missing_eval_results",
            "evaluation_results 필드 없음".to_string(),
        ));
        return errors;
    }

    let default_list = Value::List(Vec::new());
    let location_matches = eval_results
        .get_opt("location_match_TF")
        .unwrap_or(&default_list);
    if !location_matches.is_list() {
        errors.push(ValidationError::new(
            step,
            video_id,
            ERROR,
            "type_error",
            "location_match_TF가 리스트가 아닙니다".to_string(),
        ));
    } else if let Value::List(loc_items) = location_matches {
        for (idx, loc) in loc_items.iter().enumerate() {
            let origin_name: Value = match loc.get_opt("origin_name") {
                Some(v) => v.clone(),
                None => Value::Str(format!("idx_{}", idx)),
            };
            let eval_value = loc.get("eval_value");
            let matched_truthy = loc.get("matched_name").truthy();
            let provider_truthy = loc.get("naver_name").truthy() || loc.get("google_name").truthy();
            let evidence_families = as_non_empty_string_list(loc.get("evidence_families"));
            let unique_count = evidence_families
                .iter()
                .map(String::as_str)
                .collect::<BTreeSet<&str>>()
                .len();
            let pending_reason = loc.get("pending_reason");
            let second_pass = loc.get("second_pass");
            let match_status = loc.get("match_status");

            let evidence_value = || {
                Value::List(
                    evidence_families
                        .iter()
                        .map(|s| Value::Str(s.clone()))
                        .collect(),
                )
            };

            if eval_value.is_true() && (!matched_truthy || !provider_truthy) {
                errors.push(
                    ValidationError::new(
                        step,
                        video_id,
                        WARNING,
                        "inconsistent_location",
                        "location_match=True이지만 matched/provider name이 없음".to_string(),
                    )
                    .with_name(origin_name.clone()),
                );
            }

            if eval_value.is_true() && unique_count < 2 {
                errors.push(
                    ValidationError::new(
                        step,
                        video_id,
                        WARNING,
                        "insufficient_evidence_families",
                        "location_match=True이지만 독립 evidence_families가 2개 미만".to_string(),
                    )
                    .with_name(origin_name.clone())
                    .with_actual(evidence_value()),
                );
            }

            if unique_count != evidence_families.len() {
                errors.push(
                    ValidationError::new(
                        step,
                        video_id,
                        WARNING,
                        "duplicated_evidence_family",
                        "location_match evidence_families에 중복 항목이 있어 독립 증거가 이중 계산될 수 있음".to_string(),
                    )
                    .with_name(origin_name.clone())
                    .with_actual(evidence_value()),
                );
            }

            if eval_value.is_false() && !loc.get("falseMessage").truthy() {
                errors.push(
                    ValidationError::new(
                        step,
                        video_id,
                        INFO,
                        "missing_false_message",
                        "location_match=False이지만 falseMessage 없음".to_string(),
                    )
                    .with_name(origin_name.clone()),
                );
            }

            if !eval_value.is_true()
                && match_status.as_str() != Some("failed")
                && !pending_reason.truthy()
            {
                errors.push(
                    ValidationError::new(
                        step,
                        video_id,
                        INFO,
                        "missing_pending_reason",
                        "location_match가 non-True인데 pending_reason 없음".to_string(),
                    )
                    .with_name(origin_name.clone()),
                );
            }

            let pending_str = pending_reason.as_str();
            if pending_str == Some("timeout") || pending_str == Some("rate_limited") {
                if !second_pass.is_dict() {
                    errors.push(
                        ValidationError::new(
                            step,
                            video_id,
                            WARNING,
                            "missing_second_pass_state",
                            "timeout/rate_limited 상태인데 second_pass 메타데이터가 없음"
                                .to_string(),
                        )
                        .with_name(origin_name.clone()),
                    );
                } else if pending_str == Some("timeout") && !second_pass.get("timed_out").is_true()
                {
                    errors.push(
                        ValidationError::new(
                            step,
                            video_id,
                            WARNING,
                            "inconsistent_second_pass_state",
                            "pending_reason=timeout인데 second_pass.timed_out가 true가 아님"
                                .to_string(),
                        )
                        .with_name(origin_name.clone()),
                    );
                } else if pending_str == Some("rate_limited")
                    && !second_pass.get("rate_limited").is_true()
                {
                    errors.push(
                        ValidationError::new(
                            step,
                            video_id,
                            WARNING,
                            "inconsistent_second_pass_state",
                            "pending_reason=rate_limited인데 second_pass.rate_limited가 true가 아님".to_string(),
                        )
                        .with_name(origin_name.clone()),
                    );
                }
            }
        }
    }

    // category_validity_TF 검증
    let cat_validity = eval_results
        .get_opt("category_validity_TF")
        .unwrap_or(&default_list);
    if !cat_validity.is_list() {
        errors.push(ValidationError::new(
            step,
            video_id,
            WARNING,
            "type_error",
            "category_validity_TF가 리스트가 아닙니다".to_string(),
        ));
    } else if let Value::List(cat_items) = cat_validity {
        if cat_items.is_empty() {
            errors.push(ValidationError::new(
                step,
                video_id,
                WARNING,
                "empty_category_validity",
                "category_validity_TF가 비어있음".to_string(),
            ));
        }
    }

    errors
}

// ═══════════════════════════════════════════════════════════
// 4. LAAJ 평가 결과 검증
// ═══════════════════════════════════════════════════════════

pub fn validate_laaj_results(video_id: &str, data: &Value) -> Vec<ValidationError> {
    let step = "laaj_evaluation";
    let mut errors: Vec<ValidationError> = Vec::new();

    let eval_results = data.get("evaluation_results");
    if !eval_results.truthy() {
        errors.push(ValidationError::new(
            step,
            video_id,
            ERROR,
            "missing_eval_results",
            "evaluation_results 필드 없음".to_string(),
        ));
        return errors;
    }

    let present_keys: BTreeSet<&str> = eval_results.dict_keys().map(String::as_str).collect();
    let missing_keys: Vec<&str> = LAAJ_EXPECTED_KEYS
        .iter()
        .filter(|k| !present_keys.contains(**k))
        .copied()
        .collect::<BTreeSet<&str>>()
        .into_iter()
        .collect();
    if !missing_keys.is_empty() {
        errors.push(ValidationError::new(
            step,
            video_id,
            ERROR,
            "missing_laaj_keys",
            format!("LAAJ 평가 키 누락: {}", missing_keys.join(", ")),
        ));
    }

    for &(score_key, min_val, max_val) in SCORE_RANGES {
        let score_items = iter_evaluation_items(eval_results.get(score_key));
        for item in score_items {
            let val = item.get("eval_value");
            let name = get_or(item, "name", Value::Str(String::new()));
            if !val.is_none() {
                match val.py_float() {
                    Ok(val_f) => {
                        if !(val_f >= min_val && val_f <= max_val) {
                            errors.push(
                                ValidationError::new(
                                    step,
                                    video_id,
                                    ERROR,
                                    "score_range",
                                    format!(
                                        "{} 범위 초과: {} (허용: {}~{})",
                                        score_key,
                                        py_float_repr(val_f),
                                        fmt_range_bound(min_val),
                                        fmt_range_bound(max_val)
                                    ),
                                )
                                .with_name(name.clone()),
                            );
                        }
                    }
                    Err(_) => {
                        errors.push(
                            ValidationError::new(
                                step,
                                video_id,
                                ERROR,
                                "score_type",
                                format!("{} 값이 숫자가 아닙니다: {}", score_key, py_str(val)),
                            )
                            .with_name(name.clone()),
                        );
                    }
                }
            }

            let basis = get_or(item, "eval_basis", Value::Str(String::new()));
            let basis_too_short = match basis.as_str() {
                Some(s) => py_strip(s).chars().count() < 5,
                None => false,
            };
            if !basis.truthy() || basis_too_short {
                errors.push(
                    ValidationError::new(
                        step,
                        video_id,
                        WARNING,
                        "missing_basis",
                        format!("{} 평가 근거 누락 또는 너무 짧음", score_key),
                    )
                    .with_name(name.clone()),
                );
            }
        }
    }

    for &bool_key in &["rb_grounding_TF", "category_TF"] {
        let bool_items = iter_evaluation_items(eval_results.get(bool_key));
        for item in bool_items {
            let val = item.get("eval_value");
            if !val.is_none() && !val.is_bool() {
                errors.push(
                    ValidationError::new(
                        step,
                        video_id,
                        WARNING,
                        "type_error",
                        format!(
                            "{}.eval_value가 boolean이 아닙니다: {}",
                            bool_key,
                            py_str(val)
                        ),
                    )
                    .with_name(get_or(item, "name", Value::Str(String::new()))),
                );
            }
        }
    }

    errors
}

// ═══════════════════════════════════════════════════════════
// 5. Rule vs LAAJ 교차 검증
// ═══════════════════════════════════════════════════════════

pub fn cross_validate(
    video_id: &str,
    rule_data: &Value,
    laaj_data: &Value,
) -> Vec<ValidationError> {
    let step = "cross_validation";
    let mut errors: Vec<ValidationError> = Vec::new();

    let default_dict = Value::Dict(Vec::new());
    let rule_eval = rule_data
        .get_opt("evaluation_results")
        .unwrap_or(&default_dict);
    let laaj_eval = laaj_data
        .get_opt("evaluation_results")
        .unwrap_or(&default_dict);

    // 음식점 이름 목록 교차 확인
    let mut rule_restaurants: BTreeSet<String> = BTreeSet::new();
    for r in list_items(rule_data.get("restaurants")) {
        let on = r.get("origin_name");
        if on.truthy() {
            if let Some(s) = on.as_str() {
                rule_restaurants.insert(s.to_string());
            }
        }
    }
    let mut laaj_restaurants: BTreeSet<String> = BTreeSet::new();
    for r in list_items(laaj_data.get("restaurants")) {
        let on = r.get("origin_name");
        let chosen = if on.truthy() { on } else { r.get("name") };
        if chosen.truthy() {
            if let Some(s) = chosen.as_str() {
                laaj_restaurants.insert(s.to_string());
            }
        }
    }
    let name_diff: Vec<&String> = rule_restaurants
        .symmetric_difference(&laaj_restaurants)
        .collect();
    if !name_diff.is_empty() {
        errors.push(ValidationError::new(
            step,
            video_id,
            WARNING,
            "restaurant_name_mismatch",
            format!(
                "Rule vs LAAJ 음식점 이름 불일치: {}",
                join_refs(&name_diff, ", ")
            ),
        ));
    }

    // location_match vs visit_authenticity 모순 탐지
    let mut location_matches: Vec<(Value, Value)> = Vec::new();
    for loc in iter_evaluation_items(rule_eval.get("location_match_TF")) {
        map_insert(
            &mut location_matches,
            loc.get("origin_name").clone(),
            loc.get("eval_value").clone(),
        );
    }
    let mut visit_auths: Vec<(Value, Value)> = Vec::new();
    for item in iter_evaluation_items(laaj_eval.get("visit_authenticity")) {
        map_insert(
            &mut visit_auths,
            item.get("name").clone(),
            item.get("eval_value").clone(),
        );
    }

    for (name, loc_val) in &location_matches {
        let visit_val = map_get(&visit_auths, name);
        if loc_val.is_false() {
            if let Some(v) = visit_val {
                if !v.is_none() && numeric_ge(v, 2.0) {
                    errors.push(
                        ValidationError::new(
                            step,
                            video_id,
                            WARNING,
                            "location_visit_contradiction",
                            "위치 불일치(Rule)이지만 방문 인증 최고점(LAAJ): 확인 필요".to_string(),
                        )
                        .with_name(name.clone()),
                    );
                }
            }
        }
    }

    // category 교차 검증
    let mut rule_cat: Vec<(Value, Value)> = Vec::new();
    for item in iter_evaluation_items(rule_eval.get("category_validity_TF")) {
        map_insert(
            &mut rule_cat,
            item.get("name").clone(),
            item.get("eval_value").clone(),
        );
    }
    let mut laaj_cat: Vec<(Value, Value)> = Vec::new();
    for item in iter_evaluation_items(laaj_eval.get("category_TF")) {
        map_insert(
            &mut laaj_cat,
            item.get("name").clone(),
            item.get("eval_value").clone(),
        );
    }

    for (name, rule_val) in &rule_cat {
        if let Some(laaj_val) = map_get(&laaj_cat, name) {
            if rule_val.is_false() && laaj_val.is_true() {
                errors.push(
                    ValidationError::new(
                        step,
                        video_id,
                        INFO,
                        "category_contradiction",
                        "Rule에서 카테고리 부적합이지만 LAAJ에서 적합: 재확인 권장".to_string(),
                    )
                    .with_name(name.clone()),
                );
            }
        }
    }

    errors
}

// ═══════════════════════════════════════════════════════════
// 6. Transform 출력 스키마 검증
// ═══════════════════════════════════════════════════════════

pub fn validate_transform_output(video_id: &str, records: &[Value]) -> Vec<ValidationError> {
    let step = "transform";
    let mut errors: Vec<ValidationError> = Vec::new();

    let mut seen_trace_ids: Vec<Value> = Vec::new();

    for (idx, record) in records.iter().enumerate() {
        let prefix = format!("record[{}]", idx);
        let name: Value = {
            let on = record.get("origin_name");
            if on.truthy() {
                on.clone()
            } else {
                let nm = record.get("name");
                if nm.truthy() {
                    nm.clone()
                } else {
                    Value::Str(format!("idx_{}", idx))
                }
            }
        };

        for &field in TRANSFORM_REQUIRED_FIELDS_SORTED {
            let field_missing = !record.contains_key(field);
            let field_empty = record.get(field).is_none();
            let empty_allowed =
                (field == "lat" || field == "lng") && allows_empty_transform_geocoding(record);
            if field_missing || (field_empty && !empty_allowed) {
                errors.push(
                    ValidationError::new(
                        step,
                        video_id,
                        ERROR,
                        "required_field",
                        format!("필수 필드 누락: {}", field),
                    )
                    .with_name(name.clone())
                    .with_field(&format!("{}.{}", prefix, field)),
                );
            }
        }

        let trace_id = record.get("trace_id");
        if trace_id.truthy() {
            if seen_trace_ids.iter().any(|t| t == trace_id) {
                errors.push(
                    ValidationError::new(
                        step,
                        video_id,
                        ERROR,
                        "duplicate_trace_id",
                        format!("trace_id 중복: {}", py_str(trace_id)),
                    )
                    .with_name(name.clone()),
                );
            }
            seen_trace_ids.push(trace_id.clone());
        }

        let lat = record.get("lat");
        let lng = record.get("lng");
        if (lat.is_none() || lng.is_none()) && allows_pending_transform_geocoding(record) {
            errors.push(
                ValidationError::new(
                    step,
                    video_id,
                    WARNING,
                    "pending_geocoding",
                    "좌표 보류: geocoding_success=false pending record".to_string(),
                )
                .with_name(name.clone())
                .with_field(&format!("{}.lat/lng", prefix)),
            );
        }
        if !lat.is_none() && !lng.is_none() {
            if let (Ok(lat_f), Ok(lng_f)) = (lat.py_float(), lng.py_float()) {
                let in_range = lat_f >= KOREA_LAT_MIN
                    && lat_f <= KOREA_LAT_MAX
                    && lng_f >= KOREA_LNG_MIN
                    && lng_f <= KOREA_LNG_MAX;
                if !in_range {
                    errors.push(
                        ValidationError::new(
                            step,
                            video_id,
                            WARNING,
                            "coordinate_range",
                            format!(
                                "좌표 범위 초과: ({}, {})",
                                py_float_repr(lat_f),
                                py_float_repr(lng_f)
                            ),
                        )
                        .with_name(name.clone()),
                    );
                }
            }
        }

        let eval_res = record.get("evaluation_results");
        if !eval_res.truthy() && !allows_empty_transform_evaluation_results(record) {
            errors.push(
                ValidationError::new(
                    step,
                    video_id,
                    WARNING,
                    "missing_eval_results",
                    "evaluation_results 비어있음".to_string(),
                )
                .with_name(name.clone()),
            );
        }
    }

    errors
}

fn allows_pending_transform_geocoding(record: &Value) -> bool {
    if record.get("is_missing").truthy() || record.get("is_notSelected").truthy() {
        return false;
    }
    let stage = record.get("geocoding_false_stage");
    let stage_ok =
        stage.is_none() || matches!(stage, Value::Int(1)) || matches!(stage, Value::Int(2));
    record.get("source_type").as_str() == Some("geminiCLI")
        && record.get("status").as_str() == Some("pending")
        && record.get("geocoding_success").is_false()
        && stage_ok
}

fn allows_empty_transform_geocoding(record: &Value) -> bool {
    record.get("is_missing").truthy()
        || record.get("is_notSelected").truthy()
        || allows_pending_transform_geocoding(record)
}

fn allows_empty_transform_evaluation_results(record: &Value) -> bool {
    record.get("is_missing").truthy()
        || record.get("is_notSelected").truthy()
        || record.get("source_type").as_str() == Some("map_url_crawling")
}

// ═══════════════════════════════════════════════════════════
// 집계 유틸리티
// ═══════════════════════════════════════════════════════════

/// Port of `validators.has_blocking_errors`. Reads `severity` from error dicts.
pub fn has_blocking_errors(errors: &[Value]) -> bool {
    errors
        .iter()
        .any(|e| e.get("severity").as_str() == Some(ERROR))
}

/// Port of `validators.error_summary`.
pub fn error_summary(errors: &[Value]) -> String {
    if errors.is_empty() {
        return "검증 통과".to_string();
    }
    let mut parts: Vec<String> = Vec::new();
    for (sev, label) in [(ERROR, "ERROR"), (WARNING, "WARNING"), (INFO, "INFO")] {
        let count = errors
            .iter()
            .filter(|e| e.get("severity").as_str() == Some(sev))
            .count();
        if count > 0 {
            parts.push(format!("{}: {}건", label, count));
        }
    }
    parts.join(" | ")
}

// ─── 내부 헬퍼 ─────────────────────────────────────────────

fn list_items(value: &Value) -> &[Value] {
    match value {
        Value::List(items) => items.as_slice(),
        _ => &[],
    }
}

fn join_refs(items: &[&String], sep: &str) -> String {
    items
        .iter()
        .map(|s| s.as_str())
        .collect::<Vec<&str>>()
        .join(sep)
}

/// Python dict-comprehension insert: keep first position, overwrite value.
fn map_insert(map: &mut Vec<(Value, Value)>, key: Value, val: Value) {
    if let Some(slot) = map.iter_mut().find(|(k, _)| *k == key) {
        slot.1 = val;
    } else {
        map.push((key, val));
    }
}

fn map_get<'a>(map: &'a [(Value, Value)], key: &Value) -> Option<&'a Value> {
    map.iter().find(|(k, _)| k == key).map(|(_, v)| v)
}

/// Python `x >= threshold` for numeric `x`; non-numeric returns false (the
/// reference would raise, but only numeric scores reach this branch).
fn numeric_ge(v: &Value, threshold: f64) -> bool {
    match v {
        Value::Int(i) => (*i as f64) >= threshold,
        Value::Float(f) => *f >= threshold,
        Value::Bool(b) => (if *b { 1.0 } else { 0.0 }) >= threshold,
        _ => false,
    }
}

/// Range bound formatting: score range bounds are integer-valued in the Python
/// dict (`0`, `1`, `2`), so `f"{0}~{2}"` prints "0~2" without a decimal point.
fn fmt_range_bound(v: f64) -> String {
    if v.fract() == 0.0 && v.is_finite() {
        format!("{}", v as i64)
    } else {
        py_float_repr(v)
    }
}
