//! Migration_Slice `R2-normalize` (design C1/D1).
//!
//! Behavioral-parity Rust backing for the deterministic normalization /
//! text-parsing helpers in `backend/utils/data_utils.py` (requirements 1.1,
//! 1.3).
//!
//! # Boundary and entry points
//!
//! This crate does not change any Python entry point. `backend/utils` keeps its
//! function signatures; the Implementation_Selector
//! (`backend/pipeline_control/impl_selector.py`, task 41) chooses this Rust
//! backing only when the `R2-normalize` slice is opted in via
//! `TZUDONG_RUST_SLICES`. The default stays Python until the Parity_Harness
//! records N=3 consecutive matches (requirements 1.5, 2.4).
//!
//! # Scope
//!
//! Only the *pure, deterministic* helpers are ported. The date-folder
//! parsing/sorting/latest-selection logic is deterministic and has a natural
//! round-trip property. Filesystem walkers, `mkdir`, env/clock reads
//! (`get_today_folder_name`, `DataPathManager`) stay in Python: they are not
//! pure and are out of the parity comparison domain.
//!
//! # Ported functions (mirror of `data_utils.py`)
//!
//! * [`parse_folder_date`] — `parse_folder_date`: validate the `yy-mm-dd`
//!   pattern and the calendar date, returning `(year, month, day)` or `None`.
//! * [`sort_date_folders`] — the pure core of `get_all_date_folders`: keep only
//!   names that parse to a valid date, ascending by date (stable).
//! * [`latest_folder`] — `get_latest_folder`: the last name after the ascending
//!   sort, or `None` when no candidate parses.

/// Crate name used to build the Rust_Component artifact identifier
/// (`crate name` + built extension module SHA-256; requirement 2.10).
pub const CRATE_NAME: &str = "tzudong-normalize";

#[cfg(feature = "python")]
mod python;

/// A parsed date-folder value: `(year, month, day)` with `year` already
/// expanded from `yy` to `20yy`, mirroring `datetime(match.group(1)+2000, ...)`.
pub type FolderDate = (i32, u32, u32);

/// Port of `data_utils.parse_folder_date`.
///
/// The Python binding first applies Python's Unicode regex/int rules. This
/// kernel receives normalized ASCII fields, then mirrors datetime's check for an
/// out-of-range month/day. This returns `Some((year, month, day))` iff the name
/// matches the pattern *and* forms a real calendar date, else `None`.
pub fn parse_folder_date(folder_name: &str) -> Option<FolderDate> {
    let (y, m, d) = match_pattern(folder_name)?;
    let year = y as i32 + 2000;
    if is_valid_calendar_date(year, m, d) {
        Some((year, m, d))
    } else {
        None
    }
}

/// Match the `^(\d{2})-(\d{2})-(\d{2})$` shape and return the three raw fields
/// as parsed integers. Returns `None` unless every field is exactly two ASCII
/// digits and the two separators are `-`.
fn match_pattern(name: &str) -> Option<(u32, u32, u32)> {
    let bytes = name.as_bytes();
    // "yy-mm-dd" is exactly 8 bytes; all significant chars are ASCII.
    if bytes.len() != 8 {
        return None;
    }
    if bytes[2] != b'-' || bytes[5] != b'-' {
        return None;
    }
    let two = |i: usize| -> Option<u32> {
        let a = bytes[i];
        let b = bytes[i + 1];
        if a.is_ascii_digit() && b.is_ascii_digit() {
            Some(((a - b'0') as u32) * 10 + (b - b'0') as u32)
        } else {
            None
        }
    };
    Some((two(0)?, two(3)?, two(6)?))
}

/// Python `datetime(year, month, day)` validity, including the Gregorian leap
/// rule. `month` must be 1..=12 and `day` must be 1..=days_in_month.
fn is_valid_calendar_date(year: i32, month: u32, day: u32) -> bool {
    if !(1..=12).contains(&month) {
        return false;
    }
    day >= 1 && day <= days_in_month(year, month)
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap_year(year) {
                29
            } else {
                28
            }
        }
        _ => 0,
    }
}

/// Pure core of `data_utils.get_all_date_folders`: given candidate folder names,
/// keep only those that parse to a valid date and return them ascending by date.
///
/// Mirrors Python `list.sort(key=lambda x: x[1])`, which is a stable sort. Ties
/// (two names for the same calendar date, only possible via distinct strings
/// mapping to the same `(y, m, d)` — impossible here since the string form is
/// canonical) preserve input order.
pub fn sort_date_folders(names: &[String]) -> Vec<String> {
    let mut parsed: Vec<(String, FolderDate)> = names
        .iter()
        .filter_map(|name| parse_folder_date(name).map(|d| (name.clone(), d)))
        .collect();
    // Stable sort by the parsed date only, matching the Python key function.
    parsed.sort_by(|a, b| a.1.cmp(&b.1));
    parsed.into_iter().map(|(name, _)| name).collect()
}

/// Port of `data_utils.get_latest_folder`: the most recent valid date-folder
/// name, or `None` when no candidate parses. This is `sort_date_folders(...)`'s
/// last element (`folders[-1][0]`).
pub fn latest_folder(names: &[String]) -> Option<String> {
    sort_date_folders(names).pop()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn crate_name_is_stable() {
        assert_eq!(CRATE_NAME, "tzudong-normalize");
    }

    #[test]
    fn parses_canonical_date_folder() {
        assert_eq!(parse_folder_date("25-12-01"), Some((2025, 12, 1)));
        assert_eq!(parse_folder_date("00-01-31"), Some((2000, 1, 31)));
    }

    #[test]
    fn rejects_malformed_shapes() {
        for bad in [
            "2025-12-01", // four-digit year
            "25-1-01",    // one-digit month
            "25-12-1",    // one-digit day
            "25/12/01",   // wrong separators
            "25-12-01 ",  // trailing space
            "ab-12-01",   // non-digit
            "",
            "25-12-01-0",
        ] {
            assert_eq!(parse_folder_date(bad), None, "expected None for {:?}", bad);
        }
    }

    #[test]
    fn rejects_out_of_range_calendar_dates() {
        assert_eq!(parse_folder_date("25-00-10"), None); // month 0
        assert_eq!(parse_folder_date("25-13-10"), None); // month 13
        assert_eq!(parse_folder_date("25-01-00"), None); // day 0
        assert_eq!(parse_folder_date("25-01-32"), None); // day 32
        assert_eq!(parse_folder_date("25-02-29"), None); // 2025 not leap
        assert_eq!(parse_folder_date("24-02-29"), Some((2024, 2, 29))); // 2024 leap
        assert_eq!(parse_folder_date("00-02-29"), Some((2000, 2, 29))); // 2000 leap (÷400)
    }

    #[test]
    fn sorts_valid_folders_ascending_and_drops_invalid() {
        let names = v(&["25-03-01", "not-a-date", "24-12-31", "25-01-15", "25-13-01"]);
        assert_eq!(
            sort_date_folders(&names),
            v(&["24-12-31", "25-01-15", "25-03-01"])
        );
    }

    #[test]
    fn latest_folder_matches_python_last_element() {
        let names = v(&["25-03-01", "24-12-31", "25-01-15"]);
        assert_eq!(latest_folder(&names), Some("25-03-01".to_string()));
        assert_eq!(latest_folder(&v(&["bogus", ""])), None);
        assert_eq!(latest_folder(&[]), None);
    }
}
