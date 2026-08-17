/**
 * 비디오를 청크 계획에 따라 mp4 세그먼트로 분할
 *
 * 사용법:
 *   node split_video_chunks.mjs <video_path> <chunks_json> <output_dir>
 */

import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { logSafeError } from '../../utils/privacy-log.mjs';

const require = createRequire(import.meta.url);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CRAWLING_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_TRUSTED_TEMP_ROOT = path.join(CRAWLING_ROOT, 'temp');
const MAX_CAPTURE_BYTES = 64 * 1024;
const KILL_GRACE_MS = 100;

export const SPLIT_VIDEO_LIMITS = Object.freeze({
    maxChunks: 1_000,
    maxVideoDurationSec: 24 * 60 * 60,
    maxChunkDurationSec: 6 * 60 * 60,
    maxAggregateDurationSec: 24 * 60 * 60,
    maxChunkPlanBytes: 4 * 1024 * 1024,
    maxSourceBytes: 8 * 1024 * 1024 * 1024,
    maxTotalOutputBytes: 8 * 1024 * 1024 * 1024,
});

const MIN_TIMEOUT_MS = 15 * 60 * 1000;
const PROBE_TIMEOUT_MS = 60 * 1000;
const DELETE_RETRY_COUNT = 8;
const DELETE_RETRY_DELAY_MS = 500;
const NOFOLLOW = fs.constants.O_NOFOLLOW || 0;
const O_DIRECTORY = fs.constants.O_DIRECTORY || 0;
const PROC_SELF_FD = '/proc/self/fd';

function fixedError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

function sameIdentity(left, right) {
    return left.dev === right.dev &&
        left.ino === right.ino &&
        left.size === right.size &&
        left.mtimeMs === right.mtimeMs &&
        left.ctimeMs === right.ctimeMs;
}
function sameObject(left, right) {
    return left.dev === right.dev && left.ino === right.ino;
}

function isInsideRoot(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function lstatRegular(candidate, code) {
    let stat;
    try {
        stat = fs.lstatSync(candidate);
    } catch {
        throw fixedError(code);
    }
    if (stat.isSymbolicLink() || !stat.isFile()) throw fixedError(code);
    return stat;
}

function lstatDirectory(candidate, code) {
    let stat;
    try {
        stat = fs.lstatSync(candidate);
    } catch {
        throw fixedError(code);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw fixedError(code);
    return stat;
}

/** Resolve a directory once and bind its identity before it becomes a trust root. */
export function bindTrustedRoot(candidate, code = 'SPLIT_VIDEO_INPUT_INVALID') {
    const absolute = path.resolve(candidate);
    const initial = lstatDirectory(absolute, code);
    let resolved;
    try {
        resolved = fs.realpathSync(absolute);
    } catch {
        throw fixedError(code);
    }
    const opened = lstatDirectory(resolved, code);
    if (!sameObject(initial, opened)) throw fixedError(code);
    return { path: resolved, identity: opened };
}

function assertTrustedRoot(root, code) {
    const current = lstatDirectory(root.path, code);
    if (!sameObject(root.identity, current)) throw fixedError(code);
}

function normalizeTrustedRoots(trustedRoots, code) {
    if (!Array.isArray(trustedRoots) || trustedRoots.length === 0) throw fixedError(code);
    return trustedRoots.map(root => typeof root?.path === 'string' && root.identity
        ? root
        : bindTrustedRoot(root, code));
}

function containingTrustedRoot(resolved, trustedRoots, code) {
    const root = trustedRoots.find(candidate => isInsideRoot(candidate.path, resolved));
    if (!root) throw fixedError(code);
    assertTrustedRoot(root, code);
    return root;
}

/**
 * Open a non-link regular file and retain both a no-follow descriptor and its
 * canonical identity. Call assertBoundFile immediately before every dispatch.
 */
export function bindTrustedRegularFile(candidate, trustedRoots, {
    maxBytes = Number.POSITIVE_INFINITY,
    code = 'SPLIT_VIDEO_INPUT_INVALID',
} = {}) {
    const roots = normalizeTrustedRoots(trustedRoots, code);
    const absolute = path.resolve(candidate);
    const initial = lstatRegular(absolute, code);
    let resolved;
    try {
        resolved = fs.realpathSync(absolute);
    } catch {
        throw fixedError(code);
    }
    const root = containingTrustedRoot(resolved, roots, code);
    const canonical = lstatRegular(resolved, code);
    if (!sameIdentity(initial, canonical) || canonical.size > maxBytes) throw fixedError(code);

    let fd;
    try {
        fd = fs.openSync(resolved, fs.constants.O_RDONLY | NOFOLLOW);
    } catch {
        throw fixedError(code);
    }

    try {
        const opened = fs.fstatSync(fd);
        if (!sameIdentity(canonical, opened) || opened.size > maxBytes) throw fixedError(code);
        return { fd, path: resolved, identity: opened, root, code };
    } catch (error) {
        fs.closeSync(fd);
        throw error?.message === code ? error : fixedError(code);
    }
}

export function assertBoundFile(handle, code = handle?.code || 'SPLIT_VIDEO_INPUT_INVALID') {
    if (!handle || typeof handle.fd !== 'number' || !handle.root) throw fixedError(code);
    assertTrustedRoot(handle.root, code);
    const current = lstatRegular(handle.path, code);
    let opened;
    try {
        opened = fs.fstatSync(handle.fd);
    } catch {
        throw fixedError(code);
    }
    if (!sameIdentity(handle.identity, current) || !sameIdentity(handle.identity, opened)) {
        throw fixedError(code);
    }
}

function closeBoundFile(handle) {
    if (!handle) return;
    try {
        fs.closeSync(handle.fd);
    } catch {
        // The descriptor is best-effort only after all child exits have been awaited.
    }
}

function readBoundUtf8(handle, code) {
    assertBoundFile(handle, code);
    let value;
    try {
        fs.readSync(handle.fd, Buffer.alloc(0), 0, 0, 0);
        value = fs.readFileSync(handle.fd, 'utf8');
    } catch {
        throw fixedError(code);
    }
    assertBoundFile(handle, code);
    return value;
}

function ensurePrivateDirectory(trustedRoot, candidate, code) {
    assertTrustedRoot(trustedRoot, code);
    const absolute = path.resolve(candidate);
    if (!isInsideRoot(trustedRoot.path, absolute) || absolute === trustedRoot.path) throw fixedError(code);

    const relative = path.relative(trustedRoot.path, absolute);
    let current = trustedRoot.path;
    for (const segment of relative.split(path.sep)) {
        if (!segment || segment === '.' || segment === '..') throw fixedError(code);
        current = path.join(current, segment);
        if (!fs.existsSync(current)) {
            try {
                fs.mkdirSync(current, { mode: 0o700 });
            } catch {
                throw fixedError(code);
            }
        }
        lstatDirectory(current, code);
        try { fs.chmodSync(current, 0o700); } catch { /* Windows has no POSIX mode bit. */ }
    }

    const root = bindTrustedRoot(absolute, code);
    if (!isInsideRoot(trustedRoot.path, root.path)) throw fixedError(code);
    return root;
}

export function prepareOutputRoot(candidate, trustedRoot = bindTrustedRoot(DEFAULT_TRUSTED_TEMP_ROOT, 'SPLIT_VIDEO_OUTPUT_ROOT_INVALID')) {
    return ensurePrivateDirectory(trustedRoot, candidate, 'SPLIT_VIDEO_OUTPUT_ROOT_INVALID');
}

function bindOutputDirectory(root) {
    assertTrustedRoot(root, 'SPLIT_VIDEO_OUTPUT_ROOT_INVALID');
    if (process.platform === 'win32' || !fs.existsSync(PROC_SELF_FD)) return root;
    let fd;
    try {
        fd = fs.openSync(
            root.path,
            fs.constants.O_RDONLY | NOFOLLOW | (process.platform === 'win32' ? 0 : O_DIRECTORY),
        );
        const opened = fs.fstatSync(fd);
        if (!opened.isDirectory() || !sameObject(root.identity, opened)) {
            throw fixedError('SPLIT_VIDEO_OUTPUT_ROOT_INVALID');
        }
        return { ...root, fd };
    } catch (error) {
        if (typeof fd === 'number') {
            try { fs.closeSync(fd); } catch { /* Best effort after a failed directory reservation. */ }
        }
        throw error?.message === 'SPLIT_VIDEO_OUTPUT_ROOT_INVALID'
            ? error
            : fixedError('SPLIT_VIDEO_OUTPUT_ROOT_INVALID');
    }
}

function closeOutputDirectory(root) {
    if (typeof root?.fd !== 'number') return;
    try { fs.closeSync(root.fd); } catch { /* The directory descriptor is best-effort during final cleanup. */ }
}

export function resolveChunkOutputPaths(outputRoot, chunkIndex, nonce = randomUUID()) {
    const rootPath = typeof outputRoot === 'string' ? path.resolve(outputRoot) : outputRoot?.path;
    if (typeof rootPath !== 'string') throw fixedError('SPLIT_VIDEO_OUTPUT_PATH_INVALID');
    if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= SPLIT_VIDEO_LIMITS.maxChunks) {
        throw fixedError('SPLIT_VIDEO_CHUNK_INDEX_INVALID');
    }
    if (typeof nonce !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(nonce)) {
        throw fixedError('SPLIT_VIDEO_TEMP_NONCE_INVALID');
    }
    const outFile = path.resolve(rootPath, `chunk_${chunkIndex}.mp4`);
    const tempOutFile = path.resolve(rootPath, `.chunk_${chunkIndex}.${nonce}.tmp.mp4`);
    if (!isInsideRoot(rootPath, outFile) || !isInsideRoot(rootPath, tempOutFile)) {
        throw fixedError('SPLIT_VIDEO_OUTPUT_PATH_INVALID');
    }
    return { outFile, tempOutFile };
}

function assertContainedOutputPath(outputRoot, candidate, code) {
    assertTrustedRoot(outputRoot, code);
    const absolute = path.resolve(candidate);
    if (!isInsideRoot(outputRoot.path, absolute)) throw fixedError(code);
    return absolute;
}

function resolveOutputOperationPath(outputRoot, candidate, code) {
    const absolute = assertContainedOutputPath(outputRoot, candidate, code);
    if (typeof outputRoot.fd !== 'number' || process.platform === 'win32' || !fs.existsSync(PROC_SELF_FD)) {
        return absolute;
    }

    let opened;
    try {
        opened = fs.fstatSync(outputRoot.fd);
    } catch {
        throw fixedError(code);
    }
    if (!opened.isDirectory() || !sameObject(outputRoot.identity, opened)) throw fixedError(code);

    const relative = path.relative(outputRoot.path, absolute);
    if (!relative || relative.includes(path.sep) || path.isAbsolute(relative)) throw fixedError(code);
    return path.join(PROC_SELF_FD, String(outputRoot.fd), relative);
}

function assertOutputAbsent(outputRoot, candidate, code) {
    const absolute = assertContainedOutputPath(outputRoot, candidate, code);
    const operationPath = resolveOutputOperationPath(outputRoot, absolute, code);
    try {
        fs.lstatSync(operationPath);
    } catch (error) {
        if (error?.code === 'ENOENT') return { absolute, operationPath };
        throw fixedError(code);
    }
    throw fixedError(code);
}

function captureOutputState(stat) {
    return {
        dev: stat.dev,
        ino: stat.ino,
        size: stat.size,
        nlink: stat.nlink,
        isFile: stat.isFile(),
    };
}

function isRegularOutputState(stat) {
    return typeof stat?.isFile === 'function' ? stat.isFile() : stat?.isFile === true;
}

function sameOutputState(left, right) {
    return isRegularOutputState(left) &&
        isRegularOutputState(right) &&
        left.dev === right.dev &&
        left.ino === right.ino &&
        left.size === right.size &&
        left.nlink === right.nlink;
}

function readReservationState(reservation, code = 'SPLIT_VIDEO_TEMP_OUTPUT_INVALID') {
    let opened;
    try {
        opened = fs.fstatSync(reservation.fd);
    } catch {
        throw fixedError(code);
    }
    if (!opened.isFile() || !sameObject(reservation.identity, opened)) throw fixedError(code);
    return opened;
}

export function reserveExclusiveTempFile(outputRoot, tempOutFile) {
    const candidate = assertContainedOutputPath(outputRoot, tempOutFile, 'SPLIT_VIDEO_OUTPUT_PATH_INVALID');
    const operationPath = resolveOutputOperationPath(outputRoot, candidate, 'SPLIT_VIDEO_OUTPUT_PATH_INVALID');
    let fd;
    try {
        fd = fs.openSync(operationPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | NOFOLLOW, 0o600);
        const identity = fs.fstatSync(fd);
        if (!identity.isFile() || identity.size !== 0 || identity.nlink !== 1) {
            throw fixedError('SPLIT_VIDEO_TEMP_OUTPUT_INVALID');
        }
        return { fd, path: candidate, operationPath, root: outputRoot, identity };
    } catch (error) {
        if (typeof fd === 'number') {
            try { fs.closeSync(fd); } catch { /* Best effort after a failed reservation. */ }
        }
        throw error?.message === 'SPLIT_VIDEO_TEMP_OUTPUT_INVALID'
            ? error
            : fixedError('SPLIT_VIDEO_TEMP_OUTPUT_INVALID');
    }
}

function assertReservedTempFile(reservation, { requirePayload = false } = {}) {
    const current = assertRegularOutput(reservation.root, reservation.path, 'SPLIT_VIDEO_TEMP_OUTPUT_INVALID');
    const opened = readReservationState(reservation);
    if (!sameOutputState(current, opened) || opened.nlink !== 1 || (requirePayload && opened.size < 1)) {
        throw fixedError('SPLIT_VIDEO_TEMP_OUTPUT_INVALID');
    }
    return opened;
}

function removeOwnedPublicationBestEffort(outputRoot, reservation, outFile) {
    try {
        let expected;
        try {
            expected = readReservationState(reservation, 'SPLIT_VIDEO_OUTPUT_PUBLISH_INVALID');
        } catch {
            expected = reservation.publishedState;
        }
        const published = assertRegularOutput(outputRoot, outFile, 'SPLIT_VIDEO_OUTPUT_PUBLISH_INVALID');
        if (!sameOutputState(expected, published)) return false;
        fs.unlinkSync(resolveOutputOperationPath(outputRoot, outFile, 'SPLIT_VIDEO_OUTPUT_PUBLISH_INVALID'));
        return true;
    } catch {
        // Never remove an output whose descriptor-bound state was not created by this reservation.
        return false;
    }
}

function removeOwnedTemporaryBestEffort(reservation) {
    try {
        const opened = readReservationState(reservation);
        const temporary = assertRegularOutput(reservation.root, reservation.path, 'SPLIT_VIDEO_TEMP_OUTPUT_INVALID');
        if (!sameOutputState(opened, temporary)) return false;
        fs.unlinkSync(reservation.operationPath);
        return true;
    } catch {
        // Never remove a replacement for the descriptor-bound temporary file.
        return false;
    }
}

function assertRegularOutput(outputRoot, candidate, code) {
    const absolute = assertContainedOutputPath(outputRoot, candidate, code);
    return lstatRegular(resolveOutputOperationPath(outputRoot, absolute, code), code);
}

function linkReservedOutput(reservation, finalOperationPath) {
    assertReservedTempFile(reservation, { requirePayload: true });
    fs.linkSync(reservation.path, finalOperationPath);
}

export function publishOutputAtomically(outputRoot, reservation, outFile) {
    const expected = assertReservedTempFile(reservation, { requirePayload: true });
    const { absolute: finalPath, operationPath: finalOperationPath } = assertOutputAbsent(
        outputRoot,
        outFile,
        'SPLIT_VIDEO_OUTPUT_PUBLISH_INVALID',
    );
    let linked = false;

    try {
        linkReservedOutput(reservation, finalOperationPath);
        linked = true;

        const linkedState = readReservationState(reservation, 'SPLIT_VIDEO_OUTPUT_PUBLISH_INVALID');
        const temporary = assertRegularOutput(outputRoot, reservation.path, 'SPLIT_VIDEO_OUTPUT_PUBLISH_INVALID');
        const published = assertRegularOutput(outputRoot, finalPath, 'SPLIT_VIDEO_OUTPUT_PUBLISH_INVALID');
        if (!sameOutputState(linkedState, temporary) ||
            !sameOutputState(linkedState, published) ||
            linkedState.size !== expected.size ||
            linkedState.nlink !== expected.nlink + 1) {
            throw fixedError('SPLIT_VIDEO_OUTPUT_PUBLISH_INVALID');
        }

        fs.unlinkSync(reservation.operationPath);

        const finalState = readReservationState(reservation, 'SPLIT_VIDEO_OUTPUT_PUBLISH_INVALID');
        const finalPublished = assertRegularOutput(outputRoot, finalPath, 'SPLIT_VIDEO_OUTPUT_PUBLISH_INVALID');
        if (!sameOutputState(finalState, finalPublished) ||
            finalState.size !== expected.size ||
            finalState.nlink !== expected.nlink) {
            throw fixedError('SPLIT_VIDEO_OUTPUT_PUBLISH_INVALID');
        }
        reservation.publishedState = captureOutputState(finalState);
        return finalPublished;
    } catch (error) {
        if (linked) removeOwnedPublicationBestEffort(outputRoot, reservation, finalPath);
        throw error?.message === 'SPLIT_VIDEO_TEMP_OUTPUT_INVALID'
            ? error
            : fixedError('SPLIT_VIDEO_OUTPUT_PUBLISH_INVALID');
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


export function computeTimeoutMs(durationSec) {
    if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > SPLIT_VIDEO_LIMITS.maxChunkDurationSec) {
        throw fixedError('SPLIT_VIDEO_DURATION_INVALID');
    }
    const dynamicTimeout = (durationSec * 2000) + 120000;
    return Math.ceil(Math.max(MIN_TIMEOUT_MS, dynamicTimeout));
}

/** Validate the existing array schema while enforcing a non-overlapping media-bound plan. */
export function clampChunkPlanToMedia(value, mediaDurationSec) {
    if (!Array.isArray(value) || value.length === 0 ||
        !Number.isFinite(mediaDurationSec) || mediaDurationSec <= 0 ||
        mediaDurationSec > SPLIT_VIDEO_LIMITS.maxVideoDurationSec) {
        throw fixedError('SPLIT_VIDEO_CHUNK_PLAN_INVALID');
    }
    const clamped = [];
    for (const chunk of value) {
        if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk)) {
            throw fixedError('SPLIT_VIDEO_CHUNK_PLAN_INVALID');
        }
        const startSec = chunk.start_sec;
        let endSec = chunk.end_sec;
        if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || endSec <= startSec) {
            throw fixedError('SPLIT_VIDEO_CHUNK_PLAN_INVALID');
        }
        if (startSec >= mediaDurationSec) continue;
        if (endSec > mediaDurationSec) endSec = mediaDurationSec;
        if (endSec <= startSec) continue;
        clamped.push({ ...chunk, start_sec: startSec, end_sec: endSec });
    }
    if (clamped.length === 0) throw fixedError('SPLIT_VIDEO_CHUNK_PLAN_INVALID');
    return clamped;
}

export function validateChunkPlan(value, mediaDurationSec = SPLIT_VIDEO_LIMITS.maxVideoDurationSec, limits = SPLIT_VIDEO_LIMITS) {
    if (!Array.isArray(value) || value.length === 0 || value.length > limits.maxChunks ||
        !Number.isFinite(mediaDurationSec) || mediaDurationSec <= 0 || mediaDurationSec > limits.maxVideoDurationSec) {
        throw fixedError('SPLIT_VIDEO_CHUNK_PLAN_INVALID');
    }

    let previousEnd = 0;
    let aggregateDuration = 0;
    return value.map((chunk, index) => {
        if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk)) throw fixedError('SPLIT_VIDEO_CHUNK_PLAN_INVALID');
        const chunkIndex = chunk.chunk_index;
        const startSec = chunk.start_sec;
        const endSec = chunk.end_sec;
        const duration = endSec - startSec;
        if (!Number.isSafeInteger(chunkIndex) || chunkIndex !== index ||
            !Number.isFinite(startSec) || !Number.isFinite(endSec) ||
            startSec < 0 || endSec <= startSec || endSec > mediaDurationSec ||
            duration > limits.maxChunkDurationSec || startSec < previousEnd) {
            throw fixedError('SPLIT_VIDEO_CHUNK_PLAN_INVALID');
        }
        aggregateDuration += duration;
        if (!Number.isFinite(aggregateDuration) || aggregateDuration > limits.maxAggregateDurationSec) {
            throw fixedError('SPLIT_VIDEO_CHUNK_PLAN_INVALID');
        }
        previousEnd = endSec;
        return { ...chunk, chunk_index: chunkIndex, start_sec: startSec, end_sec: endSec };
    });
}

export function buildFfmpegEnv(privateHome) {
    if (typeof privateHome !== 'string' || !path.isAbsolute(privateHome)) {
        throw fixedError('SPLIT_VIDEO_ENV_INVALID');
    }
    const privateTemp = path.join(privateHome, 'tmp');
    try {
        fs.mkdirSync(privateTemp, { recursive: true, mode: 0o700 });
        fs.chmodSync(privateHome, 0o700);
        fs.chmodSync(privateTemp, 0o700);
    } catch {
        throw fixedError('SPLIT_VIDEO_ENV_INVALID');
    }
    const env = {
        HOME: privateHome,
        TMPDIR: privateTemp,
        TMP: privateTemp,
        TEMP: privateTemp,
        PATH: process.platform === 'win32' ? 'C:\\Windows\\System32' : '/usr/bin:/bin',
    };
    if (process.platform === 'win32') {
        env.USERPROFILE = privateHome;
        env.SystemRoot = process.env.SystemRoot || 'C:\\Windows';
    }
    return Object.freeze(env);
}

function createPrivateHome(outputRoot) {
    assertTrustedRoot(outputRoot, 'SPLIT_VIDEO_ENV_INVALID');
    let privateHome;
    try {
        privateHome = fs.mkdtempSync(path.join(outputRoot.path, '.split-video-home-'));
        fs.chmodSync(privateHome, 0o700);
    } catch {
        throw fixedError('SPLIT_VIDEO_ENV_INVALID');
    }
    if (!isInsideRoot(outputRoot.path, privateHome)) throw fixedError('SPLIT_VIDEO_ENV_INVALID');
    return privateHome;
}

function removePrivateHome(outputRoot, privateHome) {
    if (!privateHome || !isInsideRoot(outputRoot.path, privateHome)) return;
    try {
        const stat = fs.lstatSync(privateHome);
        if (stat.isSymbolicLink() || !stat.isDirectory()) return;
        fs.rmSync(privateHome, { recursive: true, force: true, maxRetries: DELETE_RETRY_COUNT, retryDelay: DELETE_RETRY_DELAY_MS });
    } catch (error) {
        logSafeError(error, line => console.warn(`SPLIT_VIDEO_CLEANUP_FAILED ${line.trim()}`));
    }
}

function toWindowsPath(candidate, windowsExecutable) {
    if (!windowsExecutable) return candidate;
    const match = candidate.match(/^\/mnt\/([a-z])\/(.*)/i);
    return match ? `${match[1].toUpperCase()}:/${match[2]}` : candidate;
}

function isWindowsExecutable(candidate) {
    return candidate.toLowerCase().endsWith('.exe');
}

export function bindTrustedExecutable(candidate, trustedRoots) {
    return bindTrustedRegularFile(candidate, trustedRoots, { code: 'SPLIT_VIDEO_FFMPEG_PATH_INVALID' });
}

async function resolveFfmpegBinding() {
    const customFfmpeg = (process.env.FFMPEG_PATH || '').trim();
    const allowCustomFfmpeg = process.env.ALLOW_CUSTOM_FFMPEG === '1';

    if (allowCustomFfmpeg && customFfmpeg) {
        const configuredRoot = (process.env.FFMPEG_TRUSTED_ROOT || '').trim();
        if (!path.isAbsolute(customFfmpeg) || !path.isAbsolute(configuredRoot)) {
            throw fixedError('SPLIT_VIDEO_FFMPEG_PATH_INVALID');
        }
        return bindTrustedExecutable(customFfmpeg, [bindTrustedRoot(configuredRoot, 'SPLIT_VIDEO_FFMPEG_PATH_INVALID')]);
    }
    if (customFfmpeg || process.env.ALLOW_PATH_FFMPEG === '1') {
        throw fixedError('SPLIT_VIDEO_FFMPEG_PATH_INVALID');
    }

    let ffmpegStatic;
    let packageRoot;
    try {
        ({ default: ffmpegStatic } = await import('ffmpeg-static'));
        packageRoot = path.dirname(require.resolve('ffmpeg-static'));
    } catch {
        throw fixedError('SPLIT_VIDEO_FFMPEG_UNAVAILABLE');
    }
    const trustedRoot = bindTrustedRoot(packageRoot, 'SPLIT_VIDEO_FFMPEG_PATH_INVALID');
    for (const candidate of [ffmpegStatic, `${ffmpegStatic}.exe`]) {
        if (typeof candidate === 'string' && path.isAbsolute(candidate) && fs.existsSync(candidate)) {
            return bindTrustedExecutable(candidate, [trustedRoot]);
        }
    }
    throw fixedError('SPLIT_VIDEO_FFMPEG_UNAVAILABLE');
}

function appendCapture(buffer, chunk) {
    if (buffer.length >= MAX_CAPTURE_BYTES) return buffer;
    const available = MAX_CAPTURE_BYTES - buffer.length;
    return Buffer.concat([buffer, chunk.subarray(0, available)]);
}

async function waitForOwnedProcessGroupExit(pid) {
    for (;;) {
        try {
            process.kill(-pid, 0);
        } catch (error) {
            if (error?.code === 'ESRCH') return;
            throw fixedError('SPLIT_VIDEO_PROCESS_ABORTED');
        }
        await sleep(20);
    }
}

function runWindowsTreeKill(pid, env) {
    return new Promise(resolve => {
        const systemRoot = process.env.SystemRoot || 'C:\\Windows';
        const taskkill = path.join(systemRoot, 'System32', 'taskkill.exe');
        let child;
        try {
            child = spawn(taskkill, ['/pid', String(pid), '/t', '/f'], {
                env,
                windowsHide: true,
                stdio: 'ignore',
                shell: false,
            });
        } catch {
            resolve();
            return;
        }
        child.once('error', resolve);
        child.once('close', resolve);
    });
}

export class ChildSupervisor {
    constructor(env) {
        this.env = env;
        this.records = new Set();
        this.abortReason = null;
        this.abortPromise = null;
    }

    async run(binding, sourceHandle, args, { timeoutMs, allowFailure = false, windowsExecutable = false, guardHandles = [] } = {}) {
        if (this.abortReason) throw this.abortReason;
        assertBoundFile(binding, 'SPLIT_VIDEO_FFMPEG_SWAPPED');
        assertBoundFile(sourceHandle, 'SPLIT_VIDEO_SOURCE_SWAPPED');
        for (const guard of guardHandles) {
            assertBoundFile(guard.handle, guard.code);
        }

        const useDescriptorPaths = process.platform !== 'win32' && !windowsExecutable && fs.existsSync('/proc/self/fd');
        const sourceArgument = useDescriptorPaths ? '/proc/self/fd/3' : sourceHandle.path;
        const command = useDescriptorPaths ? '/proc/self/fd/4' : binding.path;
        const commandArgs = args.map(arg => arg === sourceHandle.path ? sourceArgument : arg);
        const stdio = useDescriptorPaths ? ['ignore', 'pipe', 'pipe', sourceHandle.fd, binding.fd] : ['ignore', 'pipe', 'pipe'];

        let child;
        try {
            child = spawn(command, commandArgs, {
                detached: true,
                env: this.env,
                windowsHide: true,
                stdio,
                shell: false,
            });
        } catch {
            throw fixedError('SPLIT_VIDEO_FFMPEG_FAILED');
        }

        const record = {
            child,
            pid: child.pid,
            closed: false,
            abortReason: null,
            stdout: Buffer.alloc(0),
            stderr: Buffer.alloc(0),
            exited: null,
            resolveExited: null,
            timeout: null,
        };
        record.exited = new Promise(resolve => { record.resolveExited = resolve; });
        this.records.add(record);

        const result = await new Promise((resolve, reject) => {
            let settled = false;
            const finish = (error, value) => {
                if (settled) return;
                settled = true;
                if (record.timeout) clearTimeout(record.timeout);
                record.closed = true;
                record.resolveExited();
                if (error) reject(error);
                else resolve(value);
            };
            const fail = code => {
                const error = this.abortReason || record.abortReason || fixedError(code);
                if (!this.abortReason && !record.abortReason) void this.abortAll(error);
                finish(error);
            };

            child.stdout?.on('data', chunk => { record.stdout = appendCapture(record.stdout, chunk); });
            child.stderr?.on('data', chunk => { record.stderr = appendCapture(record.stderr, chunk); });
            child.once('error', () => fail('SPLIT_VIDEO_FFMPEG_FAILED'));
            child.once('close', (code, signal) => {
                if (record.abortReason || this.abortReason) {
                    finish(record.abortReason || this.abortReason);
                } else if (allowFailure || code === 0) {
                    finish(null, { code, signal, stdout: record.stdout.toString('utf8'), stderr: record.stderr.toString('utf8') });
                } else {
                    fail('SPLIT_VIDEO_FFMPEG_FAILED');
                }
            });
            record.timeout = setTimeout(() => {
                const timeoutError = fixedError('SPLIT_VIDEO_FFMPEG_TIMEOUT');
                void this.abortAll(timeoutError);
            }, timeoutMs);
        });

        return result;
    }

    async abortRecord(record) {
        record.abortReason ||= this.abortReason || fixedError('SPLIT_VIDEO_PROCESS_ABORTED');
        if (!Number.isSafeInteger(record.pid) || record.pid <= 0) {
            await record.exited;
            return;
        }

        if (process.platform === 'win32') {
            const treeKill = runWindowsTreeKill(record.pid, this.env);
            await Promise.race([record.exited, sleep(KILL_GRACE_MS)]);
            if (!record.closed) {
                try { record.child.kill('SIGKILL'); } catch { /* taskkill /T /F remains responsible for descendants. */ }
            }
            await treeKill;
            await record.exited;
            return;
        }

        try { process.kill(-record.pid, 'SIGTERM'); } catch { /* Child may already have exited. */ }
        await sleep(KILL_GRACE_MS);
        try { process.kill(-record.pid, 'SIGKILL'); } catch { /* Whole owned group is already gone. */ }
        await record.exited;
        await waitForOwnedProcessGroupExit(record.pid);
    }

    releaseCompleted() {
        if (!this.abortReason) this.records.clear();
    }

    async abortAll(reason) {
        if (this.abortPromise) return this.abortPromise;
        this.abortReason = reason instanceof Error ? reason : fixedError('SPLIT_VIDEO_PROCESS_ABORTED');
        this.abortPromise = Promise.all([...this.records].map(record => this.abortRecord(record))).then(() => undefined);
        return this.abortPromise;
    }
}

export class OutputBudget {
    constructor(outputRoot, maxBytes = SPLIT_VIDEO_LIMITS.maxTotalOutputBytes) {
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw fixedError('SPLIT_VIDEO_OUTPUT_BUDGET_EXCEEDED');
        this.outputRoot = outputRoot;
        this.maxBytes = maxBytes;
        this.files = new Set();
    }

    add(candidate) {
        this.files.add(assertContainedOutputPath(this.outputRoot, candidate, 'SPLIT_VIDEO_OUTPUT_BUDGET_EXCEEDED'));
        this.assertWithinLimit();
    }

    remove(candidate) {
        this.files.delete(path.resolve(candidate));
    }

    move(from, to) {
        this.remove(from);
        this.add(to);
    }

    assertWithinLimit() {
        let total = 0;
        for (const candidate of this.files) {
            const stat = assertRegularOutput(this.outputRoot, candidate, 'SPLIT_VIDEO_OUTPUT_BUDGET_EXCEEDED');
            total += stat.size;
            if (!Number.isSafeInteger(total) || total > this.maxBytes) {
                throw fixedError('SPLIT_VIDEO_OUTPUT_BUDGET_EXCEEDED');
            }
        }
        return total;
    }
}

function parseMediaDuration(output) {
    const match = output.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
    if (!match) throw fixedError('SPLIT_VIDEO_MEDIA_DURATION_INVALID');
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const duration = (hours * 3600) + (minutes * 60) + seconds;
    if (!Number.isFinite(duration) || duration <= 0 || duration > SPLIT_VIDEO_LIMITS.maxVideoDurationSec) {
        throw fixedError('SPLIT_VIDEO_MEDIA_DURATION_INVALID');
    }
    return duration;
}

async function probeMediaDuration(supervisor, binding, sourceHandle, windowsExecutable) {
    const sourceArgument = toWindowsPath(sourceHandle.path, windowsExecutable);
    const result = await supervisor.run(binding, sourceHandle, ['-hide_banner', '-i', sourceArgument], {
        timeoutMs: PROBE_TIMEOUT_MS,
        allowFailure: true,
        windowsExecutable,
    });
    return parseMediaDuration(`${result.stdout}\n${result.stderr}`);
}

export function buildFfmpegArgs(chunk, sourcePath, tempOutFile, windowsExecutable) {
    const duration = chunk.end_sec - chunk.start_sec;
    const sourceArgument = toWindowsPath(sourcePath, windowsExecutable);
    const outputArgument = toWindowsPath(tempOutFile, windowsExecutable);
    const common = [
        '-y',
        '-ss', String(chunk.start_sec),
        '-t', String(duration),
        '-i', sourceArgument,
    ];
    return [
        ...common,
        '-c:v', 'libx264',
        '-vf', 'scale=-2:240:force_original_aspect_ratio=decrease',
        '-r', '15',
        '-preset', 'veryfast',
        '-crf', '32',
        '-c:a', 'aac',
        '-ac', '1',
        '-ar', '22050',
        '-b:a', '48k',
        '-movflags', '+faststart',
        outputArgument,
    ];
}

async function cleanupAttempt(outputRoot, temporaryReservations, publishedReservations) {
    for (const reservation of temporaryReservations.values()) {
        removeOwnedTemporaryBestEffort(reservation);
    }
    for (const [outFile, reservation] of publishedReservations) {
        removeOwnedPublicationBestEffort(outputRoot, reservation, outFile);
    }
}

function rejectPreexistingChunkDestinations(outputRoot, chunks) {
    for (const chunk of chunks) {
        const { outFile } = resolveChunkOutputPaths(outputRoot, chunk.chunk_index);
        assertOutputAbsent(outputRoot, outFile, 'SPLIT_VIDEO_EXISTING_OUTPUT_INVALID');
    }
}

async function runChunks({ chunks, sourceHandle, planHandle, binding, outputRoot, supervisor, budget, windowsExecutable }) {
    const concurrencyLimit = path.extname(sourceHandle.path).toLowerCase() === '.mp4' ? 4 : 2;
    const temporaryReservations = new Map();
    const publishedReservations = new Map();
    const active = new Set();
    let watch;

    const processChunk = async chunk => {
        if (supervisor.abortReason) throw supervisor.abortReason;
        const { outFile, tempOutFile } = resolveChunkOutputPaths(outputRoot, chunk.chunk_index);
        assertOutputAbsent(outputRoot, outFile, 'SPLIT_VIDEO_EXISTING_OUTPUT_INVALID');

        const tempReservation = reserveExclusiveTempFile(outputRoot, tempOutFile);
        temporaryReservations.set(tempOutFile, tempReservation);
        const duration = chunk.end_sec - chunk.start_sec;
        try {
            budget.add(tempOutFile);
            assertReservedTempFile(tempReservation);
            assertBoundFile(sourceHandle, 'SPLIT_VIDEO_SOURCE_SWAPPED');
            assertBoundFile(binding, 'SPLIT_VIDEO_FFMPEG_SWAPPED');
            assertBoundFile(planHandle, 'SPLIT_VIDEO_PLAN_SWAPPED');
            console.log(`[분할] 청크 ${chunk.chunk_index} 시작: ${chunk.start_sec}초 ~ ${chunk.end_sec}초 (${duration}초)`);
            await supervisor.run(binding, sourceHandle, buildFfmpegArgs(chunk, sourceHandle.path, tempOutFile, windowsExecutable), {
                timeoutMs: computeTimeoutMs(duration),
                windowsExecutable,
                guardHandles: [{ handle: planHandle, code: 'SPLIT_VIDEO_PLAN_SWAPPED' }],
            });
            if (supervisor.abortReason) throw supervisor.abortReason;
            assertReservedTempFile(tempReservation, { requirePayload: true });
            budget.assertWithinLimit();
            const published = publishOutputAtomically(outputRoot, tempReservation, outFile);
            temporaryReservations.delete(tempOutFile);
            budget.move(tempOutFile, outFile);
            publishedReservations.set(outFile, tempReservation);
            console.log(`[완료] chunk_${chunk.chunk_index}.mp4 (${(published.size / 1024 / 1024).toFixed(1)}MB)`);
        } catch (error) {
            logSafeError(error, line => console.error(`SPLIT_VIDEO_CHUNK_FAILED index=${chunk.chunk_index} ${line.trim()}`));
            removeOwnedPublicationBestEffort(outputRoot, tempReservation, outFile);
            removeOwnedTemporaryBestEffort(tempReservation);
            temporaryReservations.delete(tempOutFile);
            throw error;
        } finally {
            try { fs.closeSync(tempReservation.fd); } catch { /* The reservation is no longer needed after the child exits. */ }
        }
    };

    try {
        watch = setInterval(() => {
            try {
                budget.assertWithinLimit();
            } catch (error) {
                void supervisor.abortAll(error);
            }
        }, 25);
        for (const chunk of chunks) {
            while (active.size >= concurrencyLimit) {
                const outcome = await Promise.race(active);
                active.delete(outcome.task.promise);
                if (!outcome.ok) throw outcome.error;
            }
            if (supervisor.abortReason) throw supervisor.abortReason;
            const task = {};
            const promise = processChunk(chunk).then(
                () => ({ task, ok: true }),
                error => ({ task, ok: false, error }),
            );
            task.promise = promise;
            active.add(promise);
        }
        while (active.size > 0) {
            const outcome = await Promise.race(active);
            active.delete(outcome.task.promise);
            if (!outcome.ok) throw outcome.error;
        }
        supervisor.releaseCompleted();
    } catch (error) {
        await supervisor.abortAll(error);
        await Promise.allSettled([...active]);
        await cleanupAttempt(outputRoot, temporaryReservations, publishedReservations);
        throw error;
    } finally {
        if (watch) clearInterval(watch);
    }
}

/** Execute the split with canonical input handles; exported for focused integration tests. */
export async function runSplitVideoChunks({ videoPath, chunksJsonPath, outputDir }) {
    const trustedTempRoot = bindTrustedRoot(DEFAULT_TRUSTED_TEMP_ROOT, 'SPLIT_VIDEO_INPUT_INVALID');
    let sourceHandle;
    let planHandle;
    let binding;
    let outputRoot;
    let privateHome;
    try {
        sourceHandle = bindTrustedRegularFile(videoPath, [trustedTempRoot], {
            code: 'SPLIT_VIDEO_INPUT_INVALID',
        });
        if (sourceHandle.identity.size > SPLIT_VIDEO_LIMITS.maxSourceBytes) throw fixedError('SPLIT_VIDEO_SOURCE_TOO_LARGE');
        planHandle = bindTrustedRegularFile(chunksJsonPath, [trustedTempRoot], {
            maxBytes: SPLIT_VIDEO_LIMITS.maxChunkPlanBytes,
            code: 'SPLIT_VIDEO_INPUT_INVALID',
        });
        let rawPlan;
        try {
            rawPlan = JSON.parse(readBoundUtf8(planHandle, 'SPLIT_VIDEO_INPUT_INVALID'));
        } catch (error) {
            if (error?.message === 'SPLIT_VIDEO_INPUT_INVALID') throw error;
            throw fixedError('SPLIT_VIDEO_CHUNK_PLAN_INVALID');
        }
        const declaredChunks = validateChunkPlan(rawPlan);
        outputRoot = bindOutputDirectory(prepareOutputRoot(outputDir, trustedTempRoot));
        rejectPreexistingChunkDestinations(outputRoot, declaredChunks);
        binding = await resolveFfmpegBinding();
        const windowsExecutable = isWindowsExecutable(binding.path);
        privateHome = createPrivateHome(outputRoot);
        const supervisor = new ChildSupervisor(buildFfmpegEnv(privateHome));
        const mediaDurationSec = await probeMediaDuration(supervisor, binding, sourceHandle, windowsExecutable);
        const chunks = validateChunkPlan(clampChunkPlanToMedia(rawPlan, mediaDurationSec), mediaDurationSec);
        const budget = new OutputBudget(outputRoot);
        console.log(`[분할] 총 ${chunks.length}개 청크, 소스: ${path.extname(sourceHandle.path).toLowerCase()}`);
        await runChunks({ chunks, sourceHandle, planHandle, binding, outputRoot, supervisor, budget, windowsExecutable });
        return { chunkCount: chunks.length, outputRoot: outputRoot.path };
    } finally {
        closeBoundFile(binding);
        closeBoundFile(planHandle);
        closeBoundFile(sourceHandle);
        if (outputRoot) removePrivateHome(outputRoot, privateHome);
        closeOutputDirectory(outputRoot);
    }
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length !== 3) {
        console.error('사용법: node split_video_chunks.mjs <video_path> <chunks_json> <output_dir>');
        process.exitCode = 1;
        return;
    }
    try {
        const result = await runSplitVideoChunks({
            videoPath: args[0],
            chunksJsonPath: args[1],
            outputDir: args[2],
        });
        console.log(`[완료] ${result.chunkCount}개 세그먼트 생성`);
    } catch (error) {
        logSafeError(error, line => console.error(`SPLIT_VIDEO_PROCESS_FAILED ${line.trim()}`));
        process.exitCode = 1;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => {
        logSafeError(error, line => console.error(`SPLIT_VIDEO_FATAL ${line.trim()}`));
        process.exitCode = 1;
    });
}
