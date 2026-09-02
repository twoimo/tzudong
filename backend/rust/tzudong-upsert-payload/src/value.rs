//! Python-parity value model and canonical JSON serializer for the
//! R3-upsert-payload slice.
//!
//! The stable hash reuses `state_machine.py:payload_hash`, which is
//! `json.dumps(payload, sort_keys=True, separators=(",", ":"),
//! ensure_ascii=True)` fed to SHA-256 (design D6). To reproduce that byte string
//! exactly, this module models Python JSON values and serializes them with the
//! same key ordering, separators, and non-ASCII escaping.

/// A JSON-ish Python value, as it appears in an upsert payload.
///
/// Dicts are kept as an insertion-ordered `Vec` of pairs; canonical
/// serialization sorts the keys, so insertion order does not affect the hash.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    None,
    Bool(bool),
    Int(i64),
    Float(f64),
    Str(String),
    List(Vec<Value>),
    Dict(Vec<(String, Value)>),
}

impl Value {
    /// Serialize to the canonical JSON string that `payload_hash` hashes:
    /// `sort_keys=True`, `separators=(",", ":")`, `ensure_ascii=True`.
    pub fn to_canonical_json(&self) -> String {
        let mut out = String::new();
        self.write_canonical(&mut out);
        out
    }

    fn write_canonical(&self, out: &mut String) {
        match self {
            Value::None => out.push_str("null"),
            Value::Bool(true) => out.push_str("true"),
            Value::Bool(false) => out.push_str("false"),
            Value::Int(i) => out.push_str(&i.to_string()),
            Value::Float(f) => out.push_str(&py_json_float(*f)),
            Value::Str(s) => write_json_string(s, out),
            Value::List(items) => {
                out.push('[');
                for (idx, item) in items.iter().enumerate() {
                    if idx > 0 {
                        out.push(',');
                    }
                    item.write_canonical(out);
                }
                out.push(']');
            }
            Value::Dict(pairs) => {
                // sort_keys=True: sort by the (Unicode) key. Rust String Ord is
                // by UTF-8 bytes, which equals code-point order for valid UTF-8,
                // matching CPython's sorted() on str keys.
                let mut sorted: Vec<&(String, Value)> = pairs.iter().collect();
                sorted.sort_by(|a, b| a.0.cmp(&b.0));
                out.push('{');
                for (idx, (k, v)) in sorted.iter().enumerate() {
                    if idx > 0 {
                        out.push(',');
                    }
                    write_json_string(k, out);
                    out.push(':');
                    v.write_canonical(out);
                }
                out.push('}');
            }
        }
    }
}

/// `ensure_ascii=True` string escaping, matching CPython's `json.encoder`.
///
/// ASCII control chars use the short escapes where defined (`\b \t \n \f \r`),
/// other controls and every non-ASCII code point use `\uXXXX` (with surrogate
/// pairs for astral code points), and `"`/`\` are backslash-escaped.
fn write_json_string(s: &str, out: &mut String) {
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c if (c as u32) < 0x7f => out.push(c),
            c => {
                let cp = c as u32;
                if cp <= 0xFFFF {
                    out.push_str(&format!("\\u{:04x}", cp));
                } else {
                    // UTF-16 surrogate pair, as CPython emits for astral chars.
                    let v = cp - 0x10000;
                    let hi = 0xD800 + (v >> 10);
                    let lo = 0xDC00 + (v & 0x3FF);
                    out.push_str(&format!("\\u{:04x}\\u{:04x}", hi, lo));
                }
            }
        }
    }
    out.push('"');
}

/// Best-effort port of CPython's `float.__repr__` for JSON output.
///
/// Divergence note: CPython uses the shortest round-tripping repr and emits
/// scientific notation with a two-digit exponent (`1e+16`, `1e-05`). This
/// implementation covers the finite non-scientific range that restaurant
/// coordinates and scores occupy. Values that would require CPython's
/// scientific formatting fall outside the declared parity domain (design C1:
/// the Parity_Harness constrains generators to the real input space and records
/// a mismatch otherwise rather than silently diverging).
fn py_json_float(f: f64) -> String {
    // json.dumps emits Infinity / -Infinity / NaN (non-standard JSON) for these.
    if f.is_nan() {
        return "NaN".to_string();
    }
    if f.is_infinite() {
        return if f > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
    }
    let s = format!("{}", f);
    if s.contains('.') || s.contains('e') || s.contains('E') {
        s
    } else {
        // Integral float: CPython repr shows a trailing ".0" (40.0 -> "40.0").
        format!("{}.0", s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sorts_object_keys() {
        let v = Value::Dict(vec![
            ("b".into(), Value::Int(2)),
            ("a".into(), Value::Int(1)),
        ]);
        assert_eq!(v.to_canonical_json(), r#"{"a":1,"b":2}"#);
    }

    #[test]
    fn compact_separators_and_scalars() {
        let v = Value::Dict(vec![
            ("n".into(), Value::None),
            ("t".into(), Value::Bool(true)),
            ("f".into(), Value::Bool(false)),
            ("list".into(), Value::List(vec![Value::Int(1), Value::Str("x".into())])),
        ]);
        assert_eq!(
            v.to_canonical_json(),
            r#"{"f":false,"list":[1,"x"],"n":null,"t":true}"#
        );
    }

    #[test]
    fn escapes_non_ascii_and_controls() {
        let v = Value::Str("한글\n\"\\\t".into());
        assert_eq!(
            v.to_canonical_json(),
            r#""\ud55c\uae00\n\"\\\t""#
        );
    }

    #[test]
    fn escapes_astral_surrogate_pair() {
        // U+1F600 GRINNING FACE -> \ud83d\ude00
        let v = Value::Str("\u{1F600}".into());
        assert_eq!(v.to_canonical_json(), r#""\ud83d\ude00""#);
    }

    #[test]
    fn integral_float_has_trailing_zero() {
        assert_eq!(Value::Float(40.0).to_canonical_json(), "40.0");
        assert_eq!(Value::Float(37.5).to_canonical_json(), "37.5");
    }
}
