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

    test('retries transient dev-server failures and records retry metadata', () => {
        expect(source).toContain("parsePositiveIntegerArg('--retries', 1)");
        expect(source).toContain('function shouldRetryRequest(result)');
        expect(source).toContain('result.status === 0 || result.status >= 500');
        expect(source).toContain('retry_count');
        expect(source).toContain('attempts');
    });
});
