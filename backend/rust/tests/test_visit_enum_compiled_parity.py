"""Exact visit-result parity against the compiled, dependency-free Rust core.

This supplements the PyO3 suite when its optional dependencies are unavailable.
It neither installs a toolchain nor changes the production dispatch selection.
"""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from backend.pipeline import validators
from backend.pipeline_control.impl_selector import python_reference

ROOT = Path(__file__).resolve().parents[3]
PIN = '1.97.0'
DRIVER = r'''
extern crate continuity_validators as core;
use core::value::Value;
fn json(v: &Value) -> String {
    match v {
        Value::None => "null".into(),
        Value::Str(s) => format!("{:?}", s),
        Value::List(xs) => format!("[{}]", xs.iter().map(json).collect::<Vec<_>>().join(",")),
        Value::Dict(xs) => format!("{{{}}}", xs.iter().map(|(k,v)| format!("{:?}:{}",k,json(v))).collect::<Vec<_>>().join(",")),
        _ => panic!("unexpected error-output field"),
    }
}
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let value = match args[1].as_str() {
        "none" => Value::None,
        "bool" => Value::Bool(args[2] == "true"),
        "str" => Value::Str(args[2].clone()),
        "float" => Value::Float(args[2].parse().unwrap()),
        "int" => args[2].parse::<i64>().map(Value::Int).unwrap_or(Value::Other("int".into())),
        _ => panic!("invalid fixture kind"),
    };
    let item = |value, basis: &str| Value::List(vec![Value::Dict(vec![
        ("name".into(), Value::Str("fixture".into())),
        ("eval_value".into(), value), ("eval_basis".into(), Value::Str(basis.into())),
    ])]);
    let visit = item(value, if args[4] == "short" { "" } else { "충분한 근거 문장" });
    let visit = if args[3] == "wrapped" { Value::Dict(vec![("values".into(), visit)]) } else { visit };
    let data = Value::Dict(vec![("evaluation_results".into(), Value::Dict(vec![
        ("visit_authenticity".into(), visit),
        ("rb_inference_score".into(), item(Value::Float(1.5), "충분한 근거 문장")),
        ("review_faithfulness_score".into(), item(Value::Float(0.5), "충분한 근거 문장")),
        ("rb_grounding_TF".into(), Value::List(vec![])),
        ("category_TF".into(), Value::List(vec![])),
    ]))]);
    let errors = core::validators::validate_laaj_results("fixture", &data);
    println!("{}", json(&core::errors::errors_to_value(&errors)));
}
'''


class CompiledVisitEnumParityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not shutil.which('rustup') or not shutil.which('rustc'):
            raise unittest.SkipTest('pinned Rust compiler unavailable')
        installed = subprocess.run(['rustup', 'toolchain', 'list'], capture_output=True, text=True, check=True)
        if not any(line.startswith(PIN + '-') for line in installed.stdout.splitlines()):
            raise unittest.SkipTest('pinned Rust compiler not installed; no download attempted')
        cls.scratch = tempfile.TemporaryDirectory(prefix='visit-enum-parity-')
        cls.addClassCleanup(cls.scratch.cleanup)
        directory = Path(cls.scratch.name)
        library = directory / 'libcontinuity_validators.rlib'
        driver = directory / 'driver.rs'
        cls.executable = directory / 'driver'
        driver.write_text(DRIVER)
        for command in (
            ['rustc', '+' + PIN, '--edition=2021', '--crate-name', 'continuity_validators', '--crate-type', 'rlib',
             str(ROOT / 'backend/rust/tzudong-validators/src/lib.rs'), '-o', str(library)],
            ['rustc', '+' + PIN, '--edition=2021', str(driver), '--extern', f'continuity_validators={library}',
             '-o', str(cls.executable)],
        ):
            subprocess.run(command, check=True, capture_output=True, text=True, timeout=60)

    def test_exact_error_fields_and_order_for_integer_enum_and_invalid_codes(self):
        values = list(range(5)) + [None, True, False, '1', 1.0, 1.5, -1, 5,
                                  10 ** 100, 10 ** 400, float('nan'), float('inf'), -float('inf')]
        for value in values:
            kind = {type(None): 'none', bool: 'bool', str: 'str', float: 'float', int: 'int'}[type(value)]
            for wrapped in (False, True):
                for short_basis in (False, True):
                    basis = '' if short_basis else '충분한 근거 문장'
                    def items(v):
                        return [{'name': 'fixture', 'eval_value': v, 'eval_basis': '충분한 근거 문장'}]
                    visit = [{'name': 'fixture', 'eval_value': value, 'eval_basis': basis}]
                    data = {'evaluation_results': {
                        'visit_authenticity': {'values': visit} if wrapped else visit,
                        'rb_inference_score': items(1.5), 'review_faithfulness_score': items(0.5),
                        'rb_grounding_TF': [], 'category_TF': [],
                    }}
                    with self.subTest(value=value, wrapped=wrapped, short_basis=short_basis), python_reference():
                        actual = subprocess.run([str(self.executable), kind, str(value).lower(),
                                                 'wrapped' if wrapped else 'direct',
                                                 'short' if short_basis else 'long'],
                                                check=True, capture_output=True, text=True, timeout=5)
                        self.assertEqual(validators.validate_laaj_results('fixture', data), json.loads(actual.stdout))
