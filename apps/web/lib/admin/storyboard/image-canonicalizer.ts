import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import sharp from 'sharp';
type SharpMetadata = Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;

export const STORYBOARD_IMAGE_CANONICAL_WIDTH = 1280 as const;
export const STORYBOARD_IMAGE_CANONICAL_HEIGHT = 720 as const;
export const STORYBOARD_IMAGE_MAX_SOURCE_BYTES = 16 * 1024 * 1024;
export const STORYBOARD_IMAGE_MAX_CANONICAL_BYTES = 6 * 1024 * 1024;
export const STORYBOARD_IMAGE_MAX_INPUT_PIXELS = 24_000_000;
export const STORYBOARD_IMAGE_MAX_INPUT_DIMENSION = 8_192;
export const STORYBOARD_IMAGE_CANONICALIZATION_DEADLINE_MS = 30_000;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_BASE64_LENGTH = Math.ceil(STORYBOARD_IMAGE_MAX_SOURCE_BYTES / 3) * 4;

type StoryboardImageSourceMime = 'image/png' | 'image/jpeg' | 'image/webp';

type StoryboardImagePrivateRun = {
  parentDir: string;
  runDir: string;
};

export type CanonicalStoryboardImage = {
  bytes: Buffer;
  byteLength: number;
  height: typeof STORYBOARD_IMAGE_CANONICAL_HEIGHT;
  mime: 'image/png';
  sha256: string;
  width: typeof STORYBOARD_IMAGE_CANONICAL_WIDTH;
};

export class StoryboardImageCanonicalizationError extends Error {
  constructor() {
    super('STORYBOARD_IMAGE_CANONICALIZATION_REJECTED');
    this.name = 'StoryboardImageCanonicalizationError';
  }
}

function reject(): StoryboardImageCanonicalizationError {
  return new StoryboardImageCanonicalizationError();
}

function sha256Hex(value: Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isPathInside(root: string, candidate: string) {
  const relativePath = path.relative(root, candidate);
  return Boolean(relativePath)
    && relativePath !== '..'
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath);
}

function assertBeforeDeadline(deadlineAt: number) {
  if (Date.now() > deadlineAt) throw reject();
}

async function awaitBeforeDeadline<T>(operation: Promise<T>, deadlineAt: number): Promise<T> {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw reject();

  return new Promise<T>((resolve, rejectOperation) => {
    const timer = setTimeout(() => rejectOperation(reject()), remaining);
    void operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        rejectOperation(reject());
      },
    );
  });
}

function readUint32BigEndian(bytes: Uint8Array, offset: number) {
  return (
    (bytes[offset]! << 24)
    | (bytes[offset + 1]! << 16)
    | (bytes[offset + 2]! << 8)
    | bytes[offset + 3]!
  ) >>> 0;
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset]!
    | (bytes[offset + 1]! << 8)
    | (bytes[offset + 2]! << 16)
    | (bytes[offset + 3]! << 24)
  ) >>> 0;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, offset: number, length: number) {
  let value = 0xffffffff;
  for (let index = offset; index < offset + length; index += 1) {
    value = CRC32_TABLE[(value ^ bytes[index]!) & 0xff]! ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function isAsciiLetter(value: number) {
  return (value >= 0x41 && value <= 0x5a) || (value >= 0x61 && value <= 0x7a);
}

function pngChunkName(bytes: Uint8Array, offset: number) {
  return String.fromCharCode(
    bytes[offset]!,
    bytes[offset + 1]!,
    bytes[offset + 2]!,
    bytes[offset + 3]!,
  );
}

function hasValidPngColorType(bitDepth: number, colorType: number) {
  switch (colorType) {
    case 0:
      return [1, 2, 4, 8, 16].includes(bitDepth);
    case 2:
    case 4:
    case 6:
      return bitDepth === 8 || bitDepth === 16;
    case 3:
      return [1, 2, 4, 8].includes(bitDepth);
    default:
      return false;
  }
}

function inspectStaticPng(bytes: Uint8Array) {
  if (bytes.length < PNG_SIGNATURE.length + 25 || !bytes.subarray(0, PNG_SIGNATURE.length).every((value, index) => value === PNG_SIGNATURE[index])) {
    return false;
  }

  let offset = PNG_SIGNATURE.length;
  let hasIhdr = false;
  let hasIdat = false;
  let endedIdat = false;
  let hasIend = false;
  let hasPlte = false;
  let width = 0;
  let height = 0;

  while (offset < bytes.length) {
    if (bytes.length - offset < 12) return false;
    const length = readUint32BigEndian(bytes, offset);
    const chunkTypeOffset = offset + 4;
    const dataOffset = offset + 8;
    const endOffset = dataOffset + length + 4;
    if (endOffset > bytes.length) return false;
    if (![0, 1, 2, 3].every((index) => isAsciiLetter(bytes[chunkTypeOffset + index]!))) return false;
    if (readUint32BigEndian(bytes, endOffset - 4) !== crc32(bytes, chunkTypeOffset, length + 4)) return false;

    const type = pngChunkName(bytes, chunkTypeOffset);
    if (type === 'IHDR') {
      if (hasIhdr || offset !== PNG_SIGNATURE.length || length !== 13) return false;
      width = readUint32BigEndian(bytes, dataOffset);
      height = readUint32BigEndian(bytes, dataOffset + 4);
      const bitDepth = bytes[dataOffset + 8]!;
      const colorType = bytes[dataOffset + 9]!;
      if (
        width === 0
        || height === 0
        || width > STORYBOARD_IMAGE_MAX_INPUT_DIMENSION
        || height > STORYBOARD_IMAGE_MAX_INPUT_DIMENSION
        || width * height > STORYBOARD_IMAGE_MAX_INPUT_PIXELS
        || !hasValidPngColorType(bitDepth, colorType)
        || bytes[dataOffset + 10] !== 0
        || bytes[dataOffset + 11] !== 0
        || (bytes[dataOffset + 12] !== 0 && bytes[dataOffset + 12] !== 1)
      ) return false;
      hasIhdr = true;
    } else if (type === 'PLTE') {
      if (!hasIhdr || hasPlte || hasIdat || length === 0 || length % 3 !== 0 || length > 768) return false;
      hasPlte = true;
    } else if (type === 'IDAT') {
      if (!hasIhdr || hasIend || endedIdat || length === 0) return false;
      hasIdat = true;
    } else if (type === 'IEND') {
      if (!hasIhdr || !hasIdat || hasIend || length !== 0 || endOffset !== bytes.length) return false;
      hasIend = true;
      return true;
    } else {
      if (hasIdat) endedIdat = true;
      if (![
        'cHRM',
        'gAMA',
        'iCCP',
        'sBIT',
        'sRGB',
        'bKGD',
        'hIST',
        'tRNS',
        'pHYs',
      ].includes(type)) return false;
      if (!hasIhdr || hasIend) return false;
    }
    offset = endOffset;
  }

  return false;
}

function isStartOfFrameMarker(marker: number) {
  return (
    (marker >= 0xc0 && marker <= 0xc3)
    || (marker >= 0xc5 && marker <= 0xc7)
    || (marker >= 0xc9 && marker <= 0xcb)
    || (marker >= 0xcd && marker <= 0xcf)
  );
}

function inspectStaticJpeg(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return false;

  let offset = 2;
  let inScan = false;
  let hasFrame = false;
  let hasScan = false;

  while (offset < bytes.length) {
    if (inScan) {
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const markerStart = offset;
        offset += 1;
        while (bytes[offset] === 0xff) offset += 1;
        const marker = bytes[offset];
        if (marker === undefined) return false;
        offset += 1;
        if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (marker === 0xd9) return hasFrame && hasScan && offset === bytes.length;
        if (marker === 0xd8) return false;
        offset = markerStart;
        inScan = false;
        break;
      }
      if (inScan) return false;
      continue;
    }

    if (bytes[offset] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    if (marker === undefined) return false;
    offset += 1;
    if (marker === 0xd9) return hasFrame && hasScan && offset === bytes.length;
    if (marker === 0xd8) return false;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return false;
    const segmentLength = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return false;
    if (isStartOfFrameMarker(marker)) {
      if (hasFrame || segmentLength < 8) return false;
      const height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!;
      const width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      if (
        width === 0
        || height === 0
        || width > STORYBOARD_IMAGE_MAX_INPUT_DIMENSION
        || height > STORYBOARD_IMAGE_MAX_INPUT_DIMENSION
        || width * height > STORYBOARD_IMAGE_MAX_INPUT_PIXELS
      ) return false;
      hasFrame = true;
    }
    offset += segmentLength;
    if (marker === 0xda) {
      if (!hasFrame || hasScan) return false;
      hasScan = true;
      inScan = true;
    }
  }

  return false;
}

function webpChunkName(bytes: Uint8Array, offset: number) {
  return String.fromCharCode(
    bytes[offset]!,
    bytes[offset + 1]!,
    bytes[offset + 2]!,
    bytes[offset + 3]!,
  );
}

function hasValidWebpVp8Chunk(bytes: Uint8Array, offset: number, length: number) {
  return (
    length >= 10
    && (bytes[offset]! & 0x01) === 0
    && bytes[offset + 3] === 0x9d
    && bytes[offset + 4] === 0x01
    && bytes[offset + 5] === 0x2a
  );
}

function hasValidWebpVp8lChunk(bytes: Uint8Array, offset: number, length: number) {
  return length >= 5 && bytes[offset] === 0x2f;
}

function inspectStaticWebp(bytes: Uint8Array) {
  if (
    bytes.length < 20
    || bytes.length % 2 !== 0
    || webpChunkName(bytes, 0) !== 'RIFF'
    || webpChunkName(bytes, 8) !== 'WEBP'
    || readUint32LittleEndian(bytes, 4) + 8 !== bytes.length
  ) return false;

  let offset = 12;
  let chunkCount = 0;
  let hasVp8X = false;
  let vp8XFlags = 0;
  let imageChunk: 'VP8 ' | 'VP8L' | null = null;
  let hasIccp = false;
  let hasAlpha = false;
  let hasExif = false;
  let hasXmp = false;

  while (offset < bytes.length) {
    if (bytes.length - offset < 8) return false;
    const chunkName = webpChunkName(bytes, offset);
    const chunkLength = readUint32LittleEndian(bytes, offset + 4);
    const payloadOffset = offset + 8;
    if (chunkLength > bytes.length - payloadOffset) return false;
    const payloadEnd = payloadOffset + chunkLength;
    const paddedEnd = payloadEnd + (chunkLength % 2);
    if (paddedEnd > bytes.length) return false;
    offset = paddedEnd;
    chunkCount += 1;

    if (chunkName === 'ANIM' || chunkName === 'ANMF') return false;
    if (chunkName === 'VP8X') {
      if (hasVp8X || chunkCount !== 1 || chunkLength !== 10) return false;
      vp8XFlags = bytes[payloadOffset]!;
      if (
        (vp8XFlags & 0xc3) !== 0
        || bytes[payloadOffset + 1] !== 0
        || bytes[payloadOffset + 2] !== 0
        || bytes[payloadOffset + 3] !== 0
      ) return false;
      hasVp8X = true;
      continue;
    }
    if (chunkName === 'VP8 ' || chunkName === 'VP8L') {
      if (imageChunk || (!hasVp8X && chunkCount !== 1)) return false;
      if (chunkName === 'VP8 ' && !hasValidWebpVp8Chunk(bytes, payloadOffset, chunkLength)) return false;
      if (chunkName === 'VP8L' && !hasValidWebpVp8lChunk(bytes, payloadOffset, chunkLength)) return false;
      if (hasAlpha && chunkName !== 'VP8 ') return false;
      imageChunk = chunkName;
      continue;
    }
    if (chunkName === 'ICCP') {
      if (!hasVp8X || imageChunk || hasIccp || hasAlpha || chunkLength === 0) return false;
      hasIccp = true;
      continue;
    }
    if (chunkName === 'ALPH') {
      if (!hasVp8X || imageChunk || hasAlpha || chunkLength === 0) return false;
      hasAlpha = true;
      continue;
    }
    if (chunkName === 'EXIF') {
      if (!hasVp8X || !imageChunk || hasExif) return false;
      hasExif = true;
      continue;
    }
    if (chunkName === 'XMP ') {
      if (!hasVp8X || !imageChunk || hasXmp) return false;
      hasXmp = true;
      continue;
    }
    return false;
  }

  if (offset !== bytes.length || !imageChunk) return false;
  if (!hasVp8X) return chunkCount === 1;
  if (imageChunk === 'VP8 ' && Boolean(vp8XFlags & 0x10) !== hasAlpha) return false;
  return (
    Boolean(vp8XFlags & 0x20) === hasIccp
    && Boolean(vp8XFlags & 0x08) === hasExif
    && Boolean(vp8XFlags & 0x04) === hasXmp
  );
}

function inspectStaticImage(bytes: Buffer): StoryboardImageSourceMime | null {
  if (inspectStaticPng(bytes)) return 'image/png';
  if (inspectStaticJpeg(bytes)) return 'image/jpeg';
  if (inspectStaticWebp(bytes)) return 'image/webp';
  return null;
}

function expectedSharpFormat(mime: StoryboardImageSourceMime) {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpeg';
    case 'image/webp':
      return 'webp';
  }
}

function assertSourceDimensions(width: unknown, height: unknown) {
  if (
    !isSafePositiveInteger(width)
    || !isSafePositiveInteger(height)
    || width < STORYBOARD_IMAGE_CANONICAL_WIDTH
    || height < STORYBOARD_IMAGE_CANONICAL_HEIGHT
    || width > STORYBOARD_IMAGE_MAX_INPUT_DIMENSION
    || height > STORYBOARD_IMAGE_MAX_INPUT_DIMENSION
    || width * height > STORYBOARD_IMAGE_MAX_INPUT_PIXELS
    || width * STORYBOARD_IMAGE_CANONICAL_HEIGHT !== height * STORYBOARD_IMAGE_CANONICAL_WIDTH
  ) throw reject();
}

function assertSingleStaticPage(metadata: SharpMetadata) {
  if (
    (metadata.pages !== undefined && metadata.pages !== 1)
    || (metadata.pageHeight !== undefined && metadata.height !== undefined && metadata.pageHeight !== metadata.height)
  ) throw reject();
}

export async function canonicalizeStoryboardImageBytes(
  source: Buffer,
  deadlineMs = STORYBOARD_IMAGE_CANONICALIZATION_DEADLINE_MS,
): Promise<CanonicalStoryboardImage> {
  if (
    !Buffer.isBuffer(source)
    || source.byteLength === 0
    || source.byteLength > STORYBOARD_IMAGE_MAX_SOURCE_BYTES
    || !Number.isSafeInteger(deadlineMs)
    || deadlineMs <= 0
    || deadlineMs > STORYBOARD_IMAGE_CANONICALIZATION_DEADLINE_MS
  ) throw reject();

  const deadlineAt = Date.now() + deadlineMs;
  try {
    const sourceMime = inspectStaticImage(source);
    if (!sourceMime) throw reject();
    assertBeforeDeadline(deadlineAt);

    const sourceMetadata = await awaitBeforeDeadline(
      sharp(source, { limitInputPixels: STORYBOARD_IMAGE_MAX_INPUT_PIXELS }).metadata(),
      deadlineAt,
    );
    if (sourceMetadata.format !== expectedSharpFormat(sourceMime)) throw reject();
    assertSourceDimensions(sourceMetadata.width, sourceMetadata.height);
    assertSingleStaticPage(sourceMetadata);
    assertBeforeDeadline(deadlineAt);

    const bytes = await awaitBeforeDeadline(
      sharp(source, { limitInputPixels: STORYBOARD_IMAGE_MAX_INPUT_PIXELS })
        .rotate()
        .flatten({ background: '#000000' })
        .resize({
          width: STORYBOARD_IMAGE_CANONICAL_WIDTH,
          height: STORYBOARD_IMAGE_CANONICAL_HEIGHT,
          fit: 'fill',
          withoutEnlargement: false,
        })
        .png({ adaptiveFiltering: false, compressionLevel: 9, palette: false, progressive: false })
        .toBuffer(),
      deadlineAt,
    );
    if (
      bytes.byteLength === 0
      || bytes.byteLength > STORYBOARD_IMAGE_MAX_CANONICAL_BYTES
      || !inspectStaticPng(bytes)
    ) throw reject();
    assertBeforeDeadline(deadlineAt);

    const canonicalMetadata = await awaitBeforeDeadline(
      sharp(bytes, { limitInputPixels: STORYBOARD_IMAGE_MAX_INPUT_PIXELS }).metadata(),
      deadlineAt,
    );
    if (
      canonicalMetadata.format !== 'png'
      || canonicalMetadata.width !== STORYBOARD_IMAGE_CANONICAL_WIDTH
      || canonicalMetadata.height !== STORYBOARD_IMAGE_CANONICAL_HEIGHT
    ) throw reject();
    assertSingleStaticPage(canonicalMetadata);
    assertBeforeDeadline(deadlineAt);

    return {
      bytes,
      byteLength: bytes.byteLength,
      height: STORYBOARD_IMAGE_CANONICAL_HEIGHT,
      mime: 'image/png',
      sha256: sha256Hex(bytes),
      width: STORYBOARD_IMAGE_CANONICAL_WIDTH,
    };
  } catch (error) {
    if (error instanceof StoryboardImageCanonicalizationError) throw error;
    throw reject();
  }
}

export async function canonicalizeStoryboardImageBase64(
  value: string,
  deadlineMs = STORYBOARD_IMAGE_CANONICALIZATION_DEADLINE_MS,
) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_BASE64_LENGTH
    || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) throw reject();

  const bytes = Buffer.from(value, 'base64');
  if (
    bytes.byteLength === 0
    || bytes.byteLength > STORYBOARD_IMAGE_MAX_SOURCE_BYTES
    || bytes.toString('base64') !== value
  ) throw reject();
  return canonicalizeStoryboardImageBytes(bytes, deadlineMs);
}

function getCurrentUid() {
  const getuid = Reflect.get(process, 'getuid');
  return typeof getuid === 'function' ? getuid.call(process) as number : undefined;
}

function assertOwnedDirectory(directoryPath: string) {
  const link = fs.lstatSync(/* turbopackIgnore: true */ directoryPath);
  if (link.isSymbolicLink() || !link.isDirectory()) throw reject();
  const uid = getCurrentUid();
  if (uid !== undefined && link.uid !== uid) throw reject();
  if (process.platform !== 'win32') {
    fs.chmodSync(/* turbopackIgnore: true */ directoryPath, 0o700);
    const current = fs.statSync(/* turbopackIgnore: true */ directoryPath);
    if ((current.mode & 0o077) !== 0) throw reject();
  }
  return fs.realpathSync(/* turbopackIgnore: true */ directoryPath);
}

function assertOwnedRegularFile(file: fs.Stats, maxBytes: number) {
  const uid = getCurrentUid();
  if (
    !file.isFile()
    || file.nlink !== 1
    || !isSafePositiveInteger(file.size)
    || file.size > maxBytes
    || (uid !== undefined && file.uid !== uid)
    || (process.platform !== 'win32' && (file.mode & 0o022) !== 0)
  ) throw reject();
}

export function createPrivateStoryboardImageRun(): StoryboardImagePrivateRun {
  const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tzudong-storyboard-image-'));
  let runDir: string | undefined;
  try {
    const realParentDir = assertOwnedDirectory(parentDir);
    runDir = fs.mkdtempSync(path.join(realParentDir, 'run-'));
    const realRunDir = assertOwnedDirectory(runDir);
    if (!isPathInside(realParentDir, realRunDir)) throw reject();
    return { parentDir: realParentDir, runDir: realRunDir };
  } catch (error) {
    try {
      fs.rmSync(/* turbopackIgnore: true */ parentDir, { recursive: true, force: true });
    } catch {
      // Owner-only temporary artifacts remain inaccessible after a failed setup.
    }
    if (error instanceof StoryboardImageCanonicalizationError) throw error;
    throw reject();
  }
}

export function resolvePrivateStoryboardImageRunPath(run: StoryboardImagePrivateRun, value: string) {
  if (!value || value.length > 1_024 || value.includes('\0')) throw reject();
  const candidate = path.resolve(run.runDir, value);
  if (!isPathInside(run.runDir, candidate)) throw reject();
  return candidate;
}

export function readContainedStoryboardImageFile(
  run: StoryboardImagePrivateRun,
  returnedPath: string,
  deadlineMs = STORYBOARD_IMAGE_CANONICALIZATION_DEADLINE_MS,
): Buffer {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > STORYBOARD_IMAGE_CANONICALIZATION_DEADLINE_MS) throw reject();
  const deadlineAt = Date.now() + deadlineMs;
  let descriptor: number | undefined;
  try {
    const filePath = resolvePrivateStoryboardImageRunPath(run, returnedPath);
    const realRunDir = assertOwnedDirectory(run.runDir);
    if (realRunDir !== run.runDir) throw reject();
    const link = fs.lstatSync(/* turbopackIgnore: true */ filePath);
    if (link.isSymbolicLink()) throw reject();
    assertOwnedRegularFile(link, STORYBOARD_IMAGE_MAX_SOURCE_BYTES);
    const realPath = fs.realpathSync(/* turbopackIgnore: true */ filePath);
    if (!isPathInside(realRunDir, realPath)) throw reject();
    assertBeforeDeadline(deadlineAt);

    descriptor = fs.openSync(
      /* turbopackIgnore: true */ filePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    );
    const opened = fs.fstatSync(descriptor);
    assertOwnedRegularFile(opened, STORYBOARD_IMAGE_MAX_SOURCE_BYTES);
    if (
      opened.dev !== link.dev
      || opened.ino !== link.ino
      || opened.size !== link.size
    ) throw reject();

    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      assertBeforeDeadline(deadlineAt);
      const count = fs.readSync(descriptor, bytes, offset, bytes.byteLength - offset, offset);
      if (count === 0) throw reject();
      offset += count;
    }
    assertBeforeDeadline(deadlineAt);

    const finalState = fs.fstatSync(descriptor);
    assertOwnedRegularFile(finalState, STORYBOARD_IMAGE_MAX_SOURCE_BYTES);
    if (
      finalState.dev !== opened.dev
      || finalState.ino !== opened.ino
      || finalState.size !== opened.size
    ) throw reject();
    const finalRunDir = assertOwnedDirectory(run.runDir);
    if (finalRunDir !== realRunDir) throw reject();
    return bytes;
  } catch (error) {
    if (error instanceof StoryboardImageCanonicalizationError) throw error;
    throw reject();
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function assertCanonicalOutputDirectory(root: string, target: string) {
  const safeRoot = path.resolve(root);
  const safeTarget = path.resolve(target);
  if (!isPathInside(safeRoot, safeTarget)) throw reject();
  fs.mkdirSync(/* turbopackIgnore: true */ path.dirname(safeTarget), { recursive: true, mode: 0o755 });
  const rootLink = fs.lstatSync(/* turbopackIgnore: true */ safeRoot);
  const targetParentLink = fs.lstatSync(/* turbopackIgnore: true */ path.dirname(safeTarget));
  if (
    rootLink.isSymbolicLink()
    || !rootLink.isDirectory()
    || targetParentLink.isSymbolicLink()
    || !targetParentLink.isDirectory()
  ) throw reject();
  const realRoot = fs.realpathSync(/* turbopackIgnore: true */ safeRoot);
  const realTargetParent = fs.realpathSync(/* turbopackIgnore: true */ path.dirname(safeTarget));
  if (!isPathInside(realRoot, realTargetParent)) throw reject();
  return { realRoot, safeTarget, targetParent: realTargetParent };
}

function readVerifiedCanonicalOutput(root: string, target: string) {
  const { realRoot, safeTarget, targetParent } = assertCanonicalOutputDirectory(root, target);
  let descriptor: number | undefined;
  try {
    const link = fs.lstatSync(/* turbopackIgnore: true */ safeTarget);
    if (link.isSymbolicLink()) throw reject();
    assertOwnedRegularFile(link, STORYBOARD_IMAGE_MAX_CANONICAL_BYTES);
    const realTarget = fs.realpathSync(/* turbopackIgnore: true */ safeTarget);
    if (!isPathInside(realRoot, realTarget) || path.dirname(realTarget) !== targetParent) throw reject();
    descriptor = fs.openSync(
      /* turbopackIgnore: true */ safeTarget,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    );
    const opened = fs.fstatSync(descriptor);
    assertOwnedRegularFile(opened, STORYBOARD_IMAGE_MAX_CANONICAL_BYTES);
    if (opened.dev !== link.dev || opened.ino !== link.ino || opened.size !== link.size) throw reject();
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.byteLength - offset, offset);
      if (count === 0) throw reject();
      offset += count;
    }
    const finalState = fs.fstatSync(descriptor);
    if (
      finalState.dev !== opened.dev
      || finalState.ino !== opened.ino
      || finalState.size !== opened.size
    ) throw reject();
    return bytes;
  } catch (error) {
    if (error instanceof StoryboardImageCanonicalizationError) throw error;
    throw reject();
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function persistCanonicalStoryboardImage(
  root: string,
  target: string,
  canonical: CanonicalStoryboardImage,
): CanonicalStoryboardImage {
  if (
    !Buffer.isBuffer(canonical.bytes)
    || canonical.mime !== 'image/png'
    || canonical.width !== STORYBOARD_IMAGE_CANONICAL_WIDTH
    || canonical.height !== STORYBOARD_IMAGE_CANONICAL_HEIGHT
    || canonical.byteLength !== canonical.bytes.byteLength
    || canonical.byteLength === 0
    || canonical.byteLength > STORYBOARD_IMAGE_MAX_CANONICAL_BYTES
    || canonical.sha256 !== sha256Hex(canonical.bytes)
  ) throw reject();

  let descriptor: number | undefined;
  try {
    const { safeTarget, targetParent } = assertCanonicalOutputDirectory(root, target);
    descriptor = fs.openSync(
      /* turbopackIgnore: true */ safeTarget,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0),
      0o644,
    );
    let offset = 0;
    while (offset < canonical.bytes.byteLength) {
      const count = fs.writeSync(descriptor, canonical.bytes, offset, canonical.bytes.byteLength - offset, offset);
      if (count === 0) throw reject();
      offset += count;
    }
    fs.fsyncSync(descriptor);
    const written = fs.fstatSync(descriptor);
    assertOwnedRegularFile(written, STORYBOARD_IMAGE_MAX_CANONICAL_BYTES);
    const currentParent = fs.lstatSync(/* turbopackIgnore: true */ targetParent);
    if (
      written.size !== canonical.byteLength
      || currentParent.isSymbolicLink()
      || !currentParent.isDirectory()
    ) throw reject();
  } catch (error) {
    if (error instanceof StoryboardImageCanonicalizationError) throw error;
    throw reject();
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }

  const finalBytes = readVerifiedCanonicalOutput(root, target);
  if (
    finalBytes.byteLength !== canonical.byteLength
    || sha256Hex(finalBytes) !== canonical.sha256
    || !inspectStaticPng(finalBytes)
  ) throw reject();
  return {
    ...canonical,
    bytes: finalBytes,
  };
}

export function cleanupPrivateStoryboardImageRun(run: StoryboardImagePrivateRun) {
  try {
    const parentLink = fs.lstatSync(/* turbopackIgnore: true */ run.parentDir);
    if (parentLink.isSymbolicLink() || !parentLink.isDirectory()) return;
    const realParentDir = fs.realpathSync(/* turbopackIgnore: true */ run.parentDir);
    if (realParentDir !== run.parentDir || !isPathInside(realParentDir, run.runDir)) return;
    fs.rmSync(/* turbopackIgnore: true */ realParentDir, { recursive: true, force: true });
  } catch {
    // Private bridge artifacts are intentionally not surfaced after cleanup attempts.
  }
}
