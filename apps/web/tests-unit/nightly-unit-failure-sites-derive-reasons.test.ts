import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';

const script = path.resolve('../../.github/scripts/nightly-unit-failure-sites.py');
const file = 'tests-unit/nightly-unit-failure-sites.test.ts';
const canary = 'fixture-private-provider-body-must-never-be-retained';
const suites = (tests: number, failures: number, skipped: number, body: string) =>
  `<testsuites tests="${tests}" failures="${failures}" skipped="${skipped}"><testsuite>${body}</testsuite></testsuites>`;
const pass = `<testcase file="${file}" name="a" line="5"/>`;
const failCase = `<testcase file="${file}" name="${canary}" line="10"><failure message="${canary}">${canary}</failure></testcase>`;
const red = suites(2, 1, 0, pass + failCase);
const clean = suites(1, 0, 0, pass);

function run(payload: unknown) {
  return spawnSync('python3', [script], {
    input: JSON.stringify(payload), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function expectGap(r: ReturnType<typeof run>, reason: string, xml: string, exitCode: number | null = null, signal: number | null = null) {
  expect(r.status).toBe(1);
  const line = r.stdout.trim();
  expect(line.startsWith('NIGHTLY_UNIT_DIAGNOSTIC_GAP=')).toBe(true);
  const gap = JSON.parse(line.slice('NIGHTLY_UNIT_DIAGNOSTIC_GAP='.length));
  expect(gap).toEqual({
    schema: 'nightly-unit-diagnostic-gap-v2', stage: 'derive', reason,
    xml_bytes: Buffer.byteLength(xml, 'utf8'), exit_code: exitCode, signal,
  });
  expect(r.stdout + r.stderr).not.toContain(canary);
}

describe('typed derive rejection reasons (closed enum)', () => {
  const cases: Array<[string, unknown, string, string, number | null, number | null]> = [
    ['bad_input_shape', { xml: red, files: file }, red, red, null, null],
    ['bad_file_entry', { xml: red, files: [file, 42] }, red, red, null, null],
    ['unknown_file', { xml: red, files: ['tests-unit/nope.test.ts'] }, red, red, null, null],
    ['duplicate_file', { xml: red, files: [file, file] }, red, red, null, null],
    ['empty_admitted', { xml: red, files: [] }, red, red, null, null],
    ['doctype_or_entity', { xml: '<!DOCTYPE x>' + red, files: [file] }, '<!DOCTYPE x>' + red, red, null, null],
    ['xml_parse', { xml: '<testsuites', files: [file] }, '<testsuites', '<testsuites', null, null],
    ['root_tag', { xml: '<testsuite/>', files: [file] }, '<testsuite/>', '<testsuite/>', null, null],
    ['unadmitted_case_file', { xml: red.replaceAll(file, 'tests-unit/other.test.ts'), files: [file] }, red.replaceAll(file, 'tests-unit/other.test.ts'), red, null, null],
    ['multi_outcome', { xml: suites(1, 1, 0, `<testcase file="${file}" name="a" line="3"><failure/><skipped/></testcase>`), files: [file] }, suites(1, 1, 0, `<testcase file="${file}" name="a" line="3"><failure/><skipped/></testcase>`), red, null, null],
    ['bad_line', { xml: suites(1, 1, 0, `<testcase file="${file}" name="a" line="NaN"><failure/></testcase>`), files: [file] }, suites(1, 1, 0, `<testcase file="${file}" name="a" line="NaN"><failure/></testcase>`), red, null, null],
    ['line_range', { xml: suites(1, 1, 0, `<testcase file="${file}" name="a" line="0"><failure/></testcase>`), files: [file] }, suites(1, 1, 0, `<testcase file="${file}" name="a" line="0"><failure/></testcase>`), red, null, null],
    ['no_tests', { xml: suites(0, 0, 0, ''), files: [file] }, suites(0, 0, 0, ''), red, null, null],
    ['tests_mismatch', { xml: red.replace('tests="2"', 'tests="9"'), files: [file] }, red.replace('tests="2"', 'tests="9"'), red, null, null],
    ['failures_mismatch', { xml: red.replace('failures="1"', 'failures="0"'), files: [file] }, red.replace('failures="1"', 'failures="0"'), red, null, null],
    ['skipped_mismatch', { xml: clean.replace('skipped="0"', 'skipped="1"'), files: [file] }, clean.replace('skipped="0"', 'skipped="1"'), red, null, null],
    ['exit_code_type', { xml: clean, files: [file], exit_code: 300 }, clean, clean, null, null],
    ['exit_failure_mismatch', { xml: clean, files: [file], exit_code: 1 }, clean, clean, 1, null],
  ];
  for (const [reason, payload, reportXml, , exitCode, signal] of cases) {
    test(`emits exact typed v2 gap for ${reason}`, () => {
      expectGap(run(payload), reason, reportXml, exitCode, signal);
    });
  }

  test('emits max_tests above the admitted test cap', () => {
    const body = Array.from({ length: 10001 }, (_, i) => `<testcase file="${file}" name="t${i}" line="1"/>`).join('');
    const report = suites(10001, 0, 0, body);
    expectGap(run({ xml: report, files: [file] }), 'max_tests', report);
  });

  test('untyped rejection keeps the opaque fallback with no stdout', () => {
    const r = spawnSync('python3', [script], { input: 'not-json', encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr.trim()).toBe('unit_diagnostic_unavailable');
  });

  test('non-DeriveRejected failure at the derive point falls back to the opaque path', () => {
    const probe = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('x', ${JSON.stringify(script)})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
def boom(data, root): raise ValueError('unit_diagnostic_rejected')
m.derive = boom
sys.argv = ['x']
sys.stdin = type('S', (), {'buffer': type('B', (), {'read': lambda self, n: json.dumps({'xml': '<testsuites/>', 'files': ['${file}']}).encode()})()})()
raise SystemExit(m.main())
`;
    const r = spawnSync('python3', ['-c', probe], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr.trim()).toBe('unit_diagnostic_unavailable');
  });
});

describe('gap v2 validation in --log mode', () => {
  const { mkdtempSync, rmdirSync } = require('node:fs') as typeof import('node:fs');
  const os = require('node:os') as typeof import('node:os');
  function withLog(body: string, args: string[] = []) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nightly-unit-gapv2-'));
    const log = path.join(dir, 'unit.log');
    try {
      writeFileSync(log, body, { mode: 0o600 });
      return spawnSync('python3', [script, '--log', log, ...args], { encoding: 'utf8' });
    } finally {
      try { unlinkSync(log); } catch {}
      rmdirSync(dir);
    }
  }
  const v2 = (extra: Record<string, unknown> = {}) => JSON.stringify({
    schema: 'nightly-unit-diagnostic-gap-v2', stage: 'derive', reason: 'tests_mismatch',
    xml_bytes: 1462919, exit_code: 1, signal: null, ...extra,
  });

  test('passes one valid v2 gap through byte-exact', () => {
    if (process.platform === 'win32') return;
    const line = `NIGHTLY_UNIT_DIAGNOSTIC_GAP=${v2()}\n`;
    const r = withLog(line, ['--exit-code', '1']);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe(line);
    expect(r.stderr.trim()).toBe('unit_diagnostic_unavailable');
  });

  test('rejects v2 with unknown reason, extra field, or non-derive stage', () => {
    if (process.platform === 'win32') return;
    for (const bad of [
      v2({ reason: 'made_up_reason' }).replace('tests_mismatch', 'not_a_reason'),
      v2({ raw: canary }),
      v2().replace('"stage":"derive"', '"stage":"spawn"'),
    ]) {
      const r = withLog(`NIGHTLY_UNIT_DIAGNOSTIC_GAP=${bad}\n`);
      expect(r.status).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stdout + r.stderr).not.toContain(canary);
    }
  });
});

describe('real --run-linux path', () => {
  const passProbe = 'tests-unit/zz-extractor-probe-pass.test.ts';
  const throwProbe = 'tests-unit/zz-extractor-probe-throw.test.ts';
  const passPath = path.resolve(passProbe);
  const throwPath = path.resolve(throwProbe);
  function cleanup() {
    for (const p of [passPath, throwPath]) { try { if (existsSync(p)) unlinkSync(p); } catch {} }
  }

  test('spawns bun through the memfd path and derives a real success payload', () => {
    if (process.platform !== 'linux') return;
    try {
      writeFileSync(passPath, `import { expect, test } from 'bun:test';\ntest('probe passes', () => { expect(1).toBe(1); });\n`);
      const r = spawnSync('python3', [script, '--run-linux'], {
        input: JSON.stringify({ files: [passProbe] }), encoding: 'utf8',
      });
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual({
        schema: 'nightly-unit-failure-sites-v2', test_count: 1, failure_count: 0,
        skip_count: 0, sites: [], omitted_site_count: 0,
      });
    } finally { cleanup(); }
  }, 60000);

  test('a real load-failure run emits the typed xml_parse gap, not a silent rejection', () => {
    if (process.platform !== 'linux') return;
    try {
      // The throw is env-gated so crash residue without the probe env is a
      // harmless passing test; the gate var is set ONLY on this child spawn.
      expect(process.env.EXTRACTOR_PROBE_THROW).toBeUndefined();
      writeFileSync(throwPath, `if (process.env.EXTRACTOR_PROBE_THROW === '1') { throw new Error('${canary}'); }\nimport { expect, test } from 'bun:test';\ntest('extractor probe residue-safe', () => { expect(1).toBe(1); });\n`);
      const r = spawnSync('python3', [script, '--run-linux'], {
        input: JSON.stringify({ files: [throwProbe] }), encoding: 'utf8',
        env: { ...process.env, EXTRACTOR_PROBE_THROW: '1' },
      });
      expect(r.status).toBe(1);
      const line = r.stdout.trim();
      expect(line.startsWith('NIGHTLY_UNIT_DIAGNOSTIC_GAP=')).toBe(true);
      const gap = JSON.parse(line.slice('NIGHTLY_UNIT_DIAGNOSTIC_GAP='.length));
      expect(gap).toEqual({
        schema: 'nightly-unit-diagnostic-gap-v2', stage: 'derive', reason: 'xml_parse',
        xml_bytes: 0, exit_code: 1, signal: null,
      });
      expect(r.stdout + r.stderr).not.toContain(canary);
    } finally { cleanup(); }
  }, 60000);

  test('negative control: leftover probe file without the gate env passes harmlessly', () => {
    if (process.platform !== 'linux') return;
    try {
      writeFileSync(throwPath, `if (process.env.EXTRACTOR_PROBE_THROW === '1') { throw new Error('${canary}'); }\nimport { expect, test } from 'bun:test';\ntest('extractor probe residue-safe', () => { expect(1).toBe(1); });\n`);
      const r = spawnSync('python3', [script, '--run-linux'], {
        input: JSON.stringify({ files: [throwProbe] }), encoding: 'utf8',
      });
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual({
        schema: 'nightly-unit-failure-sites-v2', test_count: 1, failure_count: 0,
        skip_count: 0, sites: [], omitted_site_count: 0,
      });
      expect(r.stdout + r.stderr).not.toContain(canary);
    } finally { cleanup(); }
  }, 60000);
});
