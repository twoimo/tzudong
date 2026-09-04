//! Migration_Slice `R3-upsert-payload` (design C1/D1).
//!
//! Behavioral-parity Rust backing for the payload-construction and stable-hash
//! portions of `backend/pipeline_control/batch_upsert.py`, reusing the
//! `state_machine.py:payload_hash` canonicalization (design D6). RPC issuance
//! and psycopg2 handling stay in Python (requirements 1.1, 1.3; design C1).
//!
//! # Boundary and entry points
//!
//! This crate does not change any Python entry point. `apply_restaurant_batch`
//! keeps its signature and still issues the `batch_upsert_restaurants` RPC in
//! Python. The Implementation_Selector
//! (`backend/pipeline_control/impl_selector.py`, task 41) chooses this Rust
//! backing only when the `R3-upsert-payload` slice is opted in. The default
//! stays Python until the Parity_Harness records N=3 consecutive matches.
//!
//! # Ported (pure) surface
//!
//! * [`payload_hash`] — `state_machine.py:payload_hash`: canonical JSON +
//!   SHA-256 hex, the stable hash Publish_Preview reuses (design D6).
//! * [`check_batch_limit`] — the `len(operations) > BATCH_LIMIT` guard that
//!   opens `apply_restaurant_batch` (returns the `batch_upsert_limit` code).
//! * [`map_db_error`] — the deterministic message/pgcode classification in
//!   `_map_db_error` (the psycopg2 exception object stays in Python; only the
//!   pure string classification is ported).
//!
//! JSON *parsing* of the RPC result (`_decode_result`) is intentionally left in
//! Python: it is not part of the payload-construction/hash core and would
//! require a full JSON decoder in this slice.

pub mod sha256;
pub mod value;

#[cfg(feature = "python")]
mod python;

pub use value::Value;

/// Crate name used to build the Rust_Component artifact identifier
/// (requirement 2.10).
pub const CRATE_NAME: &str = "tzudong-upsert-payload";

/// `batch_upsert.BATCH_LIMIT`.
pub const BATCH_LIMIT: usize = 200;

// Bounded fixed error codes, mirroring the module constants in batch_upsert.py.
pub const COMPARE_AND_SET_CONFLICT: &str = "compare_and_set_conflict";
pub const CONDITIONAL_WRITE_FAILED: &str = "conditional_write_failed";
pub const BATCH_UPSERT_LIMIT: &str = "batch_upsert_limit";
pub const BATCH_UPSERT_INVALID: &str = "batch_upsert_invalid";

/// Port of `state_machine.payload_hash`.
///
/// `json.dumps(payload, sort_keys=True, separators=(",", ":"),
/// ensure_ascii=True)` encoded as UTF-8 and SHA-256 hex-digested. Identical
/// input sets hash identically; any differing value hashes differently
/// (design D6, requirement 10.4).
pub fn payload_hash(payload: &Value) -> String {
    let canonical = payload.to_canonical_json();
    sha256::sha256_hex(canonical.as_bytes())
}

/// Port of the `len(operations) > BATCH_LIMIT` guard opening
/// `apply_restaurant_batch`.
///
/// Returns `Err(BATCH_UPSERT_LIMIT)` when the batch exceeds 200 rows, else
/// `Ok(())`. The RPC call itself remains in Python.
pub fn check_batch_limit(operation_count: usize) -> Result<(), &'static str> {
    if operation_count > BATCH_LIMIT {
        Err(BATCH_UPSERT_LIMIT)
    } else {
        Ok(())
    }
}

/// Port of `batch_upsert._map_db_error`'s pure classification.
///
/// Given the stringified DB error `message` and the optional `pgcode`, return
/// the bounded fixed code. The substring checks run first in the same order as
/// Python; then `pgcode == "40001"` maps to a serialization conflict; otherwise
/// it falls back to `conditional_write_failed`. Provider/DB text is never
/// surfaced — only the fixed code is returned.
pub fn map_db_error(message: &str, pgcode: Option<&str>) -> &'static str {
    if message.contains("compare_and_set_conflict") {
        return COMPARE_AND_SET_CONFLICT;
    }
    if message.contains("batch_upsert_limit") {
        return BATCH_UPSERT_LIMIT;
    }
    if message.contains("batch_upsert_invalid") {
        return BATCH_UPSERT_INVALID;
    }
    if message.contains("conditional_write_failed") {
        return CONDITIONAL_WRITE_FAILED;
    }
    if pgcode == Some("40001") {
        return COMPARE_AND_SET_CONFLICT;
    }
    CONDITIONAL_WRITE_FAILED
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dict(pairs: Vec<(&str, Value)>) -> Value {
        Value::Dict(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
    }

    #[test]
    fn crate_name_is_stable() {
        assert_eq!(CRATE_NAME, "tzudong-upsert-payload");
    }

    #[test]
    fn payload_hash_matches_hashlib_reference() {
        // sha256 of json.dumps({"a":1,"b":"x"}, sort_keys=True,
        // separators=(",",":"), ensure_ascii=True) == '{"a":1,"b":"x"}'.
        let payload = dict(vec![("b", Value::Str("x".into())), ("a", Value::Int(1))]);
        assert_eq!(payload.to_canonical_json(), r#"{"a":1,"b":"x"}"#);
        assert_eq!(
            payload_hash(&payload),
            sha256::sha256_hex(r#"{"a":1,"b":"x"}"#.as_bytes())
        );
    }

    #[test]
    fn payload_hash_is_key_order_invariant() {
        let a = dict(vec![("x", Value::Int(1)), ("y", Value::Int(2))]);
        let b = dict(vec![("y", Value::Int(2)), ("x", Value::Int(1))]);
        assert_eq!(payload_hash(&a), payload_hash(&b));
    }

    #[test]
    fn payload_hash_changes_when_any_value_changes() {
        let a = dict(vec![("lat", Value::Float(37.5))]);
        let b = dict(vec![("lat", Value::Float(37.6))]);
        assert_ne!(payload_hash(&a), payload_hash(&b));
    }

    #[test]
    fn batch_limit_boundary() {
        assert!(check_batch_limit(0).is_ok());
        assert!(check_batch_limit(BATCH_LIMIT).is_ok());
        assert_eq!(check_batch_limit(BATCH_LIMIT + 1), Err(BATCH_UPSERT_LIMIT));
    }

    #[test]
    fn db_error_classification_matches_python_order() {
        assert_eq!(
            map_db_error("... compare_and_set_conflict ...", None),
            COMPARE_AND_SET_CONFLICT
        );
        assert_eq!(
            map_db_error("batch_upsert_limit exceeded", None),
            BATCH_UPSERT_LIMIT
        );
        assert_eq!(
            map_db_error("batch_upsert_invalid row", None),
            BATCH_UPSERT_INVALID
        );
        assert_eq!(
            map_db_error("conditional_write_failed", None),
            CONDITIONAL_WRITE_FAILED
        );
        assert_eq!(
            map_db_error("deadlock", Some("40001")),
            COMPARE_AND_SET_CONFLICT
        );
        assert_eq!(
            map_db_error("something else", Some("23505")),
            CONDITIONAL_WRITE_FAILED
        );
        assert_eq!(map_db_error("", None), CONDITIONAL_WRITE_FAILED);
    }
}
