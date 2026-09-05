//! Migration_Slice `R1-validators` (design C1/D1).
//!
//! Behavioral-parity Rust backing for the pure functions in
//! `backend/pipeline/validators.py` and `backend/pipeline/state.py`
//! (requirements 1.1, 1.3).
//!
//! # Boundary and entry points
//!
//! This crate does not change any Python entry point. The Python package keeps
//! its `validate_*` signatures; the Implementation_Selector
//! (`backend/pipeline_control/impl_selector.py`, task 41) chooses this Rust
//! backing only when the `R1-validators` slice is opted in via
//! `TZUDONG_RUST_SLICES`. The default remains the Python implementation until
//! the Parity_Harness records N=3 consecutive matches (requirements 1.5, 2.4).
//!
//! # Layers
//!
//! * [`value`] — a PyO3-independent Python value model.
//! * [`errors`] — the `ValidationError` model and builder.
//! * [`validators`] — line-by-line ports of the six validators plus the two
//!   aggregation helpers.
//! * [`state`] — severity/step constants and `create_initial_state`.
//! * `python` (feature `python`) — the PyO3 extension module `tzudong_validators`.

pub mod errors;
pub mod state;
pub mod validators;
pub mod value;

#[cfg(feature = "python")]
mod python;

/// Crate name used to build the Rust_Component artifact identifier
/// (`crate name` + built extension module SHA-256; requirement 2.10).
pub const CRATE_NAME: &str = "tzudong-validators";

#[cfg(test)]
mod tests {
    use super::validators::*;
    use super::value::Value;

    fn dict(pairs: Vec<(&str, Value)>) -> Value {
        Value::Dict(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
    }
    fn s(v: &str) -> Value {
        Value::Str(v.to_string())
    }
    fn list(items: Vec<Value>) -> Value {
        Value::List(items)
    }

    fn rules(errors: &[super::errors::ValidationError]) -> std::collections::BTreeSet<String> {
        errors.iter().map(|e| e.rule.clone()).collect()
    }

    #[test]
    fn crate_name_is_stable() {
        assert_eq!(super::CRATE_NAME, "tzudong-validators");
    }

    #[test]
    fn gemini_accepts_canonical_category_lists() {
        let data = dict(vec![
            (
                "youtube_link",
                s("https://www.youtube.com/watch?v=category-list"),
            ),
            (
                "restaurants",
                list(vec![dict(vec![
                    ("origin_name", s("복합카테고리식당")),
                    ("address", s("서울특별시 중구 세종대로 1")),
                    ("lat", Value::Float(37.566)),
                    ("lng", Value::Float(126.978)),
                    ("category", list(vec![s("한식"), s("야식"), s("도시락")])),
                    (
                        "reasoning_basis",
                        s("영상과 자막에서 방문 위치와 상호가 명확하게 확인됩니다."),
                    ),
                    (
                        "youtuber_review",
                        s("여러 메뉴를 직접 먹고 맛과 구성에 관해 구체적으로 평가했습니다."),
                    ),
                ])]),
            ),
        ]);
        let errors = validate_gemini_output("vid-category-list", &data);
        assert!(errors.is_empty(), "expected no errors, got {:?}", errors);
    }

    #[test]
    fn gemini_keeps_legacy_scalar_category_compatible() {
        let data = dict(vec![
            (
                "youtube_link",
                s("https://www.youtube.com/watch?v=legacy-scalar"),
            ),
            (
                "restaurants",
                list(vec![dict(vec![
                    ("origin_name", s("레거시분류식당")),
                    ("address", s("서울특별시 중구 세종대로 1")),
                    ("lat", Value::Float(37.566)),
                    ("lng", Value::Float(126.978)),
                    ("category", s("일식")),
                    (
                        "reasoning_basis",
                        s("영상과 자막에서 방문 위치와 상호가 명확하게 확인됩니다."),
                    ),
                    (
                        "youtuber_review",
                        s("메뉴를 직접 먹고 맛과 구성에 관해 구체적으로 평가했습니다."),
                    ),
                ])]),
            ),
        ]);
        let errors = validate_gemini_output("vid-legacy-scalar-category", &data);
        assert!(errors.is_empty(), "expected no errors, got {:?}", errors);
    }

    #[test]
    fn gemini_rejects_legacy_label_inside_canonical_list() {
        let data = dict(vec![
            (
                "youtube_link",
                s("https://www.youtube.com/watch?v=legacy-list"),
            ),
            (
                "restaurants",
                list(vec![dict(vec![
                    ("origin_name", s("레거시배열분류식당")),
                    ("address", s("서울특별시 중구 세종대로 1")),
                    ("category", list(vec![s("일식")])),
                ])]),
            ),
        ]);
        let errors = validate_gemini_output("vid-legacy-list-category", &data);
        let invalid: Vec<_> = errors
            .iter()
            .filter(|e| e.rule == "invalid_category")
            .collect();
        assert_eq!(1, invalid.len());
        assert_eq!(Value::Str("일식".into()), invalid[0].actual_value);
    }

    #[test]
    fn gemini_reports_malformed_category_without_crashing() {
        let data = dict(vec![
            (
                "youtube_link",
                s("https://www.youtube.com/watch?v=list-malformed"),
            ),
            (
                "restaurants",
                list(vec![dict(vec![
                    ("origin_name", s("분류형식검증식당")),
                    ("address", s("서울특별시 중구 세종대로 1")),
                    (
                        "category",
                        list(vec![s("한식"), dict(vec![("name", s("분식"))])]),
                    ),
                ])]),
            ),
        ]);
        let errors = validate_gemini_output("vid-category-list-malformed", &data);
        let invalid: Vec<_> = errors
            .iter()
            .filter(|e| e.rule == "invalid_category")
            .collect();
        assert_eq!(1, invalid.len());
        assert_eq!(dict(vec![("name", s("분식"))]), invalid[0].actual_value);
    }

    #[test]
    fn gemini_rejects_falsy_members_inside_category_list() {
        for item in [s(""), Value::None, Value::Int(0), Value::Bool(false)] {
            let data = dict(vec![
                (
                    "youtube_link",
                    s("https://www.youtube.com/watch?v=list-falsy"),
                ),
                (
                    "restaurants",
                    list(vec![dict(vec![
                        ("origin_name", s("빈분류검증식당")),
                        ("address", s("서울특별시 중구 세종대로 1")),
                        ("category", list(vec![item.clone()])),
                    ])]),
                ),
            ]);
            let errors = validate_gemini_output("vid-category-list-falsy", &data);
            let invalid: Vec<_> = errors
                .iter()
                .filter(|e| e.rule == "invalid_category")
                .collect();
            assert_eq!(1, invalid.len(), "item {:?}", item);
            assert_eq!(item, invalid[0].actual_value);
        }
    }

    #[test]
    fn gemini_detects_critical_restaurant_level_issues() {
        let data = dict(vec![
            ("youtube_link", s("https://youtube.com/watch?v=abc")),
            (
                "restaurants",
                list(vec![dict(vec![
                    ("origin_name", s("테스트식당")),
                    ("address", s("Unknown City, Some Street 123")),
                    ("lat", s("40.5")),
                    ("lng", s("127.1")),
                    ("category", s("외계음식")),
                    ("reasoning_basis", s("근거짧음")),
                    ("youtuber_review", s("리뷰짧음")),
                ])]),
            ),
        ]);
        let r = rules(&validate_gemini_output("vid-2", &data));
        assert!(r.contains("coordinate_range"));
        assert!(r.contains("invalid_category"));
        assert!(r.contains("address_format"));
        assert!(r.contains("short_text"));
    }

    #[test]
    fn gemini_handles_missing_required_and_structure_errors() {
        let data = dict(vec![("restaurants", s("not-a-list"))]);
        let r = rules(&validate_gemini_output("vid-1", &data));
        assert!(r.contains("required_field"));
        assert!(r.contains("type_error"));
    }

    #[test]
    fn selection_detects_missing_and_extra_names() {
        let data = dict(vec![
            (
                "restaurants",
                list(vec![
                    dict(vec![("origin_name", s("식당A"))]),
                    dict(vec![("origin_name", s("식당B"))]),
                ]),
            ),
            (
                "evaluation_target",
                dict(vec![
                    ("식당A", dict(vec![("selected", Value::Bool(true))])),
                    ("식당C", dict(vec![("selected", Value::Bool(false))])),
                ]),
            ),
        ]);
        let errors = validate_selection("vid-3", &data);
        let mismatches: Vec<_> = errors
            .iter()
            .filter(|e| e.rule == "name_mismatch")
            .collect();
        assert_eq!(2, mismatches.len());
        let sevs: std::collections::BTreeSet<_> =
            mismatches.iter().map(|e| e.severity.clone()).collect();
        assert!(sevs.contains("error"));
        assert!(sevs.contains("warning"));
    }

    #[test]
    fn rule_results_detects_location_contract_regressions() {
        let data = dict(vec![(
            "evaluation_results",
            dict(vec![
                (
                    "location_match_TF",
                    list(vec![
                        dict(vec![
                            ("origin_name", s("식당A")),
                            ("eval_value", Value::Bool(true)),
                            ("matched_name", s("식당A")),
                            ("google_name", s("식당A")),
                            ("evidence_families", list(vec![s("provider_candidate")])),
                        ]),
                        dict(vec![
                            ("origin_name", s("식당B")),
                            ("eval_value", Value::Bool(false)),
                        ]),
                    ]),
                ),
                ("category_validity_TF", list(vec![])),
            ]),
        )]);
        let r = rules(&validate_rule_results("vid-4", &data));
        assert!(r.contains("insufficient_evidence_families"));
        assert!(r.contains("missing_false_message"));
        assert!(r.contains("missing_pending_reason"));
        assert!(r.contains("empty_category_validity"));
    }

    #[test]
    fn rule_results_checks_second_pass_timeout_and_duplicate_evidence() {
        let data = dict(vec![(
            "evaluation_results",
            dict(vec![
                (
                    "location_match_TF",
                    list(vec![
                        dict(vec![
                            ("origin_name", s("식당A")),
                            ("eval_value", Value::Bool(true)),
                            ("matched_name", s("식당A")),
                            ("naver_name", s("식당A")),
                            (
                                "evidence_families",
                                list(vec![s("provider_candidate"), s("provider_candidate")]),
                            ),
                        ]),
                        dict(vec![
                            ("origin_name", s("식당B")),
                            ("eval_value", Value::Bool(false)),
                            ("pending_reason", s("timeout")),
                            ("falseMessage", s("timeout")),
                            (
                                "second_pass",
                                dict(vec![
                                    ("attempted", Value::Bool(true)),
                                    ("provider", s("google")),
                                    ("timed_out", Value::Bool(false)),
                                ]),
                            ),
                        ]),
                    ]),
                ),
                (
                    "category_validity_TF",
                    list(vec![dict(vec![
                        ("name", s("식당A")),
                        ("eval_value", Value::Bool(true)),
                    ])]),
                ),
            ]),
        )]);
        let r = rules(&validate_rule_results("vid-4b", &data));
        assert!(r.contains("duplicated_evidence_family"));
        assert!(r.contains("insufficient_evidence_families"));
        assert!(r.contains("inconsistent_second_pass_state"));
    }

    #[test]
    fn laaj_detects_score_and_type_regressions() {
        let data = dict(vec![
            (
                "restaurants",
                list(vec![dict(vec![("origin_name", s("식당A"))])]),
            ),
            (
                "evaluation_results",
                dict(vec![
                    (
                        "visit_authenticity",
                        list(vec![dict(vec![
                            ("name", s("식당A")),
                            ("eval_value", Value::Int(3)),
                            ("eval_basis", s("충분한 근거 문장")),
                        ])]),
                    ),
                    (
                        "rb_inference_score",
                        list(vec![dict(vec![
                            ("name", s("식당A")),
                            ("eval_value", s("NaN-ish")),
                            ("eval_basis", s("충분한 근거 문장")),
                        ])]),
                    ),
                    (
                        "rb_grounding_TF",
                        list(vec![dict(vec![
                            ("name", s("식당A")),
                            ("eval_value", s("true")),
                        ])]),
                    ),
                    (
                        "review_faithfulness_score",
                        list(vec![dict(vec![
                            ("name", s("식당A")),
                            ("eval_value", Value::Float(0.8)),
                            ("eval_basis", s("짧음")),
                        ])]),
                    ),
                    (
                        "category_TF",
                        list(vec![dict(vec![
                            ("name", s("식당A")),
                            ("eval_value", Value::Bool(true)),
                        ])]),
                    ),
                ]),
            ),
        ]);
        let r = rules(&validate_laaj_results("vid-5", &data));
        assert!(r.contains("score_range"));
        assert!(r.contains("score_type"));
        assert!(r.contains("type_error"));
        assert!(r.contains("missing_basis"));
    }

    #[test]
    fn laaj_accepts_values_wrappers() {
        let values_wrap =
            |items: Vec<Value>| dict(vec![("values", list(items)), ("missing", list(vec![]))]);
        let data = dict(vec![
            (
                "restaurants",
                list(vec![dict(vec![("origin_name", s("식당A"))])]),
            ),
            (
                "evaluation_results",
                dict(vec![
                    (
                        "visit_authenticity",
                        values_wrap(vec![dict(vec![
                            ("name", s("식당A")),
                            ("eval_value", Value::Int(3)),
                            ("eval_basis", s("충분한 근거 문장")),
                        ])]),
                    ),
                    (
                        "rb_inference_score",
                        dict(vec![(
                            "values",
                            list(vec![dict(vec![
                                ("name", s("식당A")),
                                ("eval_value", s("NaN-ish")),
                                ("eval_basis", s("충분한 근거 문장")),
                            ])]),
                        )]),
                    ),
                    (
                        "rb_grounding_TF",
                        list(vec![dict(vec![
                            ("name", s("식당A")),
                            ("eval_value", s("true")),
                        ])]),
                    ),
                    (
                        "review_faithfulness_score",
                        list(vec![dict(vec![
                            ("name", s("식당A")),
                            ("eval_value", Value::Float(0.8)),
                            ("eval_basis", s("짧음")),
                        ])]),
                    ),
                    (
                        "category_TF",
                        dict(vec![(
                            "values",
                            list(vec![dict(vec![
                                ("name", s("식당A")),
                                ("eval_value", Value::Bool(true)),
                            ])]),
                        )]),
                    ),
                ]),
            ),
        ]);
        let r = rules(&validate_laaj_results("vid-5-wrapper", &data));
        assert!(r.contains("score_range"));
        assert!(r.contains("score_type"));
        assert!(r.contains("type_error"));
        assert!(r.contains("missing_basis"));
    }

    #[test]
    fn cross_validate_detects_inter_stage_contradictions() {
        let rule_data = dict(vec![
            (
                "restaurants",
                list(vec![dict(vec![("origin_name", s("식당A"))])]),
            ),
            (
                "evaluation_results",
                dict(vec![
                    (
                        "location_match_TF",
                        list(vec![dict(vec![
                            ("origin_name", s("식당A")),
                            ("eval_value", Value::Bool(false)),
                        ])]),
                    ),
                    (
                        "category_validity_TF",
                        list(vec![dict(vec![
                            ("name", s("식당A")),
                            ("eval_value", Value::Bool(false)),
                        ])]),
                    ),
                ]),
            ),
        ]);
        let laaj_data = dict(vec![
            ("restaurants", list(vec![dict(vec![("name", s("식당A"))])])),
            (
                "evaluation_results",
                dict(vec![
                    (
                        "visit_authenticity",
                        list(vec![dict(vec![
                            ("name", s("식당A")),
                            ("eval_value", Value::Int(2)),
                        ])]),
                    ),
                    (
                        "category_TF",
                        list(vec![dict(vec![
                            ("name", s("식당A")),
                            ("eval_value", Value::Bool(true)),
                        ])]),
                    ),
                ]),
            ),
        ]);
        let r = rules(&cross_validate("vid-6", &rule_data, &laaj_data));
        assert!(r.contains("location_visit_contradiction"));
        assert!(r.contains("category_contradiction"));
    }

    #[test]
    fn transform_detects_required_fields_and_duplicates() {
        let records = vec![
            dict(vec![
                ("trace_id", s("trace-1")),
                ("youtube_link", s("https://youtube.com/watch?v=abc")),
                ("channel_name", s("채널")),
                ("origin_name", s("식당A")),
                ("lat", Value::Float(37.5)),
                ("lng", Value::Float(127.0)),
                ("evaluation_results", dict(vec![])),
            ]),
            dict(vec![
                ("trace_id", s("trace-1")),
                ("youtube_link", s("https://youtube.com/watch?v=def")),
                ("channel_name", s("채널")),
                ("origin_name", s("식당B")),
                ("source_type", s("manual")),
                ("lat", Value::Int(10)),
                ("lng", Value::Int(200)),
                (
                    "evaluation_results",
                    dict(vec![("dummy", Value::Bool(true))]),
                ),
            ]),
        ];
        let r = rules(&validate_transform_output("vid-7", &records));
        assert!(r.contains("required_field"));
        assert!(r.contains("duplicate_trace_id"));
        assert!(r.contains("coordinate_range"));
        assert!(r.contains("missing_eval_results"));
    }

    #[test]
    fn blocking_errors_and_summary() {
        let errors = vec![
            dict(vec![("severity", s("warning")), ("rule", s("warn_rule"))]),
            dict(vec![("severity", s("error")), ("rule", s("error_rule"))]),
            dict(vec![("severity", s("info")), ("rule", s("info_rule"))]),
        ];
        assert!(has_blocking_errors(&errors));
        let summary = error_summary(&errors);
        assert!(summary.contains("ERROR: 1건"));
        assert!(summary.contains("WARNING: 1건"));
        assert!(summary.contains("INFO: 1건"));
    }

    #[test]
    fn empty_summary_passes() {
        assert_eq!("검증 통과", error_summary(&[]));
        assert!(!has_blocking_errors(&[]));
    }
}
