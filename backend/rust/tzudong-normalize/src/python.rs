//! PyO3 extension-module binding for Migration_Slice R2-normalize.
//!
//! Compiled only under the `python` feature (maturin build). Exposes the pure
//! date-folder helpers as the `tzudong_normalize` extension module. The Python
//! `backend/utils/data_utils.py` helpers can import this module and dispatch to
//! it through the Implementation_Selector without changing any public signature
//! (requirements 1.1, 1.3).

use pyo3::prelude::*;

/// `parse_folder_date(name) -> (year, month, day) | None`.
///
/// Returns a Python tuple `(int, int, int)` for a valid `yy-mm-dd` calendar
/// date, else `None`. The Python caller reconstructs `datetime(...)` from the
/// tuple; the parity comparison uses the tuple form (a non-deterministic
/// `datetime` object identity is out of the comparison domain).
#[pyfunction]
fn parse_folder_date(name: &str) -> Option<(i32, u32, u32)> {
    crate::parse_folder_date(name)
}

/// `sort_date_folders(names) -> list[str]` — valid names, ascending by date.
#[pyfunction]
fn sort_date_folders(names: Vec<String>) -> Vec<String> {
    crate::sort_date_folders(&names)
}

/// `latest_folder(names) -> str | None`.
#[pyfunction]
fn latest_folder(names: Vec<String>) -> Option<String> {
    crate::latest_folder(&names)
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
