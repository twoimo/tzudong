import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(import.meta.dir, '..', 'scripts/measure-dev-routes.mjs'), 'utf8');

describe('measure-dev-routes source contract', () => {
    test('fails closed on HTTP status failures unless explicitly overridden', () => {
        expect(source).toContain("const failOnHttpError = !hasFlag('--allow-http-errors')");
        expect(source).toContain('!row.ok');
        expect(source).toContain('request(s) failed status validation');
        expect(source).toContain('process.exitCode = 1');
    });

    test('removes the full Next cache for cold measurements', () => {
        expect(source).toContain("path.join(projectRoot, '.next')");
        expect(source).not.toContain("path.join(projectRoot, '.next', 'dev')");
        expect(source).toContain('async function removeNextCacheForColdIteration()');
        expect(source).toContain('maxRetries: 3');
        expect(source).toContain('await removeNextCacheForColdIteration()');
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
        expect(source).toContain('function collectEnvironmentSnapshot(stage)');
        expect(source).toContain('free_memory_bytes');
        expect(source).toContain('next_dir_size_bytes');
        expect(source).toContain('process_count_matching_next_node_bun');
        expect(source).toContain("readArg('--measurement-mode'");
        expect(source).toContain('Environment snapshot');
        expect(source).toContain('function classifyVariability(summary)');
        expect(source).toContain('high-CV results as noisy local evidence');
        expect(source).toContain('| CV | variability |');
    });

});
