//! PyO3 extension-module binding for Migration_Slice R3-upsert-payload.
//!
//! Compiled only under the `python` feature (maturin build). Exposes the stable
//! `payload_hash`, the batch-limit guard, and the DB-error classification as
//! the `tzudong_upsert_payload` extension module. `batch_upsert.py` imports this
//! module through the Implementation_Selector without changing its public
//! signature or moving the RPC call out of Python (requirements 1.1, 1.3).

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::{PyBool, PyDict, PyFloat, PyInt, PyList, PyString};

use crate::value::Value;

/// Convert an arbitrary Python object into the parity value model.
///
/// bool is checked before int (Python bool subclasses int). Only the JSON-ish
/// types that appear in an upsert payload are modeled; anything else raises
/// `ValueError`, matching `json.dumps` refusing a non-serializable object.
fn py_to_value(obj: &Bound<'_, PyAny>) -> PyResult<Value> {
    if obj.is_none() {
        return Ok(Value::None);
    }
    if obj.is_instance_of::<PyBool>() {
        return Ok(Value::Bool(obj.extract::<bool>()?));
    }
    if obj.is_instance_of::<PyInt>() {
        return Ok(Value::Int(obj.extract::<i64>()?));
    }
    if obj.is_instance_of::<PyFloat>() {
        return Ok(Value::Float(obj.extract::<f64>()?));
    }
    if obj.is_instance_of::<PyString>() {
        return Ok(Value::Str(obj.extract::<String>()?));
    }
    if obj.is_instance_of::<PyList>() {
        let list = obj.cast::<PyList>().expect("checked is_instance_of PyList");
        let mut out = Vec::with_capacity(list.len());
        for item in list.iter() {
            out.push(py_to_value(&item)?);
        }
        return Ok(Value::List(out));
    }
    if obj.is_instance_of::<PyDict>() {
        let dict = obj.cast::<PyDict>().expect("checked is_instance_of PyDict");
        let mut out: Vec<(String, Value)> = Vec::with_capacity(dict.len());
        for (k, v) in dict.iter() {
            let key = if k.is_instance_of::<PyString>() {
                k.extract::<String>()?
            } else {
                k.str()?.extract::<String>()?
            };
            out.push((key, py_to_value(&v)?));
        }
        return Ok(Value::Dict(out));
    }
    Err(PyValueError::new_err("payload_not_serializable"))
}

/// `payload_hash(payload) -> str` — hex SHA-256 of the canonical JSON.
#[pyfunction]
fn payload_hash(payload: Bound<'_, PyAny>) -> PyResult<String> {
    let value = py_to_value(&payload)?;
    Ok(crate::payload_hash(&value))
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
