/**
 * 유튜브 히트맵 기반 고화질 프레임 추출 및 자동 수집기
 *
 * 이 스크립트는 유튜브 영상의 '가장 많이 다시 본 장면(Heatmap Peak)'을 분석하여
 * 해당 구간의 고화질 프레임을 자동으로 추출합니다.
 *
 * [실행 모드]
 * 1. 자동 배치 수집 (Automatic Batch Mode)
 *    - 사용법: node 04-extract-frames-with-heatmap.js
 *    - 동작: `urls.txt`의 모든 영상을 순회하며 수집 조건(게시 D+7 경과, 스케줄/변경 트리거 등)을 만족하는 경우에만 실행
 *
 * 2. 단일 영상 수집 (Single Video Mode)
 *    - 사용법: node 04-extract-frames-with-heatmap.js --url "https://youtu.be/..."
 *    - 동작: 조건과 관계없이 지정된 영상의 프레임을 즉시 추출
 *
 * [옵션]
 * --url       : 대상 유튜브 영상 URL (생략 시 자동 배치 모드 작동)
 * --channel   : 채널명 (기본: tzuyang)
 * --fps       : 초당 추출 프레임 수 (기본: 1.0)
 * --buffer    : 피크 지점 기준 앞뒤 여유 시간(초) (기본: 0.0)
 * --quality   : 다운로드 화질 (예: 1080p,720p,360p) (기본: 360p) - 쉼표로 구분하여 다중 지정 가능
 * --ext       : 이미지 포맷 (예: webp,png,jpg) (기본: jpg) - 쉼표로 구분하여 다중 지정 가능
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawn, spawnSync } from 'child_process';
import https from 'https';
// [추가] 정적 빌드 FFmpeg/FFprobe 경로 로드
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { safeErrorName } from '../../utils/privacy-log.mjs';

const STATIC_FFMPEG_PATH = typeof ffmpegStatic === 'string' ? ffmpegStatic : '';
const STATIC_FFPROBE_PATH = typeof ffprobeStatic?.path === 'string' ? ffprobeStatic.path : '';
const ALLOWLISTED_FFMPEG_NAMES = ['ffmpeg', 'ffmpeg.exe'];
const ALLOWLISTED_FFPROBE_NAMES = ['ffprobe', 'ffprobe.exe'];
const MEDIA_TOOL_VERSION_RE = /\b(?:ffmpeg|ffprobe) version\b/i;
const MEDIA_TOOL_PROBE_TIMEOUT_MS = 5_000;
const SUPPORTED_VIDEO_CONTAINER_RE = /\.(mp4|webm|mkv)$/i;
const YTDLP_FRAGMENT_FILE_RE = /\.f\d+\.(mp4|webm|mkv)$/i;
const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const SAFE_PROVIDER_BASENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_CHANNEL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SAFE_GDRIVE_REMOTE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHELL_METACHARACTER_RE = /[&|;<>()$`"'*?[\]{}!~#%]/;
const CONTROL_CHARACTER_RE = /[\u0000-\u001F\u007F]/;
const WINDOWS_DEVICE_NAME_RE = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;
const PATH_TRAVERSAL_SEGMENT_RE = /(?:^|[\\/])\.\.(?:[\\/]|$)/;
const UNC_OR_DEVICE_PATH_RE = /^(?:\\\\|\/\/)/;
const DEFAULT_YT_DLP_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_YT_DLP_MAX_RETRIES = 3;
const YT_DLP_EXEC_MAX_BUFFER_BYTES = 20 * 1024 * 1024;
const PROCESS_STDOUT_MAX_BYTES = 1024 * 1024;
const PROCESS_STDERR_MAX_BYTES = 1024 * 1024;
const PROCESS_TERMINATION_GRACE_MS = 1000;
const RCLONE_TIMEOUT_MS = 5 * 60 * 1000;
const FFPROBE_TIMEOUT_MS = 30 * 1000;
const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_HEATMAP_RATE_LIMIT_STORM_LIMIT = 5;
const STAGE_ENVIRONMENT_KEYS = ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL'];

function createOperationError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}
const EXPECTED_VIDEO_UNAVAILABLE_CODES = new Set([
    'FRAME_VIDEO_UNAVAILABLE',
]);

function getFrameErrorCode(error) {
    if (typeof error?.code === 'string' && error.code.startsWith('FRAME_')) {
        return error.code;
    }
    if (typeof error?.message === 'string' && error.message.startsWith('FRAME_')) {
        return error.message.split(/\s/, 1)[0];
    }
    return '';
}

function isExpectedVideoUnavailable(error) {
    return EXPECTED_VIDEO_UNAVAILABLE_CODES.has(getFrameErrorCode(error));
}

function hasControlCharacters(value) {
    return typeof value !== 'string' || CONTROL_CHARACTER_RE.test(value);
}
function assertSafeChannelName(channelName) {
    if (typeof channelName !== 'string' || !SAFE_CHANNEL_NAME_RE.test(channelName)) {
        throw createOperationError('FRAME_INVALID_CHANNEL');
    }
    return channelName;
}

function isValidYouTubeVideoId(videoId) {
    return typeof videoId === 'string' && YOUTUBE_VIDEO_ID_RE.test(videoId);
}

function assertValidYouTubeVideoId(videoId) {
    if (!isValidYouTubeVideoId(videoId)) {
        throw createOperationError('FRAME_INVALID_VIDEO_ID');
    }
    return videoId;
}

function getSafeProviderBasename(value) {
    if (hasControlCharacters(value) || value.length > 128 || !SAFE_PROVIDER_BASENAME_RE.test(value)) {
        return null;
    }

    if (
        value === '.' ||
        value === '..' ||
        value.includes('/') ||
        value.includes('\\') ||
        value.includes('..') ||
        path.basename(value) !== value ||
        path.win32.basename(value) !== value ||
        path.isAbsolute(value) ||
        path.win32.isAbsolute(value) ||
        WINDOWS_DEVICE_NAME_RE.test(value) ||
        SHELL_METACHARACTER_RE.test(value)
    ) {
        return null;
    }

    return value;
}

function getSafeGDriveRemotePath(value) {
    const remoteName = typeof value === 'string' ? value.split(':', 1)[0] : '';
    if (
        hasControlCharacters(value) ||
        value.length > 192 ||
        !SAFE_GDRIVE_REMOTE_RE.test(value) ||
        value.includes('/') ||
        value.includes('\\') ||
        value.includes('..') ||
        path.isAbsolute(value) ||
        path.win32.isAbsolute(value) ||
        SHELL_METACHARACTER_RE.test(value) ||
        /^[A-Za-z]$/.test(remoteName) ||
        WINDOWS_DEVICE_NAME_RE.test(remoteName)
    ) {
        return null;
    }

    return value;
}

function isAbsolutePath(value) {
    return path.isAbsolute(value) || path.win32.isAbsolute(value);
}

function resolveConfiguredExecutable(value, label, allowlistedNames) {
    if (value === undefined || value === null || value === '') {
        return null;
    }

    if (
        hasControlCharacters(value) ||
        value !== value.trim() ||
        value.length > 1024 ||
        SHELL_METACHARACTER_RE.test(value) ||
        PATH_TRAVERSAL_SEGMENT_RE.test(value) ||
        UNC_OR_DEVICE_PATH_RE.test(value)
    ) {
        throw createOperationError(`FRAME_INVALID_${label}`);
    }

    const allowlistedName = allowlistedNames.find(name => name.toLowerCase() === value.toLowerCase());
    if (allowlistedName) {
        return allowlistedName;
    }

    if (!isAbsolutePath(value)) {
        throw createOperationError(`FRAME_INVALID_${label}`);
    }

    try {
        const resolved = fs.realpathSync(value);
        if (!fs.statSync(resolved).isFile()) {
            throw createOperationError(`FRAME_INVALID_${label}`);
        }
        return resolved;
    } catch {
        throw createOperationError(`FRAME_INVALID_${label}`);
    }
}
function collectMediaToolVersionText(result) {
    return `${result.stdout || ''}\n${result.stderr || ''}`;
}

function mediaToolReportsVersion(result) {
    return result.status === 0 && MEDIA_TOOL_VERSION_RE.test(collectMediaToolVersionText(result));
}

function probeMediaTool(file) {
    try {
        return spawnSync(file, ['-version'], {
            shell: false,
            windowsHide: true,
            encoding: 'utf8',
            timeout: MEDIA_TOOL_PROBE_TIMEOUT_MS,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: getStageEnvironment(),
        });
    } catch {
        return { status: 1, error: new Error('FRAME_PROCESS_START_FAILED'), stdout: '', stderr: '' };
    }
}

function isRunnableMediaTool(file) {
    if (typeof file !== 'string' || file.length === 0) {
        return false;
    }
    const result = probeMediaTool(file);
    if (result.error && (result.error.code === 'ENOENT' || result.error.code === 'EACCES')) {
        return false;
    }
    if (typeof result.error?.message === 'string' && /Bad CPU type in executable/i.test(result.error.message)) {
        return false;
    }
    if (typeof result.stderr === 'string' && /Bad CPU type in executable/i.test(result.stderr)) {
        return false;
    }
    if (result.status === 126 || result.status === 127) {
        return false;
    }
    return mediaToolReportsVersion(result);
}

function resolvePathMediaTool(allowlistedNames) {
    for (const name of allowlistedNames) {
        if (isRunnableMediaTool(name)) {
            return name;
        }
    }
    return null;
}

function resolveOptionalMediaToolOverride(value, label, allowlistedNames) {
    const configured = resolveConfiguredExecutable(value, label, allowlistedNames);
    if (!configured) {
        return null;
    }
    if (!isRunnableMediaTool(configured)) {
        throw createOperationError(`FRAME_INVALID_${label}`);
    }
    return configured;
}

function resolveRequiredMediaTool({ configuredValue, label, allowlistedNames, staticPath }) {
    const configured = resolveOptionalMediaToolOverride(configuredValue, label, allowlistedNames);
    if (configured) {
        return configured;
    }
    if (staticPath && isRunnableMediaTool(staticPath)) {
        return staticPath;
    }
    const pathTool = resolvePathMediaTool(allowlistedNames);
    if (pathTool) {
        return pathTool;
    }
    throw createOperationError(`FRAME_UNAVAILABLE_${label}`);
}

function resolveMediaTools(env = process.env, options = {}) {
    return {
        ffmpegPath: resolveRequiredMediaTool({
            configuredValue: env.FFMPEG_CMD,
            label: 'FFMPEG_CMD',
            allowlistedNames: ALLOWLISTED_FFMPEG_NAMES,
            staticPath: Object.hasOwn(options, 'ffmpegStaticPath') ? options.ffmpegStaticPath : STATIC_FFMPEG_PATH,
        }),
        ffprobePath: resolveRequiredMediaTool({
            configuredValue: env.FFPROBE_CMD,
            label: 'FFPROBE_CMD',
            allowlistedNames: ALLOWLISTED_FFPROBE_NAMES,
            staticPath: Object.hasOwn(options, 'ffprobeStaticPath') ? options.ffprobeStaticPath : STATIC_FFPROBE_PATH,
        }),
    };
}

let cachedMediaTools = null;

function getMediaTools(env = process.env) {
    if (env !== process.env) {
        return resolveMediaTools(env);
    }
    if (!cachedMediaTools) {
        cachedMediaTools = resolveMediaTools(env);
    }
    return cachedMediaTools;
}

function resolveYtDlpInvocation(env = process.env) {
    const ytDlp = resolveConfiguredExecutable(env.YT_DLP_CMD, 'YT_DLP_CMD', ['yt-dlp', 'yt-dlp.exe']);
    const python = resolveConfiguredExecutable(env.PYTHON_CMD, 'PYTHON_CMD', ['python', 'python.exe', 'python3', 'python3.exe']);

    if (ytDlp) {
        return { file: ytDlp, args: [] };
    }

    if (process.platform === 'win32') {
        return { file: python || 'python', args: ['-m', 'yt_dlp'] };
    }

    return { file: 'yt-dlp', args: [] };
}
function resolveDownloadConfiguration(env = process.env) {
    const configuredRemotePath = env.GDRIVE_REMOTE_PATH;
    const gdriveRemotePath = configuredRemotePath ? getSafeGDriveRemotePath(configuredRemotePath) : null;
    if (configuredRemotePath && !gdriveRemotePath) {
        throw createOperationError('FRAME_INVALID_GDRIVE_REMOTE_PATH');
    }

    return {
        gdriveRemotePath,
        ytDlpInvocation: resolveYtDlpInvocation(env),
    };
}

function getStageEnvironment(env = process.env) {
    const stageEnvironment = {};
    for (const key of STAGE_ENVIRONMENT_KEYS) {
        if (typeof env[key] === 'string' && !hasControlCharacters(env[key])) {
            stageEnvironment[key] = env[key];
        }
    }
    return stageEnvironment;
}

function isPathContained(rootPath, candidatePath) {
    const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
    return relativePath === '' || (!relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath));
}

function resolveContainedPath(rootPath, ...segments) {
    const resolvedRoot = path.resolve(rootPath);
    const targetPath = path.resolve(resolvedRoot, ...segments);
    if (!isPathContained(resolvedRoot, targetPath)) {
        throw createOperationError('FRAME_PATH_OUTSIDE_ROOT');
    }
    return targetPath;
}

function assertPathContainmentBeforeMutation(rootPath, targetPath) {
    const resolvedRoot = fs.realpathSync(rootPath);
    let existingPath = path.resolve(targetPath);
    while (!fs.existsSync(existingPath)) {
        const parentPath = path.dirname(existingPath);
        if (parentPath === existingPath) {
            throw createOperationError('FRAME_PATH_OUTSIDE_ROOT');
        }
        existingPath = parentPath;
    }

    if (!isPathContained(resolvedRoot, fs.realpathSync(existingPath))) {
        throw createOperationError('FRAME_PATH_OUTSIDE_ROOT');
    }
}

function assertExistingPathContained(rootPath, targetPath) {
    if (!isPathContained(rootPath, targetPath)) {
        throw createOperationError('FRAME_PATH_OUTSIDE_ROOT');
    }
    if (!fs.existsSync(targetPath) || !isPathContained(fs.realpathSync(rootPath), fs.realpathSync(targetPath))) {
        throw createOperationError('FRAME_PATH_OUTSIDE_ROOT');
    }
}

function ensureContainedDirectory(rootPath, ...segments) {
    const targetPath = resolveContainedPath(rootPath, ...segments);
    assertPathContainmentBeforeMutation(rootPath, targetPath);
    fs.mkdirSync(targetPath, { recursive: true });
    assertExistingPathContained(rootPath, targetPath);
    return targetPath;
}

function removeContainedFile(rootPath, targetPath) {
    assertExistingPathContained(rootPath, targetPath);
    fs.unlinkSync(targetPath);
}

function removeContainedDirectory(rootPath, targetPath) {
    assertExistingPathContained(rootPath, targetPath);
    fs.rmSync(targetPath, { recursive: true, force: true });
}

function requireExistingDirectory(directoryPath) {
    if (hasControlCharacters(directoryPath)) {
        throw createOperationError('FRAME_INVALID_OUTPUT_DIRECTORY');
    }

    const resolved = path.resolve(directoryPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        throw createOperationError('FRAME_INVALID_OUTPUT_DIRECTORY');
    }
    return resolved;
}

function runProcess(file, args, options = {}) {
    const {
        timeoutMs = FFMPEG_TIMEOUT_MS,
        stdoutMaxBytes = PROCESS_STDOUT_MAX_BYTES,
        stderrMaxBytes = PROCESS_STDERR_MAX_BYTES,
        env = getStageEnvironment(),
    } = options;

    return new Promise((resolve, reject) => {
        let child;
        try {
            child = spawn(file, args, {
                shell: false,
                windowsHide: true,
                detached: process.platform !== 'win32',
                env,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch {
            reject(createOperationError('FRAME_PROCESS_START_FAILED'));
            return;
        }

        let stdout = '';
        let stderr = '';
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let failure = null;
        let terminationTimer = null;
        let timeoutTimer = null;

        const killChild = (signal) => {
            const pid = child.pid;
            if (process.platform !== 'win32' && Number.isInteger(pid) && pid > 0) {
                try {
                    process.kill(-pid, signal);
                    return;
                } catch {
                    // Fall back to the direct child when it is not a process-group leader.
                }
            }
            try {
                child.kill(signal);
            } catch {
                // Close handling below reports the bounded failure code.
            }
        };

        const requestTermination = (error) => {
            if (failure) return;
            failure = error;
            killChild('SIGTERM');
            terminationTimer = setTimeout(() => {
                killChild('SIGKILL');
            }, PROCESS_TERMINATION_GRACE_MS);
            terminationTimer.unref?.();
        };

        const collectOutput = (streamName, limit) => (chunk) => {
            if (failure) return;
            const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
            const byteLength = Buffer.byteLength(text);
            if (streamName === 'stdout') {
                stdoutBytes += byteLength;
                if (stdoutBytes > limit) {
                    requestTermination(createOperationError('FRAME_PROCESS_STDOUT_LIMIT'));
                    return;
                }
                stdout += text;
                return;
            }

            stderrBytes += byteLength;
            if (stderrBytes > limit) {
                requestTermination(createOperationError('FRAME_PROCESS_STDERR_LIMIT'));
                return;
            }
            stderr += text;
        };

        child.stdout.on('data', collectOutput('stdout', stdoutMaxBytes));
        child.stderr.on('data', collectOutput('stderr', stderrMaxBytes));
        child.once('error', () => {
            requestTermination(createOperationError('FRAME_PROCESS_START_FAILED'));
        });
        child.once('close', (code, signal) => {
            if (timeoutTimer) clearTimeout(timeoutTimer);
            if (terminationTimer) clearTimeout(terminationTimer);

            if (failure) {
                reject(failure);
            } else if (code !== 0) {
                reject(createOperationError(signal ? 'FRAME_PROCESS_TERMINATED' : 'FRAME_PROCESS_EXIT_FAILED'));
            } else {
                resolve({ stdout, stderr });
            }
        });

        timeoutTimer = setTimeout(() => {
            requestTermination(createOperationError('FRAME_PROCESS_TIMEOUT'));
        }, timeoutMs);
        timeoutTimer.unref?.();
    });
}

function parsePositiveInteger(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getYtDlpDownloadTimeoutMs(env = process.env) {
    const timeoutMs = parsePositiveInteger(env.YT_DLP_DOWNLOAD_TIMEOUT_MS);
    if (timeoutMs) return timeoutMs;

    const timeoutSeconds = parsePositiveInteger(env.YT_DLP_DOWNLOAD_TIMEOUT_SECONDS);
    if (timeoutSeconds) return timeoutSeconds * 1000;

    return DEFAULT_YT_DLP_DOWNLOAD_TIMEOUT_MS;
}

function getYtDlpMaxRetries(env = process.env) {
    return parsePositiveInteger(env.YT_DLP_MAX_RETRIES) || DEFAULT_YT_DLP_MAX_RETRIES;
}

function getHeatmapRateLimitStormLimit(env = process.env) {
    return parsePositiveInteger(env.HEATMAP_RATE_LIMIT_STORM_LIMIT) || DEFAULT_HEATMAP_RATE_LIMIT_STORM_LIMIT;
}

function isHeatmapRateLimitError(error) {
    const message = (error?.message || String(error || '')).toLowerCase();
    return message.includes('429') || message.includes('block') || message.includes('sorry_redirect');
}

function buildYtDlpExecOptions(env = process.env) {
    return {
        timeout: getYtDlpDownloadTimeoutMs(env),
        killSignal: 'SIGTERM',
        maxBuffer: YT_DLP_EXEC_MAX_BUFFER_BYTES,
        shell: false,
    };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- 환경 설정 ---
const SCRIPT_DIR = __dirname;
const BASE_DATA_DIR = path.resolve(SCRIPT_DIR, '../data');

// [수정] 환경 변수 또는 상대 경로 우선 사용 (CI/CD 및 다중 환경 호환성)
// 기존 하드코딩된 Windows 경로는 로컬 개발 환경용 fallback으로 유지하되, 존재하지 않으면 상대 경로 사용
const LOCAL_DRIVE_CACHE = 'H:\\My Drive\\04_빠른공유\\tzudong_tzuyang_data\\video_cache';
const LOCAL_DRIVE_FRAMES = 'H:\\My Drive\\04_빠른공유\\tzudong_tzuyang_data\\frames';

let VIDEO_CACHE_DIR = process.env.VIDEO_CACHE_DIR || (fs.existsSync(LOCAL_DRIVE_CACHE) ? LOCAL_DRIVE_CACHE : path.join(BASE_DATA_DIR, 'video_cache'));
let FRAMES_ROOT_DIR = process.env.FRAMES_ROOT_DIR || (fs.existsSync(LOCAL_DRIVE_FRAMES) ? LOCAL_DRIVE_FRAMES : path.join(BASE_DATA_DIR, 'frames'));


// --- 로깅 헬퍼 ---
function log(level, message) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    // [Styling] 레벨에 따라 색상이나 포맷을 다르게 할 수 있지만, 일단 직관적인 텍스트로 통일
    console.log(`[${timestamp}] [${level.toUpperCase().padEnd(5)}] ${message}`);
}
function logOperationError(level, operation, error) {
    log(level, `${operation} ${safeErrorName(error)}`);
}


function isSupportedVideoContainer(fileName) {
    return Boolean(getSafeProviderBasename(fileName)) && SUPPORTED_VIDEO_CONTAINER_RE.test(fileName);
}

function getVideoCandidatePriority(fileName, videoId) {
    const normalizedFileName = fileName.toLowerCase();
    const normalizedVideoId = videoId.toLowerCase();

    let score = 0;
    if (normalizedFileName === `${normalizedVideoId}.mp4`) score += 400;
    else if (normalizedFileName === `${normalizedVideoId}.mkv`) score += 350;
    else if (normalizedFileName === `${normalizedVideoId}.webm`) score += 300;
    else if (normalizedFileName.startsWith(`${normalizedVideoId}.`)) score += 200;
    else if (normalizedFileName.includes(normalizedVideoId)) score += 100;

    if (!YTDLP_FRAGMENT_FILE_RE.test(normalizedFileName)) score += 100;

    if (normalizedFileName.endsWith('.mp4')) score += 30;
    else if (normalizedFileName.endsWith('.mkv')) score += 20;
    else if (normalizedFileName.endsWith('.webm')) score += 10;

    return score;
}

function sortVideoCandidates(candidateNames, videoId) {
    if (!isValidYouTubeVideoId(videoId) || !Array.isArray(candidateNames)) {
        return [];
    }

    return [...candidateNames]
        .filter(fileName => isSupportedVideoContainer(fileName))
        .sort((left, right) => {
            const scoreDiff = getVideoCandidatePriority(right, videoId) - getVideoCandidatePriority(left, videoId);
            return scoreDiff !== 0 ? scoreDiff : left.localeCompare(right);
        });
}

async function hasVideoStream(mediaPath) {
    try {
        if (hasControlCharacters(mediaPath) || !fs.existsSync(mediaPath) || !fs.statSync(mediaPath).isFile()) {
            return false;
        }

        const { stdout } = await runProcess(
            getMediaTools().ffprobePath,
            ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', mediaPath],
            { timeoutMs: FFPROBE_TIMEOUT_MS }
        );
        return stdout
            .split('\n')
            .map(line => line.trim())
            .some(line => line === 'video');
    } catch (e) {
        logOperationError('warn', 'FRAME_PROBE_FAILED', e);
        return false;
    }
}

async function pickUsableLocalVideoCandidate(
    videoId,
    candidateNames,
    baseDir,
    _sourceLabel,
    validateMediaPath = hasVideoStream
) {
    if (!isValidYouTubeVideoId(videoId)) {
        return null;
    }

    let candidateRoot;
    try {
        candidateRoot = requireExistingDirectory(baseDir);
    } catch {
        return null;
    }

    for (const candidateName of sortVideoCandidates(candidateNames, videoId)) {
        try {
            const candidatePath = resolveContainedPath(candidateRoot, candidateName);
            assertExistingPathContained(candidateRoot, candidatePath);
            const usable = await validateMediaPath(candidatePath);
            if (usable) {
                return candidatePath;
            }
        } catch {
            // Unsafe or unusable local candidate is never passed to a child process.
        }
        log('warn', 'FRAME_VIDEO_CANDIDATE_REJECTED');
    }

    return null;
}

// --- RClone 및 Env 헬퍼 ---
async function setupRCloneConfig() {
    const configBase64 = process.env.RCLONE_CONFIG_BASE64;
    // Base64 인코딩된 Config가 있으면 디코딩해서 파일로 저장 (GitHub Actions 환경 등)
    if (configBase64) {
        try {
            const homeDir = requireExistingDirectory(process.env.HOME || process.env.USERPROFILE);
            const configDir = ensureContainedDirectory(homeDir, '.config', 'rclone');
            const configPath = resolveContainedPath(configDir, 'rclone.conf');
            assertPathContainmentBeforeMutation(configDir, configPath);

            const configContent = Buffer.from(configBase64, 'base64').toString('utf-8');
            fs.writeFileSync(configPath, configContent, 'utf-8');
            assertExistingPathContained(configDir, configPath);
            log('info', 'FRAME_RCLONE_CONFIGURED');
            return true;
        } catch (e) {
            logOperationError('warn', 'FRAME_RCLONE_CONFIG_FAILED', e);
        }
    }
    return false;
}

async function findVideoInGDrive(remotePath, videoId) {
    const safeRemotePath = getSafeGDriveRemotePath(remotePath);
    if (!safeRemotePath || !isValidYouTubeVideoId(videoId)) {
        return [];
    }

    try {
        const { stdout } = await runProcess(
            'rclone',
            ['lsf', safeRemotePath, '--files-only', '--include', `*${videoId}*`, '--format', 'p'],
            { timeoutMs: RCLONE_TIMEOUT_MS }
        );
        const files = stdout.trim().split('\n').filter(fileName => getSafeProviderBasename(fileName));
        if (files.length > 0) {
            return sortVideoCandidates(files, videoId);
        }
    } catch (e) {
        logOperationError('warn', 'FRAME_RCLONE_LIST_FAILED', e);
    }
    return [];
}

async function fetchVideoFromGDrive(remotePath, fileName, outputDir) {
    const safeRemotePath = getSafeGDriveRemotePath(remotePath);
    const safeFileName = getSafeProviderBasename(fileName);
    if (!safeRemotePath || !safeFileName) {
        return null;
    }

    let outputDirectory;
    try {
        outputDirectory = requireExistingDirectory(outputDir);
        const source = `${safeRemotePath}/${safeFileName}`;
        const target = resolveContainedPath(outputDirectory, safeFileName);
        assertPathContainmentBeforeMutation(outputDirectory, target);

        log('info', 'FRAME_RCLONE_DOWNLOAD_STARTED');
        await runProcess(
            'rclone',
            ['copy', source, outputDirectory, '--progress'],
            { timeoutMs: RCLONE_TIMEOUT_MS }
        );

        if (fs.existsSync(target)) {
            assertExistingPathContained(outputDirectory, target);
            log('info', 'FRAME_RCLONE_DOWNLOAD_COMPLETED');
            return target;
        }
    } catch (e) {
        logOperationError('error', 'FRAME_RCLONE_DOWNLOAD_FAILED', e);
    }
    return null;
}

async function fetchUsableGDriveVideo(videoId, remotePath, outputDir, options = {}) {
    const {
        listCandidates = findVideoInGDrive,
        fetchCandidate = fetchVideoFromGDrive,
        validateMediaPath = hasVideoStream,
    } = options;
    const safeRemotePath = getSafeGDriveRemotePath(remotePath);
    if (!isValidYouTubeVideoId(videoId) || !safeRemotePath) {
        return null;
    }

    let outputDirectory;
    try {
        outputDirectory = requireExistingDirectory(outputDir);
    } catch {
        return null;
    }

    const gdriveCandidates = await listCandidates(safeRemotePath, videoId);
    if (!gdriveCandidates || !Array.isArray(gdriveCandidates) || gdriveCandidates.length === 0) {
        log('info', 'FRAME_GDRIVE_VIDEO_UNAVAILABLE');
        return null;
    }

    for (const gdriveFileName of sortVideoCandidates(gdriveCandidates, videoId)) {
        log('info', 'FRAME_GDRIVE_VIDEO_FOUND');
        const downloaded = await fetchCandidate(safeRemotePath, gdriveFileName, outputDirectory);
        if (!downloaded) {
            continue;
        }

        try {
            assertExistingPathContained(outputDirectory, downloaded);
        } catch {
            log('warn', 'FRAME_GDRIVE_DOWNLOAD_PATH_REJECTED');
            continue;
        }

        const usableDownloaded = await validateMediaPath(downloaded);
        if (!usableDownloaded) {
            log('warn', 'FRAME_GDRIVE_VIDEO_INVALID');
            try {
                removeContainedFile(outputDirectory, downloaded);
            } catch (e) {
                logOperationError('warn', 'FRAME_GDRIVE_CLEANUP_FAILED', e);
            }
            continue;
        }

        return downloaded;
    }

    log('info', 'FRAME_GDRIVE_CANDIDATES_EXHAUSTED');
    return null;
}

// --- 인자 파싱 ---
function parseArgs() {
    const args = process.argv.slice(2);
    const params = {
        url: null,
        channel: 'tzuyang', // 기본 채널 변경: tzuyang
        fps: 1.0,
        buffer: 0.0,
        quality: ['360p'], // 배열로 변경
        ext: ['jpg'], // 배열로 변경
        force: false, // [추가] 기본값 false
        framesDir: null, // [추가] 프레임 저장 경로
        videoCacheDir: null // [추가] 비디오 캐시 경로
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--url': params.url = args[++i]; break;
            case '--channel': params.channel = args[++i]; break;
            case '--fps': params.fps = parseFloat(args[++i]); break;
            case '--buffer': params.buffer = parseFloat(args[++i]); break;
            case '--quality': params.quality = args[++i].split(','); break; // 콤마로 구분하여 배열로 변환
            case '--ext': params.ext = args[++i].toLowerCase().split(','); break; // 콤마로 구분하여 배열로 변환
            case '--delete-cache': params.deleteCache = true; break;
            case '--force': params.force = true; break; // [추가] 강제 수집 플래그
            case '--frames-dir': params.framesDir = args[++i]; break; // [추가] 프레임 경로 설정
            case '--video-cache-dir': params.videoCacheDir = args[++i]; break; // [추가] 캐시 경로 설정
        }
    }
    return params;
}

// --- 경로 헬퍼 ---
function copyFolderRecursiveSync(source, target, targetRoot) {
    assertExistingPathContained(source, source);
    assertPathContainmentBeforeMutation(targetRoot, target);
    if (!fs.existsSync(target)) {
        fs.mkdirSync(target, { recursive: true });
        assertExistingPathContained(targetRoot, target);
    }

    if (!fs.lstatSync(source).isDirectory()) return;

    for (const fileName of fs.readdirSync(source)) {
        if (!getSafeProviderBasename(fileName)) continue;

        const sourcePath = resolveContainedPath(source, fileName);
        const targetPath = resolveContainedPath(target, fileName);
        assertExistingPathContained(source, sourcePath);
        if (fs.lstatSync(sourcePath).isDirectory()) {
            copyFolderRecursiveSync(sourcePath, targetPath, targetRoot);
            continue;
        }

        // [최적화] 하드 링크 시도 -> 실패 시 복사 (Cross-device 등 대비)
        if (!fs.existsSync(targetPath)) {
            assertPathContainmentBeforeMutation(targetRoot, targetPath);
            try {
                fs.linkSync(sourcePath, targetPath);
            } catch {
                fs.copyFileSync(sourcePath, targetPath);
            }
            assertExistingPathContained(targetRoot, targetPath);
        }
    }
}

function getChannelDir(channelName) {
    return resolveContainedPath(BASE_DATA_DIR, assertSafeChannelName(channelName));
}

// 프레임 저장 경로: channel/frames/videoId/recollectId/
function getFramesOutputDir(channelName, videoId, recollectId) {
    assertSafeChannelName(channelName);
    assertValidYouTubeVideoId(videoId);
    const normalizedRecollectId = recollectId === undefined || recollectId === null ? 0 : Number(recollectId);
    if (!Number.isSafeInteger(normalizedRecollectId) || normalizedRecollectId < 0) {
        throw createOperationError('FRAME_INVALID_RECOLLECT_ID');
    }

    return resolveContainedPath(FRAMES_ROOT_DIR, videoId, String(normalizedRecollectId));
}

function getHeatmapOutputPath(channelName, videoId) {
    assertValidYouTubeVideoId(videoId);
    const safeChannelName = assertSafeChannelName(channelName);
    const dir = ensureContainedDirectory(BASE_DATA_DIR, safeChannelName, 'heatmap');
    return resolveContainedPath(dir, `${videoId}.jsonl`);
}

function getMetaOutputPath(channelName, videoId) {
    assertValidYouTubeVideoId(videoId);
    return resolveContainedPath(getChannelDir(channelName), 'meta', `${videoId}.jsonl`);
}

// [추가] 완료된 프레임 수집 기록 관리
function getCompletedFramesPath(channelName, createDirectory = false) {
    const safeChannelName = assertSafeChannelName(channelName);
    const channelDir = createDirectory
        ? ensureContainedDirectory(BASE_DATA_DIR, safeChannelName)
        : getChannelDir(safeChannelName);
    return resolveContainedPath(channelDir, 'completed_frames.jsonl');
}

function isFrameCollectionCompleted(channelName, videoId, metaRecollectId) {
    if (!isValidYouTubeVideoId(videoId)) return false;
    const logPath = getCompletedFramesPath(channelName);
    if (!fs.existsSync(logPath)) return false;

    try {
        const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
        // 뒤에서부터 검색 (최신 기록 우선)
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            try {
                const data = JSON.parse(line);
                if (data.video_id === videoId) {
                    // 기록된 recollect_id가 현재 메타보다 크거나 같으면 완료된 것
                    return data.recollect_id >= metaRecollectId;
                }
            } catch (e) { }
        }
    } catch (e) {
        logOperationError('warn', 'FRAME_COMPLETION_LOG_READ_FAILED', e);
    }
    return false;
}

function markFrameCollectionCompleted(channelName, videoId, metaRecollectId) {
    assertValidYouTubeVideoId(videoId);
    const logPath = getCompletedFramesPath(channelName, true);
    const data = {
        video_id: videoId,
        recollect_id: metaRecollectId,
        completed_at: new Date().toISOString()
    };
    try {
        assertPathContainmentBeforeMutation(path.dirname(logPath), logPath);
        fs.appendFileSync(logPath, JSON.stringify(data) + '\n', 'utf8');
        assertExistingPathContained(path.dirname(logPath), logPath);
    } catch (e) {
        logOperationError('warn', 'FRAME_COMPLETION_LOG_WRITE_FAILED', e);
    }
}

function extractVideoId(url) {
    if (typeof url !== 'string' || hasControlCharacters(url) || url.length > 2048) return null;

    try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        let videoId = null;
        if (host === 'youtu.be' || host.endsWith('.youtu.be')) {
            videoId = parsed.pathname.split('/').filter(Boolean)[0] || null;
        } else if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
            videoId = parsed.searchParams.get('v');
        }
        return isValidYouTubeVideoId(videoId) ? videoId : null;
    } catch {
        return null;
    }
}

// --- 메타 데이터 유틸리티 ---

// 메타 파일에서 recollect_id 값을 읽어옴 (없으면 0 반환)
function getMetaRecollectId(channelName, videoId) {
    let metaPath = getMetaOutputPath(channelName, videoId);

    // manual 채널인 경우 tzuyang 데이터 풀백 검색 (테스트 용의성)
    if (!fs.existsSync(metaPath) && channelName === 'manual') {
        const fallbackPath = path.join(BASE_DATA_DIR, 'tzuyang', 'meta', `${videoId}.jsonl`);
        if (fs.existsSync(fallbackPath)) {
            metaPath = fallbackPath;
        }
    }

    if (fs.existsSync(metaPath)) {
        try {
            const content = fs.readFileSync(metaPath, 'utf-8').trim().split('\n').pop();
            if (content) {
                const data = JSON.parse(content);
                return typeof data.recollect_id === 'number' ? data.recollect_id : 0;
            }
        } catch (e) {
            // 무시 (기본값 0 사용)
        }
    }
    return 0;
}

// 메타 파일에서 변경 변수(recollect_vars) 확인
function getRecollectVars(channelName, videoId) {
    let metaPath = getMetaOutputPath(channelName, videoId);

    if (!fs.existsSync(metaPath) && channelName === 'manual') {
        const fallbackPath = path.join(BASE_DATA_DIR, 'tzuyang', 'meta', `${videoId}.jsonl`);
        if (fs.existsSync(fallbackPath)) {
            metaPath = fallbackPath;
            log('info', 'FRAME_META_FALLBACK_SELECTED');
        }
    }

    if (fs.existsSync(metaPath)) {
        try {
            const content = fs.readFileSync(metaPath, 'utf-8').trim().split('\n').pop();
            if (content) {
                const data = JSON.parse(content);
                const vars = data.recollect_vars || [];
                log('info', 'FRAME_META_RECOLLECT_VARS_FOUND');
                return vars;
            }
        } catch (e) {
            logOperationError('warn', 'FRAME_META_PARSE_FAILED', e);
        }
    }
    return [];
}

function getKSTDate() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utc + (9 * 60 * 60 * 1000));
}



function getMetaInfo(channelName, videoId) {
    const metaPath = getMetaOutputPath(channelName, videoId);
    if (fs.existsSync(metaPath)) {
        try {
            const content = fs.readFileSync(metaPath, 'utf-8').trim().split('\n').pop();
            if (content) {
                return JSON.parse(content);
            }
        } catch (e) {
        logOperationError('warn', 'FRAME_META_READ_FAILED', e);
        }
    }
    return null;
}

// [수정] params 객체를 통해 quality, fps 등 상세 조건 확인
function shouldCollect(channelName, videoId, params) {
    const { force: ignoreExisting, quality, fps, ext } = params;
    const metaInfo = getMetaInfo(channelName, videoId);
    let metaRecollectId = -1;
    let recollectVars = [];
    let publishedAt = null;

    if (metaInfo) {
        metaRecollectId = metaInfo.recollect_id !== undefined ? metaInfo.recollect_id : 0;
        recollectVars = metaInfo.recollect_vars || [];
        publishedAt = metaInfo.published_at;

        // [추가] 180초(3분) 미만 영상은 Shorts로 간주하여 자동 수집 제외
        const duration = metaInfo.duration || 0;
        if (duration < 180) {
            // [수정] 개별 로그 → 호출부에서 집계하여 요약 출력
            return { skip: true, reason: 'shorts', duration };
        }
    } else {
        // 메타 정보 없으면 수집 대상 (또는 정책에 따라 스킵 할 수도 있음)
        // 여기서는 일단 수집 시도 (히트맵 수집 과정에서 메타 없으면 어차피 실패할 수 있음)
        return true;
    }

    // [Fix] diffDays 계산 (D+7 로직 사용 위해)
    // 메타 수집 스크립트(02)와 기준 통일 (숙성기 7일)
    let diffDays = 0;
    if (publishedAt) {
        const pDate = new Date(publishedAt);
        const now = getKSTDate();
        const diffTime = now - pDate;
        diffDays = diffTime / (1000 * 60 * 60 * 24);
    }

    // [제거됨] 5일 경과 조건 - 7일 조건(shouldRecollectHeatmapToday)으로 통합

    // [수정] 강제 수집 모드일 경우 기존 파일 확인 스킵
    if (ignoreExisting) {
        return true;
    }

    // [추가] "완료 기록" 확인 (CI 환경 등에서 파일이 없어도 기록이 있으면 스킵)
    if (isFrameCollectionCompleted(channelName, videoId, metaRecollectId)) {
        return false;
    }



    // 이미 프레임이 추출된 상태인지 확인 (recollect_id 비교)
    const framesDir = getFramesOutputDir(channelName, videoId, metaRecollectId);

    // frames 폴더 확인
    if (fs.existsSync(framesDir)) {
        // [수정] 단순히 폴더가 있는지가 아니라, 요청한 설정(Quality/FPS)의 데이터가 있는지 확인해야 함
        // 구조: frames/VID/RID/SEG/EXT/CONF
        // 예: 1/jpg/360p_1.0fps

        // 세그먼트 폴더들을 순회
        try {
            const segDirs = fs.readdirSync(framesDir).filter(f => !f.startsWith('.')); // 숨김파일 제외
            if (segDirs.length > 0) {
                // 하나라도 세그먼트 폴더가 있다면 체크 시작
                const fpsStr = Number.isInteger(fps) ? `${fps}.0` : `${fps}`;

                // 요청된 화질/포맷 중 하나라도 없으면 수집 대상 (False 반환 -> True 반환해야 함)
                // 모든 요청 포맷이 존재해야 "이미 수집됨"으로 간주
                const qualities = Array.isArray(quality) ? quality : [quality];
                const extensions = Array.isArray(ext) ? ext : [ext];

                let isFullyCollected = true;

                for (const q of qualities) {
                    const configDirName = `${q}_${fpsStr}fps`;

                    for (const e of extensions) {
                        // 모든 세그먼트에 대해 해당 설정이 존재하는지 확인
                        // (세그먼트 개수가 몇 개인지는 히트맵 까봐야 알지만, 여기선 존재하는 세그먼트 폴더 기준)
                        // 적어도 존재하는 세그먼트 폴더들에는 다 있어야 함.
                        const missingInSegments = segDirs.some(sd => {
                            const targetPath = path.join(framesDir, sd, e, configDirName);
                            // 폴더가 없거나 비어있으면 누락된 것
                            return !fs.existsSync(targetPath) || fs.readdirSync(targetPath).length === 0;
                        });

                        if (missingInSegments) {
                            log('info', 'FRAME_OUTPUT_INCOMPLETE');
                            isFullyCollected = false;
                            break;
                        }
                    }
                    if (!isFullyCollected) break;
                }

                if (isFullyCollected) {
                    // 데이터는 다 있음. 이제 트리거 체크 (recollect_id 증가 여부 등)
                    // 하지만 recollect_id가 같은데 데이터가 다 있다면 -> 진짜 다 있는 것.
                    // 메타 recollect_id가 더 높은지 체크
                    const heatmapPath = getHeatmapOutputPath(channelName, videoId);
                    if (fs.existsSync(heatmapPath)) {
                        try {
                            const lines = fs.readFileSync(heatmapPath, 'utf-8').trim().split('\n');
                            if (lines.length > 0) {
                                const lastLine = lines[lines.length - 1];
                                const lastData = JSON.parse(lastLine);
                                const lastRecollectId = lastData.recollect_id !== undefined ? lastData.recollect_id : -1;

                                if (metaRecollectId > lastRecollectId) {
                                    // ... 트리거 로직 ...
                                    const TRIGGER_VARS = ['new_video', 'duration_changed', 'scheduled_daily', 'scheduled_weekly', 'scheduled_biweekly', 'scheduled_monthly'];
                                    const shouldTrigger = recollectVars.some(variable => TRIGGER_VARS.includes(variable));
                                    if (shouldTrigger) {
                                        log('info', 'FRAME_RECOLLECT_TRIGGERED');
                                        return true;
                                    }
                                }
                            }
                        } catch (e) { }
                    }
                    // 데이터도 있고 트리거도 없으면 스킵
                    return false;
                }

                // isFullyCollected가 false면 수집해야 함
                return true;
            }
        } catch (e) {
            logOperationError('warn', 'FRAME_OUTPUT_CHECK_FAILED', e);
        }
    }

    // [수정] D+7 강제 수집 로직 추가 (메타 수집 정책과 통일)
    // 히트맵/프레임이 아예 없는 신규 영상이면, 스케줄 트리거가 없어도 D+7가 지났으면 수집해야 함
    // (get_schedule_frequency에서 D+7 미만은 None을 반환하므로, 메타 수집 단계에서 걸러졌을 수 있음.
    // 하지만 여기까지 왔다는 건 메타가 있다는 뜻일 수도 있고, shouldCollect가 호출된 시점에서 판단)

    // 데이터 부재 확인
    const heatmapPath = getHeatmapOutputPath(channelName, videoId);
    const hasHeatmap = fs.existsSync(heatmapPath);

    // D+7 경과 확인 (위에서 계산한 diffDays 사용)
    if (diffDays >= 7) {
        if (!hasHeatmap) {
            log('info', 'FRAME_HEATMAP_COLLECTION_FORCED');
            return true;
        }
    }

    // 폴더가 없거나 비어있으면 수집 필요
    // [중요] 단, recollect_vars에 'daily_collection'만 있다면 수집 스킵 (주간/월간 스케줄 아님)
    // new_video, scheduled_*, duration_changed, heatmap_changed 등이 있어야 함
    const TRIGGER_VARS = ['new_video', 'duration_changed', 'scheduled_daily', 'scheduled_weekly', 'scheduled_biweekly', 'scheduled_monthly', 'heatmap_changed'];
    const hasTrigger = recollectVars.some(variable => TRIGGER_VARS.includes(variable));

    // 강제 수집 모드가 아니고 트리거가 없다면 스킵 (daily_collection은 메타만 수집)
    if (!ignoreExisting && !hasTrigger && recollectVars.includes('daily_collection')) {
        return false;
    }

    // 스케줄링(scheduled_*)에 의해 왔더라도, 히트맵이 바뀌지 않았다면 굳이 수집할 필요 없음.
    // 이는 processSingleVideo 내부의 fetchAndSaveHeatmap 단계에서 "히트맵 비교"를 통해 최종 결정됨.
    // 여기서는 일단 "수집 시도 대상"으로는 분류함.

    return true;
}

// --- 데이터 수집 및 다운로드 로직 ---

async function loadCookies() {
    // 1. JSON 포맷 쿠키 시도
    const jsonPath = path.join(BASE_DATA_DIR, 'cookies.json');
    if (fs.existsSync(jsonPath)) {
        try {
            const content = fs.readFileSync(jsonPath, 'utf-8');
            const cookies = JSON.parse(content);
            log('info', 'FRAME_JSON_COOKIES_LOADED');
            return cookies.map(c => `${c.name}=${c.value}`).join('; ');
        } catch (e) {
            logOperationError('warn', 'FRAME_JSON_COOKIES_LOAD_FAILED', e);
        }
    }

    // 2. Netscape 포맷 쿠키 (.txt) 시도
    const txtPath = path.join(BASE_DATA_DIR, 'cookies.txt');
    if (fs.existsSync(txtPath)) {
        try {
            const content = fs.readFileSync(txtPath, 'utf-8');
            const lines = content.split('\n');
            const cookies = [];
            for (const line of lines) {
                if (line.startsWith('#') || !line.trim()) continue;
                const parts = line.split('\t');
                if (parts.length >= 7) {
                    cookies.push(`${parts[5]}=${parts[6]}`);
                }
            }
            log('info', 'FRAME_TEXT_COOKIES_LOADED');
            return cookies.join('; ');
        } catch (e) {
            logOperationError('warn', 'FRAME_TEXT_COOKIES_LOAD_FAILED', e);
        }
    }
    return '';
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchPage(url, cookieHeader, redirectCount = 0, retryCount = 0) {
    if (redirectCount > 5) throw new Error('FRAME_HEATMAP_REDIRECT_LIMIT');

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8',
        'Cookie': cookieHeader || ''
    };

    try {
        return await new Promise((resolve, reject) => {
            const req = https.get(url, { headers }, (res) => {
                // 1. Google Abuse Check (429 or Soft Ban Redirect)
                if (res.statusCode === 429) {
                    reject(new Error('429_TOO_MANY_REQUESTS'));
                    return;
                }

                // 리다이렉트 처리 (301, 302, 303, 307, 308)
                if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                    let redirectUrl = res.headers.location;

                    let redirectHost = '';
                    try { redirectHost = new URL(redirectUrl, url).hostname.toLowerCase(); } catch { redirectHost = ''; }

                    // Google Abuse Redirect Check
                    if (redirectHost === 'google.com' || redirectHost.endsWith('.google.com') && redirectUrl.includes('/sorry')) {
                        reject(new Error('429_GOOGLE_SORRY_REDIRECT'));
                        return;
                    }

                    // [Fix] Cookie Mismatch or Auth Redirect Check
                    if (redirectUrl.includes('CookieMismatch') || redirectHost === 'accounts.google.com' || redirectHost.endsWith('.accounts.google.com')) {
                        log('warn', 'FRAME_HEATMAP_AUTH_REDIRECT');
                        if (cookieHeader && cookieHeader.length > 0) {
                            log('info', 'FRAME_HEATMAP_COOKIE_RETRY');
                            // 쿠키 없이 현재 URL 다시 요청
                            resolve(fetchPage(url, '', 0, retryCount));
                            return;
                        }
                    }

                    // 상대 경로인 경우 처리
                    if (!redirectUrl.startsWith('http')) {
                        const parsedUrl = new URL(url);
                        redirectUrl = new URL(redirectUrl, parsedUrl.origin).toString();
                    }
                    log('info', 'FRAME_HEATMAP_REDIRECT');

                    // 재귀 호출 (retryCount 유지)
                    resolve(fetchPage(redirectUrl, cookieHeader, redirectCount + 1, retryCount));
                    return;
                }

                if (res.statusCode !== 200) {
                    reject(new Error('FRAME_HEATMAP_HTTP_STATUS'));
                    return;
                }

                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data));
            });

            req.on('error', reject);
        });
    } catch (e) {
        // [Mod] 내부 재시도 로직 제거 (외부 루프에서 제어)
        throw e;
    }
}

function parseHeatmap(html) {
    // ytInitialData 객체 추출
    const match = html.match(/var\s+ytInitialData\s*=\s*({.*?});/s);
    if (!match) return null;

    try {
        const data = JSON.parse(match[1]);

        // 깊은 객체 탐색 헬퍼
        function findKey(obj, key) {
            if (!obj) return null;
            if (obj[key]) return obj[key];
            if (typeof obj === 'object') {
                for (const k in obj) {
                    const found = findKey(obj[k], key);
                    if (found) return found;
                }
            }
            return null;
        }

        // '가장 많이 다시 본 장면' 마커 추출
        const markersDecoration = findKey(data, 'markersDecoration');
        let mostReplayed = [];

        if (markersDecoration && markersDecoration.timedMarkerDecorations) {
            mostReplayed = markersDecoration.timedMarkerDecorations
                .filter(marker => {
                    const labelText = marker.label?.runs?.[0]?.text || '';
                    return labelText.includes('가장 많이 다시 본 장면') || labelText.toLowerCase().includes('most replayed');
                })
                .map(marker => ({
                    startMillis: marker.visibleTimeRangeStartMillis,
                    endMillis: marker.visibleTimeRangeEndMillis,
                    peakMillis: marker.decorationTimeMillis,
                    label: marker.label?.runs?.[0]?.text
                }));
        }

        // 일반 인터랙션 데이터 추출
        const markers = findKey(data, 'markers');
        let rawMarkers = null;

        if (markers && Array.isArray(markers) && markers.length > 0) {
            rawMarkers = markers;
        } else {
            const markerGraph = findKey(data, 'markerGraph');
            if (markerGraph && markerGraph.markers && Array.isArray(markerGraph.markers)) {
                rawMarkers = markerGraph.markers;
            }
        }

        return {
            mostReplayedMarkers: mostReplayed,
            interactionData: rawMarkers
        };

    } catch (e) {
        logOperationError('error', 'FRAME_HEATMAP_PARSE_FAILED', e);
        return null;
    }
}

// 히트맵 데이터 수집 및 저장
async function fetchAndSaveHeatmap(channel, videoId, _url) {
    assertSafeChannelName(channel);
    assertValidYouTubeVideoId(videoId);
    const canonicalVideoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const outPath = getHeatmapOutputPath(channel, videoId);

    // [추가] 스케줄 트리거 확인 (scheduled_daily, scheduled_monthly 등)
    // 스케줄 트리거가 있다면 수요일이 아니어도 재수집해야 함 (예: 30일 경과 영상의 월간 수집)
    const triggerCheckVars = getRecollectVars(channel, videoId);
    const isScheduledTrigger = triggerCheckVars.some(v => v.startsWith('scheduled_'));

    // [수정] 이미 데이터가 존재하면 다음 조건들을 만족할 때만 재수집 스킵:
    // 1. 스케줄 트리거가 없음 (!isScheduledTrigger)
    if (fs.existsSync(outPath) && !isScheduledTrigger) {
        try {
            const lines = fs.readFileSync(outPath, 'utf-8').trim().split('\n');
            if (lines.length > 0) {
                const lastLine = lines[lines.length - 1]; // 가장 최신 데이터 사용
                // 마지막 줄이 완전하지 않을 경우 대비 (간단 체크)
                if (lastLine.endsWith('}')) {
                    const existingData = JSON.parse(lastLine);
                    const currentMetaId = getMetaRecollectId(channel, videoId);

                    // 메타 ID가 더 크면 재수집 (업데이트)
                    if (currentMetaId > existingData.recollect_id) {
                        log('info', 'FRAME_HEATMAP_RECOLLECT_DETECTED');

                        // [최적화] 여기서 무조건 재수집하지 않고, "진짜 바뀌었는지" 확인하기 위해
                        // 아래로 흘려보내서 새 히트맵을 가져온 뒤 비교 로직 수행 (Intersection Check)
                    } else {
                        // ID도 같고 데이터도 있으면 재사용
                        log('info', 'FRAME_HEATMAP_REUSED');
                        return existingData.most_replayed_markers.map(m => ({
                            startSec: m.startMillis / 1000,
                            endSec: m.endMillis / 1000,
                            peakSec: m.peakMillis / 1000
                        }));
                    }
                }
            }
        } catch (e) {
            logOperationError('warn', 'FRAME_HEATMAP_READ_FAILED', e);
        }
    }

    // [Mod] 쿠키 없이 접근 (Public/Incognito Mode) - 최대 3회 재시도 (2차 쿠키 폴백 제거)
    let html, parsed;
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        log('info', 'FRAME_HEATMAP_REQUEST_ATTEMPTED');
        try {
            html = await fetchPage(canonicalVideoUrl, '');
            parsed = parseHeatmap(html);

            // 데이터가 유효하면 루프 탈출
            if (parsed && (parsed.mostReplayedMarkers.length || parsed.interactionData)) {
                break;
            } else {
                throw new Error('FRAME_HEATMAP_DATA_MISSING');
            }
        } catch (e) {
            logOperationError('warn', 'FRAME_HEATMAP_REQUEST_FAILED', e);

            // [Fix] 429/차단 관련 에러면 즉시 중단 (무리한 재시도 방지)하고 상위 배치 breaker에 전달
            if (isHeatmapRateLimitError(e)) {
                log('error', 'FRAME_HEATMAP_REQUEST_ABORTED');
                throw e;
            }

            // 마지막 시도가 아니면 대기 후 재시도
            if (attempt < MAX_RETRIES) {
                const delay = attempt * 2000 + Math.random() * 1000; // 2s~, 4s~...
                log('info', 'FRAME_HEATMAP_RETRY_SCHEDULED');
                await sleep(delay);
            }
        }
    }

    if (!parsed || (!parsed.mostReplayedMarkers.length && !parsed.interactionData)) {
        log('warn', 'FRAME_HEATMAP_UNAVAILABLE');
        return null;
    }

    // [추가] 히트맵 변경 감지 & 부분 업데이트(Hard Link) 지원을 위한 비교 로직
    // 기존 데이터 로드 (최신본)
    let existingMarkers = [];
    if (fs.existsSync(outPath)) {
        try {
            const lines = fs.readFileSync(outPath, 'utf-8').trim().split('\n');
            if (lines.length > 0) {
                const lastData = JSON.parse(lines[lines.length - 1]);
                existingMarkers = lastData.most_replayed_markers.map(m => ({
                    startSec: m.startMillis / 1000,
                    endSec: m.endMillis / 1000,
                    peakSec: m.peakMillis / 1000
                }));
            }
        } catch (e) { }
    }

    const newMarkers = parsed.mostReplayedMarkers.map(m => ({
        startSec: m.startMillis / 1000,
        endSec: m.endMillis / 1000,
        peakSec: m.peakMillis / 1000
    }));

    // 비교: 개수가 같고, 모든 마커가 오차 범위 내(±2초) 라면 '변경 없음'으로 간주
    // 단, duration_changed 트리거가 있다면 무조건 변경으로 간주 (신뢰도 하락)
    const vars = getRecollectVars(channel, videoId);
    const isDurationChanged = vars.includes('duration_changed');

    let isHeatmapChanged = false;

    if (isDurationChanged) {
        log('info', 'FRAME_HEATMAP_DURATION_CHANGED');
        isHeatmapChanged = true;
    } else if (existingMarkers.length !== newMarkers.length) {
        log('info', 'FRAME_HEATMAP_MARKER_COUNT_CHANGED');
        isHeatmapChanged = true;
    } else {
        // 개수 같음 -> 구간별 시간 비교
        const TOLERANCE_SEC = 2.0;
        const hasDiff = newMarkers.some((newM, i) => {
            const oldM = existingMarkers[i];
            const startDiff = Math.abs(newM.startSec - oldM.startSec);
            const endDiff = Math.abs(newM.endSec - oldM.endSec);
            return startDiff > TOLERANCE_SEC || endDiff > TOLERANCE_SEC;
        });

        if (hasDiff) {
            log('info', 'FRAME_HEATMAP_MARKERS_CHANGED');
            isHeatmapChanged = true;
        } else {
            // 변경 없음
            log('info', 'FRAME_HEATMAP_UNCHANGED');
            // [Fix] return null 제거 -> 아래 저장 로직을 태워서 Heatmap ID를 Meta ID와 동기화시킴
            // 이렇게 해야 다음 실행 시 'ID 불일치'로 인한 중복 검사를 방지할 수 있음.
        }
    }

    // 변경 없는 경우 처리 로직 (getRecollectVars가 scheduled_* 만 있을 때)
    // 만약 isHeatmapChanged가 false인데 여기까지 왔다면(위에서 return null 안됨), 뭔가 이상함.
    // 하지만 new_video인 경우는 existingMarkers가 없으므로 isHeatmapChanged = true가 됨. (0 != N)

    // [중요] 변경되지 않았다면 파일 저장도 하지 않음 (불필요한 로그 방지)
    // 하지만 여기까지 왔다는 건 변경되었다는 뜻임. 저장 진행.

    const formattedInteraction = (parsed.interactionData || []).map(item => {

        const seconds = Math.floor((item.startMillis || 0) / 1000);
        const mm = Math.floor(seconds / 60).toString().padStart(2, '0');
        const ss = (seconds % 60).toString().padStart(2, '0');
        return {
            ...item,
            formatted_time: `${mm}:${ss}`
        };
    });

    const recollectId = getMetaRecollectId(channel, videoId);

    // [추가] 메타 정보에서 duration 가져오기
    const metaInfo = getMetaInfo(channel, videoId);
    const duration = metaInfo ? metaInfo.duration : 0;

    // [중요] recollect_vars에 heatmap_changed 추가 (명시적)
    // [Fix] 변경되었을 때만 추가
    let finalVars = getRecollectVars(channel, videoId);
    if (isHeatmapChanged) {
        if (!finalVars.includes('heatmap_changed')) {
            finalVars.push('heatmap_changed');
        }
    } else {
        // 변경 안됐으면 제거 (혹시 있다면)
        finalVars = finalVars.filter(v => v !== 'heatmap_changed');
    }

    const saveData = {
        youtube_link: canonicalVideoUrl,
        channel_name: channel,
        video_id: videoId,
        duration: duration, // duration 필드 추가
        interaction_data: formattedInteraction,
        most_replayed_markers: parsed.mostReplayedMarkers,
        status: 'success',
        collected_at: new Date().toISOString(),
        recollect_id: recollectId,
        recollect_vars: finalVars
    };

    assertPathContainmentBeforeMutation(path.dirname(outPath), outPath);
    fs.appendFileSync(outPath, JSON.stringify(saveData) + '\n', 'utf8');
    assertExistingPathContained(path.dirname(outPath), outPath);
    log('info', 'FRAME_HEATMAP_SAVED');

    // [Fix] 변경 없으면 저장(ID동기화) 후 여기서 종료 -> 프레임 추출 스킵
    // [수정] 단, 프레임 파일이 실제로 없는 경우에는 히트맵 변경 여부와 관계없이 추출 진행
    // [개선] shouldCollect()와 동일한 상세 체크 로직 사용 (일관성)
    if (!isHeatmapChanged) {
        const recollectId = getMetaRecollectId(channel, videoId);
        const framesDir = getFramesOutputDir(channel, videoId, recollectId);

        // [일관성] shouldCollect()와 동일한 방식으로 프레임 존재 확인
        // 단순히 폴더 존재가 아닌, 실제 설정별 데이터 존재 여부 확인
        let hasFrames = false;
        if (fs.existsSync(framesDir)) {
            try {
                const segDirs = fs.readdirSync(framesDir).filter(f => !f.startsWith('.'));
                if (segDirs.length > 0) {
                    // 첫 번째 세그먼트의 구조만 확인 (전체 확인은 비용이 큼)
                    const firstSegDir = path.join(framesDir, segDirs[0]);
                    // jpg/360p_1.0fps 같은 구조가 있는지 확인
                    const extDirs = fs.existsSync(firstSegDir) ? fs.readdirSync(firstSegDir).filter(f => !f.startsWith('.')) : [];
                    if (extDirs.length > 0) {
                        const configDirs = fs.existsSync(path.join(firstSegDir, extDirs[0]))
                            ? fs.readdirSync(path.join(firstSegDir, extDirs[0])).filter(f => !f.startsWith('.'))
                            : [];
                        hasFrames = configDirs.length > 0;
                    }
                }
            } catch (e) { }
        }

        if (hasFrames) {
            log('info', 'FRAME_EXTRACTION_SKIPPED');
            return null;
        } else {
            log('info', 'FRAME_EXTRACTION_FORCED');
            // 아래로 계속 진행하여 프레임 추출
        }
    }

    // 반환값에 '재사용 가능 여부' 정보를 포함하면 좋겠지만, 
    // 기존 구조 유지를 위해 마커 리스트만 반환하고, 실제 부분 업데이트 로직은 extractFrames에서 수행
    // (extractFrames에서 다시 히트맵 파일 읽거나, 여기서 넘겨줄 수 있으면 좋음)

    // [Fix] extractFrames에서 '어떤 게 바뀌었는지' 알기 쉽게 하기 위해 확장된 객체 반환은 호출부 수정이 많이 필요함.
    // 대신, extractFrames가 '스마트 재사용' 로직을 내장하고 있으므로(폴더 비교), 
    // 여기서는 최신 마커 리스트만 잘 넘겨주면 됨.

    return parsed.mostReplayedMarkers.map(m => ({
        startSec: m.startMillis / 1000,
        endSec: m.endMillis / 1000,
        peakSec: m.peakMillis / 1000
    }));
}

// --- 비디오 다운로드 및 프레임 추출 ---

function assertFrameQuality(quality) {
    if (typeof quality !== 'string' || !/^[1-9]\d{2,3}p$/.test(quality)) {
        throw createOperationError('FRAME_INVALID_QUALITY');
    }

    const height = Number.parseInt(quality, 10);
    if (height > 4320) {
        throw createOperationError('FRAME_INVALID_QUALITY');
    }
    return { quality, height };
}

function assertFrameExtension(ext) {
    const normalizedExt = typeof ext === 'string' ? ext.toLowerCase() : '';
    if (!['webp', 'png', 'jpg', 'jpeg', 'bmp'].includes(normalizedExt)) {
        throw createOperationError('FRAME_INVALID_EXTENSION');
    }
    return normalizedExt;
}

function getFrameEncodingArgs(ext) {
    if (ext === 'webp') return ['-c:v', 'libwebp', '-lossless', '1', '-q:v', '100'];
    if (ext === 'png') return ['-c:v', 'png', '-compression_level', '3'];
    if (ext === 'jpg' || ext === 'jpeg') return ['-q:v', '2'];
    return ['-c:v', 'bmp'];
}

function assertFrameSegments(segments) {
    if (!Array.isArray(segments)) {
        throw createOperationError('FRAME_INVALID_SEGMENTS');
    }

    return segments.map((segment) => {
        const startSec = Number(segment?.startSec);
        const endSec = Number(segment?.endSec);
        if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || endSec < startSec) {
            throw createOperationError('FRAME_INVALID_SEGMENTS');
        }
        return { startSec, endSec };
    });
}

function copyDownloadedVideoToCache(downloadedPath, sourceRoot, cacheRoot) {
    const safeFileName = getSafeProviderBasename(path.basename(downloadedPath));
    if (!safeFileName) {
        throw createOperationError('FRAME_INVALID_PROVIDER_FILENAME');
    }

    const resolvedSourceRoot = requireExistingDirectory(sourceRoot);
    assertExistingPathContained(resolvedSourceRoot, downloadedPath);
    const resolvedCacheRoot = requireExistingDirectory(cacheRoot);
    const cachePath = resolveContainedPath(resolvedCacheRoot, safeFileName);
    assertPathContainmentBeforeMutation(resolvedCacheRoot, cachePath);
    if (!fs.existsSync(cachePath)) {
        fs.copyFileSync(downloadedPath, cachePath);
        assertExistingPathContained(resolvedCacheRoot, cachePath);
    }
}

async function downloadVideo(videoId, outputDir, quality, options = {}) {
    const { validateMediaPath = hasVideoStream } = options;
    assertValidYouTubeVideoId(videoId);
    const { height } = assertFrameQuality(quality);
    const outputDirectory = requireExistingDirectory(outputDir);
    const cacheDirectory = requireExistingDirectory(VIDEO_CACHE_DIR);
    const { gdriveRemotePath: safeGDriveRemotePath, ytDlpInvocation } = resolveDownloadConfiguration();

    const cookieTxt = path.join(BASE_DATA_DIR, 'cookies.txt');
    const cookieArgs = fs.existsSync(cookieTxt) ? ['--cookies', cookieTxt] : [];

    // 포맷 유연성 확보: mp4 강제 제거 후 remux 사용 (n-challenge 해결 확률 높임)
    const format = `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`;
    const outputFileTemplate = resolveContainedPath(outputDirectory, `${videoId}.%(ext)s`);
    assertPathContainmentBeforeMutation(outputDirectory, outputFileTemplate);

    // [최적화] 캐시된 파일 확인
    const cacheFiles = fs.readdirSync(cacheDirectory).filter(fileName => fileName.startsWith(videoId));
    const cachedVideoPath = await pickUsableLocalVideoCandidate(videoId, cacheFiles, cacheDirectory, 'Cache', validateMediaPath);
    if (cachedVideoPath) {
        log('info', 'FRAME_VIDEO_CACHE_HIT');
        return cachedVideoPath;
    }

    // [추가] GDrive 우선 검색 및 다운로드 로직
    if (safeGDriveRemotePath) {
        // RClone Config 설정 시도 (없으면 로컬 설정 사용)
        await setupRCloneConfig();

        const downloadedFromGDrive = await fetchUsableGDriveVideo(videoId, safeGDriveRemotePath, outputDirectory, {
            validateMediaPath,
        });
        if (downloadedFromGDrive) {
            try {
                copyDownloadedVideoToCache(downloadedFromGDrive, outputDirectory, cacheDirectory);
                log('info', 'FRAME_GDRIVE_CACHE_SAVED');
            } catch (e) {
                logOperationError('warn', 'FRAME_CACHE_WRITE_FAILED', e);
            }
            return downloadedFromGDrive;
        }
    }

    const ytDlpArgs = [
        ...ytDlpInvocation.args,
        '--ffmpeg-location', getMediaTools().ffmpegPath,
        ...cookieArgs,
        '--js-runtimes', `node:${process.execPath}`,
        '--remote-components', 'ejs:github',
        '--no-part',
        '-f', format,
        '-o', outputFileTemplate,
        `https://www.youtube.com/watch?v=${videoId}`,
    ];
    const execOptions = buildYtDlpExecOptions();

    const maxRetries = getYtDlpMaxRetries();
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            log('info', 'FRAME_VIDEO_DOWNLOAD_ATTEMPTED');
            await runProcess(ytDlpInvocation.file, ytDlpArgs, {
                timeoutMs: execOptions.timeout,
                stdoutMaxBytes: execOptions.maxBuffer,
                stderrMaxBytes: execOptions.maxBuffer,
            });

            // 다운로드된 파일 찾기
            const files = fs.readdirSync(outputDirectory).filter(fileName => fileName.startsWith(videoId));
            const downloadedPath = await pickUsableLocalVideoCandidate(videoId, files, outputDirectory, 'Downloader', validateMediaPath);

            if (downloadedPath) {
                // [최적화] 다운로드 성공 시 캐시에 복사
                try {
                    copyDownloadedVideoToCache(downloadedPath, outputDirectory, cacheDirectory);
                    log('info', 'FRAME_VIDEO_CACHE_SAVED');
                } catch (e) {
                    logOperationError('warn', 'FRAME_CACHE_WRITE_FAILED', e);
                }

                return downloadedPath;
            }

            log('warn', 'FRAME_VIDEO_DOWNLOAD_OUTPUT_MISSING');
        } catch (e) {
            logOperationError('warn', 'FRAME_VIDEO_DOWNLOAD_FAILED', e);
        }

        // 재시도 전 대기 (2초)
        if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    log('error', 'FRAME_VIDEO_DOWNLOAD_RETRIES_EXHAUSTED');
    return null;
}

// [수정] quality 인자 추가, compress -> ext 변경
async function extractFrames(videoPath, segments, outputBaseDir, quality, fps, bufferSec, ext) {
    const safeSegments = assertFrameSegments(segments);
    const { quality: safeQuality } = assertFrameQuality(quality);
    const safeExt = assertFrameExtension(ext);
    const safeFps = Number(fps);
    const safeBufferSec = Number(bufferSec);
    if (!Number.isFinite(safeFps) || safeFps <= 0 || safeFps > 120 || !Number.isFinite(safeBufferSec) || safeBufferSec < 0 || safeBufferSec > 3600) {
        throw createOperationError('FRAME_INVALID_EXTRACTION_OPTIONS');
    }

    const outputDirectory = requireExistingDirectory(outputBaseDir);
    if (hasControlCharacters(videoPath) || !fs.existsSync(videoPath) || !fs.statSync(videoPath).isFile()) {
        return { totalSegments: safeSegments.length, failedSegments: safeSegments.length, totalFrames: 0 };
    }

    let duration = 0;
    try {
        const { stdout } = await runProcess(
            getMediaTools().ffprobePath,
            ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', videoPath],
            { timeoutMs: FFPROBE_TIMEOUT_MS }
        );
        duration = Number.parseFloat(stdout);
        if (!Number.isFinite(duration) || duration < 0) duration = 0;
        log('info', 'FRAME_VIDEO_DURATION_PROBED');
    } catch (e) {
        logOperationError('warn', 'FRAME_VIDEO_DURATION_PROBE_FAILED', e);
    }

    log('info', 'FRAME_IMAGE_FORMAT_CONFIGURED');
    const encodingArgs = getFrameEncodingArgs(safeExt);

    // [최적화] Promise.all을 사용하여 모든 구간을 병렬로 처리 (CPU 활용 극대화)
    const results = await Promise.all(safeSegments.map(async (seg, i) => {
        // [수정] 피크 지점 기준이 아닌, 마커의 전체 범위(startSec ~ endSec)에 버퍼를 더한 구간 추출
        const startTime = Math.max(0, seg.startSec - safeBufferSec);
        const endTime = Math.min(duration || 99999, seg.endSec + safeBufferSec);

        const segDirName = `${i + 1}_${Math.floor(startTime)}_${Math.floor(endTime)}`;
        const fpsStr = Number.isInteger(safeFps) ? `${safeFps}.0` : `${safeFps}`;
        const configDirName = `${safeQuality}_${fpsStr}fps`;

        // 구조: frames/VIDEO_ID/RECOLLECT_ID/SEGMENT_DIR/EXT_DIR/QUALITY_FPS/frame_x.ext
        const segDirPath = ensureContainedDirectory(outputDirectory, segDirName, safeExt, configDirName);

        // [최적화] 이미 프레임이 추출되어 있다면 스킵
        const existingFiles = fs.readdirSync(segDirPath).filter(fileName => fileName.endsWith(`.${safeExt}`));
        if (existingFiles.length > 0) {
            log('info', 'FRAME_SEGMENT_SKIPPED');
            return { failed: false, frameCount: existingFiles.length };
        }

        log('info', 'FRAME_SEGMENT_EXTRACTION_STARTED');

        let segDuration = endTime - startTime;
        if (segDuration < (1.0 / safeFps)) {
            segDuration = 1.0 / safeFps; // 최소 1프레임 보장
        }

        const outputPattern = resolveContainedPath(segDirPath, `frame_%d.${safeExt}`);
        assertPathContainmentBeforeMutation(segDirPath, outputPattern);
        try {
            await runProcess(
                getMediaTools().ffmpegPath,
                [
                    '-y',
                    '-ss', String(startTime),
                    '-t', String(segDuration),
                    '-i', videoPath,
                    '-vf', `fps=${safeFps}`,
                    ...encodingArgs,
                    '-frame_pts', '1',
                    outputPattern,
                ],
                { timeoutMs: FFMPEG_TIMEOUT_MS }
            );

            // 파일명 정리: frame_1.ext -> 정확한 시간(초).ext 로 변경
            const files = fs.readdirSync(segDirPath).filter(fileName => fileName.startsWith('frame_'));
            let count = 0;
            for (const fileName of files) {
                const match = fileName.match(new RegExp(`^frame_(\\d+)\\.${safeExt}$`));
                if (match && getSafeProviderBasename(fileName)) {
                    const idx = Number.parseInt(match[1], 10);
                    const timeOffset = (idx - 1) / safeFps;
                    const actualTime = startTime + timeOffset;
                    const newName = `${actualTime.toFixed(2)}.${safeExt}`;
                    const oldPath = resolveContainedPath(segDirPath, fileName);
                    const newPath = resolveContainedPath(segDirPath, newName);
                    assertExistingPathContained(segDirPath, oldPath);
                    assertPathContainmentBeforeMutation(segDirPath, newPath);
                    fs.renameSync(oldPath, newPath);
                    assertExistingPathContained(segDirPath, newPath);
                    count++;
                }
            }
            if (count === 0) {
                log('error', 'FRAME_SEGMENT_OUTPUT_MISSING');
                return { failed: true, frameCount: 0 };
            }
            log('info', 'FRAME_SEGMENT_EXTRACTION_COMPLETED');
            return { failed: false, frameCount: count };
        } catch (e) {
            logOperationError('error', 'FRAME_SEGMENT_EXTRACTION_FAILED', e);
            return { failed: true, frameCount: 0 };
        }
    }));

    return {
        totalSegments: results.length,
        failedSegments: results.filter(result => result.failed).length,
        totalFrames: results.reduce((sum, result) => sum + (result.frameCount || 0), 0),
    };
}

async function processSingleVideo(videoId, params, dependencies = {}) {
    const {
        loadSegments = fetchAndSaveHeatmap,
        acquireVideo = downloadVideo,
        extractFramesFn = extractFrames,
    } = dependencies;
    const { channel, fps, buffer, quality, ext } = params;
    assertValidYouTubeVideoId(videoId);
    assertSafeChannelName(channel);
    const qualities = (Array.isArray(quality) ? quality : [quality]).map(value => assertFrameQuality(value).quality);
    const extensions = (Array.isArray(ext) ? ext : [ext]).map(assertFrameExtension);
    const safeFps = Number(fps);
    const safeBuffer = Number(buffer);
    if (!Number.isFinite(safeFps) || safeFps <= 0 || safeFps > 120 || !Number.isFinite(safeBuffer) || safeBuffer < 0 || safeBuffer > 3600) {
        throw createOperationError('FRAME_INVALID_EXTRACTION_OPTIONS');
    }

    // Validate all externally configured process commands before any path mutation or child process.
    resolveDownloadConfiguration();

    let downloadPerformed = false;
    let videoHadFailure = false;
    let latestRecollectId = null;
    const canonicalVideoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // 1. 히트맵 데이터 수집 (Recollect ID 자동 감지)
    const segments = await loadSegments(channel, videoId, canonicalVideoUrl);
    // [Mod] segments가 null이면 '변경 없음' 또는 '데이터 없음' -> 수집 중단
    if (!segments) {
        return;
    }
    const safeSegments = assertFrameSegments(segments);
    if (safeSegments.length === 0) {
        log('info', 'FRAME_HEATMAP_EMPTY');
        return;
    }

    log('info', 'FRAME_HEATMAP_SEGMENTS_FOUND');
    log('info', 'FRAME_QUALITIES_CONFIGURED');
    log('info', 'FRAME_FORMATS_CONFIGURED');

    const tempVideoRoot = ensureContainedDirectory(BASE_DATA_DIR, channel, 'temp_video');
    for (const currentQuality of qualities) {
        log('info', 'FRAME_QUALITY_STARTED');

        // 2. 영상 다운로드 (임시 폴더) - 파일 잠금 충돌 방지용 랜덤 접미사
        const uniqueSuffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
        const tempDir = ensureContainedDirectory(tempVideoRoot, uniqueSuffix);
        // 다운로드 및 처리 로직
        let videoPath = null;
        try {
            // [최적화] 스마트 재개 & 데이터 재사용 로직
            const metaInfo = getMetaInfo(channel, videoId);
            const duration = metaInfo ? metaInfo.duration : 0; // Duration 확보

            const recollectId = getMetaRecollectId(channel, videoId);
            latestRecollectId = recollectId;
            const outputDir = ensureContainedDirectory(FRAMES_ROOT_DIR, videoId, String(recollectId));
            const fpsStr = Number.isInteger(safeFps) ? `${safeFps}.0` : `${safeFps}`;
            const configDirName = `${currentQuality}_${fpsStr}fps`;
            const framesVideoRoot = resolveContainedPath(FRAMES_ROOT_DIR, videoId);

            const existingIds = fs.readdirSync(framesVideoRoot)
                .filter(directoryName => /^\d+$/.test(directoryName))
                .map(directoryName => Number.parseInt(directoryName, 10))
                .filter(id => Number.isSafeInteger(id) && id < recollectId)
                .sort((left, right) => right - left);
            const previousId = existingIds.length > 0 ? existingIds[0] : -1;

            if (previousId >= 0) {
                const prevDir = resolveContainedPath(framesVideoRoot, String(previousId));
                assertExistingPathContained(framesVideoRoot, prevDir);
                const previousSegments = fs.readdirSync(prevDir)
                    .filter(directoryName => /^\d+_\d+_\d+$/.test(directoryName))
                    .map(directoryName => {
                        const [index, start, end] = directoryName.split('_').map(value => Number.parseInt(value, 10));
                        return { directoryName, index, start, end };
                    });

                let reusedCount = 0;
                const toleranceSec = 2.0;
                for (let i = 0; i < safeSegments.length; i++) {
                    const segment = safeSegments[i];
                    const segmentStart = Math.max(0, segment.startSec - safeBuffer);
                    const segmentEnd = Math.min(duration || 99999, segment.endSec + safeBuffer);
                    const currentSegDirName = `${i + 1}_${Math.floor(segmentStart)}_${Math.floor(segmentEnd)}`;
                    const currentSegPath = resolveContainedPath(outputDir, currentSegDirName);
                    const matchedPrevious = previousSegments.find(previousSegment =>
                        Math.abs(previousSegment.start - Math.floor(segmentStart)) <= toleranceSec &&
                        Math.abs(previousSegment.end - Math.floor(segmentEnd)) <= toleranceSec
                    );

                    if (matchedPrevious) {
                        const sourcePath = resolveContainedPath(prevDir, matchedPrevious.directoryName);
                        if (fs.existsSync(sourcePath)) {
                            try {
                                assertExistingPathContained(prevDir, sourcePath);
                                assertPathContainmentBeforeMutation(outputDir, currentSegPath);
                                copyFolderRecursiveSync(sourcePath, currentSegPath, outputDir);
                                assertExistingPathContained(outputDir, currentSegPath);
                                reusedCount++;
                            } catch (e) {
                                logOperationError('warn', 'FRAME_SEGMENT_REUSE_FAILED', e);
                            }
                        }
                    }
                }

                if (reusedCount > 0) {
                    log('info', 'FRAME_SEGMENTS_REUSED');
                }
                if (reusedCount === safeSegments.length) {
                    log('info', 'FRAME_ALL_SEGMENTS_REUSED');
                } else {
                    log('info', 'FRAME_SEGMENTS_PENDING');
                }
            }


            let allSegmentsExist = true;
            for (const currentExt of extensions) {
                const segDirs = fs.readdirSync(outputDir).filter(directoryName => /^\d+_\d+_\d+$/.test(directoryName));
                let completedSegs = 0;
                for (const segDirName of segDirs) {
                    const targetPath = resolveContainedPath(outputDir, segDirName, currentExt, configDirName);
                    if (fs.existsSync(targetPath)) {
                        assertExistingPathContained(outputDir, targetPath);
                        if (fs.readdirSync(targetPath).length > 0) {
                            completedSegs++;
                        }
                    }
                }

                if (completedSegs < safeSegments.length) {
                    allSegmentsExist = false;
                    break;
                }
            }

            if (allSegmentsExist) {
                log('info', 'FRAME_QUALITY_SKIPPED');
                continue;
            }

            videoPath = await acquireVideo(videoId, tempDir, currentQuality);
            if (videoPath && !videoPath.startsWith(VIDEO_CACHE_DIR)) {
                downloadPerformed = true;
            }

            if (!videoPath) {
                log('error', 'FRAME_VIDEO_UNAVAILABLE');
                logFailedUrl(channel, canonicalVideoUrl);
                throw createOperationError('FRAME_VIDEO_UNAVAILABLE');
            }

            for (const currentExt of extensions) {
                const extractionSummary = await extractFramesFn(videoPath, safeSegments, outputDir, currentQuality, safeFps, safeBuffer, currentExt);
                if (extractionSummary.failedSegments > 0) {
                    throw createOperationError('FRAME_SEGMENT_EXTRACTION_FAILED');
                }
                log('info', 'FRAME_EXTRACTION_COMPLETED');
            }
        } catch (e) {
            if (isExpectedVideoUnavailable(e)) {
                throw e;
            }
            logOperationError('error', 'FRAME_VIDEO_PROCESSING_FAILED', e);
            logFailedUrl(channel, canonicalVideoUrl);
            videoHadFailure = true;
        } finally {
            // 4. 임시 파일 정리 (항상 수행)
            try {
                if (fs.existsSync(tempDir)) {
                    removeContainedDirectory(tempVideoRoot, tempDir);
                }

                if (fs.existsSync(tempVideoRoot) && fs.readdirSync(tempVideoRoot).length === 0) {
                    const channelDir = getChannelDir(channel);
                    assertExistingPathContained(channelDir, tempVideoRoot);
                    fs.rmdirSync(tempVideoRoot);
                }
            } catch (e) {
                logOperationError('warn', 'FRAME_TEMP_CLEANUP_FAILED', e);
            }
        }
    }

    if (videoHadFailure) {
        throw new Error('FRAME_VIDEO_PROCESSING_FAILED');
    }

    if (latestRecollectId !== null) {
        markFrameCollectionCompleted(channel, videoId, latestRecollectId);
    }

    // [옵션] 작업 완료 후 캐시 삭제 (디스크 공간 확보용)
    // 주의: 모든 확장자/화질 처리가 끝난 후 삭제해야 함
    if (params.deleteCache) {
        try {
            const cacheDirectory = requireExistingDirectory(VIDEO_CACHE_DIR);
            const targetCacheFiles = fs.readdirSync(cacheDirectory)
                .filter(fileName => fileName.startsWith(`${videoId}.`) && getSafeProviderBasename(fileName));

            for (const fileName of targetCacheFiles) {
                const targetPath = resolveContainedPath(cacheDirectory, fileName);
                if (fs.existsSync(targetPath)) {
                    removeContainedFile(cacheDirectory, targetPath);
                    log('info', 'FRAME_CACHE_REMOVED');
                }
            }
        } catch (e) {
            logOperationError('warn', 'FRAME_CACHE_REMOVE_FAILED', e);
        }
    }

    removeFailedUrl(channel, canonicalVideoUrl);
    return downloadPerformed;
}

// [추가] 실패한 URL 로깅 함수
function logFailedUrl(channel, url) {
    const videoId = extractVideoId(url);
    if (!videoId) return;

    try {
        const channelDir = ensureContainedDirectory(BASE_DATA_DIR, assertSafeChannelName(channel));
        const failedPath = resolveContainedPath(channelDir, 'failed_urls.txt');
        const canonicalVideoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const content = fs.existsSync(failedPath) ? fs.readFileSync(failedPath, 'utf8') : '';
        const lines = content.split('\n').map(line => line.trim()).filter(Boolean);
        const exists = lines.some(line => extractVideoId(line) === videoId);
        if (!exists) {
            assertPathContainmentBeforeMutation(channelDir, failedPath);
            fs.appendFileSync(failedPath, `${canonicalVideoUrl}\n`, 'utf8');
            assertExistingPathContained(channelDir, failedPath);
        }
    } catch (e) {
        logOperationError('warn', 'FRAME_FAILURE_LIST_UPDATE_FAILED', e);
    }
}

// [추가] 성공한 URL을 실패 목록에서 제거
function removeFailedUrl(channel, url) {
    const videoId = extractVideoId(url);
    if (!videoId) return;

    const failedPath = resolveContainedPath(getChannelDir(channel), 'failed_urls.txt');
    if (!fs.existsSync(failedPath)) return;

    try {
        const channelDir = getChannelDir(channel);
        assertExistingPathContained(channelDir, failedPath);
        const lines = fs.readFileSync(failedPath, 'utf8').split('\n').map(line => line.trim()).filter(Boolean);
        const newLines = lines.filter(line => extractVideoId(line) !== videoId);

        if (lines.length !== newLines.length) {
            assertPathContainmentBeforeMutation(channelDir, failedPath);
            fs.writeFileSync(failedPath, newLines.join('\n') + (newLines.length ? '\n' : ''), 'utf8');
            assertExistingPathContained(channelDir, failedPath);
            log('info', 'FRAME_FAILURE_LIST_RESOLVED');
        }
    } catch (e) {
        logOperationError('warn', 'FRAME_FAILURE_LIST_UPDATE_FAILED', e);
    }
}

async function main() {
    const params = parseArgs();
    const videoId = params.url ? extractVideoId(params.url) : null;
    if (params.url && !videoId) {
        log('error', 'FRAME_INVALID_URL');
        return;
    }

    assertSafeChannelName(params.channel);
    resolveDownloadConfiguration();

    // [설정 적용] 파라미터로 경로가 들어왔으면 덮어쓰기
    if (params.framesDir) FRAMES_ROOT_DIR = params.framesDir;
    if (params.videoCacheDir) VIDEO_CACHE_DIR = params.videoCacheDir;

    // All untrusted process configuration and identifiers are now validated.
    if (!fs.existsSync(BASE_DATA_DIR)) fs.mkdirSync(BASE_DATA_DIR, { recursive: true });
    requireExistingDirectory(BASE_DATA_DIR);
    if (!fs.existsSync(VIDEO_CACHE_DIR)) fs.mkdirSync(VIDEO_CACHE_DIR, { recursive: true });
    if (!fs.existsSync(FRAMES_ROOT_DIR)) fs.mkdirSync(FRAMES_ROOT_DIR, { recursive: true });
    requireExistingDirectory(VIDEO_CACHE_DIR);
    requireExistingDirectory(FRAMES_ROOT_DIR);

    log('info', 'FRAME_OUTPUT_CONFIGURED');
    log('info', 'FRAME_CACHE_CONFIGURED');

    if (videoId) {
        // URL 정규화 (youtu.be 단축 링크 등 리다이렉트 방지)
        params.url = `https://www.youtube.com/watch?v=${videoId}`;

        log('info', 'FRAME_SINGLE_VIDEO_STARTED');
        log('info', 'FRAME_OPTIONS_CONFIGURED');

        if (params.channel === 'manual') {
            ensureContainedDirectory(BASE_DATA_DIR, 'manual');
        }

        await processSingleVideo(videoId, params);
    } else {
        // 자동 배치 수집 모드
        log('info', 'FRAME_BATCH_STARTED');
        await processBatch(params);
    }
}

async function processBatch(params, dependencies = {}) {
    const {
        processVideo = processSingleVideo,
        collectPredicate = shouldCollect,
    } = dependencies;
    const { channel } = params;
    assertSafeChannelName(channel);
    resolveDownloadConfiguration();
    const urlsPath = path.join(getChannelDir(channel), 'urls.txt');
    const deletedPath = path.join(getChannelDir(channel), 'deleted_urls.txt');

    if (!fs.existsSync(urlsPath)) {
        log('error', 'FRAME_URL_LIST_MISSING');
        return;
    }

    // 1. deleted_ids 로드
    const deletedIds = new Set();
    if (fs.existsSync(deletedPath)) {
        try {
            const lines = fs.readFileSync(deletedPath, 'utf8').split('\n');
            for (const line of lines) {
                const vid = extractVideoId(line);
                if (vid) deletedIds.add(vid);
            }
        } catch (e) {
            logOperationError('warn', 'FRAME_DELETED_URLS_READ_FAILED', e);
        }
    }

    const urls = fs.readFileSync(urlsPath, 'utf8')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    log('info', 'FRAME_URLS_DISCOVERED');

    // [Smart Filter] 처리 대상 영상 미리 선별
    console.log(`\n[SCAN] [Smart Filter] 처리 대상을 선별 중입니다...`);
    const pendingUrls = [];

    // 진행바 처럼 점찍기
    let shortsCount = 0;  // [추가] Shorts 카운트
    let scanCount = 0;
    process.stdout.write('Scanning: ');

    for (const url of urls) {
        scanCount++;
        if (scanCount % 50 === 0) process.stdout.write('.');

        const videoId = extractVideoId(url);
        if (!videoId) continue;
        if (deletedIds.has(videoId)) {
            continue;
        }

        // [수정] shouldCollect 반환값 처리 (true/false 또는 객체)
        const result = collectPredicate(channel, videoId, params);

        if (result === true) {
            pendingUrls.push(url);
        } else if (result && result.skip && result.reason === 'shorts') {
            // Shorts는 별도 카운트 (개별 로그 출력 안함)
            shortsCount++;
        }
    }
    process.stdout.write('\n');

    // [수정] Shorts 요약 로그 출력 (한 줄로)
    if (shortsCount > 0) {
        log('info', 'FRAME_SHORTS_SKIPPED');
    }
    log('info', 'FRAME_SCAN_COMPLETED');


    if (String(process.env.TZUDONG_PIPELINE_LIVE || '').trim() === '1' && pendingUrls.length > 0) {
        const raw = String(process.env.LIVE_MAX_NEW_ITEMS || '1').trim();
        const maxNew = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : 1;
        if (pendingUrls.length > maxNew) {
            log('info', 'FRAME_LIVE_CAP_PENDING_DOWNLOADS', { kept: maxNew, dropped: pendingUrls.length - maxNew });
            pendingUrls.length = maxNew;
        }
    }
    if (pendingUrls.length === 0) {
        log('info', 'FRAME_NO_PENDING_WORK');
        return;
    }

    // [PERF] 병렬 처리: OS 리소스(CPU/메모리) 기반 동적 동시성 설정
    const cpuCores = os.cpus().length;
    const freeMemGB = os.freemem() / (1024 * 1024 * 1024);
    
    // CPU 코어 수와 가용 메모리(작업당 최소 500MB 여유분 가정)를 고려하여 계산
    // GitHub Actions(보통 2~4코어) 및 로컬 환경(8~16코어) 자동 최적화
    const memBasedLimit = Math.max(1, Math.floor(freeMemGB / 0.5)); 
    let CONCURRENCY = Math.min(cpuCores, memBasedLimit, 8); // 최대 8개 제한 (Rate limit 방지)
    
    // CI 환경의 경우 메모리 부족 킬(OOM)을 방지하기 위해 조금 더 보수적으로 접근
    if (process.env.CI) {
        CONCURRENCY = Math.min(CONCURRENCY, 4);
    }
    
    // 명시적 환경변수가 있으면 최우선 적용
    if (process.env.MAX_JOBS) {
        CONCURRENCY = parseInt(process.env.MAX_JOBS, 10) || CONCURRENCY;
    }
    
    log('info', 'FRAME_CONCURRENCY_CONFIGURED');

    let failedCount = 0;
    let expectedUnavailableCount = 0;
    let urlIndex = 0;
    const heatmapRateLimitStormLimit = getHeatmapRateLimitStormLimit();
    let heatmapRateLimitErrors = 0;
    let heatmapRateLimitStormTripped = false;

    // [PERF] Promise 기반 동시성 제어 (외부 의존성 없음)
    const processNext = async () => {
        while (urlIndex < pendingUrls.length) {
            if (heatmapRateLimitStormTripped) {
                break;
            }
            const currentIndex = urlIndex++;
            const url = pendingUrls[currentIndex];
            const videoId = extractVideoId(url);

            log('info', 'FRAME_VIDEO_PROCESSING_STARTED');
            
            // params를 복사하여 병렬 작업 간 url 충돌 방지
            const taskParams = { ...params, url };
            
            try {
                const downloadPerformed = await processVideo(videoId, taskParams);

                // [변경] 다운로드가 실제로 수행되었을 때만 짧은 대기 (속도 제한 방지)
                if (downloadPerformed) {
                    await new Promise(r => setTimeout(r, 500));
                }
            } catch (e) {
                logOperationError('error', 'FRAME_VIDEO_PROCESSING_FAILED', e);
                if (isExpectedVideoUnavailable(e)) {
                    expectedUnavailableCount++;
                    log('warn', 'FRAME_VIDEO_UNAVAILABLE_CONTINUED');
                    continue;
                }
                if (isHeatmapRateLimitError(e)) {
                    heatmapRateLimitErrors++;
                    logFailedUrl(channel, url);
                    log('error', 'FRAME_BATCH_FAILURE_RECORDED');
                    if (heatmapRateLimitErrors >= heatmapRateLimitStormLimit) {
                        heatmapRateLimitStormTripped = true;
                        log('error', 'FRAME_BATCH_SCHEDULING_STOPPED');
                    }
                }
                failedCount++;
            }
        }
    };

    // N개의 worker를 동시에 시작
    const workers = [];
    for (let i = 0; i < Math.min(CONCURRENCY, pendingUrls.length); i++) {
        workers.push(processNext());
    }
    await Promise.all(workers);

    log('info', 'FRAME_BATCH_COMPLETED');
    if (expectedUnavailableCount > 0) {
        log('warn', 'FRAME_BATCH_UNAVAILABLE_RECORDED');
    }
    if (heatmapRateLimitStormTripped) {
        log('error', 'FRAME_BATCH_SCHEDULING_STOPPED');
        throw new Error('FRAME_BATCH_RATE_LIMIT_BREAKER_TRIPPED');
    }
    if (failedCount > 0) {
        throw new Error('FRAME_BATCH_FAILED');
    }
}

const isDirectExecution = process.argv[1]
    ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
    : false;

if (isDirectExecution) {
    main().catch(e => {
        logOperationError('error', 'FRAME_MAIN_FAILED', e);
        process.exitCode = 1;
    });
}

export {
    downloadVideo,
    buildYtDlpExecOptions,
    fetchUsableGDriveVideo,
    getYtDlpDownloadTimeoutMs,
    getHeatmapRateLimitStormLimit,
    getYtDlpMaxRetries,
    isHeatmapRateLimitError,
    hasVideoStream,
    pickUsableLocalVideoCandidate,
    processBatch,
    processSingleVideo,
    sortVideoCandidates,
    resolveMediaTools,
    isRunnableMediaTool,
    isExpectedVideoUnavailable,
};
