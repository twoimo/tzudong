import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(import.meta.dir, '..', 'scripts/measure-dev-routes.mjs'), 'utf8');
const compileSource = readFileSync(join(import.meta.dir, '..', 'scripts/measure-dev-compile.mjs'), 'utf8');

describe('measure-dev-routes source contract', () => {
    test('fails closed on HTTP status failures unless explicitly overridden', () => {
        expect(source).toContain("const failOnHttpError = !hasFlag('--allow-http-errors')");
        expect(source).toContain('!row.ok');
        expect(source).toContain('request(s) failed status validation');
        expect(source).toContain('process.exitCode = 1');
    });

    test('resolves the effective port before clearing and measuring its isolated Next cache', () => {
        expect(source).toContain('const nextDistDir = resolveLocalDevDistDir(projectRoot, port)');
        expect(source.indexOf('const port = await choosePort()')).toBeLessThan(
            source.indexOf('const nextDistDir = resolveLocalDevDistDir(projectRoot, port)'),
        );
        expect(source).toContain('async function removeNextCacheForColdIteration(nextDistDir)');
        expect(source).toContain('directorySizeBytes(nextDistDir)');
        expect(source).toContain("collectEnvironmentSnapshot('run-start', nextDistDir)");
        expect(source).toContain('result.iterations[0]?.environment_before ?? result.environment_start');
        expect(source).not.toContain("path.join(projectRoot, '.next')");
        expect(source).toContain('maxRetries: 3');
        expect(source).toContain('await removeNextCacheForColdIteration(nextDistDir)');

        expect(compileSource.indexOf('const port = await choosePort()')).toBeLessThan(
            compileSource.indexOf('const nextDistDir = resolveLocalDevDistDir(projectRoot, port)'),
        );
        expect(compileSource).toContain('fs.rmSync(nextDistDir, { recursive: true, force: true })');
        expect(compileSource).toContain('next_dist_dir: path.relative(projectRoot, nextDistDir)');
        expect(compileSource).not.toContain("path.join(projectRoot, '.next', 'dev')");
    });

    test('retries transient dev-server failures and records retry metadata', () => {
        expect(source).toContain("parsePositiveIntegerArg('--retries', 1)");
        expect(source).toContain('function shouldRetryRequest(result)');
        expect(source).toContain('result.status === 0 || result.status >= 500');
        expect(source).toContain('retry_count');
        expect(source).toContain('attempts');
    });

    test('records repeated measurements with distribution summaries', () => {
        expect(source).toContain("parsePositiveIntegerArg('--repeat', 1)");
        expect(source).toContain('function percentile(sorted, fraction)');
        expect(source).toContain('mad_ms');
        expect(source).toContain('p75_ms');
        expect(source).toContain('buildSummaries(result.requests, result.iterations)');
        expect(source).toContain('iteration,round,route,kind,source');
    });

    test('captures environment context for noisy local benchmarks', () => {
        expect(source).toContain('function collectEnvironmentSnapshot(stage, nextDistDir)');
        expect(source).toContain('free_memory_bytes');
        expect(source).toContain('next_dir_size_bytes');
        expect(source).toContain('process_count_matching_next_node_bun');
        expect(source).toContain("readArg('--measurement-mode'");
        expect(source).toContain('Environment snapshot');
        expect(source).toContain('function classifyVariability(summary)');
        expect(source).toContain('high-CV results as noisy local evidence');
        expect(source).toContain('| CV | variability |');
    });


    test('keeps admin-first route ordering available for focused admin console benchmarks', () => {
        expect(source).toContain("order === 'admin-first'");
        expect(source).toContain("route.startsWith('/admin/')");
        expect(source).toContain('a.route.localeCompare(b.route)');
    });

});
