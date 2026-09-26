import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cpus, platform, arch } from 'node:os';
import ts from 'typescript';
import { chromium } from '@playwright/test';

const root = new URL('./', import.meta.url);
const sourcePath = new URL('../../lib/mobile-home-search-selection.ts', root);
const baseline = await readFile(new URL('baseline-source.txt', root), 'utf8');
const candidate = await readFile(sourcePath, 'utf8');
const digest = (value) => createHash('sha256').update(value).digest('hex');
const frozenAt = new Date().toISOString();
await writeFile(new URL('candidate-source.txt', root), candidate);
await writeFile(new URL('frozen-tree.patch', root), execFileSync('git', ['diff', '--binary', 'HEAD'], {
    cwd: fileURLToPath(new URL('../../', root)), encoding: 'utf8',
}));
const sources = [baseline, candidate].map((source) => ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText);
const scenarios = [
    { name: 'fresh-visible-order', size: 200, iterations: 120 },
    { name: 'new-search-same-visible', size: 200, iterations: 400 },
    { name: 'same-search-cache-hit', size: 200, iterations: 30000 },
    { name: 'nearest-fallback', size: 1000, iterations: 120 },
    { name: 'revisit-64-searches', size: 200, iterations: 400 },
];
const browser = await chromium.launch({ headless: true, args: ['--js-flags=--expose-gc'] });
const samples = [];
let equivalenceCases = 0;
try {
    const page = await browser.newPage();
    await page.evaluate(async (moduleSources) => {
        const modules = await Promise.all(moduleSources.map((source) => import(
            'data:text/javascript;base64,' + btoa(unescape(encodeURIComponent(source)))
        )));
        const restaurant = (id, index) => ({
            id, name: id, lat: 37 + index / 10000, lng: 127 + index / 10000,
            mergedRestaurants: Array.from({ length: 4 }, (_, alias) => ({ id: `${id}-alias-${alias}` })),
        });
        const prepare = (scenario, module) => {
            const all = Array.from({ length: scenario.size }, (_, index) => restaurant(`r-${index}`, index));
            const visible = scenario.name === 'nearest-fallback' ? [all[0]] : all;
            const queryCount = scenario.name === 'same-search-cache-hit' ? 1
                : scenario.name === 'revisit-64-searches' ? 64 : scenario.iterations;
            const queries = Array.from({ length: queryCount }, (_, index) => ({
                ...restaurant(`query-${index}`, index % scenario.size),
                mergedRestaurants: [
                    { id: `r-${index % scenario.size}-alias-0` },
                    { id: `r-${(index + 1) % scenario.size}` },
                    { id: 'missing-1' }, { id: 'missing-2' },
                ],
            }));
            module.buildPostSearchSwipeCandidates({ visibleRestaurants: all, allRestaurants: all, activeSearchedRestaurant: null });
            module.buildPostSearchSwipeCandidates({ visibleRestaurants: visible, allRestaurants: all, activeSearchedRestaurant: null });
            if (scenario.name === 'same-search-cache-hit' || scenario.name === 'revisit-64-searches') {
                const count = scenario.name === 'same-search-cache-hit' ? 1 : 64;
                for (let index = 0; index < count; index += 1) module.buildPostSearchSwipeCandidates({
                    visibleRestaurants: visible, allRestaurants: all, activeSearchedRestaurant: queries[index],
                });
            }
            return { all, visible, queries };
        };
        const inputAt = (state, scenario, index) => ({
            visibleRestaurants: scenario.name === 'fresh-visible-order' ? state.visible.slice() : state.visible,
            allRestaurants: state.all,
            activeSearchedRestaurant: state.queries[
                scenario.name === 'same-search-cache-hit' ? 0 : scenario.name === 'revisit-64-searches' ? index % 64 : index
            ],
        });
        globalThis.verifyScenario = (scenario) => {
            const states = modules.map((module) => prepare(scenario, module));
            const count = Math.min(scenario.iterations, 128);
            for (let index = 0; index < count; index += 1) {
                const results = modules.map((module, variant) => module.buildPostSearchSwipeCandidates(
                    inputAt(states[variant], scenario, index),
                ).map((item) => item.id));
                if (JSON.stringify(results[0]) !== JSON.stringify(results[1])) throw new Error(`Benchmark output mismatch: ${scenario.name}:${index}`);
            }
            return count;
        };
        globalThis.measureScenario = (scenario, variant) => {
            const module = modules[variant];
            const state = prepare(scenario, module);
            globalThis.gc?.();
            let checksum = 0;
            const start = performance.now();
            for (let index = 0; index < scenario.iterations; index += 1) {
                const result = module.buildPostSearchSwipeCandidates(inputAt(state, scenario, index));
                checksum += result.length + (result[0]?.id.length ?? 0);
            }
            return { totalMs: performance.now() - start, checksum };
        };
    }, sources);
    for (const scenario of scenarios) {
        equivalenceCases += await page.evaluate((s) => globalThis.verifyScenario(s), scenario);
        for (let warmup = 0; warmup < 5; warmup += 1) {
            await page.evaluate((s) => { globalThis.measureScenario(s, 0); globalThis.measureScenario(s, 1); }, scenario);
        }
        for (let sample = 0; sample < 31; sample += 1) {
            const order = sample % 2 === 0 ? [0, 1] : [1, 0];
            const pair = {};
            for (const variant of order) pair[variant === 0 ? 'baseline' : 'candidate'] = await page.evaluate(
                ({ s, v }) => globalThis.measureScenario(s, v), { s: scenario, v: variant },
            );
            if (pair.baseline.checksum !== pair.candidate.checksum) throw new Error('Checksum mismatch');
            samples.push({ scenario: scenario.name, sample, order, ...pair });
        }
        console.log(JSON.stringify({ measured: scenario.name, pairedSamples: 31 }));
    }
    const raw = {
        schemaVersion: 'swipe-render-local-microbenchmark.v1', frozenAt,
        scope: 'Isolated Chromium JavaScript helper; not page rendering, LCP, INP, production, or a release/G003 admission.',
        environment: { node: process.version, chromium: browser.version(), platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
        source: { baselineSha256: digest(baseline), candidateSha256: digest(candidate) },
        gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        gitHeadTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(),
        budgets: { absoluteDeltaMs: 0.001, relativeDeltaFraction: 0.05, noiseMadMultiplier: 2 },
        warmupRounds: 5, pairsPerScenario: 31, equivalenceCases, scenarios, samples,
    };
    await writeFile(new URL('raw.json', root), JSON.stringify(raw, null, 2) + '\n');
    const names = ['baseline-source.txt', 'candidate-source.txt', 'frozen-tree.patch', 'measure.mjs', 'score-and-verify.mjs', 'raw.json'];
    const artifacts = {};
    for (const name of names) artifacts[name] = digest(await readFile(new URL(name, root)));
    const map = JSON.stringify({ schemaVersion: 'local-performance-artifact-map.v1', frozenAt, artifacts }, null, 2) + '\n';
    await writeFile(new URL('artifact-map.json', root), map);
    console.log(JSON.stringify({ artifactMapSha256: digest(map), equivalenceCases, mismatches: 0 }));
} finally {
    await browser.close();
}
