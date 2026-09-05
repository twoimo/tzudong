//! PyO3 extension-module binding for Migration_Slice R3-upsert-payload.
//!
//! Compiled only under the `python` feature (maturin build). Exposes the stable
//! `payload_hash`, the batch-limit guard, and the DB-error classification as
//! the `tzudong_upsert_payload` extension module. `batch_upsert.py` imports this
//! module through the Implementation_Selector without changing its public
//! signature or moving the RPC call out of Python (requirements 1.1, 1.3).

use pyo3::prelude::*;
use pyo3::types::PyDict;

/// Preserve the running interpreter's complete JSON contract (including float
/// exponent spelling, arbitrary-size ints, tuples and key/error semantics).
/// Canonical serialization remains at the Python boundary; only SHA-256 and
/// the pure batch/error guards are Rust. This is not a serialization speedup.
#[pyfunction]
fn payload_hash(payload: Bound<'_, PyAny>) -> PyResult<String> {
    let py = payload.py();
    let kwargs = PyDict::new(py);
    kwargs.set_item("sort_keys", true)?;
    kwargs.set_item("separators", (",", ":"))?;
    kwargs.set_item("ensure_ascii", true)?;
    let canonical: String = PyModule::import(py, "json")?
        .getattr("dumps")?
        .call((payload,), Some(&kwargs))?
        .extract()?;
    Ok(crate::sha256::sha256_hex(canonical.as_bytes()))
}

/// `check_batch_limit(count) -> str | None`.
///
/// Returns the `batch_upsert_limit` code string when the batch exceeds the
/// limit, else `None`. The Python caller raises `BatchUpsertError(code)`; this
/// keeps the raise semantics in Python and the pure guard in Rust.
#[pyfunction]
fn check_batch_limit(operation_count: usize) -> Option<&'static str> {
    crate::check_batch_limit(operation_count).err()
}

/// `map_db_error(message, pgcode=None) -> str` — the bounded fixed code.
#[pyfunction]
#[pyo3(signature = (message, pgcode=None))]
fn map_db_error(message: &str, pgcode: Option<&str>) -> &'static str {
    crate::map_db_error(message, pgcode)
}

/// The `tzudong_upsert_payload` extension module.
#[pymodule]
fn tzudong_upsert_payload(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add("CRATE_NAME", crate::CRATE_NAME)?;
    m.add("BATCH_LIMIT", crate::BATCH_LIMIT)?;
    m.add_function(wrap_pyfunction!(payload_hash, m)?)?;
    m.add_function(wrap_pyfunction!(check_batch_limit, m)?)?;
    m.add_function(wrap_pyfunction!(map_db_error, m)?)?;
    Ok(())
}
