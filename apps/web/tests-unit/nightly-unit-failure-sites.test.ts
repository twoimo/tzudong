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
      schema: 'nightly-unit-failure-sites-v1', test_count: 2, failure_count: 1,
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
      expect(safe.status).toBe(0);
      expect(safe.stdout).toBe(`NIGHTLY_UNIT_DIAGNOSTIC=${r.stdout.trim()}\n`);
      expect(safe.stdout + safe.stderr).not.toContain(canary);
      symlinkSync(log, link);
      expect(spawnSync('python3', [script, '--log', link]).status).toBe(1);
      const payload = JSON.parse(r.stdout); payload.raw_message = canary;
      writeFileSync(log, `NIGHTLY_UNIT_DIAGNOSTIC=${JSON.stringify(payload)}\n`);
      const rejected = spawnSync('python3', [script, '--log', log], { encoding: 'utf8' });
      expect(rejected.status).toBe(1);
      expect(rejected.stdout + rejected.stderr).not.toContain(canary);
    } finally {
      unlinkSync(link); unlinkSync(log); rmdirSync(dir);
    }
  });
});
