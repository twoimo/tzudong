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
        ['Abc123Def45.f251.webm', 'Abc123Def45.webm', 'Abc123Def45.mp4', 'Abc123Def45.f303.webm'],
        'Abc123Def45'
    );
    assert.deepEqual(sorted, ['Abc123Def45.mp4', 'Abc123Def45.webm', 'Abc123Def45.f251.webm', 'Abc123Def45.f303.webm']);

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

    for (const fileName of ['Abc123Def45.f251.webm', 'Abc123Def45.f303.webm']) {
        fs.writeFileSync(path.join(cacheDir, fileName), 'stub', 'utf8');
    }

    const selectedPath = await pickUsableLocalVideoCandidate(
        'Abc123Def45',
        ['Abc123Def45.f251.webm', 'Abc123Def45.f303.webm'],
        cacheDir,
        'Test',
        async mediaPath => !mediaPath.endsWith('f251.webm')
    );

    assert.equal(path.basename(selectedPath), 'Abc123Def45.f303.webm');

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
    const resultPath = await fetchUsableGDriveVideo('Abc123Def45', 'gdrive:archive', outputDir, {
        listCandidates: async () => ['Abc123Def45.f251.webm', 'Abc123Def45.f303.webm'],
        fetchCandidate: async (_remotePath, fileName, targetDir) => {
            fetched.push(fileName);
            const targetPath = path.join(targetDir, fileName);
            fs.writeFileSync(targetPath, 'stub', 'utf8');
            return targetPath;
        },
        validateMediaPath: async mediaPath => !mediaPath.endsWith('f251.webm'),
    });

    assert.deepEqual(fetched, ['Abc123Def45.f251.webm', 'Abc123Def45.f303.webm']);
    assert.equal(path.basename(resultPath), 'Abc123Def45.f303.webm');
    assert.equal(fs.existsSync(path.join(outputDir, 'Abc123Def45.f251.webm')), false);
    assert.equal(fs.existsSync(path.join(outputDir, 'Abc123Def45.f303.webm')), true);

    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
});

test('downloadVideo reuses the first cache candidate that actually has a video stream', async () => {
    const cacheDir = makeTempDir('heatmap-cache-');
    const framesDir = makeTempDir('heatmap-frames-');
    const outputDir = makeTempDir('heatmap-output-');
    for (const fileName of ['Abc123Def45.f251.webm', 'Abc123Def45.f303.webm']) {
        fs.writeFileSync(path.join(cacheDir, fileName), 'stub', 'utf8');
    }

    const { downloadVideo } = await loadModule({
        VIDEO_CACHE_DIR: cacheDir,
        FRAMES_ROOT_DIR: framesDir,
        GDRIVE_REMOTE_PATH: undefined,
    });

    const selectedPath = await downloadVideo('Abc123Def45', outputDir, '360p', {
        validateMediaPath: async mediaPath => !mediaPath.endsWith('f251.webm'),
    });

    assert.equal(path.basename(selectedPath), 'Abc123Def45.f303.webm');

    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
});

test('processSingleVideo re-extracts when reused segments miss a requested format subtree', async () => {
    const cacheDir = makeTempDir('heatmap-cache-');
    const framesDir = makeTempDir('heatmap-frames-');
    const channel = `heatmap-partial-reuse-${Date.now()}`;
    const channelDir = path.join(DATA_ROOT, channel);
    const videoId = 'Abc123Def45';
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
            url: 'https://www.youtube.com/watch?v=Abc123Def45',
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
            'Abc123Def45',
            {
                channel,
                fps: 1.0,
                buffer: 0.0,
                quality: ['360p'],
                ext: ['jpg'],
                url: 'https://www.youtube.com/watch?v=Abc123Def45',
            },
            {
                loadSegments: async () => [{ startSec: 1, endSec: 2, peakSec: 1.5 }],
                acquireVideo: async () => null,
                extractFramesFn: async () => ({ totalSegments: 1, failedSegments: 0, totalFrames: 1 }),
            }
        ),
        /FRAME_VIDEO_UNAVAILABLE/
    );

    const failedUrlsPath = path.join(channelDir, 'failed_urls.txt');
    assert.equal(fs.existsSync(failedUrlsPath), true);
    assert.match(fs.readFileSync(failedUrlsPath, 'utf8'), /Abc123Def45/);

    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.rmSync(channelDir, { recursive: true, force: true });
});

test('processBatch stops scheduling after heatmap 429 storm limit and logs failed URLs', async () => {
    const cacheDir = makeTempDir('heatmap-cache-');
    const framesDir = makeTempDir('heatmap-frames-');
    const channel = `heatmap-storm-breaker-${Date.now()}`;
    const channelDir = path.join(DATA_ROOT, channel);
    fs.mkdirSync(channelDir, { recursive: true });
    fs.writeFileSync(
        path.join(channelDir, 'urls.txt'),
        [
            'https://www.youtube.com/watch?v=Storm000001',
            'https://www.youtube.com/watch?v=Storm000002',
            'https://www.youtube.com/watch?v=Storm000003',
        ].join('\n') + '\n',
        'utf8'
    );

    const { processBatch, getHeatmapRateLimitStormLimit, isHeatmapRateLimitError } = await loadModule({
        VIDEO_CACHE_DIR: cacheDir,
        FRAMES_ROOT_DIR: framesDir,
    });

    const previousMaxJobs = process.env.MAX_JOBS;
    const previousStormLimit = process.env.HEATMAP_RATE_LIMIT_STORM_LIMIT;
    process.env.MAX_JOBS = '1';
    process.env.HEATMAP_RATE_LIMIT_STORM_LIMIT = '2';

    const attempted = [];
    try {
        assert.equal(getHeatmapRateLimitStormLimit(), 2);
        assert.equal(isHeatmapRateLimitError(new Error('429_GOOGLE_SORRY_REDIRECT')), true);

        await assert.rejects(
            processBatch(
                {
                    channel,
                    fps: 1.0,
                    buffer: 0.0,
                    quality: ['360p'],
                    ext: ['jpg'],
                    force: true,
                },
                {
                    collectPredicate: () => true,
                    processVideo: async (videoId) => {
                        attempted.push(videoId);
                        throw new Error('429_GOOGLE_SORRY_REDIRECT');
                    },
                }
            ),
            /FRAME_BATCH_RATE_LIMIT_BREAKER_TRIPPED/
        );
    } finally {
        if (previousMaxJobs === undefined) delete process.env.MAX_JOBS; else process.env.MAX_JOBS = previousMaxJobs;
        if (previousStormLimit === undefined) delete process.env.HEATMAP_RATE_LIMIT_STORM_LIMIT; else process.env.HEATMAP_RATE_LIMIT_STORM_LIMIT = previousStormLimit;
    }

    assert.deepEqual(attempted, ['Storm000001', 'Storm000002']);

    const failedUrlsPath = path.join(channelDir, 'failed_urls.txt');
    assert.equal(fs.existsSync(failedUrlsPath), true);
    const failedUrls = fs.readFileSync(failedUrlsPath, 'utf8');
    assert.match(failedUrls, /Storm000001/);
    assert.match(failedUrls, /Storm000002/);
    assert.doesNotMatch(failedUrls, /Storm000003/);

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
        selectedPath = await downloadVideo('Abc123Def45', outputDir, '360p', {
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
test('hostile command, video, remote, and provider filename inputs never reach a child process or write target', async () => {
    const cacheDir = makeTempDir('heatmap-cache-');
    const framesDir = makeTempDir('heatmap-frames-');
    const outputDir = makeTempDir('heatmap-output-');
    const sentinelPath = path.join(outputDir, 'spawned-sentinel');
    const { downloadVideo, fetchUsableGDriveVideo, sortVideoCandidates } = await loadModule({
        VIDEO_CACHE_DIR: cacheDir,
        FRAMES_ROOT_DIR: framesDir,
    });
    const previous = new Map([
        ['YT_DLP_CMD', process.env.YT_DLP_CMD],
        ['PYTHON_CMD', process.env.PYTHON_CMD],
        ['GDRIVE_REMOTE_PATH', process.env.GDRIVE_REMOTE_PATH],
    ]);

    try {
        process.env.YT_DLP_CMD = `yt-dlp;${sentinelPath}`;
        delete process.env.PYTHON_CMD;
        delete process.env.GDRIVE_REMOTE_PATH;
        await assert.rejects(
            downloadVideo('Abc123Def45', outputDir, '360p'),
            /FRAME_INVALID_YT_DLP_CMD/
        );

        delete process.env.YT_DLP_CMD;
        process.env.PYTHON_CMD = `python3;${sentinelPath}`;
        await assert.rejects(
            downloadVideo('Abc123Def45', outputDir, '360p'),
            /FRAME_INVALID_PYTHON_CMD/
        );

        delete process.env.PYTHON_CMD;
        process.env.GDRIVE_REMOTE_PATH = 'C:archive';
        await assert.rejects(
            downloadVideo('Abc123Def45', outputDir, '360p'),
            /FRAME_INVALID_GDRIVE_REMOTE_PATH/
        );
        process.env.GDRIVE_REMOTE_PATH = `gdrive:archive;${sentinelPath}`;
        await assert.rejects(
            downloadVideo('Abc123Def45', outputDir, '360p'),
            /FRAME_INVALID_GDRIVE_REMOTE_PATH/
        );

        delete process.env.GDRIVE_REMOTE_PATH;
        await assert.rejects(
            downloadVideo('../Abc123Def45', outputDir, '360p'),
            /FRAME_INVALID_VIDEO_ID/
        );

        const fetchedCandidates = [];
        const validCandidate = 'Abc123Def45.mp4';
        const result = await fetchUsableGDriveVideo('Abc123Def45', 'gdrive:archive', outputDir, {
            listCandidates: async () => [
                '../Abc123Def45.mp4',
                `Abc123Def45;${sentinelPath}.mp4`,
                '\\\\server\\share.mp4',
                'C:provider.mp4',
                'NUL.mp4',
                validCandidate,
            ],
            fetchCandidate: async (_remotePath, fileName, targetDir) => {
                fetchedCandidates.push(fileName);
                const targetPath = path.join(targetDir, fileName);
                fs.writeFileSync(targetPath, 'stub', 'utf8');
                return targetPath;
            },
            validateMediaPath: async () => true,
        });

        assert.equal(result, path.join(outputDir, validCandidate));
        assert.deepEqual(fetchedCandidates, [validCandidate]);
        assert.deepEqual(
            sortVideoCandidates(['../Abc123Def45.mp4', 'Abc123Def45;touch.mp4', validCandidate], 'Abc123Def45'),
            [validCandidate]
        );
        assert.equal(fs.existsSync(sentinelPath), false);
    } finally {
        for (const [key, value] of previous.entries()) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    }

    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
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
        shell: false,
    });

    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(framesDir, { recursive: true, force: true });
});
test('unusable static ffprobe falls back to a runnable PATH tool', async () => {
    if (process.platform === 'win32') return;

    const cacheDir = makeTempDir('heatmap-cache-');
    const framesDir = makeTempDir('heatmap-frames-');
    const toolDir = makeTempDir('heatmap-tools-');
    const previousPath = process.env.PATH;
    const { resolveMediaTools, isRunnableMediaTool } = await loadModule({
        VIDEO_CACHE_DIR: cacheDir,
        FRAMES_ROOT_DIR: framesDir,
        FFMPEG_CMD: undefined,
        FFPROBE_CMD: undefined,
    });

    try {
        const ffmpegShim = path.join(toolDir, 'ffmpeg');
        const ffprobeShim = path.join(toolDir, 'ffprobe');
        const deadStatic = path.join(toolDir, 'dead-ffprobe');
        fs.writeFileSync(ffmpegShim, '#!/bin/sh\necho "ffmpeg version 6.0 test"\n', 'utf8');
        fs.writeFileSync(ffprobeShim, '#!/bin/sh\necho "ffprobe version 6.0 test"\n', 'utf8');
        fs.writeFileSync(deadStatic, '', 'utf8');
        fs.chmodSync(ffmpegShim, 0o755);
        fs.chmodSync(ffprobeShim, 0o755);

        process.env.PATH = `${toolDir}${path.delimiter}${previousPath || ''}`;

        assert.equal(isRunnableMediaTool(deadStatic), false);
        assert.equal(isRunnableMediaTool(ffprobeShim), true);

        const tools = resolveMediaTools(process.env, {
            ffmpegStaticPath: deadStatic,
            ffprobeStaticPath: deadStatic,
        });
        assert.equal(tools.ffmpegPath, 'ffmpeg');
        assert.equal(tools.ffprobePath, 'ffprobe');

        await assert.rejects(
            async () => resolveMediaTools({
                ...process.env,
                FFPROBE_CMD: deadStatic,
            }, {
                ffmpegStaticPath: ffmpegShim,
                ffprobeStaticPath: deadStatic,
            }),
            /FRAME_INVALID_FFPROBE_CMD/
        );
    } finally {
        if (previousPath === undefined) {
            delete process.env.PATH;
        } else {
            process.env.PATH = previousPath;
        }
        fs.rmSync(cacheDir, { recursive: true, force: true });
        fs.rmSync(framesDir, { recursive: true, force: true });
        fs.rmSync(toolDir, { recursive: true, force: true });
    }
});
test('processBatch continues after expected unavailable videos and still fails closed on extraction errors', async () => {
    const cacheDir = makeTempDir('heatmap-cache-');
    const framesDir = makeTempDir('heatmap-frames-');
    const channel = `heatmap-unavailable-continue-${Date.now()}`;
    const channelDir = path.join(DATA_ROOT, channel);
    fs.mkdirSync(channelDir, { recursive: true });
    fs.writeFileSync(
        path.join(channelDir, 'urls.txt'),
        [
            'https://www.youtube.com/watch?v=Unavail0001',
            'https://www.youtube.com/watch?v=Extract0001',
        ].join('\n') + '\n',
        'utf8'
    );

    const { processBatch, isExpectedVideoUnavailable } = await loadModule({
        VIDEO_CACHE_DIR: cacheDir,
        FRAMES_ROOT_DIR: framesDir,
    });
    const previousMaxJobs = process.env.MAX_JOBS;
    process.env.MAX_JOBS = '1';

    const attempted = [];
    try {
        assert.equal(isExpectedVideoUnavailable(Object.assign(new Error('FRAME_VIDEO_UNAVAILABLE'), { code: 'FRAME_VIDEO_UNAVAILABLE' })), true);
        assert.equal(isExpectedVideoUnavailable(Object.assign(new Error('FRAME_SEGMENT_EXTRACTION_FAILED'), { code: 'FRAME_SEGMENT_EXTRACTION_FAILED' })), false);

        await assert.rejects(
            processBatch(
                {
                    channel,
                    fps: 1.0,
                    buffer: 0.0,
                    quality: ['360p'],
                    ext: ['jpg'],
                    force: true,
                },
                {
                    collectPredicate: () => true,
                    processVideo: async (videoId) => {
                        attempted.push(videoId);
                        if (videoId === 'Unavail0001') {
                            throw Object.assign(new Error('FRAME_VIDEO_UNAVAILABLE'), { code: 'FRAME_VIDEO_UNAVAILABLE' });
                        }
                        throw Object.assign(new Error('FRAME_SEGMENT_EXTRACTION_FAILED'), { code: 'FRAME_SEGMENT_EXTRACTION_FAILED' });
                    },
                }
            ),
            /FRAME_BATCH_FAILED/
        );
    } finally {
        if (previousMaxJobs === undefined) delete process.env.MAX_JOBS;
        else process.env.MAX_JOBS = previousMaxJobs;
    }

    assert.deepEqual(attempted, ['Unavail0001', 'Extract0001']);

    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.rmSync(channelDir, { recursive: true, force: true });
});

test('processBatch succeeds when the only failures are unavailable videos', async () => {
    const cacheDir = makeTempDir('heatmap-cache-');
    const framesDir = makeTempDir('heatmap-frames-');
    const channel = `heatmap-unavailable-ok-${Date.now()}`;
    const channelDir = path.join(DATA_ROOT, channel);
    fs.mkdirSync(channelDir, { recursive: true });
    fs.writeFileSync(
        path.join(channelDir, 'urls.txt'),
        'https://www.youtube.com/watch?v=Unavail0001\n',
        'utf8'
    );

    const { processBatch } = await loadModule({
        VIDEO_CACHE_DIR: cacheDir,
        FRAMES_ROOT_DIR: framesDir,
    });
    const previousMaxJobs = process.env.MAX_JOBS;
    process.env.MAX_JOBS = '1';

    try {
        await processBatch(
            {
                channel,
                fps: 1.0,
                buffer: 0.0,
                quality: ['360p'],
                ext: ['jpg'],
                force: true,
            },
            {
                collectPredicate: () => true,
                processVideo: async () => {
                    throw Object.assign(new Error('FRAME_VIDEO_UNAVAILABLE'), { code: 'FRAME_VIDEO_UNAVAILABLE' });
                },
            }
        );
    } finally {
        if (previousMaxJobs === undefined) delete process.env.MAX_JOBS;
        else process.env.MAX_JOBS = previousMaxJobs;
    }

    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.rmSync(channelDir, { recursive: true, force: true });
});
