import { expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ESLint } from 'eslint';

const webRoot = resolve(import.meta.dir, '..');

test('excludes generated custom distDir files while enforcing authored runner rules', async () => {
    const generatedRoot = resolve(webRoot, `.next-ci-lint-fixture-${process.pid}`);
    mkdirSync(generatedRoot);
    try {
        writeFileSync(resolve(generatedRoot, 'generated.js'), 'const module = {};');
        const eslint = new ESLint({ cwd: webRoot });
        expect(await eslint.isPathIgnored(resolve(generatedRoot, 'generated.js'))).toBe(true);
        const authoredPath = 'performance/cms-followthrough-20261009/browser-check.mjs';
        expect(await eslint.isPathIgnored(resolve(webRoot, authoredPath))).toBe(false);
        const [result] = await eslint.lintText('const module = {};', { filePath: authoredPath });
        expect(result.messages.some(message => message.ruleId === '@next/next/no-assign-module-variable')).toBe(true);
        const fixtureRoot = 'performance/public-cms-followthrough-20261009/share-http-status-followup/fixture';
        for (const directory of ['.next', '.next-dev', '.next-production']) {
            expect(await eslint.isPathIgnored(resolve(webRoot, fixtureRoot, directory, 'generated.js'))).toBe(true);
        }
        expect(await eslint.isPathIgnored(resolve(webRoot, fixtureRoot, 'app/not-found.jsx'))).toBe(false);
    } finally {
        rmSync(generatedRoot, { recursive: true });
    }
});
