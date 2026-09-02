//! Migration_Slice `R4-media-compute` (design C1/D1).
//!
//! Behavioral-parity Rust backing for the frame-selection / metadata-compute
//! pure functions in `backend/restaurant-crawling/scripts/chunk_planner.py`
//! (plus the `format_time` helper imported from
//! `backend/restaurant-crawling/src/utils/chunk_utils.py`) (requirements 1.1,
//! 1.3).
//!
//! # Boundary and entry points
//!
//! This crate does not change any Python entry point. `chunk_planner.py` keeps
//! its CLI, transcript file I/O, and any ffmpeg process orchestration in
//! Python; the Implementation_Selector
//! (`backend/pipeline_control/impl_selector.py`, task 41) chooses this Rust
//! backing only when the `R4-media-compute` slice is opted in. The default
//! stays Python until the Parity_Harness records N=3 consecutive matches.
//!
//! # Ported (pure) surface
//!
//! * [`format_time`] — `chunk_utils.format_time`.
//! * [`compute_chunk_duration`] — `chunk_planner.compute_chunk_duration`.
//! * [`align_to_subtitle_boundary`] — `chunk_planner.align_to_subtitle_boundary`.
//! * [`format_transcript_range`] — `chunk_planner.format_transcript_range`.
//! * [`plan_chunks`] — `chunk_planner.plan_chunks`.
//!
//! Transcript file loading (`load_transcript_segments`) and the CLI stay in
//! Python: they touch the filesystem and are out of the parity domain.

#[cfg(feature = "python")]
mod python;

/// Crate name used to build the Rust_Component artifact identifier
/// (requirement 2.10).
pub const CRATE_NAME: &str = "tzudong-media-compute";

/// A transcript segment, mirroring the `Segment` TypedDict
/// (`{start, duration, text}`). `duration` is optional (JSON `null`).
#[derive(Debug, Clone, PartialEq)]
pub struct Segment {
    pub start: f64,
    pub duration: Option<f64>,
    pub text: String,
}

/// A planned chunk, mirroring the dict `plan_chunks` emits.
#[derive(Debug, Clone, PartialEq)]
pub struct Chunk {
    pub chunk_index: i64,
    pub start_sec: f64,
    pub end_sec: f64,
    pub transcript_text: String,
}

/// Port of Python `round(x, 1)` (round-half-to-even on the true binary value).
///
/// Rust's `{:.1}` formatting rounds a double to one fractional digit with
/// ties-to-even, matching CPython's `round`, which also operates on the true
/// double and breaks ties to even. Re-parsing yields the rounded `f64`.
fn py_round1(x: f64) -> f64 {
    format!("{:.1}", x).parse::<f64>().unwrap_or(x)
}

/// Port of `chunk_utils.format_time`: seconds -> `MM:SS`.
///
/// `minutes = int(seconds // 60)`, `secs = int(seconds % 60)`, both formatted
/// zero-padded to two digits. Inputs are non-negative durations.
pub fn format_time(seconds: f64) -> String {
    let minutes = (seconds / 60.0).floor() as i64;
    // Python float `%` is non-negative for non-negative operands; `as i64`
    // truncates toward zero, matching `int(...)` on that non-negative value.
    let secs = (seconds % 60.0) as i64;
    format!("{:02}:{:02}", minutes, secs)
}

/// Port of `chunk_planner.compute_chunk_duration`.
///
/// Adaptive chunk size: the whole video for <= 1800s, otherwise capped at
/// 1800s. (The `<= 3600` branch and the `else` branch both yield 1800.)
pub fn compute_chunk_duration(total_duration: f64) -> f64 {
    if total_duration <= 1800.0 {
        total_duration
    } else {
        1800.0
    }
}

/// Port of `chunk_planner.align_to_subtitle_boundary`.
///
/// Snap `target_sec` to the nearest segment start within `tolerance`; if there
/// are no segments or none within tolerance, return `target_sec` unchanged.
/// Python `min(..., key=...)` returns the first minimal element on ties, which
/// this reproduces by iterating in order and keeping strictly-smaller updates.
pub fn align_to_subtitle_boundary(target_sec: f64, segments: &[Segment], tolerance: f64) -> f64 {
    if segments.is_empty() {
        return target_sec;
    }
    let mut best: Option<f64> = None;
    for seg in segments {
        if (seg.start - target_sec).abs() <= tolerance {
            match best {
                None => best = Some(seg.start),
                Some(cur) => {
                    if (seg.start - target_sec).abs() < (cur - target_sec).abs() {
                        best = Some(seg.start);
                    }
                }
            }
        }
    }
    best.unwrap_or(target_sec)
}

/// Default tolerance for [`align_to_subtitle_boundary`], matching the Python
/// keyword default (`tolerance=10.0`).
pub const DEFAULT_ALIGN_TOLERANCE: f64 = 10.0;

/// Default overlap for [`plan_chunks`], matching the Python keyword default
/// (`overlap_sec=10.0`).
pub const DEFAULT_OVERLAP_SEC: f64 = 10.0;

/// Port of `chunk_planner.format_transcript_range`.
///
/// Collect `[MM:SS] text` lines for segments overlapping `[start_sec, end_sec)`,
/// stopping at the first segment starting at/after `end_sec`. A segment fully
/// before `start_sec` is skipped when its end (`start + duration`) is at/before
/// `start_sec`; a falsy duration (`None` or `0.0`) is treated as "keep",
/// matching Python `if not seg_dur or seg_start + seg_dur <= start_sec`.
pub fn format_transcript_range(segments: &[Segment], start_sec: f64, end_sec: f64) -> String {
    let mut lines: Vec<String> = Vec::new();
    for seg in segments {
        let seg_start = seg.start;
        if seg_start >= end_sec {
            break;
        }
        if seg_start < start_sec {
            let seg_dur = seg.duration;
            // Python truthiness: `not seg_dur` is true for None or 0.0.
            let falsy_dur = match seg_dur {
                None => true,
                Some(d) => d == 0.0,
            };
            if falsy_dur || seg_start + seg_dur.unwrap_or(0.0) <= start_sec {
                continue;
            }
        }
        lines.push(format!("[{}] {}", format_time(seg_start), seg.text));
    }
    lines.join("\n")
}

/// Port of `chunk_planner.plan_chunks`.
///
/// Split a video into subtitle-aligned chunks with a trailing overlap. Returns
/// a single chunk covering the whole video when the adaptive chunk size is at
/// least the duration.
pub fn plan_chunks(duration: f64, segments: &[Segment], overlap_sec: f64) -> Vec<Chunk> {
    let chunk_sec = compute_chunk_duration(duration);

    if chunk_sec >= duration {
        return vec![Chunk {
            chunk_index: 0,
            start_sec: 0.0,
            end_sec: py_round1(duration),
            transcript_text: format_transcript_range(segments, 0.0, duration),
        }];
    }

    let mut chunks: Vec<Chunk> = Vec::new();
    let mut current_start = 0.0f64;
    let mut chunk_index = 0i64;

    while current_start < duration {
        let mut raw_end = (current_start + chunk_sec + overlap_sec).min(duration);

        let tail = duration - raw_end;
        if tail > 0.0 && tail < 30.0 {
            raw_end = duration;
        }

        let mut aligned_end = if raw_end < duration {
            align_to_subtitle_boundary(raw_end, segments, DEFAULT_ALIGN_TOLERANCE)
        } else {
            duration
        };

        if aligned_end <= current_start {
            aligned_end = raw_end;
        }

        chunks.push(Chunk {
            chunk_index,
            start_sec: py_round1(current_start),
            end_sec: py_round1(aligned_end),
            transcript_text: format_transcript_range(segments, current_start, aligned_end),
        });

        // Pull the next chunk back by overlap_sec for context continuity.
        let next_start = aligned_end - overlap_sec;
        current_start = (current_start + 1.0).max(next_start);

        // Stop if the next start is too close to the end.
        if duration - current_start < 10.0 {
            break;
        }

        chunk_index += 1;
    }

    chunks
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(start: f64, duration: Option<f64>, text: &str) -> Segment {
        Segment {
            start,
            duration,
            text: text.to_string(),
        }
    }

    #[test]
    fn crate_name_is_stable() {
        assert_eq!(CRATE_NAME, "tzudong-media-compute");
    }

    #[test]
    fn format_time_matches_python() {
        assert_eq!(format_time(0.0), "00:00");
        assert_eq!(format_time(9.0), "00:09");
        assert_eq!(format_time(90.7), "01:30");
        assert_eq!(format_time(3661.0), "61:01");
    }

    #[test]
    fn compute_chunk_duration_branches() {
        assert_eq!(compute_chunk_duration(0.0), 0.0);
        assert_eq!(compute_chunk_duration(1800.0), 1800.0);
        assert_eq!(compute_chunk_duration(1800.1), 1800.0);
        assert_eq!(compute_chunk_duration(3600.0), 1800.0);
        assert_eq!(compute_chunk_duration(10000.0), 1800.0);
    }

    #[test]
    fn align_snaps_to_nearest_within_tolerance() {
        let segs = vec![seg(100.0, Some(5.0), "a"), seg(112.0, Some(5.0), "b")];
        // target 110: |100-110|=10 (<=10), |112-110|=2 -> 112 is nearest.
        assert_eq!(align_to_subtitle_boundary(110.0, &segs, 10.0), 112.0);
        // target 200: none within tolerance -> unchanged.
        assert_eq!(align_to_subtitle_boundary(200.0, &segs, 10.0), 200.0);
        // no segments -> unchanged.
        assert_eq!(align_to_subtitle_boundary(50.0, &[], 10.0), 50.0);
    }

    #[test]
    fn align_ties_take_first() {
        // 90 and 110 are both 10 away from 100; first (90) wins.
        let segs = vec![seg(90.0, None, "a"), seg(110.0, None, "b")];
        assert_eq!(align_to_subtitle_boundary(100.0, &segs, 10.0), 90.0);
    }

    #[test]
    fn transcript_range_filters_and_formats() {
        let segs = vec![
            seg(0.0, Some(5.0), "before"),   // ends at 5 <= start 10 -> skipped
            seg(8.0, Some(5.0), "spanning"), // starts before 10 but ends at 13 > 10 -> kept
            seg(20.0, Some(5.0), "inside"),  // kept
            seg(60.0, Some(5.0), "after"),   // >= end 60 -> break
        ];
        let out = format_transcript_range(&segs, 10.0, 60.0);
        assert_eq!(out, "[00:08] spanning\n[00:20] inside");
    }

    #[test]
    fn transcript_range_keeps_falsy_duration_before_start() {
        // duration None -> `not seg_dur` true -> `continue` (skipped).
        let segs = vec![seg(2.0, None, "no-dur"), seg(20.0, Some(1.0), "keep")];
        let out = format_transcript_range(&segs, 10.0, 60.0);
        assert_eq!(out, "[00:20] keep");
    }

    #[test]
    fn plan_chunks_single_chunk_when_short() {
        let segs = vec![seg(0.0, Some(10.0), "hello"), seg(10.0, Some(10.0), "world")];
        let chunks = plan_chunks(30.0, &segs, 10.0);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].chunk_index, 0);
        assert_eq!(chunks[0].start_sec, 0.0);
        assert_eq!(chunks[0].end_sec, 30.0);
        assert_eq!(chunks[0].transcript_text, "[00:00] hello\n[00:10] world");
    }

    #[test]
    fn plan_chunks_splits_long_video() {
        // Duration beyond a single 1800s chunk forces multiple chunks.
        let segs: Vec<Segment> = (0..40)
            .map(|i| seg((i as f64) * 100.0, Some(100.0), "seg"))
            .collect();
        let chunks = plan_chunks(4000.0, &segs, 10.0);
        assert!(chunks.len() >= 2, "expected multiple chunks, got {}", chunks.len());
        assert_eq!(chunks[0].chunk_index, 0);
        assert_eq!(chunks[0].start_sec, 0.0);
        // Chunk indices are contiguous from 0.
        for (i, c) in chunks.iter().enumerate() {
            assert_eq!(c.chunk_index, i as i64);
        }
    }
}
