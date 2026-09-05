//! Property 6 — 파이썬 ↔ 러스트 출력 동등성 (Rust half), Migration_Slice R1-validators.
//!
//! Feature: platform-modernization, Property 6: 파이썬 ↔ 러스트 출력 동등성.
//!
//! Task 46.3. This is the Rust half of the cross-language parity property. The
//! actual python-vs-rust field comparison lives in the python harness
//! (`backend/rust/tests/parity_pbt.py`), which imports this crate's PyO3
//! extension and the python reference and compares their normalized outputs
//! under normalization rule `v1`.
//!
//! A `cargo test` proptest cannot invoke the python interpreter, so this suite
//! establishes the Rust-side guarantee that parity relies on: for inputs drawn
//! from a per-slice `valid_inputs()` generator, the Rust_Component output is a
//! *stable canonical form* — invariant under input dict-key reordering and a
//! fixed point of normalization rule `v1`. If the Rust output were sensitive to
//! input key ordering or otherwise non-canonical, python↔rust equality could
//! not hold field-by-field. Each property runs 100 cases (design C1, task 46).
//!
//! **Validates: Requirements 2.1, 2.2, 2.3, 2.7**

use std::collections::BTreeSet;

use proptest::prelude::*;

use tzudong_validators::errors::errors_to_value;
use tzudong_validators::validators::{
    cross_validate, validate_gemini_output, validate_laaj_results, validate_rule_results,
    validate_selection, validate_transform_output,
};
use tzudong_validators::value::Value;

// ---------------------------------------------------------------------------
// Normalization rule v1 (design C1): sort field names, drop the declared
// non-deterministic fields. Validator error dicts carry none of the excluded
// fields, so on this slice the rule reduces to a recursive key sort — but the
// drop is implemented so the canonical form matches the harness exactly.
// ---------------------------------------------------------------------------
const EXCLUDED_FIELDS: &[&str] = &["generated_at", "duration_ms", "host", "pid"];

fn normalize(value: &Value) -> Value {
    match value {
        Value::Dict(pairs) => {
            let mut kept: Vec<(String, Value)> = pairs
                .iter()
                .filter(|(k, _)| !EXCLUDED_FIELDS.contains(&k.as_str()))
                .map(|(k, v)| (k.clone(), normalize(v)))
                .collect();
            kept.sort_by(|a, b| a.0.cmp(&b.0));
            Value::Dict(kept)
        }
        Value::List(items) => Value::List(items.iter().map(normalize).collect()),
        other => other.clone(),
    }
}

/// Rotate every dict's entry order (recursively) by `k`, preserving list order.
/// Models the same logical input arriving with keys in a different insertion
/// order. A canonical implementation must be invariant under this transform.
fn reorder(value: &Value, k: usize) -> Value {
    match value {
        Value::Dict(pairs) => {
            let mut rotated: Vec<(String, Value)> = pairs
                .iter()
                .map(|(key, v)| (key.clone(), reorder(v, k)))
                .collect();
            let len = rotated.len();
            if len != 0 {
                rotated.rotate_left(k % len);
            }
            Value::Dict(rotated)
        }
        Value::List(items) => Value::List(items.iter().map(|v| reorder(v, k)).collect()),
        other => other.clone(),
    }
}

fn reorder_records(records: &[Value], k: usize) -> Vec<Value> {
    records.iter().map(|r| reorder(r, k)).collect()
}

// ---------------------------------------------------------------------------
// Shared value strategies, kept inside the valid input domain of the slice.
// ---------------------------------------------------------------------------
fn name_str() -> impl Strategy<Value = Value> {
    prop::sample::select(vec!["식당A", "식당B", "식당C"]).prop_map(|n| Value::Str(n.to_string()))
}

fn maybe_name() -> impl Strategy<Value = Value> {
    prop_oneof![Just(Value::None), name_str()]
}

fn coord() -> impl Strategy<Value = Value> {
    prop_oneof![
        Just(Value::None),
        (-200i64..200).prop_map(Value::Int),
        prop::sample::select(vec![33.0, 37.566, 40.5, 126.978, 129.0, 200.0, -5.5])
            .prop_map(Value::Float),
        prop::sample::select(vec!["abc", "N/A"]).prop_map(|s| Value::Str(s.to_string())),
    ]
}

fn address() -> impl Strategy<Value = Value> {
    prop_oneof![
        Just(Value::None),
        prop::sample::select(vec![
            "서울특별시 중구 세종대로 1",
            "부산광역시 해운대구 우동",
            "Unknown City, Some Street 123",
        ])
        .prop_map(|s| Value::Str(s.to_string())),
    ]
}

fn short_or_none_text() -> impl Strategy<Value = Value> {
    prop_oneof![Just(Value::None), "[가-힣a-z ]{0,30}".prop_map(Value::Str)]
}

fn category() -> impl Strategy<Value = Value> {
    let canonical = vec!["한식", "치킨", "분식", "야식", "도시락"];
    let legacy = vec!["일식", "카페", "국밥"];
    prop_oneof![
        prop::sample::select(canonical.clone()).prop_map(|s| Value::Str(s.to_string())),
        prop::sample::select(legacy).prop_map(|s| Value::Str(s.to_string())),
        prop::sample::select(vec!["외계음식", "없는카테고리"])
            .prop_map(|s| Value::Str(s.to_string())),
        prop::collection::vec(
            prop::sample::select(canonical).prop_map(|s| Value::Str(s.to_string())),
            1..3,
        )
        .prop_map(Value::List),
    ]
}

fn restaurant() -> impl Strategy<Value = Value> {
    (
        maybe_name(),
        address(),
        coord(),
        coord(),
        category(),
        short_or_none_text(),
        short_or_none_text(),
    )
        .prop_map(|(nm, ad, lat, lng, cat, rb, rv)| {
            Value::Dict(vec![
                ("origin_name".into(), nm),
                ("address".into(), ad),
                ("lat".into(), lat),
                ("lng".into(), lng),
                ("category".into(), cat),
                ("reasoning_basis".into(), rb),
                ("youtuber_review".into(), rv),
            ])
        })
}

fn valid_gemini_input() -> impl Strategy<Value = Value> {
    let link = prop_oneof![
        Just(Value::None),
        Just(Value::Str(String::new())),
        Just(Value::Str("https://www.youtube.com/watch?v=abc".into())),
    ];
    let restaurants = prop_oneof![
        Just(Value::List(vec![])),
        prop::collection::vec(restaurant(), 1..3).prop_map(Value::List),
        Just(Value::Str("not-a-list".into())),
    ];
    (link, restaurants)
        .prop_map(|(l, r)| Value::Dict(vec![("youtube_link".into(), l), ("restaurants".into(), r)]))
}

fn dedupe(items: Vec<&str>) -> Vec<String> {
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut out: Vec<String> = Vec::new();
    for item in items {
        if seen.insert(item.to_string()) {
            out.push(item.to_string());
        }
    }
    out
}

fn valid_selection_input() -> impl Strategy<Value = Value> {
    let names = prop::collection::vec(
        prop::sample::select(vec!["식당A", "식당B", "식당C", "식당D"]),
        0..4,
    );
    let target_keys = prop::collection::vec(
        prop::sample::select(vec!["식당A", "식당B", "식당C", "식당D", "식당E"]),
        0..4,
    );
    let target = prop_oneof![
        // Weight the dict shape higher than the type_error shape.
        4 => target_keys.prop_map(|ks| {
            Value::Dict(
                dedupe(ks)
                    .into_iter()
                    .map(|k| (k, Value::Dict(vec![("selected".into(), Value::Bool(true))])))
                    .collect(),
            )
        }),
        1 => Just(Value::Str("not-a-dict".into())),
    ];
    (names, target).prop_map(|(ns, t)| {
        let restaurants = Value::List(
            ns.iter()
                .map(|n| Value::Dict(vec![("origin_name".into(), Value::Str(n.to_string()))]))
                .collect(),
        );
        Value::Dict(vec![
            ("restaurants".into(), restaurants),
            ("evaluation_target".into(), t),
        ])
    })
}

fn loc_item() -> impl Strategy<Value = Value> {
    (
        name_str(),
        prop_oneof![Just(Value::None), any::<bool>().prop_map(Value::Bool)],
        maybe_name(),
        maybe_name(),
        prop::collection::vec(
            prop::sample::select(vec!["provider_candidate", "text_match", "map_pin"])
                .prop_map(|s| Value::Str(s.to_string())),
            0..3,
        )
        .prop_map(Value::List),
        prop_oneof![
            Just(Value::None),
            prop::sample::select(vec!["timeout", "rate_limited"])
                .prop_map(|s| Value::Str(s.to_string()))
        ],
        prop_oneof![
            Just(Value::None),
            (any::<bool>(), any::<bool>()).prop_map(|(t, r)| Value::Dict(vec![
                ("timed_out".into(), Value::Bool(t)),
                ("rate_limited".into(), Value::Bool(r)),
            ]))
        ],
    )
        .prop_map(|(nm, ev, matched, naver, evidence, pending, second)| {
            Value::Dict(vec![
                ("origin_name".into(), nm),
                ("eval_value".into(), ev),
                ("matched_name".into(), matched),
                ("naver_name".into(), naver),
                ("evidence_families".into(), evidence),
                ("pending_reason".into(), pending),
                ("second_pass".into(), second),
            ])
        })
}

fn valid_rule_input() -> impl Strategy<Value = Value> {
    let loc = prop_oneof![
        prop::collection::vec(loc_item(), 0..3).prop_map(Value::List),
        Just(Value::Str("not-a-list".into())),
    ];
    let cat = prop::collection::vec(
        (name_str(), any::<bool>()).prop_map(|(n, b)| {
            Value::Dict(vec![
                ("name".into(), n),
                ("eval_value".into(), Value::Bool(b)),
            ])
        }),
        0..3,
    )
    .prop_map(Value::List);
    (loc, cat).prop_map(|(l, c)| {
        Value::Dict(vec![(
            "evaluation_results".into(),
            Value::Dict(vec![
                ("location_match_TF".into(), l),
                ("category_validity_TF".into(), c),
            ]),
        )])
    })
}

fn score_item() -> impl Strategy<Value = Value> {
    (
        name_str(),
        prop_oneof![
            Just(Value::None),
            (-2i64..4).prop_map(Value::Int),
            prop::sample::select(vec![0.0, 0.5, 1.0, 2.0, 3.5]).prop_map(Value::Float),
            prop::sample::select(vec!["x", "N/A"]).prop_map(|s| Value::Str(s.to_string())),
        ],
        short_or_none_text(),
    )
        .prop_map(|(nm, ev, basis)| {
            Value::Dict(vec![
                ("name".into(), nm),
                ("eval_value".into(), ev),
                ("eval_basis".into(), basis),
            ])
        })
}

fn bool_item() -> impl Strategy<Value = Value> {
    (
        name_str(),
        prop_oneof![
            Just(Value::None),
            any::<bool>().prop_map(Value::Bool),
            (0i64..3).prop_map(Value::Int),
            prop::sample::select(vec!["true", "false"]).prop_map(|s| Value::Str(s.to_string())),
        ],
    )
        .prop_map(|(nm, ev)| Value::Dict(vec![("name".into(), nm), ("eval_value".into(), ev)]))
}

fn valid_laaj_input() -> impl Strategy<Value = Value> {
    (
        prop::collection::vec(score_item(), 0..3),
        prop::collection::vec(score_item(), 0..3),
        prop::collection::vec(bool_item(), 0..3),
        prop::collection::vec(score_item(), 0..3),
        prop::collection::vec(bool_item(), 0..3),
        any::<bool>(),
    )
        .prop_map(|(va, rb_inf, rb_g, rev, cat, wrap)| {
            let wrapper = |items: Vec<Value>| {
                if wrap {
                    Value::Dict(vec![("values".into(), Value::List(items))])
                } else {
                    Value::List(items)
                }
            };
            Value::Dict(vec![(
                "evaluation_results".into(),
                Value::Dict(vec![
                    ("visit_authenticity".into(), wrapper(va)),
                    ("rb_inference_score".into(), wrapper(rb_inf)),
                    ("rb_grounding_TF".into(), Value::List(rb_g)),
                    ("review_faithfulness_score".into(), wrapper(rev)),
                    ("category_TF".into(), Value::List(cat)),
                ]),
            )])
        })
}

fn transform_record() -> impl Strategy<Value = Value> {
    (
        prop::sample::select(vec!["t1", "t2"]),
        name_str(),
        coord(),
        coord(),
        prop_oneof![
            Just(Value::Dict(vec![("dummy".into(), Value::Bool(true))])),
            Just(Value::Dict(vec![])),
        ],
    )
        .prop_map(|(tid, nm, lat, lng, ev)| {
            Value::Dict(vec![
                ("trace_id".into(), Value::Str(tid.to_string())),
                (
                    "youtube_link".into(),
                    Value::Str("https://youtu.be/x".into()),
                ),
                ("channel_name".into(), Value::Str("채널".into())),
                ("origin_name".into(), nm),
                ("source_type".into(), Value::Str("manual".into())),
                ("lat".into(), lat),
                ("lng".into(), lng),
                ("evaluation_results".into(), ev),
            ])
        })
}

fn valid_transform_input() -> impl Strategy<Value = Vec<Value>> {
    prop::collection::vec(transform_record(), 0..3)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// Property 6: gemini validator output is a normalization-`v1` fixed point
    /// and is invariant under input dict-key reordering.
    #[test]
    fn gemini_output_is_canonical_and_key_order_invariant(
        vid in "[a-z0-9-]{1,12}",
        input in valid_gemini_input(),
        k in 1usize..8,
    ) {
        let base = normalize(&errors_to_value(&validate_gemini_output(&vid, &input)));
        prop_assert_eq!(normalize(&base), base.clone());
        let alt = normalize(&errors_to_value(&validate_gemini_output(&vid, &reorder(&input, k))));
        prop_assert_eq!(alt, base);
    }

    /// Property 6: selection validator output canonical form is stable.
    #[test]
    fn selection_output_is_canonical_and_key_order_invariant(
        vid in "[a-z0-9-]{1,12}",
        input in valid_selection_input(),
        k in 1usize..8,
    ) {
        let base = normalize(&errors_to_value(&validate_selection(&vid, &input)));
        prop_assert_eq!(normalize(&base), base.clone());
        let alt = normalize(&errors_to_value(&validate_selection(&vid, &reorder(&input, k))));
        prop_assert_eq!(alt, base);
    }

    /// Property 6: rule-evaluation validator output canonical form is stable.
    #[test]
    fn rule_results_output_is_canonical_and_key_order_invariant(
        vid in "[a-z0-9-]{1,12}",
        input in valid_rule_input(),
        k in 1usize..8,
    ) {
        let base = normalize(&errors_to_value(&validate_rule_results(&vid, &input)));
        prop_assert_eq!(normalize(&base), base.clone());
        let alt = normalize(&errors_to_value(&validate_rule_results(&vid, &reorder(&input, k))));
        prop_assert_eq!(alt, base);
    }

    /// Property 6: LAAJ validator output canonical form is stable.
    #[test]
    fn laaj_results_output_is_canonical_and_key_order_invariant(
        vid in "[a-z0-9-]{1,12}",
        input in valid_laaj_input(),
        k in 1usize..8,
    ) {
        let base = normalize(&errors_to_value(&validate_laaj_results(&vid, &input)));
        prop_assert_eq!(normalize(&base), base.clone());
        let alt = normalize(&errors_to_value(&validate_laaj_results(&vid, &reorder(&input, k))));
        prop_assert_eq!(alt, base);
    }

    /// Property 6: cross-validation output canonical form is stable under
    /// reordering of both the rule and LAAJ input dict keys.
    #[test]
    fn cross_validate_output_is_canonical_and_key_order_invariant(
        vid in "[a-z0-9-]{1,12}",
        rule_input in valid_rule_input(),
        laaj_input in valid_laaj_input(),
        k in 1usize..8,
    ) {
        let base = normalize(&errors_to_value(&cross_validate(&vid, &rule_input, &laaj_input)));
        prop_assert_eq!(normalize(&base), base.clone());
        let alt = normalize(&errors_to_value(&cross_validate(
            &vid,
            &reorder(&rule_input, k),
            &reorder(&laaj_input, k),
        )));
        prop_assert_eq!(alt, base);
    }

    /// Property 6: transform validator output canonical form is stable under
    /// reordering of each record's dict keys.
    #[test]
    fn transform_output_is_canonical_and_key_order_invariant(
        vid in "[a-z0-9-]{1,12}",
        records in valid_transform_input(),
        k in 1usize..8,
    ) {
        let base = normalize(&errors_to_value(&validate_transform_output(&vid, &records)));
        prop_assert_eq!(normalize(&base), base.clone());
        let alt = normalize(&errors_to_value(&validate_transform_output(
            &vid,
            &reorder_records(&records, k),
        )));
        prop_assert_eq!(alt, base);
    }
}
