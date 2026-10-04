import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectChannelTranscripts, isValidTranscriptRecord, updateNoTranscriptPermanent } from '../03-collect-transcript.js';

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
