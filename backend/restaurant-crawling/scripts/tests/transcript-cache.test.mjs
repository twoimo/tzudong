import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectChannelTranscripts, getTranscript, isValidTranscriptRecord, main, updateNoTranscriptPermanent } from '../03-collect-transcript.js';

const videoId = 'AbCdEf123_-';
const url = `https://www.youtube.com/watch?v=${videoId}`;
const provider = { language: 'ko', source: 'fixture', transcript: [{ start: 0, duration: 1, text: 'fixture' }] };
const valid = { youtube_link: url, channel_name: 'test', recollect_id: 1, ...provider };

function fixture({ cached, repetitions = 1, meta = { recollect_id: 1 } } = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-cache-'));
    fs.mkdirSync(path.join(directory, 'meta'));
    fs.mkdirSync(path.join(directory, 'transcript'));
    fs.writeFileSync(path.join(directory, 'urls.txt'), Array(repetitions).fill(url).join('\n'));
    fs.writeFileSync(path.join(directory, 'meta', `${videoId}.jsonl`), JSON.stringify(meta) + '\n');
    const output = path.join(directory, 'transcript', `${videoId}.jsonl`);
    if (cached !== undefined) fs.writeFileSync(output, typeof cached === 'string' ? cached : JSON.stringify(cached) + '\n');
    return { directory, output };
}

function options(directory, getTranscriptForVideo) {
    return {
        dataPath: directory, getTranscriptForVideo,
        acquireSlot: async () => {}, releaseSlot: () => {}, waitForDelay: async () => {},
        loadSkipUrls: () => new Set(), recordNoTranscript: async () => {},
    };
}

test('Puppeteer legacy segments pass through getTranscript into a valid persisted transcript', async () => {
    const f = fixture();
    const segments = [{ start: 12, duration: null, text: 'fixture transcript' }];
    let fallbackCalls = 0;
    let response;
    try {
        const result = await collectChannelTranscripts('test', { name: 'test' }, options(f.directory, async (id) => {
            response = await getTranscript(id, {
                fetchYtDlpTranscript: async () => null,
                getTranscriptFromPuppeteer: async (requestedId) => {
                    assert.equal(requestedId, videoId);
                    fallbackCalls++;
                    return { text: '[00:12] fixture transcript', segments, language: 'ko' };
                },
            });
            return response;
        }));
        assert.equal(fallbackCalls, 1);
        assert.equal(result.success, 1);
        assert.equal(result.failed, 0);
        assert.deepEqual(response.transcript, segments);
        assert.deepEqual(response.segments, segments);
        const stored = JSON.parse(fs.readFileSync(f.output, 'utf8'));
        assert.equal(isValidTranscriptRecord(stored, videoId, 'test'), true);
        assert.deepEqual(stored.transcript, segments);
        assert.equal(stored.collector_source, 'puppeteer');
        assert.equal(Object.hasOwn(stored, 'text'), false);
        assert.equal(Object.hasOwn(stored, 'segments'), false);
    } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test('Puppeteer alias admission preserves validation and never hides an invalid canonical transcript', async () => {
    for (const result of [
        { segments: [] },
        { segments: [{ start: -1, text: 'invalid start' }] },
        { segments: [{ start: 0, text: ' ' }] },
        { transcript: [], segments: provider.transcript },
        { transcript: null, segments: provider.transcript },
        { transcript: undefined, segments: provider.transcript },
    ]) {
        const f = fixture({ cached: valid, meta: { recollect_id: 2, recollect_vars: ['duration_changed'] } });
        const before = fs.readFileSync(f.output);
        try {
            const stats = await collectChannelTranscripts('test', { name: 'test' }, options(f.directory, (id) => getTranscript(id, {
                fetchYtDlpTranscript: async () => null,
                getTranscriptFromPuppeteer: async () => ({ language: 'ko', ...result }),
            })));
            assert.equal(stats.failed, 1);
            assert.equal(stats.success, 0);
            assert.equal(stats.noTranscript, 0);
            assert.deepEqual(fs.readFileSync(f.output), before);
        } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
    }
});

test('legacy content is reusable only with valid identity and finite, non-empty segments', () => {
    assert.equal(isValidTranscriptRecord(valid, videoId, 'test'), true);
    assert.equal(isValidTranscriptRecord({ youtube_link: url, transcript: [{ start: 0, text: 'legacy' }] }, videoId, 'test'), true);
    assert.equal(isValidTranscriptRecord({ ...valid, transcript: [{ start: 0, duration: null, text: 'legacy missing duration' }] }, videoId, 'test'), true);
    for (const row of [
        {}, { ...valid, youtube_link: 'https://youtu.be/ZyXwVu987_-' },
        { ...valid, channel_name: 'other' }, { ...valid, recollect_id: -1 },
        { ...valid, transcript: [] }, { ...valid, transcript: [{ start: NaN, text: 'x' }] },
        { ...valid, transcript: [{ start: 0, text: ' ' }] },
        { ...valid, transcript: [{ start: 0, duration: -0.1, text: 'invalid duration' }] },
        { ...valid, transcript: [{ start: 0, duration: Infinity, text: 'x' }] },
    ]) assert.equal(isValidTranscriptRecord(row, videoId, 'test'), false);
});

test('valid cached content survives counter/title changes without provider calls or bytes changed', async () => {
    const f = fixture({ cached: valid, meta: { recollect_id: 2, recollect_vars: ['title_changed'], viewCount: 999 } });
    const before = fs.readFileSync(f.output);
    try {
        const result = await collectChannelTranscripts('test', { name: 'test' }, options(f.directory, () => { throw new Error('UNEXPECTED_CALL'); }));
        assert.equal(result.processed, 0);
        assert.deepEqual(fs.readFileSync(f.output), before);
    } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test('empty cache and duplicate URLs cause one repair with historical bytes preserved', async () => {
    const f = fixture({ cached: { ...valid, transcript: [] }, repetitions: 5 });
    const before = fs.readFileSync(f.output, 'utf8');
    let calls = 0;
    try {
        const result = await collectChannelTranscripts('test', { name: 'test' }, options(f.directory, async () => { calls++; return provider; }));
        assert.equal(calls, 1);
        assert.equal(result.success, 1);
        const after = fs.readFileSync(f.output, 'utf8');
        assert.ok(after.startsWith(before));
        const rows = after.trim().split('\n').map(JSON.parse);
        assert.equal(rows.length, 2);
        assert.equal(isValidTranscriptRecord(rows.at(-1), videoId, 'test'), true);
    } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test('a truncated latest row is preserved and a repaired row gets its own JSONL boundary', async () => {
    const damaged = '{"transcript":[';
    const f = fixture({ cached: damaged });
    try {
        await collectChannelTranscripts('test', { name: 'test' }, options(f.directory, async () => provider));
        const after = fs.readFileSync(f.output, 'utf8');
        assert.ok(after.startsWith(damaged + '\n'));
        assert.equal(isValidTranscriptRecord(JSON.parse(after.trim().split('\n').at(-1)), videoId, 'test'), true);
    } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test('empty provider output is a failure and does not replace history or count as success', async () => {
    const f = fixture({ cached: valid, meta: { recollect_id: 2, recollect_vars: ['duration_changed'] } });
    const before = fs.readFileSync(f.output);
    try {
        const result = await collectChannelTranscripts('test', { name: 'test' }, options(f.directory, async () => ({ ...provider, transcript: [] })));
        assert.equal(result.success, 0);
        assert.equal(result.failed, 1);
        assert.deepEqual(fs.readFileSync(f.output), before);
    } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test('two concurrent collectors recheck under one writer and admit only one provider call', async () => {
    const f = fixture();
    let calls = 0;
    try {
        const run = () => collectChannelTranscripts('test', { name: 'test' }, options(f.directory, async () => {
            calls++; await new Promise(resolve => setTimeout(resolve, 15)); return provider;
        }));
        const results = await Promise.all([run(), run()]);
        assert.equal(calls, 1);
        assert.equal(results.reduce((sum, row) => sum + row.success, 0), 1);
        assert.equal(fs.readFileSync(f.output, 'utf8').trim().split('\n').length, 1);
    } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test('permanent no-transcript policy still prevents a retry of invalid cached data', async () => {
    const f = fixture({ cached: { ...valid, transcript: [] } });
    try {
        const opts = options(f.directory, () => { throw new Error('UNEXPECTED_CALL'); });
        opts.loadSkipUrls = () => new Set([url]);
        const result = await collectChannelTranscripts('test', { name: 'test' }, opts);
        assert.equal(result.processed, 0);
        assert.equal(JSON.parse(fs.readFileSync(f.output, 'utf8')).transcript.length, 0);
    } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test('a failed shared ledger write counts once as failure and publishes no completed output', async () => {
    const f = fixture();
    try {
        const opts = options(f.directory, async () => null);
        opts.recordNoTranscript = async () => { throw new Error('TRANSCRIPT_LEDGER_FAILED'); };
        const result = await collectChannelTranscripts('test', { name: 'test' }, opts);
        assert.equal(result.failed, 1);
        assert.equal(result.noTranscript, 0);
        assert.equal(result.success, 0);
        assert.equal(fs.existsSync(f.output), false);
    } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test('concurrent shared ledger updates preserve both increments and unrelated entries', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-ledger-'));
    const ledger = path.join(directory, 'permanent.json');
    const other = { youtube_link: 'https://www.youtube.com/watch?v=ZyXwVu987_-', retry_num: 2 };
    fs.writeFileSync(ledger, JSON.stringify([{ youtube_link: url, retry_num: 1 }, other]));
    try {
        await Promise.all([updateNoTranscriptPermanent(url, ledger), updateNoTranscriptPermanent(url, ledger)]);
        const rows = JSON.parse(fs.readFileSync(ledger, 'utf8'));
        assert.equal(rows.find(row => row.youtube_link === url).retry_num, 3);
        assert.deepEqual(rows.find(row => row.youtube_link === other.youtube_link), other);
        assert.equal(fs.readdirSync(directory).some(file => file.startsWith('.write-')), false);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('a damaged failure ledger is not overwritten and its writer can be acquired after failure', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-ledger-damaged-'));
    const ledger = path.join(directory, 'permanent.json');
    const damaged = '{"entries":[';
    fs.writeFileSync(ledger, damaged);
    try {
        await assert.rejects(updateNoTranscriptPermanent(url, ledger));
        assert.equal(fs.readFileSync(ledger, 'utf8'), damaged);
        fs.writeFileSync(ledger, '[]');
        await updateNoTranscriptPermanent(url, ledger);
        assert.equal(JSON.parse(fs.readFileSync(ledger, 'utf8'))[0].retry_num, 1);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});


const scopeArgs = ['--channel', 'test', '--video-id', videoId];
const scopedMeta = { youtube_link: url, recollect_id: 1 };
function runScoped(directory, opts = {}) {
    return main(scopeArgs, {
        loadEnvironmentForRun: async () => {},
        loadConfig: async () => ({ channels: { test: { name: 'test' } } }),
        collect: (name, config, scope) => collectChannelTranscripts(name, config, {
            ...options(directory, async () => provider), ...opts, ...scope,
        }),
    });
}

test('scoped CLI rejects duplicate, URL, whitespace and malformed IDs before environment or collector', async (t) => {
    t.mock.method(console, 'log', () => {});
    const badArgs = [
        ['--channel', 'test', '--video-id'],
        ['--channel', 'test', '--video-id', ''],
        ['--channel', 'test', '--video-id', url],
        ['--channel', 'test', '--video-id', ` ${videoId}`],
        ['--channel', 'test', '--video-id', `${videoId} `],
        ['--channel', 'test', '--video-id', `${videoId}\n`],
        ['--channel', 'test', '--video-id', `${videoId}\r\n`],
        ['--channel', 'test', '--video-id', 'bad'],
        ['--channel', 'test', '--video-id', 'AbCdEf123_;'],
        [...scopeArgs, '--video-id', videoId],
        [...scopeArgs, '--channel', 'test'],
        [...scopeArgs, '-c', 'test'],
        [...scopeArgs, '--force'],
        ['--channel', 'test', `--video-id=${videoId}`],
        ['--channel', 'test', '--video-id ', videoId],
    ];
    for (const args of badArgs) {
        let environment = 0, config = 0, collector = 0;
        const exit = await main(args, {
            loadEnvironmentForRun: async () => { environment++; },
            loadConfig: async () => { config++; return { channels: { test: {} } }; },
            collect: async () => { collector++; return { success: 1, skipped: 0 }; },
        });
        assert.equal(exit, 2, JSON.stringify(args));
        assert.deepEqual([environment, config, collector], [0, 0, 0]);
    }
});

test('scoped CLI requires an explicit valid registered channel', async (t) => {
    t.mock.method(console, 'log', () => {});
    for (const args of [
        ['--video-id', videoId],
        ['--channel', ' test', '--video-id', videoId],
        ['--channel', 'test\n', '--video-id', videoId],
        ['--channel', '../test', '--video-id', videoId],
        ['--channel', 'unknown', '--video-id', videoId],
        ['--channel', 'toString', '--video-id', videoId],
    ]) {
        let calls = 0;
        assert.equal(await main(args, {
            loadEnvironmentForRun: async () => {},
            loadConfig: async () => ({ channels: { test: { name: 'test' } } }),
            collect: async () => { calls++; return { success: 1, skipped: 0 }; },
        }), 2);
        assert.equal(calls, 0);
    }
});

test('scoped main collects only its singleton and preserves sibling shorts and canonical input bytes', async () => {
    const f = fixture({ meta: scopedMeta });
    const others = ['ZyXwVu987_-', 'QrStUv456_-', 'ShOrTs123_-'];
    const urls = `${url}\n${others.map(id => `https://www.youtube.com/watch?v=${id}`).join('\n')}\n${url}\n`;
    fs.writeFileSync(path.join(f.directory, 'urls.txt'), urls);
    for (const id of others) fs.writeFileSync(path.join(f.directory, 'meta', `${id}.jsonl`), JSON.stringify({ youtube_link: `https://www.youtube.com/watch?v=${id}`, recollect_id: 1, duration: 30 }) + '\n');
    const calls = [];
    try {
        assert.equal(await runScoped(f.directory, { getTranscriptForVideo: async id => { calls.push(id); return provider; } }), 0);
        assert.deepEqual(calls, [videoId]);
        assert.equal(fs.readFileSync(path.join(f.directory, 'urls.txt'), 'utf8'), urls);
        assert.deepEqual(fs.readdirSync(path.join(f.directory, 'transcript')), [`${videoId}.jsonl`]);
        assert.equal(isValidTranscriptRecord(JSON.parse(fs.readFileSync(f.output, 'utf8')), videoId, 'test'), true);
    } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test('scoped admission rejects absent deleted skipped missing and mismatched metadata under the writer', async () => {
    for (const mode of ['absent', 'deleted', 'permanent', 'missing-meta', 'wrong-meta', 'malformed-meta', 'invalid-sequence']) {
        const f = fixture({ meta: scopedMeta });
        let calls = 0;
        try {
            if (mode === 'absent') fs.writeFileSync(path.join(f.directory, 'urls.txt'), 'https://www.youtube.com/watch?v=ZyXwVu987_-\n');
            if (mode === 'deleted') fs.writeFileSync(path.join(f.directory, 'deleted_urls.txt'), `${url}\t2026-01-01\n`);
            if (mode === 'missing-meta') fs.unlinkSync(path.join(f.directory, 'meta', `${videoId}.jsonl`));
            if (mode === 'wrong-meta') fs.writeFileSync(path.join(f.directory, 'meta', `${videoId}.jsonl`), JSON.stringify({ ...scopedMeta, youtube_link: 'https://www.youtube.com/watch?v=ZyXwVu987_-' }));
            if (mode === 'malformed-meta') fs.writeFileSync(path.join(f.directory, 'meta', `${videoId}.jsonl`), '{"recollect_id":');
            if (mode === 'invalid-sequence') fs.writeFileSync(path.join(f.directory, 'meta', `${videoId}.jsonl`), JSON.stringify({ ...scopedMeta, recollect_id: -1 }));
            const before = fs.readFileSync(path.join(f.directory, 'urls.txt'));
            assert.equal(await runScoped(f.directory, {
                getTranscriptForVideo: async () => { calls++; return provider; },
                loadSkipUrls: () => new Set(mode === 'permanent' ? [url] : []),
            }), 2, mode);
            assert.equal(calls, 0, mode);
            assert.equal(fs.existsSync(f.output), false, mode);
            assert.deepEqual(fs.readFileSync(path.join(f.directory, 'urls.txt')), before);
        } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
    }
});

test('scoped valid cached transcript is reused across repeated and concurrent runs without provider calls', async () => {
    const f = fixture({ meta: { ...scopedMeta, recollect_id: 2, recollect_vars: ['title_changed'] }, cached: valid });
    const before = fs.readFileSync(f.output);
    let calls = 0;
    const opts = { getTranscriptForVideo: async () => { calls++; return provider; } };
    try {
        assert.equal(await runScoped(f.directory, opts), 0);
        assert.deepEqual(await Promise.all([runScoped(f.directory, opts), runScoped(f.directory, opts)]), [0, 0]);
        assert.equal(calls, 0);
        assert.deepEqual(fs.readFileSync(f.output), before);
    } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test('scoped invalid provider and no-transcript results remain nonzero without replacing history', async () => {
    for (const response of [null, {}, { ...provider, transcript: [] }, { ...provider, transcript: [{ start: 0, text: ' ' }] }]) {
        const f = fixture({ meta: { ...scopedMeta, recollect_id: 2, recollect_vars: ['duration_changed'] }, cached: valid });
        const before = fs.readFileSync(f.output);
        let calls = 0;
        try {
            assert.equal(await runScoped(f.directory, { getTranscriptForVideo: async () => { calls++; return response; } }), 1);
            assert.equal(calls, 1);
            assert.deepEqual(fs.readFileSync(f.output), before);
        } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
    }
});

test('scoped partial append is unconfirmed and preserves the original damaged tail', async (t) => {
    const f = fixture({ meta: scopedMeta, cached: '{"old":' });
    const append = fs.appendFileSync;
    t.mock.method(fs, 'appendFileSync', (file, ...args) => file === f.output
        ? append(file, '{"partial":', 'utf8') : append(file, ...args));
    try {
        assert.equal(await runScoped(f.directory), 1);
        assert.equal(fs.readFileSync(f.output, 'utf8'), '{"old":{"partial":');
    } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test('scoped append cannot report success by reading an unchanged old valid row', async (t) => {
    const f = fixture({ meta: { ...scopedMeta, recollect_id: 2, recollect_vars: ['duration_changed'] }, cached: valid });
    const before = fs.readFileSync(f.output);
    const append = fs.appendFileSync;
    t.mock.method(fs, 'appendFileSync', (file, ...args) => file === f.output ? undefined : append(file, ...args));
    try {
        assert.equal(await runScoped(f.directory), 1);
        assert.deepEqual(fs.readFileSync(f.output), before);
    } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test('scoped cleanup failure stops without fallback or completed output', async () => {
    const f = fixture({ meta: scopedMeta });
    let calls = 0, fallback = 0;
    try {
        const exit = await runScoped(f.directory, { getTranscriptForVideo: id => getTranscript(id, {
            fetchYtDlpTranscript: async () => { calls++; throw Object.assign(new Error('fixed'), { code: 'TRANSCRIPT_YTDLP_TREE_CLEANUP_FAILED' }); },
            getTranscriptFromPuppeteer: async () => { fallback++; return provider; },
        }) });
        assert.equal(exit, 1);
        assert.equal(calls, 1);
        assert.equal(fallback, 0);
        assert.equal(fs.existsSync(f.output), false);
    } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test('scoped permanent-skip ledger parse failure is fail-closed before provider', async (t) => {
    const f = fixture({ meta: scopedMeta });
    const ledger = fileURLToPath(new URL('../../../data/no_transcript_link/no_transcript_permanent.json', import.meta.url));
    const exists = fs.existsSync, read = fs.readFileSync;
    t.mock.method(fs, 'existsSync', file => String(file) === ledger || exists(file));
    t.mock.method(fs, 'readFileSync', (file, ...args) => String(file) === ledger ? '{"broken":' : read(file, ...args));
    let calls = 0;
    try {
        assert.equal(await runScoped(f.directory, { loadSkipUrls: undefined, getTranscriptForVideo: async () => { calls++; return provider; } }), 2);
        assert.equal(calls, 0);
    } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test('actual scoped CLI rejects a URL ID with fixed exit2 before environment or provider work', () => {
    const source = fileURLToPath(new URL('../03-collect-transcript.js', import.meta.url));
    const run = spawnSync(process.execPath, [source, '--channel', 'test', '--video-id', url], { env: {}, encoding: 'utf8', timeout: 5000 });
    assert.equal(run.status, 2);
    assert.match(run.stdout, /TRANSCRIPT_VIDEO_SCOPE_INVALID/);
    assert.equal(run.stdout.includes(url), false);
    assert.equal(run.stderr, '');
});

test('default main still visits all configured channels with no singleton option', async () => {
    const seen = [];
    assert.equal(await main([], {
        loadEnvironmentForRun: async () => {},
        loadConfig: async () => ({ channels: { first: {}, second: {} } }),
        collect: async (name, _config, scope) => { seen.push([name, scope]); return { channel: name, success: 0, skipped: 0 }; },
    }), 0);
    assert.deepEqual(seen.map(row => row[0]), ['first', 'second']);
    assert.equal(seen.every(row => row[1] === undefined), true);
});


test('scoped admission rechecks canonical membership after waiting for the existing stage writer', async () => {
    const f = fixture({ meta: scopedMeta });
    let enter;
    const entered = new Promise(resolve => { enter = resolve; });
    let release;
    const held = new Promise(resolve => { release = resolve; });
    let calls = 0;
    try {
        const first = runScoped(f.directory, { getTranscriptForVideo: async () => {
            calls++; enter(); await held; return provider;
        } });
        await entered;
        const second = runScoped(f.directory, { getTranscriptForVideo: async () => { calls++; return provider; } });
        fs.writeFileSync(path.join(f.directory, 'urls.txt'), 'https://www.youtube.com/watch?v=ZyXwVu987_-\n');
        release();
        assert.deepEqual(await Promise.all([first, second]), [0, 2]);
        assert.equal(calls, 1);
    } finally { release?.(); fs.rmSync(f.directory, { recursive: true, force: true }); }
});
