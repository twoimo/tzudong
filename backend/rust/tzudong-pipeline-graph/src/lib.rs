//! Migration_Slice `R5-pipeline-graph` (design C1/D1).
//!
//! Behavioral-parity Rust backing for the declarative graph validation and the
//! state-transition pure logic in `backend/pipeline_control/graph.py` and
//! `backend/pipeline_control/state_machine.py` (requirements 1.1, 1.3).
//!
//! # Boundary and entry points
//!
//! This crate does not change any Python entry point. `graph.py` /
//! `state_machine.py` keep their signatures; the Implementation_Selector
//! (`backend/pipeline_control/impl_selector.py`, task 41) chooses this Rust
//! backing only when the `R5-pipeline-graph` slice is opted in. The default
//! stays Python until the Parity_Harness records N=3 consecutive matches.
//!
//! # Layers
//!
//! * [`graph`] — the declarative step table, capability tags, step-class
//!   composition, and the non-filesystem `validate_graph` checks.
//! * [`state`] — the run-status transition predicates, `lock_key`, the
//!   transition decision, and stale-lease reclaim eligibility.
//!
//! Filesystem checks (`_reject_escape`, `is_file`), env reads
//! (`resolve_python`, `build_argv`), and lease/heartbeat clock arithmetic stay
//! in Python: they are effectful and out of the parity comparison domain.

pub mod graph;
pub mod state;

#[cfg(feature = "python")]
mod python;

/// Crate name used to build the Rust_Component artifact identifier
/// (requirement 2.10).
pub const CRATE_NAME: &str = "tzudong-pipeline-graph";

#[cfg(test)]
mod tests {
    #[test]
    fn crate_name_is_stable() {
        assert_eq!(super::CRATE_NAME, "tzudong-pipeline-graph");
    }
}
