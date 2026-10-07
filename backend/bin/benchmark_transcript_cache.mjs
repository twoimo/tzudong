#!/usr/bin/env node
/** Controlled collection replay plus a read-only corpus audit; no supplier requests. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const value = name => { const i = args.indexOf(name); if (i < 0 || !args[i + 1]) throw new Error('ARGUMENT_MISSING'); return args[i + 1]; };
const output = value('--output');
const corpus = value('--corpus');
if (fs.existsSync(output)) throw new Error('OUTPUT_ALREADY_EXISTS');
const script = path.join(root, 'backend/restaurant-crawling/scripts/03-collect-transcript.js');
const baselineCommit = '8f9db662368c28eac02e1ecbfe7d2e6b6d0dcc8d';
const baselinePath = path.join(path.dirname(script), `.pipeline-perf-baseline-${process.pid}.js`);
const baselineSource = execFileSync('git', ['show', `${baselineCommit}:backend/restaurant-crawling/scripts/03-collect-transcript.js`], { cwd: root });
const hash = data => createHash('sha256').update(data).digest('hex');
const sourceFiles = fs.readdirSync(corpus).filter(f => f.endsWith('.jsonl')).sort();
function corpusHash() {
    const digest = createHash('sha256');
    for (const file of fs.readdirSync(corpus).filter(f => f.endsWith('.jsonl')).sort())
        digest.update(file + '\0').update(fs.readFileSync(path.join(corpus, file)));
    return digest.digest('hex');
}
const sourceBefore = corpusHash();
const print = console.log;
console.log = () => {};
fs.writeFileSync(baselinePath, baselineSource, { flag: 'wx' });

try {
    const baseline = await import(pathToFileURL(baselinePath));
    const candidate = await import(pathToFileURL(script));
    const audit = { files: sourceFiles.length, baselineTruthyLatest: 0, candidateReusable: 0, rejected: 0 };
    for (const file of sourceFiles) {
        let record;
        try { record = JSON.parse(fs.readFileSync(path.join(corpus, file), 'utf8').trim().split('\n').at(-1)); } catch { record = null; }
        if (record) audit.baselineTruthyLatest++;
        if (candidate.isValidTranscriptRecord(record, path.basename(file, '.jsonl'), 'tzuyang')) audit.candidateReusable++;
        else audit.rejected++;
    }
    const warmup = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-warmup-'));
    try { await candidate.collectChannelTranscripts('benchmark', { name: 'fixture' }, { dataPath: warmup }); }
    finally { fs.rmSync(warmup, { recursive: true, force: true }); }

    async function run(module, implementation, scenario, repeat) {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-replay-'));
        const ids = Array.from({ length: scenario === 'concurrent' ? 1 : 5 }, (_, i) => `Z${String(i).padStart(10, '0')}`);
        const record = id => ({ youtube_link: `https://www.youtube.com/watch?v=${id}`, channel_name: 'benchmark',
            language: 'ko', transcript: [{ start: 0, duration: 1, text: 'fixture' }], recollect_id: 1, recollect_vars: [], collector_source: 'fixture' });
        let providerCalls = 0;
        fs.mkdirSync(path.join(directory, 'meta'));
        fs.mkdirSync(path.join(directory, 'transcript'));
        fs.writeFileSync(path.join(directory, 'urls.txt'), ids.flatMap(id => Array(scenario === 'duplicate-urls' ? 5 : 1).fill(`https://www.youtube.com/watch?v=${id}`)).join('\n'));
        for (const id of ids) {
            fs.writeFileSync(path.join(directory, 'meta', `${id}.jsonl`), JSON.stringify({ recollect_id: scenario === 'duration-change' ? 2 : 1, recollect_vars: scenario === 'duration-change' ? ['duration_changed'] : [] }) + '\n');
            if (['unchanged', 'duration-change', 'empty-cache', 'truncated-cache'].includes(scenario)) {
                fs.writeFileSync(path.join(directory, 'transcript', `${id}.jsonl`), scenario === 'truncated-cache' ? '{"transcript":[' : JSON.stringify(scenario === 'empty-cache' ? { ...record(id), transcript: [] } : record(id)) + '\n');
            }
        }
        const opts = { dataPath: directory, acquireSlot: async () => {}, releaseSlot: () => {}, waitForDelay: async () => {},
            getTranscriptForVideo: async id => {
                providerCalls++; await new Promise(resolve => setTimeout(resolve, 2));
                return { ...record(id), source: 'fixture' };
            } };
        const started = performance.now();
        const cpu = process.cpuUsage();
        try {
            const collect = () => module.collectChannelTranscripts('benchmark', { name: 'fixture' }, opts);
            if (scenario === 'concurrent') await Promise.all([collect(), collect()]);
            else await collect();
            const wallMs = performance.now() - started;
            const used = process.cpuUsage(cpu);
            let validLatest = 0, outputRows = 0, bytes = 0;
            const content = [];
            for (const id of ids) {
                const file = path.join(directory, 'transcript', `${id}.jsonl`);
                const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
                bytes += Buffer.byteLength(text);
                const rows = text.trim().split('\n').filter(Boolean); outputRows += rows.length;
                let latest = null; try { latest = JSON.parse(rows.at(-1)); } catch {}
                if (candidate.isValidTranscriptRecord(latest, id, 'benchmark')) validLatest++;
                if (latest) { delete latest.collected_at; content.push(latest); }
            }
            return { implementation, scenario, repeat, wallMs, nodeCpuMs: (used.user + used.system) / 1000,
                providerCalls, outputRows, outputBytes: bytes, validLatest, expectedLatest: ids.length, semanticOutputSha256: hash(JSON.stringify(content)) };
        } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    }
    const observations = [];
    for (const scenario of ['unchanged', 'new', 'duplicate-urls', 'duration-change', 'empty-cache', 'truncated-cache', 'concurrent']) {
        for (let repeat = 0; repeat < 7; repeat++) {
            for (const implementation of repeat % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'])
                observations.push(await run(implementation === 'baseline' ? baseline : candidate, implementation, scenario, repeat));
        }
    }
    const sourceAfter = corpusHash();
    const report = { kind: 'controlled_transcript_collection_replay', measuredAt: new Date().toISOString(),
        benchmarkSourceSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
        baselineCommit, candidateSourceSha256: hash(fs.readFileSync(script)), baselineSourceSha256: hash(baselineSource),
        corpusAudit: audit, sourceSha256Before: sourceBefore, sourceSha256After: sourceAfter,
        sourcePreserved: sourceBefore === sourceAfter, environment: { node: process.version, platform: process.platform, architecture: process.arch },
        settings: { pairedRuns: 7, providerDelayMs: 2, actualNetworkRequests: 0, suppliedWaitDelayMs: 0,
            modulesAndWriterBroker: 'warm', cpuScope: 'Node process only; Python broker CPU excluded' },
        limitations: ['Synthetic provider responses; not supplier latency or cost.', 'Cold writer startup and production waits excluded.', 'Different valid-result rates invalidate speed comparisons for empty/truncated cache.'],
        observations };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    print(JSON.stringify({ observations: observations.length, sourcePreserved: report.sourcePreserved, corpusAudit: audit }));
} finally {
    console.log = print;
    fs.rmSync(baselinePath, { force: true });
}
