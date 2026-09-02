//! PyO3 extension-module binding for Migration_Slice R4-media-compute.
//!
//! Compiled only under the `python` feature (maturin build). Exposes the pure
//! chunk-planning helpers as the `tzudong_media_compute` extension module.
//! `chunk_planner.py` imports this module through the Implementation_Selector
//! without changing its public signatures or moving ffmpeg orchestration / file
//! I/O out of Python (requirements 1.1, 1.3).

use pyo3::prelude::*;
use pyo3::types::{PyDict, PyList};

use crate::{Chunk, Segment};

/// Convert a Python `Segment` mapping (`{start, duration, text}`) into the Rust
/// model. `start` and `text` follow the accessors the Python functions use;
/// `duration` is `None` when absent or `None`.
fn segment_from_py(obj: &Bound<'_, PyAny>) -> PyResult<Segment> {
    let start = obj.get_item("start")?.extract::<f64>()?;
    let duration = match obj.get_item("duration") {
        Ok(v) if !v.is_none() => Some(v.extract::<f64>()?),
        _ => None,
    };
    let text = match obj.get_item("text") {
        Ok(v) if !v.is_none() => v.extract::<String>()?,
        _ => String::new(),
    };
    Ok(Segment {
        start,
        duration,
        text,
    })
}

fn segments_from_py(obj: &Bound<'_, PyAny>) -> PyResult<Vec<Segment>> {
    let list = obj.cast::<PyList>().map_err(PyErr::from)?;
    let mut out = Vec::with_capacity(list.len());
    for item in list.iter() {
        out.push(segment_from_py(&item)?);
    }
    Ok(out)
}

fn chunk_to_py<'py>(py: Python<'py>, chunk: &Chunk) -> PyResult<Bound<'py, PyDict>> {
    let dict = PyDict::new(py);
    dict.set_item("chunk_index", chunk.chunk_index)?;
    dict.set_item("start_sec", chunk.start_sec)?;
    dict.set_item("end_sec", chunk.end_sec)?;
    dict.set_item("transcript_text", &chunk.transcript_text)?;
    Ok(dict)
}

#[pyfunction]
fn format_time(seconds: f64) -> String {
    crate::format_time(seconds)
}

#[pyfunction]
fn compute_chunk_duration(total_duration: f64) -> f64 {
    crate::compute_chunk_duration(total_duration)
}

#[pyfunction]
#[pyo3(signature = (target_sec, segments, tolerance=crate::DEFAULT_ALIGN_TOLERANCE))]
fn align_to_subtitle_boundary(
    target_sec: f64,
    segments: Bound<'_, PyAny>,
    tolerance: f64,
) -> PyResult<f64> {
    let segs = segments_from_py(&segments)?;
    Ok(crate::align_to_subtitle_boundary(target_sec, &segs, tolerance))
}

#[pyfunction]
fn format_transcript_range(
    segments: Bound<'_, PyAny>,
    start_sec: f64,
    end_sec: f64,
) -> PyResult<String> {
    let segs = segments_from_py(&segments)?;
    Ok(crate::format_transcript_range(&segs, start_sec, end_sec))
}

/// `plan_chunks(video_id, duration, segments, overlap_sec=10.0) -> list[dict]`.
///
/// `video_id` is accepted to keep the Python signature identical but is not
/// used in the computation (it is not in the Python function body either).
#[pyfunction]
#[pyo3(signature = (video_id, duration, segments, overlap_sec=crate::DEFAULT_OVERLAP_SEC))]
fn plan_chunks<'py>(
    py: Python<'py>,
    video_id: &str,
    duration: f64,
    segments: Bound<'py, PyAny>,
    overlap_sec: f64,
) -> PyResult<Bound<'py, PyList>> {
    let _ = video_id;
    let segs = segments_from_py(&segments)?;
    let chunks = crate::plan_chunks(duration, &segs, overlap_sec);
    let out = PyList::empty(py);
    for chunk in &chunks {
        out.append(chunk_to_py(py, chunk)?)?;
    }
    Ok(out)
}

/// The `tzudong_media_compute` extension module.
#[pymodule]
fn tzudong_media_compute(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add("CRATE_NAME", crate::CRATE_NAME)?;
    m.add_function(wrap_pyfunction!(format_time, m)?)?;
    m.add_function(wrap_pyfunction!(compute_chunk_duration, m)?)?;
    m.add_function(wrap_pyfunction!(align_to_subtitle_boundary, m)?)?;
    m.add_function(wrap_pyfunction!(format_transcript_range, m)?)?;
    m.add_function(wrap_pyfunction!(plan_chunks, m)?)?;
    Ok(())
}
