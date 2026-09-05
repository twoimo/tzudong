//! PyO3 extension-module binding for Migration_Slice R5-pipeline-graph.
//!
//! Compiled only under the `python` feature (maturin build). Exposes the pure
//! graph-composition and state-transition helpers as the
//! `tzudong_pipeline_graph` extension module. `graph.py` / `state_machine.py`
//! import this module through the Implementation_Selector without changing
//! their public signatures or moving filesystem/clock work out of Python
//! (requirements 1.1, 1.3).
//!
//! Fixed error codes are surfaced by raising `ValueError(code)`, mirroring the
//! Python `AdapterGraphError(code)` / `ControlPlaneError(code)` raises so the
//! Parity_Harness observes identical fixed codes (requirement 2.8).

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;

use crate::{graph, state};

// --- graph.py ---------------------------------------------------------------

#[pyfunction]
fn adapter_steps() -> Vec<&'static str> {
    graph::adapter_steps()
}

#[pyfunction]
fn step_class(step_id: &str) -> PyResult<&'static str> {
    graph::step_class(step_id).map_err(PyValueError::new_err)
}

#[pyfunction]
fn validate_step_classes() -> PyResult<()> {
    graph::validate_step_classes().map_err(PyValueError::new_err)
}

#[pyfunction]
fn validate_graph_pure() -> PyResult<()> {
    graph::validate_graph_pure().map_err(PyValueError::new_err)
}

// --- state_machine.py -------------------------------------------------------

#[pyfunction]
fn lock_key(target: &str, profile: &str) -> String {
    state::lock_key(target, profile)
}

#[pyfunction]
fn can_pause(status: &str) -> bool {
    state::can_pause(status)
}

#[pyfunction]
fn can_cancel(status: &str) -> bool {
    state::can_cancel(status)
}

#[pyfunction]
fn can_resume(status: &str) -> bool {
    state::can_resume(status)
}

#[pyfunction]
fn heartbeat_allowed(status: &str) -> bool {
    state::heartbeat_allowed(status)
}

/// `apply_transition_status(status, action) -> str` — the resulting status, or
/// `ValueError("illegal_transition")` for an illegal pair.
#[pyfunction]
fn apply_transition_status(status: &str, action: &str) -> PyResult<&'static str> {
    state::apply_transition_status(status, action).map_err(PyValueError::new_err)
}

#[pyfunction]
fn stale_reclaim_eligible(status: &str, now: f64, lease_until: f64) -> bool {
    state::stale_reclaim_eligible(status, now, lease_until)
}

/// The `tzudong_pipeline_graph` extension module.
#[pymodule]
fn tzudong_pipeline_graph(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add("CRATE_NAME", crate::CRATE_NAME)?;
    // graph
    m.add_function(wrap_pyfunction!(adapter_steps, m)?)?;
    m.add_function(wrap_pyfunction!(step_class, m)?)?;
    m.add_function(wrap_pyfunction!(validate_step_classes, m)?)?;
    m.add_function(wrap_pyfunction!(validate_graph_pure, m)?)?;
    // state_machine
    m.add_function(wrap_pyfunction!(lock_key, m)?)?;
    m.add_function(wrap_pyfunction!(can_pause, m)?)?;
    m.add_function(wrap_pyfunction!(can_cancel, m)?)?;
    m.add_function(wrap_pyfunction!(can_resume, m)?)?;
    m.add_function(wrap_pyfunction!(heartbeat_allowed, m)?)?;
    m.add_function(wrap_pyfunction!(apply_transition_status, m)?)?;
    m.add_function(wrap_pyfunction!(stale_reclaim_eligible, m)?)?;
    Ok(())
}
