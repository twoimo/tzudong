import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  MAX_HOSTED_PIPELINE_ARCHIVE_BYTES,
  readHostedPipelineArchive,
} from '../lib/admin/hosted-pipeline-archive';

// Created by Python zipfile with a non-seekable BytesIO, allowZip64=False.
// These are independent ZIP32 fixtures with signed data descriptors (bit 3).
const STORED = Buffer.from(
  'UEsDBBQACAAAABSjVF0AAAAAAAAAAAAAAAAPAAAAaG9zdGVkLXJ1bi5qc29ueyJzdGF0dXMiOiJvayJ9UEsHCN3tEx0PAAAADwAAAFBLAQIUAxQACAAAABSjVF3d7RMdDwAAAA8AAAAPAAAAAAAAAAAAAACAAQAAAABob3N0ZWQtcnVuLmpzb25QSwUGAAAAAAEAAQA9AAAATAAAAAAA',
  'base64',
);
const DEFLATED = Buffer.from(
  'UEsDBBQACAAIABSjVF0AAAAAAAAAAAAAAAAPAAAAaG9zdGVkLXJ1bi5qc29uq1YqLkksKS1WslLKz1aqBQBQSwcI3e0THREAAAAPAAAAUEsBAhQDFAAIAAgAFKNUXd3tEx0RAAAADwAAAA8AAAAAAAAAAAAAAIABAAAAAGhvc3RlZC1ydW4uanNvblBLBQYAAAAAAQABAD0AAABOAAAAAAA=',
  'base64',
);
// Synthetic compatibility fixture: archiver@7.0.1 on Node 24 used
// .create('zip', { zlib: { level: 6 } }).file(..., { name: 'hosted-run.json' }).
// It is not a downloaded hosted Actions artifact.
const ACTION_ARCHIVER_SYNTHETIC = Buffer.from(
  'UEsDBBQACAAIADxcVF0AAAAAAAAAAAAAAAAPAAAAaG9zdGVkLXJ1bi5qc29uq1YqTs5IzU0MSy0qzszPU7Iy1FEqrswryUgtyUxWsiopKk0FCpQklpQWK1kppWVWlJQWpSrVcgEAUEsHCMomjoQ5AAAAOAAAAFBLAQItAxQACAAIADxcVF3KJo6EOQAAADgAAAAPAAAAAAAAAAAAIACkgQAAAABob3N0ZWQtcnVuLmpzb25QSwUGAAAAAAEAAQA9AAAAdgAAAAAA',
  'base64',
);
const OVER_EXPANDED = Buffer.from(
  'UEsDBBQACAAIAECjVF0AAAAAAAAAAAAAAAAPAAAAaG9zdGVkLXJ1bi5qc29u7cGBAAAAAMMgpfnT/SBVAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwA1QSwcI+E9hY1AAAAABAAEAUEsBAhQDFAAIAAgAQKNUXfhPYWNQAAAAAQABAA8AAAAAAAAAAAAAAIABAAAAAGhvc3RlZC1ydW4uanNvblBLBQYAAAAAAQABAD0AAACNAAAAAAA=',
  'base64',
);
const EXPECTED = '{"status":"ok"}';
const INVALID_CODE = 'hosted_pipeline_archive_invalid';

function offsets(zip: Buffer) {
  const eocd = zip.length - 22;
  const central = zip.readUInt32LE(eocd + 16);
  const data = 30 + zip.readUInt16LE(26) + zip.readUInt16LE(28);
  const descriptor = data + zip.readUInt32LE(central + 20);
  return { eocd, central, data, descriptor };
}

function withoutSignature(source: Buffer): Buffer {
  const { descriptor, eocd, central } = offsets(source);
  const zip = Buffer.concat([source.subarray(0, descriptor), source.subarray(descriptor + 4)]);
  zip.writeUInt32LE(central - 4, eocd - 4 + 16);
  return zip;
}

function withoutDescriptor(source: Buffer): Buffer {
  const { descriptor, eocd, central } = offsets(source);
  const zip = Buffer.concat([source.subarray(0, descriptor), source.subarray(descriptor + 16)]);
  zip.writeUInt16LE(zip.readUInt16LE(6) & ~0x0008, 6);
  zip.writeUInt16LE(zip.readUInt16LE(central - 16 + 8) & ~0x0008, central - 16 + 8);
  zip.writeUInt32LE(source.readUInt32LE(central + 16), 14);
  zip.writeUInt32LE(source.readUInt32LE(central + 20), 18);
  zip.writeUInt32LE(source.readUInt32LE(central + 24), 22);
  zip.writeUInt32LE(central - 16, eocd - 16 + 16);
  return zip;
}

function expectInvalid(bytes: Uint8Array) {
  expect(readHostedPipelineArchive(bytes)).toEqual({ ok: false, code: INVALID_CODE });
}

describe('bounded single-entry hosted pipeline ZIP32 reader', () => {
  test('restores the pinned archiver synthetic fixture byte-for-byte', () => {
    expect(ACTION_ARCHIVER_SYNTHETIC.length).toBe(201);
    expect(createHash('sha256').update(ACTION_ARCHIVER_SYNTHETIC).digest('hex'))
      .toBe('028a152178e119e6a1e0688a84c4a20dc05b214eb26e5e14f1913ed50a6bb4e7');
    const result = readHostedPipelineArchive(ACTION_ARCHIVER_SYNTHETIC);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bytes.length).toBe(56);
      expect(createHash('sha256').update(result.bytes).digest('hex'))
        .toBe('6a91d0193a0c45a2d9d11995a641f8543d72a3bad6d06d0fc30e50270e48efc3');
    }
  });

  test('reads real stored and deflated non-seekable ZIP fixtures with signed descriptors', () => {
    for (const fixture of [STORED, DEFLATED]) {
      const result = readHostedPipelineArchive(fixture);
      expect(result.ok).toBe(true);
      if (result.ok) expect(Buffer.from(result.bytes).toString('utf8')).toBe(EXPECTED);
    }
  });

  test('accepts unsigned descriptors and exact archives without descriptors', () => {
    for (const fixture of [STORED, DEFLATED]) {
      for (const variant of [withoutSignature(fixture), withoutDescriptor(fixture)]) {
        const result = readHostedPipelineArchive(variant);
        expect(result.ok).toBe(true);
        if (result.ok) expect(Buffer.from(result.bytes).toString('utf8')).toBe(EXPECTED);
      }
    }
  });

  test('rejects archive cap, output cap, and a compressed stream with hidden trailing bytes', () => {
    expectInvalid(Buffer.alloc(MAX_HOSTED_PIPELINE_ARCHIVE_BYTES + 1));
    expectInvalid(OVER_EXPANDED);
    const { descriptor, central, eocd } = offsets(DEFLATED);
    const zip = Buffer.concat([DEFLATED.subarray(0, descriptor), Buffer.from([0]), DEFLATED.subarray(descriptor)]);
    zip.writeUInt32LE(DEFLATED.readUInt32LE(central + 20) + 1, descriptor + 1 + 8);
    zip.writeUInt32LE(DEFLATED.readUInt32LE(central + 20) + 1, central + 1 + 20);
    zip.writeUInt32LE(central + 1, eocd + 1 + 16);
    expectInvalid(zip);
  });

  test('rejects CRC, local/central mismatches, bad descriptors, and false lengths', () => {
    const crc = Buffer.from(STORED);
    crc[offsets(crc).data] ^= 1;
    expectInvalid(crc);

    const wrongLocalName = Buffer.from(DEFLATED);
    wrongLocalName.writeUInt16LE(14, 26);
    expectInvalid(wrongLocalName);

    const wrongMethod = Buffer.from(DEFLATED);
    wrongMethod.writeUInt16LE(0, 8);
    expectInvalid(wrongMethod);

    const wrongDescriptor = Buffer.from(DEFLATED);
    wrongDescriptor.writeUInt32LE(1, offsets(wrongDescriptor).descriptor + 4);
    expectInvalid(wrongDescriptor);

    const wrongDescriptorLength = Buffer.from(DEFLATED);
    wrongDescriptorLength.writeUInt32LE(0, offsets(wrongDescriptorLength).descriptor + 8);
    expectInvalid(wrongDescriptorLength);

    const wrongCompressedLength = Buffer.from(DEFLATED);
    wrongCompressedLength.writeUInt32LE(1, offsets(wrongCompressedLength).central + 20);
    expectInvalid(wrongCompressedLength);

    const wrongOutputLength = Buffer.from(DEFLATED);
    wrongOutputLength.writeUInt32LE(1, offsets(wrongOutputLength).central + 24);
    expectInvalid(wrongOutputLength);
  });

  test('rejects encryption, unsupported flags, ZIP64, multi-disk, path names, and extra entries', () => {
    const flags = Buffer.from(DEFLATED);
    flags.writeUInt16LE(flags.readUInt16LE(6) | 1, 6);
    flags.writeUInt16LE(flags.readUInt16LE(offsets(flags).central + 8) | 1, offsets(flags).central + 8);
    expectInvalid(flags);

    const unsupported = Buffer.from(DEFLATED);
    unsupported.writeUInt16LE(unsupported.readUInt16LE(6) | 0x0040, 6);
    unsupported.writeUInt16LE(unsupported.readUInt16LE(offsets(unsupported).central + 8) | 0x0040, offsets(unsupported).central + 8);
    expectInvalid(unsupported);

    const zip64 = Buffer.from(DEFLATED);
    zip64.writeUInt32LE(0xffffffff, offsets(zip64).central + 20);
    expectInvalid(zip64);

    const multiDisk = Buffer.from(DEFLATED);
    multiDisk.writeUInt16LE(1, offsets(multiDisk).eocd + 4);
    expectInvalid(multiDisk);

    const pathName = Buffer.from(DEFLATED);
    Buffer.from('hosted/run.json').copy(pathName, 30);
    Buffer.from('hosted/run.json').copy(pathName, offsets(pathName).central + 46);
    expectInvalid(pathName);

    const extraEntry = Buffer.from(DEFLATED);
    extraEntry.writeUInt16LE(2, offsets(extraEntry).eocd + 10);
    expectInvalid(extraEntry);
  });

  test('rejects trailing bytes, overlapping regions, and multiple plausible EOCDs', () => {
    expectInvalid(Buffer.concat([DEFLATED, Buffer.from([0])]));
    const overlap = Buffer.from(DEFLATED);
    overlap.writeUInt32LE(offsets(overlap).descriptor - 1, offsets(overlap).eocd + 16);
    expectInvalid(overlap);

    // The first EOCD claims a comment containing the second EOCD; neither is
    // an unambiguous comment-free end of this exact single-entry archive.
    const duplicate = Buffer.concat([DEFLATED, DEFLATED.subarray(DEFLATED.length - 22)]);
    duplicate.writeUInt16LE(22, DEFLATED.length - 2);
    expectInvalid(duplicate);
  });
});
