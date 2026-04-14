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
