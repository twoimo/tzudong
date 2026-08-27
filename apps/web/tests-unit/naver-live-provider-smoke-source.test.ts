import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('Naver live-provider Playwright smoke source contract', () => {
    test('couples the dedicated spec to the explicit live server mode', () => {
        const packageSource = source('package.json');
        const config = source('playwright.config.ts');
        const runner = source('scripts/run-naver-live-provider-smoke.mjs');
        const spec = source('tests/naver-live-marker.spec.ts');

        expect(packageSource).toContain(
            '"dev:playwright:naver-live": "node scripts/run-local-dev.mjs --port 3000 --live-naver-provider-smoke"',
        );
        expect(packageSource).toContain(
            '"test:naver-live-provider": "node scripts/run-naver-live-provider-smoke.mjs"',
        );
        expect(config).toContain("const NAVER_LIVE_PROVIDER_SPEC = /naver-live-marker\\.spec\\.ts$/");
        expect(config).toContain("process.env.PLAYWRIGHT_NAVER_LIVE_PROVIDER_SMOKE === '1'");
        expect(config).toContain("? 'bun run dev:playwright:naver-live'");
        expect(config).toContain('...(runsDedicatedNaverLiveProviderSmoke ? [] : [NAVER_LIVE_PROVIDER_SPEC])');
        expect(runner).toContain("PLAYWRIGHT_NAVER_LIVE_PROVIDER_SMOKE: '1'");
        expect(runner).toContain("'tests/naver-live-marker.spec.ts'");
        expect(runner).toContain("'[naver-live-smoke] error=ClientIdRequired\\n'");
        expect(runner).toContain('/^(?:approved[-_]local|replace[-_]with|your[-_])/i');
        expect(spec).toContain("process.env.PLAYWRIGHT_NAVER_LIVE_PROVIDER_SMOKE === '1'");
        expect(spec).not.toContain("readFileSync(envPath");
        expect(spec).toContain("script[data-local-naver-maps=\"true\"]");
    });

    test('documents the explicit command without embedding a Client ID', () => {
        const readme = source('README.md');
        expect(readme).toContain('bun run test:naver-live-provider');
        expect(readme).toContain('NEXT_PUBLIC_NAVER_CLIENT_ID="$NAVER_APPROVED_CLIENT_ID"');
        expect(readme).not.toMatch(/NEXT_PUBLIC_NAVER_CLIENT_ID=[A-Za-z0-9_-]{24,}/);
    });

    test('fails closed before Playwright when the explicit Client ID is absent', () => {
        const environmentWithoutClientId = { ...process.env };
        delete environmentWithoutClientId.NEXT_PUBLIC_NAVER_CLIENT_ID;
        const result = spawnSync(
            process.execPath,
            ['scripts/run-naver-live-provider-smoke.mjs'],
            {
                cwd: join(import.meta.dir, '..'),
                encoding: 'utf8',
                env: environmentWithoutClientId,
            },
        );

        expect(result.status).toBe(2);
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe('[naver-live-smoke] error=ClientIdRequired\n');
    });
});
