//! PyO3 extension-module binding for Migration_Slice R1-validators.
//!
//! Compiled only under the `python` feature (maturin build). Exposes the six
//! validators plus the two aggregation helpers and `create_initial_state` as
//! the `tzudong_validators` extension module. The functions accept and return
//! ordinary Python objects (dicts, lists, scalars) so the Python package can
//! import this module and dispatch to it through the Implementation_Selector
//! without changing any public signature (requirements 1.1, 1.3).
//!
//! Conversion boundary: [`py_to_value`] maps `PyAny -> value::Value`
//! (bool checked before int, since Python `bool` subclasses `int`), and
//! [`value_to_py`] maps back. This is the only place PyO3 types appear.

use pyo3::prelude::*;
use pyo3::types::{PyBool, PyDict, PyFloat, PyInt, PyList, PyString, PyTuple};

use crate::errors::{self, ValidationError};
use crate::state;
use crate::validators;
use crate::value::Value;

/// Convert an arbitrary Python object into the parity value model.
fn py_to_value(obj: &Bound<'_, PyAny>) -> PyResult<Value> {
    if obj.is_none() {
        return Ok(Value::None);
    }
    // bool must be checked before int: Python bool is a subclass of int.
    if obj.is_instance_of::<PyBool>() {
        return Ok(Value::Bool(obj.extract::<bool>()?));
    }
    if obj.is_instance_of::<PyInt>() {
        if let Ok(n) = obj.extract::<i64>() {
            return Ok(Value::Int(n));
        }
        if let Ok(f) = obj.extract::<f64>() {
            return Ok(Value::Float(f));
        }
        return Ok(Value::Other("int".to_string()));
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
    if obj.is_instance_of::<PyTuple>() {
        // isinstance(x, list) is False for a tuple; model it as Other so the
        // validators' list checks behave identically. Tuples do not appear in
        // the validators' real input domain.
        return Ok(Value::Other("tuple".to_string()));
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
    let type_name = obj.get_type().name()?.to_string();
    Ok(Value::Other(type_name))
}

/// Convert a parity value back into a Python object.
fn value_to_py<'py>(py: Python<'py>, v: &Value) -> PyResult<Bound<'py, PyAny>> {
    Ok(match v {
        Value::None => py.None().into_bound(py),
        Value::Bool(b) => PyBool::new(py, *b).to_owned().into_any(),
        Value::Int(i) => (*i)
            .into_pyobject(py)
            .expect("i64 conversion is infallible")
            .into_any(),
        Value::Float(f) => (*f)
            .into_pyobject(py)
            .expect("f64 conversion is infallible")
            .into_any(),
        Value::Str(s) => PyString::new(py, s).into_any(),
        Value::List(items) => {
            let list = PyList::empty(py);
            for it in items {
                list.append(value_to_py(py, it)?)?;
            }
            list.into_any()
        }
        Value::Dict(pairs) => {
            let dict = PyDict::new(py);
            for (k, val) in pairs {
                dict.set_item(k, value_to_py(py, val)?)?;
            }
            dict.into_any()
        }
        // Other only arises from exotic input types that the validators never
        // place into an output payload; surface the type name as a string.
        Value::Other(name) => PyString::new(py, name).into_any(),
    })
}

fn errors_to_py<'py>(
    py: Python<'py>,
    errs: Vec<ValidationError>,
) -> PyResult<Bound<'py, PyAny>> {
    value_to_py(py, &errors::errors_to_value(&errs))
}

fn as_list(value: Value) -> Vec<Value> {
    match value {
        Value::List(items) => items,
        _ => Vec::new(),
    }
}

#[pyfunction]
fn validate_gemini_output<'py>(
    py: Python<'py>,
    video_id: &str,
    data: Bound<'py, PyAny>,
) -> PyResult<Bound<'py, PyAny>> {
    let value = py_to_value(&data)?;
    errors_to_py(py, validators::validate_gemini_output(video_id, &value))
}

#[pyfunction]
fn validate_selection<'py>(
    py: Python<'py>,
    video_id: &str,
    data: Bound<'py, PyAny>,
) -> PyResult<Bound<'py, PyAny>> {
    let value = py_to_value(&data)?;
    errors_to_py(py, validators::validate_selection(video_id, &value))
}

#[pyfunction]
fn validate_rule_results<'py>(
    py: Python<'py>,
    video_id: &str,
    data: Bound<'py, PyAny>,
) -> PyResult<Bound<'py, PyAny>> {
    let value = py_to_value(&data)?;
    errors_to_py(py, validators::validate_rule_results(video_id, &value))
}

#[pyfunction]
fn validate_laaj_results<'py>(
    py: Python<'py>,
    video_id: &str,
    data: Bound<'py, PyAny>,
) -> PyResult<Bound<'py, PyAny>> {
    let value = py_to_value(&data)?;
    errors_to_py(py, validators::validate_laaj_results(video_id, &value))
}

#[pyfunction]
fn cross_validate<'py>(
    py: Python<'py>,
    video_id: &str,
    rule_data: Bound<'py, PyAny>,
    laaj_data: Bound<'py, PyAny>,
) -> PyResult<Bound<'py, PyAny>> {
    let rule_value = py_to_value(&rule_data)?;
    let laaj_value = py_to_value(&laaj_data)?;
    errors_to_py(
        py,
        validators::cross_validate(video_id, &rule_value, &laaj_value),
    )
}

#[pyfunction]
fn validate_transform_output<'py>(
    py: Python<'py>,
    video_id: &str,
    records: Bound<'py, PyAny>,
) -> PyResult<Bound<'py, PyAny>> {
    let items = as_list(py_to_value(&records)?);
    errors_to_py(py, validators::validate_transform_output(video_id, &items))
}

#[pyfunction]
fn has_blocking_errors(errors: Bound<'_, PyAny>) -> PyResult<bool> {
    let items = as_list(py_to_value(&errors)?);
    Ok(validators::has_blocking_errors(&items))
}

#[pyfunction]
fn error_summary(errors: Bound<'_, PyAny>) -> PyResult<String> {
    let items = as_list(py_to_value(&errors)?);
    Ok(validators::error_summary(&items))
}

#[pyfunction]
#[pyo3(signature = (channel, crawling_path, evaluation_path, dry_run=false, max_videos=-1))]
fn create_initial_state<'py>(
    py: Python<'py>,
    channel: &str,
    crawling_path: &str,
    evaluation_path: &str,
    dry_run: bool,
    max_videos: i64,
) -> PyResult<Bound<'py, PyAny>> {
    value_to_py(
        py,
        &state::create_initial_state(channel, crawling_path, evaluation_path, dry_run, max_videos),
    )
}

/// The `tzudong_validators` extension module.
#[pymodule]
fn tzudong_validators(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add("CRATE_NAME", crate::CRATE_NAME)?;
    m.add_function(wrap_pyfunction!(validate_gemini_output, m)?)?;
    m.add_function(wrap_pyfunction!(validate_selection, m)?)?;
    m.add_function(wrap_pyfunction!(validate_rule_results, m)?)?;
    m.add_function(wrap_pyfunction!(validate_laaj_results, m)?)?;
    m.add_function(wrap_pyfunction!(cross_validate, m)?)?;
    m.add_function(wrap_pyfunction!(validate_transform_output, m)?)?;
    m.add_function(wrap_pyfunction!(has_blocking_errors, m)?)?;
    m.add_function(wrap_pyfunction!(error_summary, m)?)?;
    m.add_function(wrap_pyfunction!(create_initial_state, m)?)?;
    Ok(())
}
