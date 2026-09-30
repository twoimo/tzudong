import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const label = process.argv[2];
if (!/^[a-z0-9-]+$/.test(label ?? '')) throw new Error('Unique run label required');
const here = new URL('./', import.meta.url);
const output = new URL(`${label}/`, here);
await mkdir(output);
const app = new URL('../../', here);
const baseline = await readFile(new URL('baseline-home-runtime-shell.tsx.txt', here), 'utf8');
const candidate = await readFile(new URL('../../app/home-runtime-shell.tsx', here), 'utf8');
const sources = { baseline, candidate };
const generated = String.raw`
const sources = ${JSON.stringify(sources)};
const result = await Bun.build({
    entrypoints: [${JSON.stringify(fileURLToPath(new URL('browser-entry.jsx', here)))}],
    outdir: ${JSON.stringify(fileURLToPath(output))}, naming: 'browser-bundle.mjs',
    target: 'browser', format: 'esm', minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'controlled-service-inputs', setup(builder) {
        builder.onResolve({ filter: /^(baseline-shell|candidate-shell)$/ }, args => ({ path: args.path, namespace: 'shell' }));
        builder.onLoad({ filter: /.*/, namespace: 'shell' }, args => ({
            contents: sources[args.path === 'baseline-shell' ? 'baseline' : 'candidate'],
            loader: 'tsx', resolveDir: ${JSON.stringify(fileURLToPath(new URL('../../app/', here)))}
        }));
        builder.onResolve({ filter: /^(@\/|@tanstack\/react-query$|\.\/providers$|.*\.css$)/ }, () => ({
            path: ${JSON.stringify(fileURLToPath(new URL('service-stubs.jsx', here)))}
        }));
    }}]
});
if (!result.success) throw new Error(result.logs.map(item => item.message).join('\n'));
`;
await writeFile(new URL('build.mjs', output), generated, { flag: 'wx' });
execFileSync('bun', [fileURLToPath(new URL('build.mjs', output))], { cwd: fileURLToPath(app), stdio: 'pipe' });
const bundle = await readFile(new URL('browser-bundle.mjs', output));
const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': request.url === '/bundle.mjs' ? 'text/javascript' : 'text/html',
        'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
    response.end(request.url === '/bundle.mjs' ? bundle : '<!doctype html><html><body><script type="module" src="/bundle.mjs"></script></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const mad = values => median(values.map(value => Math.abs(value - median(values))));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const budgets = { absoluteDeltaMs: 0.05, relativeDeltaFraction: 0.05, noiseMadMultiplier: 2 };
const scope = 'Production React structural browser lab: actual frozen/current HomeRuntimeShell source; controlled viewport input, service/chrome stubs, 200 memoized synthetic rows. No live SDK, auth, full-page or visible-frame performance claim.';
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.name));
    page.on('console', message => { if (message.type() === 'error') errors.push('console_error'); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => globalThis.viewportContinuityHarness);
    const transitions = [['pending', 'desktop'], ['pending', 'mobileOrTablet'], ['desktop', 'mobileOrTablet'],
        ['mobileOrTablet', 'desktop'], ['mobileOrTablet', 'mobileOrTablet'], ['desktop', 'desktop']];
    const checks = [];
    for (const [from, to] of transitions) {
        for (const kind of ['baseline', 'candidate']) {
            const result = await page.evaluate(args => globalThis.viewportContinuityHarness.sample(...args), [kind, from, to]);
            checks.push({ kind, from, to, hydration: false, result });
        }
    }
    for (const kind of ['baseline', 'candidate']) {
        checks.push({ kind, from: 'pending', to: 'mobileOrTablet', hydration: true,
            result: await page.evaluate(kind => globalThis.viewportContinuityHarness.sample(kind, 'pending', 'mobileOrTablet', true), kind) });
    }
    const pairs = [];
    for (let index = 0; index < 35; index++) {
        const pair = { index };
        for (const kind of index % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
            pair[kind] = await page.evaluate(kind => globalThis.viewportContinuityHarness.sample(kind, 'desktop', 'mobileOrTablet'), kind);
        }
        if (index >= 4) pairs.push(pair);
    }
    const before = pairs.map(pair => pair.baseline.durationMs), after = pairs.map(pair => pair.candidate.durationMs);
    const baselineMs = median(before), candidateMs = median(after), deltaMs = candidateMs - baselineMs;
    const noiseMs = 2 * Math.max(mad(before), mad(after));
    const scored = { scope, budgets, samples: pairs.length, baselineMs, candidateMs, absoluteDeltaMs: deltaMs,
        relativeDeltaPercent: 100 * deltaMs / baselineMs, baselineMadMs: mad(before), candidateMadMs: mad(after), noiseMs,
        classification: Math.abs(deltaMs) > Math.max(budgets.absoluteDeltaMs, baselineMs * budgets.relativeDeltaFraction, noiseMs)
            ? deltaMs < 0 ? 'local_improvement' : 'local_regression' : 'below_budget_or_noise' };
    const raw = { scope, observedAt: new Date().toISOString(), node: process.version, chromium: browser.version(),
        isolatedTimer: await page.evaluate(() => crossOriginIsolated), warmupPairs: 4, checks, pairs, errors };
    await writeFile(new URL('raw.json', output), JSON.stringify(raw, null, 2) + '\n', { flag: 'wx' });
    await writeFile(new URL('scored.json', output), JSON.stringify(scored, null, 2) + '\n', { flag: 'wx' });
    const artifacts = {};
    for (const [index, name] of ['baseline-home-runtime-shell.tsx.txt', '../../app/home-runtime-shell.tsx',
        '../../hooks/useHomeViewportMode.ts', 'service-stubs.jsx', 'browser-entry.jsx', 'measure.mjs'].entries()) {
        const bytes = await readFile(new URL(name, here));
        const frozen = `source-${index}.txt`;
        await writeFile(new URL(frozen, output), bytes, { flag: 'wx' });
        artifacts[frozen] = { original: name, sha256: hash(bytes) };
    }
    for (const name of ['build.mjs', 'browser-bundle.mjs', 'raw.json', 'scored.json']) {
        artifacts[name] = { sha256: hash(await readFile(new URL(name, output))) };
    }
    const map = JSON.stringify({ scope, baseCommit: '157ced98a2414d434132c99f74c72bbe5f796ca4', artifacts }, null, 2) + '\n';
    await writeFile(new URL('artifact-map.json', output), map, { flag: 'wx' });
    console.log(JSON.stringify({ ...scored, artifactMapSha256: hash(map), errors,
        checks: checks.map(({ kind, from, to, hydration, result }) => ({ kind, from, to, hydration, ...result })) }, null, 2));
} finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
