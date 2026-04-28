import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MODULE_PATH = path.resolve(__dirname, '../04-extract-frames-with-heatmap.js');
const DATA_ROOT = path.resolve(__dirname, '../../data');

async function loadModule(envOverrides = {}) {
    const previousEnv = new Map();
    for (const [key, value] of Object.entries(envOverrides)) {
        previousEnv.set(key, process.env[key]);
        if (value === undefined || value === null) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }

    try {
        return await import(`${pathToFileURL(MODULE_PATH).href}?test=${Date.now()}-${Math.random()}`);
    } finally {
        for (const [key, value] of previousEnv.entries()) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
}

function makeTempDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('sortVideoCandidates prefers full containers over yt-dlp fragments', async () => {
    const cacheDir = makeTempDir('heatmap-cache-');
    const framesDir = makeTempDir('heatmap-frames-');
    const { sortVideoCandidates } = await loadModule({
        VIDEO_CACHE_DIR: cacheDir,
        FRAMES_ROOT_DIR: framesDir,
    });

    const sorted = sortVideoCandidates(
        ['abc123.f251.webm', 'abc123.webm', 'abc123.mp4', 'abc123.f303.webm'],
        'abc123'
    );

    assert.deepEqual(sorted, ['abc123.mp4', 'abc123.webm', 'abc123.f251.webm', 'abc123.f303.webm']);

    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(framesDir, { recursive: true, force: true });
});

test('pickUsableLocalVideoCandidate skips unusable fragment and returns next valid candidate', async () => {
    const cacheDir = makeTempDir('heatmap-cache-');
    const framesDir = makeTempDir('heatmap-frames-');
    const { pickUsableLocalVideoCandidate } = await loadModule({
        VIDEO_CACHE_DIR: cacheDir,
        FRAMES_ROOT_DIR: framesDir,
    });

    for (const fileName of ['abc123.f251.webm', 'abc123.f303.webm']) {
        fs.writeFileSync(path.join(cacheDir, fileName), 'stub', 'utf8');
    }

    const selectedPath = await pickUsableLocalVideoCandidate(
        'abc123',
        ['abc123.f251.webm', 'abc123.f303.webm'],
        cacheDir,
        'Test',
        async mediaPath => !mediaPath.endsWith('f251.webm')
    );

    assert.equal(path.basename(selectedPath), 'abc123.f303.webm');

    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(framesDir, { recursive: true, force: true });
});

test('fetchUsableGDriveVideo retries with the next candidate after audio-only download', async () => {
    const cacheDir = makeTempDir('heatmap-cache-');
    const framesDir = makeTempDir('heatmap-frames-');
    const outputDir = makeTempDir('heatmap-output-');
    const { fetchUsableGDriveVideo } = await loadModule({
        VIDEO_CACHE_DIR: cacheDir,
        FRAMES_ROOT_DIR: framesDir,
    });

    const fetched = [];
    const resultPath = await fetchUsableGDriveVideo('abc123', 'gdrive:archive', outputDir, {
        listCandidates: async () => ['abc123.f251.webm', 'abc123.f303.webm'],
        fetchCandidate: async (_remotePath, fileName, targetDir) => {
            fetched.push(fileName);
            const targetPath = path.join(targetDir, fileName);
            fs.writeFileSync(targetPath, 'stub', 'utf8');
            return targetPath;
        },
        validateMediaPath: async mediaPath => !mediaPath.endsWith('f251.webm'),
    });

    assert.deepEqual(fetched, ['abc123.f251.webm', 'abc123.f303.webm']);
    assert.equal(path.basename(resultPath), 'abc123.f303.webm');
    assert.equal(fs.existsSync(path.join(outputDir, 'abc123.f251.webm')), false);
    assert.equal(fs.existsSync(path.join(outputDir, 'abc123.f303.webm')), true);

    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
});

test('downloadVideo reuses the first cache candidate that actually has a video stream', async () => {
    const cacheDir = makeTempDir('heatmap-cache-');
    const framesDir = makeTempDir('heatmap-frames-');
    const outputDir = makeTempDir('heatmap-output-');
    for (const fileName of ['abc123.f251.webm', 'abc123.f303.webm']) {
        fs.writeFileSync(path.join(cacheDir, fileName), 'stub', 'utf8');
    }

    const { downloadVideo } = await loadModule({
        VIDEO_CACHE_DIR: cacheDir,
        FRAMES_ROOT_DIR: framesDir,
        GDRIVE_REMOTE_PATH: undefined,
    });

    const selectedPath = await downloadVideo('abc123', outputDir, '360p', {
        validateMediaPath: async mediaPath => !mediaPath.endsWith('f251.webm'),
    });

    assert.equal(path.basename(selectedPath), 'abc123.f303.webm');

    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
});

test('processSingleVideo re-extracts when reused segments miss a requested format subtree', async () => {
    const cacheDir = makeTempDir('heatmap-cache-');
    const framesDir = makeTempDir('heatmap-frames-');
    const channel = `heatmap-partial-reuse-${Date.now()}`;
    const channelDir = path.join(DATA_ROOT, channel);
    const videoId = 'abc123';
    fs.mkdirSync(path.join(channelDir, 'meta'), { recursive: true });
    fs.writeFileSync(
        path.join(channelDir, 'meta', `${videoId}.jsonl`),
        `${JSON.stringify({ recollect_id: 1, duration: 120 })}\n`,
        'utf8'
    );

    const previousSegmentDir = path.join(framesDir, videoId, '0', '1_1_2', 'jpg', '360p_1.0fps');
    fs.mkdirSync(previousSegmentDir, { recursive: true });
    fs.writeFileSync(path.join(previousSegmentDir, '1.00.jpg'), 'stub', 'utf8');

    const { processSingleVideo } = await loadModule({
        VIDEO_CACHE_DIR: cacheDir,
        FRAMES_ROOT_DIR: framesDir,
        GDRIVE_REMOTE_PATH: undefined,
    });

    let acquireCalls = 0;
    const extractedExts = [];
    await processSingleVideo(
        videoId,
        {
            channel,
            fps: 1.0,
            buffer: 0.0,
            quality: ['360p'],
            ext: ['jpg', 'webp'],
            url: 'https://www.youtube.com/watch?v=abc123',
        },
        {
            loadSegments: async () => [{ startSec: 1, endSec: 2, peakSec: 1.5 }],
            acquireVideo: async () => {
                acquireCalls += 1;
                return path.join(cacheDir, `${videoId}.mp4`);
            },
            extractFramesFn: async (_videoPath, _segments, _outputDir, _quality, _fps, _buffer, currentExt) => {
                extractedExts.push(currentExt);
                return { totalSegments: 1, failedSegments: 0, totalFrames: 1 };
            },
        }
    );

    assert.equal(acquireCalls, 1);
    assert.deepEqual(extractedExts, ['jpg', 'webp']);
    assert.equal(
        fs.existsSync(path.join(framesDir, videoId, '1', '1_1_2', 'jpg', '360p_1.0fps', '1.00.jpg')),
        true
    );

    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.rmSync(channelDir, { recursive: true, force: true });
});

test('processSingleVideo fails closed when no usable media fallback exists', async () => {
    const cacheDir = makeTempDir('heatmap-cache-');
    const framesDir = makeTempDir('heatmap-frames-');
    const channel = `heatmap-fail-closed-${Date.now()}`;
    const channelDir = path.join(DATA_ROOT, channel);
    fs.mkdirSync(channelDir, { recursive: true });

    const { processSingleVideo } = await loadModule({
        VIDEO_CACHE_DIR: cacheDir,
        FRAMES_ROOT_DIR: framesDir,
        GDRIVE_REMOTE_PATH: undefined,
    });

    await assert.rejects(
        processSingleVideo(
            'abc123',
            {
                channel,
                fps: 1.0,
                buffer: 0.0,
                quality: ['360p'],
                ext: ['jpg'],
                url: 'https://www.youtube.com/watch?v=abc123',
            },
            {
                loadSegments: async () => [{ startSec: 1, endSec: 2, peakSec: 1.5 }],
                acquireVideo: async () => null,
                extractFramesFn: async () => ({ totalSegments: 1, failedSegments: 0, totalFrames: 1 }),
            }
        ),
        /one or more quality\/extension jobs failed/
    );

    const failedUrlsPath = path.join(channelDir, 'failed_urls.txt');
    assert.equal(fs.existsSync(failedUrlsPath), true);
    assert.match(fs.readFileSync(failedUrlsPath, 'utf8'), /abc123/);

    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.rmSync(channelDir, { recursive: true, force: true });
});

test('downloadVideo gives up when yt-dlp exceeds the configured per-attempt timeout', async () => {
    const cacheDir = makeTempDir('heatmap-cache-');
    const framesDir = makeTempDir('heatmap-frames-');
    const outputDir = makeTempDir('heatmap-output-');
    const binDir = makeTempDir('heatmap-bin-');
    const fakeYtDlp = path.join(binDir, 'fake-yt-dlp.sh');
    fs.writeFileSync(fakeYtDlp, '#!/usr/bin/env bash\nsleep 2\n', 'utf8');
    fs.chmodSync(fakeYtDlp, 0o755);

    const { downloadVideo } = await loadModule({
        VIDEO_CACHE_DIR: cacheDir,
        FRAMES_ROOT_DIR: framesDir,
        GDRIVE_REMOTE_PATH: undefined,
        YT_DLP_CMD: fakeYtDlp,
        YT_DLP_DOWNLOAD_TIMEOUT_MS: '50',
        YT_DLP_MAX_RETRIES: '1',
    });

    const previousYtDlpCmd = process.env.YT_DLP_CMD;
    const previousTimeoutMs = process.env.YT_DLP_DOWNLOAD_TIMEOUT_MS;
    const previousMaxRetries = process.env.YT_DLP_MAX_RETRIES;
    process.env.YT_DLP_CMD = fakeYtDlp;
    process.env.YT_DLP_DOWNLOAD_TIMEOUT_MS = '50';
    process.env.YT_DLP_MAX_RETRIES = '1';

    let selectedPath;
    const startedAt = Date.now();
    try {
        selectedPath = await downloadVideo('abc123', outputDir, '360p', {
            validateMediaPath: async () => true,
        });
    } finally {
        if (previousYtDlpCmd === undefined) delete process.env.YT_DLP_CMD; else process.env.YT_DLP_CMD = previousYtDlpCmd;
        if (previousTimeoutMs === undefined) delete process.env.YT_DLP_DOWNLOAD_TIMEOUT_MS; else process.env.YT_DLP_DOWNLOAD_TIMEOUT_MS = previousTimeoutMs;
        if (previousMaxRetries === undefined) delete process.env.YT_DLP_MAX_RETRIES; else process.env.YT_DLP_MAX_RETRIES = previousMaxRetries;
    }

    assert.equal(selectedPath, null);
    assert.ok(Date.now() - startedAt < 1500, 'download should be bounded by the configured timeout');

    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
});

test('yt-dlp timeout helpers prefer explicit millisecond override', async () => {
    const cacheDir = makeTempDir('heatmap-cache-');
    const framesDir = makeTempDir('heatmap-frames-');
    const { buildYtDlpExecOptions, getYtDlpDownloadTimeoutMs, getYtDlpMaxRetries } = await loadModule({
        VIDEO_CACHE_DIR: cacheDir,
        FRAMES_ROOT_DIR: framesDir,
    });

    assert.equal(getYtDlpDownloadTimeoutMs({ YT_DLP_DOWNLOAD_TIMEOUT_SECONDS: '7' }), 7000);
    assert.equal(getYtDlpDownloadTimeoutMs({ YT_DLP_DOWNLOAD_TIMEOUT_MS: '123', YT_DLP_DOWNLOAD_TIMEOUT_SECONDS: '7' }), 123);
    assert.equal(getYtDlpMaxRetries({ YT_DLP_MAX_RETRIES: '1' }), 1);
    assert.deepEqual(buildYtDlpExecOptions({ YT_DLP_DOWNLOAD_TIMEOUT_MS: '321' }), {
        timeout: 321,
        killSignal: 'SIGTERM',
        maxBuffer: 20 * 1024 * 1024,
    });

    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(framesDir, { recursive: true, force: true });
});
