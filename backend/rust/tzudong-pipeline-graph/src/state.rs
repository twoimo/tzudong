//! Port of the pure state-transition logic in
//! `backend/pipeline_control/state_machine.py`.
//!
//! The transition predicates, the lock key, and the transition decision are
//! pure. Lease/heartbeat clock arithmetic and the `RunRecord` mutation stay in
//! Python; here the transition is expressed as a status decision plus a
//! legality result.

pub const RUN_STATUSES: [&str; 7] = [
    "Queued",
    "Fetching",
    "Inserting",
    "Paused",
    "Cancelled",
    "Failed",
    "Succeeded",
];

pub const ACTIVE_LOCK_STATUSES: [&str; 4] = ["Queued", "Fetching", "Inserting", "Paused"];
pub const PAUSE_FROM: [&str; 3] = ["Queued", "Fetching", "Inserting"];
pub const CANCEL_FROM: [&str; 4] = ["Queued", "Fetching", "Inserting", "Paused"];

pub const ILLEGAL_TRANSITION: &str = "illegal_transition";

/// Port of `state_machine.lock_key`.
pub fn lock_key(target: &str, profile: &str) -> String {
    format!("{}:{}", target, profile)
}

/// Port of `state_machine.can_pause`.
pub fn can_pause(status: &str) -> bool {
    PAUSE_FROM.contains(&status)
}

/// Port of `state_machine.can_cancel`.
pub fn can_cancel(status: &str) -> bool {
    CANCEL_FROM.contains(&status)
}

/// Port of `state_machine.can_resume`.
pub fn can_resume(status: &str) -> bool {
    status == "Paused"
}

/// Port of `state_machine.heartbeat`'s legality guard: heartbeat is allowed only
/// while the run holds an active lock status.
pub fn heartbeat_allowed(status: &str) -> bool {
    ACTIVE_LOCK_STATUSES.contains(&status)
}

/// Pure decision core of `state_machine.apply_transition`.
///
/// Returns the resulting status for a legal `(status, action)` pair, or
/// `Err(ILLEGAL_TRANSITION)` otherwise. The lease/heartbeat timestamp updates
/// that accompany a legal transition stay in Python (they depend on `now` and
/// `lease_ttl`); this function decides the target status and legality.
pub fn apply_transition_status(status: &str, action: &str) -> Result<&'static str, &'static str> {
    match action {
        "pause" => {
            if can_pause(status) {
                Ok("Paused")
            } else {
                Err(ILLEGAL_TRANSITION)
            }
        }
        "resume" => {
            if can_resume(status) {
                Ok("Queued")
            } else {
                Err(ILLEGAL_TRANSITION)
            }
        }
        "cancel" => {
            if can_cancel(status) {
                Ok("Cancelled")
            } else {
                Err(ILLEGAL_TRANSITION)
            }
        }
        _ => Err(ILLEGAL_TRANSITION),
    }
}

/// Port of `state_machine.stale_reclaim_eligible`.
///
/// A run is reclaimable when it is not `Paused`, is in one of the three active
/// running statuses, and its lease has expired (`now > lease_until`).
pub fn stale_reclaim_eligible(status: &str, now: f64, lease_until: f64) -> bool {
    if status == "Paused" {
        return false;
    }
    if !["Queued", "Fetching", "Inserting"].contains(&status) {
        return false;
    }
    now > lease_until
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lock_key_joins_with_colon() {
        assert_eq!(lock_key("tzuyang", "heavy_local"), "tzuyang:heavy_local");
    }

    #[test]
    fn transition_predicates_match_python_sets() {
        assert!(can_pause("Fetching"));
        assert!(!can_pause("Paused"));
        assert!(can_cancel("Paused"));
        assert!(!can_cancel("Succeeded"));
        assert!(can_resume("Paused"));
        assert!(!can_resume("Queued"));
        assert!(heartbeat_allowed("Paused"));
        assert!(!heartbeat_allowed("Succeeded"));
    }

    #[test]
    fn apply_transition_status_decisions() {
        assert_eq!(apply_transition_status("Fetching", "pause"), Ok("Paused"));
        assert_eq!(apply_transition_status("Paused", "pause"), Err(ILLEGAL_TRANSITION));
        assert_eq!(apply_transition_status("Paused", "resume"), Ok("Queued"));
        assert_eq!(apply_transition_status("Queued", "resume"), Err(ILLEGAL_TRANSITION));
        assert_eq!(apply_transition_status("Paused", "cancel"), Ok("Cancelled"));
        assert_eq!(apply_transition_status("Succeeded", "cancel"), Err(ILLEGAL_TRANSITION));
        assert_eq!(apply_transition_status("Queued", "bogus"), Err(ILLEGAL_TRANSITION));
    }

    #[test]
    fn stale_reclaim_rules() {
        assert!(stale_reclaim_eligible("Fetching", 100.0, 50.0));
        assert!(!stale_reclaim_eligible("Fetching", 40.0, 50.0)); // lease not expired
        assert!(!stale_reclaim_eligible("Paused", 100.0, 50.0)); // paused excluded
        assert!(!stale_reclaim_eligible("Succeeded", 100.0, 50.0)); // terminal excluded
    }
}
