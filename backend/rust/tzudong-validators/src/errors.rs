//! ValidationError model and builder, mirroring `validators._err`.

use crate::value::Value;

/// A single validation failure. Field order matches the Python dict literal so
/// the serialized output dict has identical key ordering.
#[derive(Debug, Clone, PartialEq)]
pub struct ValidationError {
    pub step: String,
    pub video_id: String,
    /// Raw Python value (usually a string or None), preserved for output parity.
    pub restaurant_name: Value,
    pub severity: String,
    pub rule: String,
    pub message: String,
    pub field_path: String,
    pub actual_value: Value,
}

impl ValidationError {
    /// Construct with the `_err` defaults: `restaurant_name=None`,
    /// `field_path=""`, `actual_value=None`.
    pub fn new(step: &str, video_id: &str, severity: &str, rule: &str, message: String) -> Self {
        ValidationError {
            step: step.to_string(),
            video_id: video_id.to_string(),
            restaurant_name: Value::None,
            severity: severity.to_string(),
            rule: rule.to_string(),
            message,
            field_path: String::new(),
            actual_value: Value::None,
        }
    }

    pub fn with_name(mut self, restaurant_name: Value) -> Self {
        self.restaurant_name = restaurant_name;
        self
    }

    pub fn with_field(mut self, field_path: &str) -> Self {
        self.field_path = field_path.to_string();
        self
    }

    pub fn with_actual(mut self, actual_value: Value) -> Self {
        self.actual_value = actual_value;
        self
    }

    /// Serialize to the `{step, video_id, restaurant_name, severity, rule,
    /// message, field_path, actual_value}` dict, in Python key order.
    pub fn to_value(&self) -> Value {
        Value::Dict(vec![
            ("step".into(), Value::Str(self.step.clone())),
            ("video_id".into(), Value::Str(self.video_id.clone())),
            ("restaurant_name".into(), self.restaurant_name.clone()),
            ("severity".into(), Value::Str(self.severity.clone())),
            ("rule".into(), Value::Str(self.rule.clone())),
            ("message".into(), Value::Str(self.message.clone())),
            ("field_path".into(), Value::Str(self.field_path.clone())),
            ("actual_value".into(), self.actual_value.clone()),
        ])
    }
}

/// Builder mirroring `validators._err`, with explicit defaults at call sites.
#[allow(clippy::too_many_arguments)]
pub fn err(
    step: &str,
    video_id: &str,
    severity: &str,
    rule: &str,
    message: String,
    restaurant_name: Value,
    field_path: &str,
    actual_value: Value,
) -> ValidationError {
    ValidationError {
        step: step.to_string(),
        video_id: video_id.to_string(),
        restaurant_name,
        severity: severity.to_string(),
        rule: rule.to_string(),
        message,
        field_path: field_path.to_string(),
        actual_value,
    }
}

/// Convert a slice of errors to a [`Value::List`] of error dicts.
pub fn errors_to_value(errors: &[ValidationError]) -> Value {
    Value::List(errors.iter().map(ValidationError::to_value).collect())
}
