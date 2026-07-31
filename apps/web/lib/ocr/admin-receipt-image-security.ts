import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import sharp from 'sharp';

export const ADMIN_RECEIPT_MAX_SOURCE_BYTES = 8 * 1024 * 1024;
export const ADMIN_RECEIPT_MAX_CANONICAL_BYTES = 5 * 1024 * 1024;
export const ADMIN_RECEIPT_MAX_INPUT_PIXELS = 24_000_000;
export const ADMIN_RECEIPT_MAX_DIMENSION = 8_192;
export const ADMIN_RECEIPT_MAX_CANONICAL_DIMENSION = 2_048;
export const ADMIN_RECEIPT_DOWNLOAD_DEADLINE_MS = 15_000;

const MAX_RECEIPT_DOWNLOAD_CHUNKS = 16 * 1024;
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type ReceiptImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp';
type ReceiptImageFormat = 'jpeg' | 'png' | 'webp';

type StorageDownloadResult = {
    data: Blob | null;
    error: unknown;
};

type AdminReceiptTempRun = {
    parentDir: string;
    runDir: string;
};

export class AdminReceiptImageSecurityError extends Error {
    constructor() {
        super('ADMIN_RECEIPT_IMAGE_SECURITY_REJECTED');
    }
}

function securityError(): AdminReceiptImageSecurityError {
    return new AdminReceiptImageSecurityError();
}

function isPathInside(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return Boolean(relative)
        && relative !== '..'
        && !relative.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relative);
}

function assertOwnerOnlyDirectory(directoryPath: string): string {
    const link = fs.lstatSync(/* turbopackIgnore: true */ directoryPath);
    if (link.isSymbolicLink() || !link.isDirectory()) throw securityError();

    if (process.platform !== 'win32') {
        fs.chmodSync(/* turbopackIgnore: true */ directoryPath, 0o700);
        const mode = fs.statSync(/* turbopackIgnore: true */ directoryPath).mode;
        if ((mode & 0o077) !== 0) throw securityError();
    }

    return fs.realpathSync(/* turbopackIgnore: true */ directoryPath);
}

function normalizeReceiptMimeType(value: string): ReceiptImageMimeType | null {
    if (value.length === 0 || value.length > 128) return null;
    const mimeType = value.split(';', 1)[0]?.trim().toLowerCase();
    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return 'image/jpeg';
    if (mimeType === 'image/png') return 'image/png';
    if (mimeType === 'image/webp') return 'image/webp';
    return null;
}

export function getReceiptImageMimeTypeFromSignature(bytes: Uint8Array): ReceiptImageMimeType | null {
    if (bytes.byteLength >= JPEG_SIGNATURE.byteLength && bytes.subarray(0, JPEG_SIGNATURE.byteLength).every((value, index) => value === JPEG_SIGNATURE[index])) {
        return 'image/jpeg';
    }
    if (bytes.byteLength >= PNG_SIGNATURE.byteLength && bytes.subarray(0, PNG_SIGNATURE.byteLength).every((value, index) => value === PNG_SIGNATURE[index])) {
        return 'image/png';
    }
    if (
        bytes.byteLength >= 12
        && Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF'
        && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP'
    ) {
        return 'image/webp';
    }
    return null;
}

function receiptImageFormatForMimeType(mimeType: ReceiptImageMimeType): ReceiptImageFormat {
    if (mimeType === 'image/jpeg') return 'jpeg';
    if (mimeType === 'image/png') return 'png';
    return 'webp';
}

function isSafePositiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

async function awaitBeforeDeadline<T>(operation: Promise<T>, deadlineAt: number): Promise<T> {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw securityError();

    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(securityError()), remaining);
        void operation.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            () => {
                clearTimeout(timer);
                reject(securityError());
            },
        );
    });
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
    try {
        void reader.cancel().catch(() => {
            // Cancellation is best-effort after a fixed rejection boundary.
        });
    } catch {
        // Cancellation is best-effort after a fixed rejection boundary.
    }
}

async function readBoundedReceiptBlobUntil(
    blob: Blob,
    deadlineAt: number,
): Promise<{ bytes: Buffer; mimeType: ReceiptImageMimeType }> {
    const declaredMimeType = normalizeReceiptMimeType(blob.type);
    if (
        !declaredMimeType
        || !isSafePositiveInteger(blob.size)
        || blob.size > ADMIN_RECEIPT_MAX_SOURCE_BYTES
        || typeof blob.stream !== 'function'
    ) {
        throw securityError();
    }

    const stream = blob.stream();
    if (!stream || typeof stream.getReader !== 'function') throw securityError();

    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let chunkCount = 0;

    try {
        while (true) {
            const { done, value } = await awaitBeforeDeadline(reader.read(), deadlineAt);
            if (done) break;
            if (!(value instanceof Uint8Array)) throw securityError();

            chunkCount += 1;
            totalBytes += value.byteLength;
            if (
                chunkCount > MAX_RECEIPT_DOWNLOAD_CHUNKS
                || totalBytes > ADMIN_RECEIPT_MAX_SOURCE_BYTES
            ) {
                cancelReader(reader);
                throw securityError();
            }
            chunks.push(value);
        }

        if (totalBytes === 0 || totalBytes !== blob.size) throw securityError();
        const bytes = Buffer.concat(chunks, totalBytes);
        const detectedMimeType = getReceiptImageMimeTypeFromSignature(bytes);
        if (!detectedMimeType || detectedMimeType !== declaredMimeType) throw securityError();
        return { bytes, mimeType: detectedMimeType };
    } catch (error) {
        cancelReader(reader);
        if (error instanceof AdminReceiptImageSecurityError) throw error;
        throw securityError();
    } finally {
        try {
            reader.releaseLock();
        } catch {
            // A stalled read may release its lock after cancellation settles.
        }
    }
}

export async function readBoundedReceiptBlob(
    blob: Blob,
    deadlineMs = ADMIN_RECEIPT_DOWNLOAD_DEADLINE_MS,
): Promise<{ bytes: Buffer; mimeType: ReceiptImageMimeType }> {
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > ADMIN_RECEIPT_DOWNLOAD_DEADLINE_MS) {
        throw securityError();
    }
    return readBoundedReceiptBlobUntil(blob, Date.now() + deadlineMs);
}

export async function downloadPrivateReceiptObject(
    download: () => Promise<StorageDownloadResult>,
): Promise<{ bytes: Buffer; mimeType: ReceiptImageMimeType }> {
    const deadlineAt = Date.now() + ADMIN_RECEIPT_DOWNLOAD_DEADLINE_MS;
    const result = await awaitBeforeDeadline(download(), deadlineAt);
    if (result.error || !result.data) throw securityError();
    return readBoundedReceiptBlobUntil(result.data, deadlineAt);
}

export async function canonicalizeReceiptImage(
    source: Buffer,
    declaredMimeType: string,
): Promise<{ bytes: Buffer; mimeType: 'image/jpeg' }> {
    const mimeType = normalizeReceiptMimeType(declaredMimeType);
    const detectedMimeType = getReceiptImageMimeTypeFromSignature(source);
    if (
        !Buffer.isBuffer(source)
        || source.byteLength === 0
        || source.byteLength > ADMIN_RECEIPT_MAX_SOURCE_BYTES
        || !mimeType
        || detectedMimeType !== mimeType
    ) {
        throw securityError();
    }

    try {
        const metadata = await sharp(source, { limitInputPixels: ADMIN_RECEIPT_MAX_INPUT_PIXELS }).metadata();
        const width = metadata.width;
        const height = metadata.height;
        if (
            !isSafePositiveInteger(width)
            || !isSafePositiveInteger(height)
            || width > ADMIN_RECEIPT_MAX_DIMENSION
            || height > ADMIN_RECEIPT_MAX_DIMENSION
            || width * height > ADMIN_RECEIPT_MAX_INPUT_PIXELS
            || (metadata.pages !== undefined && metadata.pages !== 1)
            || metadata.format !== receiptImageFormatForMimeType(mimeType)
        ) {
            throw securityError();
        }

        const bytes = await sharp(source, { limitInputPixels: ADMIN_RECEIPT_MAX_INPUT_PIXELS })
            .rotate()
            .resize({
                width: ADMIN_RECEIPT_MAX_CANONICAL_DIMENSION,
                height: ADMIN_RECEIPT_MAX_CANONICAL_DIMENSION,
                fit: 'inside',
                withoutEnlargement: true,
            })
            .jpeg({ quality: 85, progressive: false })
            .toBuffer();
        if (
            bytes.byteLength === 0
            || bytes.byteLength > ADMIN_RECEIPT_MAX_CANONICAL_BYTES
            || getReceiptImageMimeTypeFromSignature(bytes) !== 'image/jpeg'
        ) {
            throw securityError();
        }
        return { bytes, mimeType: 'image/jpeg' };
    } catch (error) {
        if (error instanceof AdminReceiptImageSecurityError) throw error;
        throw securityError();
    }
}

export function createAdminReceiptTempRun(): AdminReceiptTempRun {
    const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tzudong-admin-ocr-parent-'));
    let runDir: string | null = null;
    try {
        const realParentDir = assertOwnerOnlyDirectory(parentDir);
        runDir = fs.mkdtempSync(path.join(realParentDir, 'run-'));
        const realRunDir = assertOwnerOnlyDirectory(runDir);
        if (!isPathInside(realParentDir, realRunDir)) throw securityError();
        return { parentDir: realParentDir, runDir: realRunDir };
    } catch (error) {
        try {
            fs.rmSync(/* turbopackIgnore: true */ parentDir, { recursive: true, force: true });
        } catch {
            // Failed setup artifacts remain inaccessible under the owner-only parent.
        }
        if (error instanceof AdminReceiptImageSecurityError) throw error;
        throw securityError();
    }
}

export function resolveAdminReceiptRunPath(run: AdminReceiptTempRun, value: string): string {
    if (!value || value.length > 1_024 || value.includes('\u0000')) throw securityError();
    const candidate = path.resolve(run.runDir, value);
    if (!isPathInside(run.runDir, candidate)) throw securityError();
    return candidate;
}

export function createPrivateReceiptTempDirectory(run: AdminReceiptTempRun, relativePath: string): string {
    const directoryPath = resolveAdminReceiptRunPath(run, relativePath);
    if (fs.existsSync(/* turbopackIgnore: true */ directoryPath)) throw securityError();
    fs.mkdirSync(/* turbopackIgnore: true */ directoryPath, { mode: 0o700 });
    const realDirectoryPath = assertOwnerOnlyDirectory(directoryPath);
    if (!isPathInside(run.runDir, realDirectoryPath)) throw securityError();
    return realDirectoryPath;
}

export function writeExclusivePrivateReceiptFile(
    run: AdminReceiptTempRun,
    relativePath: string,
    bytes: Buffer,
): string {
    if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0 || bytes.byteLength > ADMIN_RECEIPT_MAX_CANONICAL_BYTES) {
        throw securityError();
    }

    const filePath = resolveAdminReceiptRunPath(run, relativePath);
    const parentDir = path.dirname(filePath);
    const parentLink = fs.lstatSync(/* turbopackIgnore: true */ parentDir);
    if (parentLink.isSymbolicLink() || !parentLink.isDirectory() || parentDir !== run.runDir) throw securityError();

    const flags = process.platform === 'win32'
        ? 'wx'
        : fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0);
    let descriptor: number | undefined;
    try {
        descriptor = fs.openSync(/* turbopackIgnore: true */ filePath, flags, 0o600);
        let offset = 0;
        while (offset < bytes.byteLength) {
            offset += fs.writeSync(descriptor, bytes, offset, bytes.byteLength - offset);
        }
        if (process.platform !== 'win32') fs.fchmodSync(descriptor, 0o600);
        const file = fs.fstatSync(descriptor);
        const currentParent = fs.lstatSync(/* turbopackIgnore: true */ parentDir);
        if (
            !file.isFile()
            || file.nlink !== 1
            || file.size !== bytes.byteLength
            || currentParent.isSymbolicLink()
            || currentParent.dev !== parentLink.dev
            || currentParent.ino !== parentLink.ino
            || (process.platform !== 'win32' && (file.mode & 0o077) !== 0)
        ) {
            throw securityError();
        }
    } catch (error) {
        if (error instanceof AdminReceiptImageSecurityError) throw error;
        throw securityError();
    } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
    }
    return filePath;
}

export function readContainedPrivateReceiptFile(
    run: AdminReceiptTempRun,
    returnedPath: string,
): Buffer {
    const filePath = resolveAdminReceiptRunPath(run, returnedPath);
    const link = fs.lstatSync(/* turbopackIgnore: true */ filePath);
    if (
        link.isSymbolicLink()
        || !link.isFile()
        || link.nlink !== 1
        || !Number.isSafeInteger(link.size)
        || link.size <= 0
        || link.size > ADMIN_RECEIPT_MAX_CANONICAL_BYTES
    ) {
        throw securityError();
    }
    const realPath = fs.realpathSync(/* turbopackIgnore: true */ filePath);
    if (!isPathInside(run.runDir, realPath)) throw securityError();

    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
    let descriptor: number | undefined;
    try {
        descriptor = fs.openSync(/* turbopackIgnore: true */ filePath, flags);
        const opened = fs.fstatSync(descriptor);
        if (
            !opened.isFile()
            || opened.nlink !== 1
            || opened.dev !== link.dev
            || opened.ino !== link.ino
            || opened.size !== link.size
        ) {
            throw securityError();
        }

        const bytes = Buffer.alloc(opened.size);
        let offset = 0;
        while (offset < bytes.byteLength) {
            const count = fs.readSync(descriptor, bytes, offset, bytes.byteLength - offset, offset);
            if (count === 0) throw securityError();
            offset += count;
        }
        const finalState = fs.fstatSync(descriptor);
        if (
            finalState.dev !== opened.dev
            || finalState.ino !== opened.ino
            || finalState.size !== opened.size
            || !finalState.isFile()
            || finalState.nlink !== 1
        ) {
            throw securityError();
        }
        return bytes;
    } catch (error) {
        if (error instanceof AdminReceiptImageSecurityError) throw error;
        throw securityError();
    } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
    }
}

export function cleanupAdminReceiptTempRun(run: AdminReceiptTempRun): void {
    try {
        const parentLink = fs.lstatSync(/* turbopackIgnore: true */ run.parentDir);
        if (parentLink.isSymbolicLink() || !parentLink.isDirectory()) return;
        const realParentDir = fs.realpathSync(/* turbopackIgnore: true */ run.parentDir);
        if (realParentDir !== run.parentDir || !isPathInside(realParentDir, run.runDir)) return;
        fs.rmSync(/* turbopackIgnore: true */ realParentDir, { recursive: true, force: true });
    } catch {
        // Temporary receipt artifacts are never logged after cleanup attempts.
    }
}
