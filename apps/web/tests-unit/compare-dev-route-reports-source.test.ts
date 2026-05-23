import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(import.meta.dir, '..', 'scripts/compare-dev-route-reports.mjs'), 'utf8');
const packageJson = readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf8');

describe('compare-dev-route-reports source contract', () => {
    test('compares median and p75 deltas with explicit regression gates', () => {
        expect(source).toContain("readArg('--baseline'");
        expect(source).toContain("readArg('--candidate'");
        expect(source).toContain("parseNumberArg('--median-regression-pct', 10)");
        expect(source).toContain("parseNumberArg('--p75-regression-pct', 10)");
        expect(source).toContain('median_delta_pct');
        expect(source).toContain('p75_delta_pct');
        expect(source).toContain('median <= +');
        expect(source).toContain('p75 <= +');
    });

    test('fails closed on route regressions unless explicitly disabled', () => {
        expect(source).toContain("const failOnRegression = !hasFlag('--no-fail')");
        expect(source).toContain("row.status === 'fail'");
        expect(source).toContain('process.exitCode = 1');
    });

    test('is exposed as a package benchmark helper', () => {
        expect(packageJson).toContain('"bench:routes": "node scripts/measure-dev-routes.mjs"');
        expect(packageJson).toContain('"bench:compare": "node scripts/compare-dev-route-reports.mjs"');
    });
});
