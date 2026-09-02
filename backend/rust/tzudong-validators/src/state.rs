//! Pure constants ported from `backend/pipeline/state.py`.
//!
//! `state.py` is dominated by dataclasses/TypedDicts for the LangGraph runtime
//! (not pure functions). Its pure, portable contributions are the enum string
//! values consumed by the validators and the `create_initial_state` factory.

use crate::value::Value;

/// `ValidationSeverity` string values.
pub mod severity {
    pub const ERROR: &str = "error";
    pub const WARNING: &str = "warning";
    pub const INFO: &str = "info";
}

/// `StepName` string values.
pub mod step_name {
    pub const ENRICH: &str = "enrich";
    pub const GEMINI: &str = "gemini_crawling";
    pub const TARGET: &str = "target_selection";
    pub const RULE: &str = "rule_evaluation";
    pub const LAAJ: &str = "laaj_evaluation";
    pub const TRANSFORM: &str = "transform";
    pub const INSERT: &str = "supabase_insert";
}

/// `ReviewStatus` string values.
pub mod review_status {
    pub const PENDING: &str = "pending";
    pub const APPROVED: &str = "approved";
    pub const REJECTED: &str = "rejected";
    pub const MODIFIED: &str = "modified";
}

/// Port of `state.create_initial_state`. Returns the PipelineState TypedDict as
/// an ordered [`Value::Dict`], preserving the Python key insertion order.
pub fn create_initial_state(
    channel: &str,
    crawling_path: &str,
    evaluation_path: &str,
    dry_run: bool,
    max_videos: i64,
) -> Value {
    let empty_list = || Value::List(Vec::new());
    Value::Dict(vec![
        ("channel".into(), Value::Str(channel.to_string())),
        ("crawling_path".into(), Value::Str(crawling_path.to_string())),
        ("evaluation_path".into(), Value::Str(evaluation_path.to_string())),
        ("dry_run".into(), Value::Bool(dry_run)),
        ("max_videos".into(), Value::Int(max_videos)),
        ("video_ids".into(), empty_list()),
        ("current_step".into(), Value::Str(String::new())),
        ("completed_enrich".into(), empty_list()),
        ("completed_gemini".into(), empty_list()),
        ("completed_target".into(), empty_list()),
        ("completed_rule".into(), empty_list()),
        ("completed_laaj".into(), empty_list()),
        ("completed_transform".into(), empty_list()),
        ("completed_insert".into(), empty_list()),
        ("validation_errors".into(), empty_list()),
        ("review_queue".into(), empty_list()),
        ("failed_video_ids".into(), empty_list()),
        ("total_restaurants".into(), Value::Int(0)),
        ("validated_restaurants".into(), Value::Int(0)),
        ("quality_score".into(), Value::Float(1.0)),
        ("step_timings".into(), empty_list()),
        ("summary".into(), Value::Str(String::new())),
    ])
}
