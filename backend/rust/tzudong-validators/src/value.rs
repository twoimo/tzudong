//! Python-parity value model for the R1-validators slice.
//!
//! The Python validators operate on arbitrary decoded JSON-ish payloads
//! (dicts, lists, strings, ints, floats, bools, None). To reproduce their
//! behavior *exactly* — including the `bool` vs `int` distinction, Python
//! `float()` coercion, truthiness, and `.get(key, default)` semantics — this
//! module defines a self-contained [`Value`] type that is independent of PyO3.
//!
//! Keeping the value model free of PyO3 lets the pure logic and its unit tests
//! compile and run with `cargo test` (default features) on any host, while the
//! optional binding layer in `src/python.rs` converts `PyAny <-> Value`.

/// A Python object as seen by the validators.
///
/// Dicts preserve insertion order (a `Vec` of pairs) to mirror CPython 3.7+
/// dict ordering, which several validators rely on when iterating `.items()`.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    None,
    Bool(bool),
    Int(i64),
    Float(f64),
    Str(String),
    List(Vec<Value>),
    Dict(Vec<(String, Value)>),
    /// Any Python type not modeled above. Carries the Python type name
    /// (e.g. `"tuple"`) so `isinstance(...)`-style checks still fail correctly.
    Other(String),
}

static NONE_VALUE: Value = Value::None;

impl Value {
    /// Python `bool(x)` truthiness.
    pub fn truthy(&self) -> bool {
        match self {
            Value::None => false,
            Value::Bool(b) => *b,
            Value::Int(i) => *i != 0,
            Value::Float(f) => *f != 0.0,
            Value::Str(s) => !s.is_empty(),
            Value::List(l) => !l.is_empty(),
            Value::Dict(d) => !d.is_empty(),
            Value::Other(_) => true,
        }
    }

    /// Strict identity with Python `True` (`x is True`), not merely truthy.
    pub fn is_true(&self) -> bool {
        matches!(self, Value::Bool(true))
    }

    /// Strict identity with Python `False` (`x is False`).
    pub fn is_false(&self) -> bool {
        matches!(self, Value::Bool(false))
    }

    /// Python `x is None`.
    pub fn is_none(&self) -> bool {
        matches!(self, Value::None)
    }

    pub fn is_list(&self) -> bool {
        matches!(self, Value::List(_))
    }

    pub fn is_dict(&self) -> bool {
        matches!(self, Value::Dict(_))
    }

    /// Python `isinstance(x, bool)`.
    pub fn is_bool(&self) -> bool {
        matches!(self, Value::Bool(_))
    }

    /// Python `isinstance(x, str)`.
    pub fn is_str(&self) -> bool {
        matches!(self, Value::Str(_))
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::Str(s) => Some(s.as_str()),
            _ => None,
        }
    }

    /// Python `type(x).__name__` for the builtin types we model.
    pub fn type_name(&self) -> &str {
        match self {
            Value::None => "NoneType",
            Value::Bool(_) => "bool",
            Value::Int(_) => "int",
            Value::Float(_) => "float",
            Value::Str(_) => "str",
            Value::List(_) => "list",
            Value::Dict(_) => "dict",
            Value::Other(name) => name.as_str(),
        }
    }

    /// `dict.get(key)` — returns `None` (as [`Value::None`]) if the key is
    /// absent or the receiver is not a dict.
    pub fn get(&self, key: &str) -> &Value {
        match self {
            Value::Dict(items) => items
                .iter()
                .find(|(k, _)| k == key)
                .map(|(_, v)| v)
                .unwrap_or(&NONE_VALUE),
            _ => &NONE_VALUE,
        }
    }

    /// `dict.get(key)` returning `Some` only when the key is actually present.
    /// Used to distinguish "key missing" from "value is None" and to implement
    /// `dict.get(key, default)`.
    pub fn get_opt(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Dict(items) => items.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    /// Python `key in dict`.
    pub fn contains_key(&self, key: &str) -> bool {
        self.get_opt(key).is_some()
    }

    /// Iterator over dict keys (empty if not a dict).
    pub fn dict_keys(&self) -> impl Iterator<Item = &String> {
        let empty: &[(String, Value)] = &[];
        let items: &[(String, Value)] = match self {
            Value::Dict(items) => items.as_slice(),
            _ => empty,
        };
        items.iter().map(|(k, _)| k)
    }

    /// Python `float(x)`. `Err(())` models both `ValueError` and `TypeError`,
    /// which the validators always catch with a single `except`.
    pub fn py_float(&self) -> Result<f64, ()> {
        match self {
            Value::Bool(b) => Ok(if *b { 1.0 } else { 0.0 }),
            Value::Int(i) => Ok(*i as f64),
            Value::Float(f) => Ok(*f),
            Value::Str(s) => {
                let trimmed = s.trim();
                match trimmed.to_ascii_lowercase().as_str() {
                    "inf" | "+inf" | "infinity" | "+infinity" => Ok(f64::INFINITY),
                    "-inf" | "-infinity" => Ok(f64::NEG_INFINITY),
                    "nan" | "+nan" | "-nan" => Ok(f64::NAN),
                    _ => trimmed.parse::<f64>().map_err(|_| ()),
                }
            }
            _ => Err(()),
        }
    }

    /// Number of Unicode code points, matching Python `len(str)`.
    pub fn char_len(&self) -> usize {
        match self {
            Value::Str(s) => s.chars().count(),
            _ => 0,
        }
    }
}

/// First `n` Unicode code points, matching Python `s[:n]` slicing.
pub fn char_prefix(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// Python `str(x)` for f-string interpolation of scalar values, with a
/// best-effort container representation.
///
/// Divergence note: very large/small floats use Rust's `Display`, which does
/// not emit scientific notation the way CPython's `repr` does. Coordinate and
/// score magnitudes in this slice never reach that range, and the Parity_Harness
/// (task 43) normalizes message text, so this stays within the declared parity
/// contract.
pub fn py_str(v: &Value) -> String {
    match v {
        Value::None => "None".to_string(),
        Value::Bool(true) => "True".to_string(),
        Value::Bool(false) => "False".to_string(),
        Value::Int(i) => i.to_string(),
        Value::Float(f) => py_float_repr(*f),
        Value::Str(s) => s.clone(),
        Value::List(items) => {
            let inner: Vec<String> = items.iter().map(py_repr).collect();
            format!("[{}]", inner.join(", "))
        }
        Value::Dict(items) => {
            let inner: Vec<String> = items
                .iter()
                .map(|(k, val)| format!("'{}': {}", k, py_repr(val)))
                .collect();
            format!("{{{}}}", inner.join(", "))
        }
        Value::Other(name) => format!("<{}>", name),
    }
}

/// Python `repr(x)` (used for members inside container `str()`).
pub fn py_repr(v: &Value) -> String {
    match v {
        Value::Str(s) => format!("'{}'", s),
        _ => py_str(v),
    }
}

/// Python `str(float)` — always shows a fractional part for integral values
/// (`40.0` -> "40.0"), unlike Rust's default `Display`.
pub fn py_float_repr(f: f64) -> String {
    if f.is_nan() {
        return "nan".to_string();
    }
    if f.is_infinite() {
        return if f > 0.0 { "inf" } else { "-inf" }.to_string();
    }
    let s = format!("{}", f);
    if s.contains('.') || s.contains('e') || s.contains('E') {
        s
    } else {
        format!("{}.0", s)
    }
}
