import { inflateRawSync } from 'node:zlib';

export const MAX_HOSTED_PIPELINE_ARCHIVE_BYTES = 256 * 1024;
export const MAX_HOSTED_PIPELINE_RECEIPT_BYTES = 64 * 1024;

const ENTRY_NAME = Buffer.from('hosted-run.json', 'ascii');
const INVALID = { ok: false, code: 'hosted_pipeline_archive_invalid' } as const;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const DESCRIPTOR_SIGNATURE = 0x08074b50;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const UTF8_FLAG = 0x0800;
const ALLOWED_FLAGS = DATA_DESCRIPTOR_FLAG | UTF8_FLAG;

export type HostedPipelineArchiveResult =
  | { ok: true; bytes: Uint8Array }
  | typeof INVALID;

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function hasBytes(bytes: Uint8Array, start: number, length: number): boolean {
  return Number.isSafeInteger(start) && Number.isSafeInteger(length)
    && start >= 0 && length >= 0 && start + length <= bytes.length;
}

function hasExactName(bytes: Buffer, start: number, length: number): boolean {
  return length === ENTRY_NAME.length && hasBytes(bytes, start, length)
    && bytes.subarray(start, start + length).equals(ENTRY_NAME);
}

function findEocd(bytes: Buffer): number {
  let found = -1;
  for (let offset = 0; offset <= bytes.length - 22; offset += 1) {
    if (bytes.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
    // A ZIP comment must account for every byte after the EOCD header. A
    // second structurally valid EOCD is ambiguous, so reject the archive.
    if (offset + 22 + bytes.readUInt16LE(offset + 20) !== bytes.length) continue;
    if (found !== -1) return -1;
    found = offset;
  }
  return found;
}

/** Read only the bounded, single hosted-run.json entry. Never writes files. */
export function readHostedPipelineArchive(archive: Uint8Array): HostedPipelineArchiveResult {
  if (!(archive instanceof Uint8Array) || archive.byteLength < 22
    || archive.byteLength > MAX_HOSTED_PIPELINE_ARCHIVE_BYTES) return INVALID;

  try {
    const bytes = Buffer.from(archive);
    const eocd = findEocd(bytes);
    if (eocd !== bytes.length - 22) return INVALID; // No comment or trailing data.
    if (bytes.readUInt16LE(eocd + 4) !== 0 || bytes.readUInt16LE(eocd + 6) !== 0
      || bytes.readUInt16LE(eocd + 8) !== 1 || bytes.readUInt16LE(eocd + 10) !== 1
      || bytes.readUInt16LE(eocd + 20) !== 0) return INVALID;

    const centralSize = bytes.readUInt32LE(eocd + 12);
    const centralOffset = bytes.readUInt32LE(eocd + 16);
    if (centralSize === 0xffffffff || centralOffset === 0xffffffff
      || centralOffset < 30 || centralSize < 46
      || centralOffset + centralSize !== eocd
      || !hasBytes(bytes, centralOffset, 46)
      || bytes.readUInt32LE(centralOffset) !== CENTRAL_SIGNATURE) return INVALID;

    const versionNeeded = bytes.readUInt16LE(centralOffset + 6);
    const flags = bytes.readUInt16LE(centralOffset + 8);
    const method = bytes.readUInt16LE(centralOffset + 10);
    const expectedCrc = bytes.readUInt32LE(centralOffset + 16);
    const compressedLength = bytes.readUInt32LE(centralOffset + 20);
    const outputLength = bytes.readUInt32LE(centralOffset + 24);
    const nameLength = bytes.readUInt16LE(centralOffset + 28);
    const extraLength = bytes.readUInt16LE(centralOffset + 30);
    const commentLength = bytes.readUInt16LE(centralOffset + 32);
    const diskStart = bytes.readUInt16LE(centralOffset + 34);
    const localOffset = bytes.readUInt32LE(centralOffset + 42);
    if (versionNeeded > 20 || flags & ~ALLOWED_FLAGS || (method !== 0 && method !== 8)
      || compressedLength === 0xffffffff || outputLength === 0xffffffff
      || compressedLength > MAX_HOSTED_PIPELINE_ARCHIVE_BYTES
      || outputLength === 0 || outputLength > MAX_HOSTED_PIPELINE_RECEIPT_BYTES
      || extraLength !== 0 || commentLength !== 0 || diskStart !== 0 || localOffset !== 0
      || centralSize !== 46 + nameLength
      || !hasExactName(bytes, centralOffset + 46, nameLength)) return INVALID;

    if (bytes.readUInt32LE(0) !== LOCAL_SIGNATURE
      || bytes.readUInt16LE(4) !== versionNeeded
      || bytes.readUInt16LE(6) !== flags
      || bytes.readUInt16LE(8) !== method) return INVALID;
    const localCrc = bytes.readUInt32LE(14);
    const localCompressedLength = bytes.readUInt32LE(18);
    const localOutputLength = bytes.readUInt32LE(22);
    const localNameLength = bytes.readUInt16LE(26);
    const localExtraLength = bytes.readUInt16LE(28);
    if (localExtraLength !== 0 || !hasExactName(bytes, 30, localNameLength)) return INVALID;

    const hasDescriptor = (flags & DATA_DESCRIPTOR_FLAG) !== 0;
    if (hasDescriptor) {
      if ((localCrc !== 0 && localCrc !== expectedCrc)
        || (localCompressedLength !== 0 && localCompressedLength !== compressedLength)
        || (localOutputLength !== 0 && localOutputLength !== outputLength)) return INVALID;
    } else if (localCrc !== expectedCrc
      || localCompressedLength !== compressedLength
      || localOutputLength !== outputLength) return INVALID;

    const dataOffset = 30 + localNameLength;
    const dataEnd = dataOffset + compressedLength;
    if (!hasBytes(bytes, dataOffset, compressedLength) || dataEnd > centralOffset) return INVALID;
    const descriptorLength = centralOffset - dataEnd;
    if (hasDescriptor) {
      if (descriptorLength !== 12 && descriptorLength !== 16) return INVALID;
      const descriptorOffset = dataEnd + (descriptorLength === 16 ? 4 : 0);
      if (descriptorLength === 16 && bytes.readUInt32LE(dataEnd) !== DESCRIPTOR_SIGNATURE) return INVALID;
      if (bytes.readUInt32LE(descriptorOffset) !== expectedCrc
        || bytes.readUInt32LE(descriptorOffset + 4) !== compressedLength
        || bytes.readUInt32LE(descriptorOffset + 8) !== outputLength) return INVALID;
    } else if (descriptorLength !== 0) return INVALID;

    const compressed = bytes.subarray(dataOffset, dataEnd);
    let output: Buffer;
    if (method === 0) {
      if (compressedLength !== outputLength) return INVALID;
      output = Buffer.from(compressed);
    } else {
      const inflated = inflateRawSync(compressed, {
        info: true,
        maxOutputLength: MAX_HOSTED_PIPELINE_RECEIPT_BYTES,
      }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
      if (inflated.engine.bytesWritten !== compressedLength) return INVALID;
      output = inflated.buffer;
    }
    if (output.length !== outputLength || crc32(output) !== expectedCrc) return INVALID;
    return { ok: true, bytes: output };
  } catch {
    return INVALID;
  }
}
