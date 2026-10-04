import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const script = path.resolve('../../.github/scripts/nightly-unit-failure-sites.py');
const file = 'tests-unit/nightly-unit-failure-sites.test.ts';
const canary = 'fixture-private-provider-body-must-never-be-retained';
const xml = (attrs = '', body = '', source = file, line = '10') => `
<testsuites tests="2" failures="1" skipped="0" ${attrs}>
<testsuite file="${source}" name="${canary}">
<testcase file="${source}" name="private-title" line="5"/>
<testcase file="${source}" name="${canary}" line="${line}">
<failure message="${canary}" type="private-provider-type">${body || canary}</failure>
</testcase></testsuite></testsuites>`;

function derive(report: string, files = [file]) {
  return spawnSync('python3', [script], {
    input: JSON.stringify({ xml: report, files }), encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

describe('bounded nightly unit failure source coordinates', () => {
  test('keeps source coordinates and counts while dropping all raw error/title fields', () => {
    const r = derive(xml());
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      schema: 'nightly-unit-failure-sites-v2', test_count: 2, failure_count: 1, omitted_site_count: 0,
      skip_count: 0, sites: [{ file, test_index: 1, line: 10, kind: 'failure' }],
    });
    expect(r.stdout + r.stderr).not.toContain(canary);
    expect(r.stdout).not.toContain('private-title');
  });

  test('does not treat error text or CDATA as testcase markup', () => {
    const r = derive(xml('', '<![CDATA[<testcase file="../../private-file" line="900"><failure/></testcase>]]>'));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).failure_count).toBe(1);
    expect(r.stdout).not.toContain('private-file');
  });

  test('rejects both exit/report mismatches before emitting a clean-looking diagnostic', () => {
    const passing = `<testsuites tests="1" failures="0" skipped="0"><testsuite><testcase file="${file}" line="10"/></testsuite></testsuites>`;
    for (const [report, exit_code, accepted] of [[passing, 0, true], [xml(), 1, true], [passing, 37, false], [xml(), 0, false], [passing, -9, false], [passing, null, false]] as const) {
      const r = spawnSync('python3', [script], {
        input: JSON.stringify({ xml: report, files: [file], exit_code }), encoding: 'utf8',
      });
      expect(r.status).toBe(accepted ? 0 : 1);
      if (!accepted) { expect(r.stdout).toBe(''); expect(r.stderr.trim()).toBe('unit_diagnostic_unavailable'); }
    }
  });

  test('keeps every failure count and explicitly reports omitted sites above 64', () => {
    const cases = Array.from({ length: 65 }, () => `<testcase file="${file}" line="10"><failure message="${canary}"/></testcase>`).join('');
    const r = derive(`<testsuites tests="65" failures="65" skipped="0"><testsuite>${cases}</testsuite></testsuites>`);
    expect(r.status).toBe(0);
    const payload = JSON.parse(r.stdout);
    expect(payload.failure_count).toBe(65); expect(payload.omitted_site_count).toBe(1);
    expect(payload.sites).toHaveLength(64); expect(payload.sites[63].test_index).toBe(63);
    expect(r.stdout).not.toContain(canary);
    const last = cases.lastIndexOf('line="10"');
    const malformedLast = cases.slice(0, last) + 'line="0"' + cases.slice(last + 'line="10"'.length);
    const bad = derive(`<testsuites tests="65" failures="65" skipped="0"><testsuite>${malformedLast}</testsuite></testsuites>`);
    expect(bad.status).toBe(1);
  });

  test('rejects foreign source, entity expansion, inconsistent counts and invalid lines', () => {
    for (const report of [
      xml('', '', '../../private-file'),
      '<!DOCTYPE testsuites [<!ENTITY x "private-value">]>' + xml(),
      xml().replace('tests="2"', 'tests="9"'),
      xml('', '', file, '0'), xml('', '', file, '99999999'),
      xml('', '', file, 'NaN'),
    ]) {
      const r = derive(report);
      expect(r.status).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr.trim()).toBe('unit_diagnostic_unavailable');
    }
  });

  test('validates log coordinates again and refuses symlinks or unknown data fields', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nightly-unit-sites-'));
    const log = path.join(dir, 'unit.log');
    const link = path.join(dir, 'link.log');
    try {
      const r = derive(xml());
      expect(r.status).toBe(0);
      writeFileSync(log, `discarded-private-log-${canary}\nNIGHTLY_UNIT_DIAGNOSTIC=${r.stdout.trim()}\n`, { mode: 0o600 });
      const safe = spawnSync('python3', [script, '--log', log], { encoding: 'utf8' });
      if (process.platform === 'win32') {
        expect(safe.status).toBe(1);
        expect(safe.stdout).toBe('');
        expect(safe.stderr.trim()).toBe('unit_diagnostic_unavailable');
        return;
      }
      expect(safe.status).toBe(0);
      expect(safe.stdout).toBe(`NIGHTLY_UNIT_DIAGNOSTIC=${r.stdout.trim()}\n`);
      expect(safe.stdout + safe.stderr).not.toContain(canary);
      const passing = JSON.parse(r.stdout); passing.test_count = 1; passing.failure_count = 0; passing.sites = [];
      for (const [payloads, code, accepted] of [
        [[passing], 1, false], [[passing, passing], 0, true],
        [[passing, JSON.parse(r.stdout)], 37, true], [[JSON.parse(r.stdout), passing], 1, false],
        [[passing, passing], 37, false], [[passing, JSON.parse(r.stdout)], 0, false],
      ] as const) {
        writeFileSync(log, payloads.map(value => `NIGHTLY_UNIT_DIAGNOSTIC=${JSON.stringify(value)}\n`).join(''));
        const checked = spawnSync('python3', [script, '--log', log, '--exit-code', String(code)], { encoding: 'utf8' });
        expect(checked.status).toBe(accepted ? 0 : 1);
        if (!accepted) expect(checked.stdout).toBe('');
      }
      const legacy = JSON.parse(r.stdout); legacy.schema = 'nightly-unit-failure-sites-v1'; delete legacy.omitted_site_count;
      writeFileSync(log, `NIGHTLY_UNIT_DIAGNOSTIC=${JSON.stringify(legacy)}\n`);
      expect(spawnSync('python3', [script, '--log', log]).status).toBe(0);
      writeFileSync(log, `discarded-private-log-${canary}\n`);
      const empty = spawnSync('python3', [script, '--log', log], { encoding: 'utf8' });
      expect(empty.status).toBe(1); expect(empty.stdout).toBe('');
      expect(empty.stderr.trim()).toBe('unit_diagnostic_unavailable');
      symlinkSync(log, link);
      expect(spawnSync('python3', [script, '--log', link]).status).toBe(1);
      const payload = JSON.parse(r.stdout); payload.raw_message = canary;
      writeFileSync(log, `NIGHTLY_UNIT_DIAGNOSTIC=${JSON.stringify(payload)}\n`);
      const rejected = spawnSync('python3', [script, '--log', log], { encoding: 'utf8' });
      expect(rejected.status).toBe(1);
      expect(rejected.stdout + rejected.stderr).not.toContain(canary);
    } finally {
      try { unlinkSync(link); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      unlinkSync(log); rmdirSync(dir);
    }
  });
});
