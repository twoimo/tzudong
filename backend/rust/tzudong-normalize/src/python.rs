//! PyO3 extension-module binding for Migration_Slice R2-normalize.
//!
//! Compiled only under the `python` feature (maturin build). Exposes the pure
//! date-folder helpers as the `tzudong_normalize` extension module. The Python
//! `backend/utils/data_utils.py` helpers can import this module and dispatch to
//! it through the Implementation_Selector without changing any public signature
//! (requirements 1.1, 1.3).

use pyo3::prelude::*;

/// Match with the running Python Unicode database and regex end anchor.
/// Python \d admits Unicode decimal digits and $ admits one final newline.
/// Conversion stays at this boundary; Rust validates the Gregorian date.
#[pyfunction]
fn parse_folder_date(name: Bound<'_, PyAny>) -> PyResult<Option<(i32, u32, u32)>> {
    let py = name.py();
    let matched =
        PyModule::import(py, "re")?.call_method1("match", (r"^(\d{2})-(\d{2})-(\d{2})$", name))?;
    if matched.is_none() {
        return Ok(None);
    }
    let int = PyModule::import(py, "builtins")?.getattr("int")?;
    let mut fields = Vec::new();
    for index in 1..=3 {
        fields.push(
            int.call1((matched.call_method1("group", (index,))?,))?
                .extract::<u32>()?,
        );
    }
    Ok(crate::parse_folder_date(&format!(
        "{:02}-{:02}-{:02}",
        fields[0], fields[1], fields[2]
    )))
}

/// Stable order preserves original Unicode spellings, including equal dates.
#[pyfunction]
fn sort_date_folders(py: Python<'_>, names: Vec<Py<PyAny>>) -> PyResult<Vec<Py<PyAny>>> {
    let mut parsed = Vec::new();
    for name in names {
        if let Some(date) = parse_folder_date(name.bind(py).clone())? {
            parsed.push((date, name));
        }
    }
    parsed.sort_by_key(|(date, _)| *date);
    Ok(parsed.into_iter().map(|(_, name)| name).collect())
}

#[pyfunction]
fn latest_folder(py: Python<'_>, names: Vec<Py<PyAny>>) -> PyResult<Option<Py<PyAny>>> {
    Ok(sort_date_folders(py, names)?.pop())
}

/// The `tzudong_normalize` extension module.
#[pymodule]
fn tzudong_normalize(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add("CRATE_NAME", crate::CRATE_NAME)?;
    m.add_function(wrap_pyfunction!(parse_folder_date, m)?)?;
    m.add_function(wrap_pyfunction!(sort_date_folders, m)?)?;
    m.add_function(wrap_pyfunction!(latest_folder, m)?)?;
    Ok(())
}
