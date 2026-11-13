import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

function createSyntheticPngFile(filePath: string) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(128, 0);
  ihdr.writeUInt32BE(128, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  function crc32(buf: Buffer) {
    let crc = -1;
    for (let i = 0; i < buf.length; i++) {
      let b = buf[i];
      for (let j = 0; j < 8; j++) {
        let bit = (b ^ crc) & 1;
        crc = (crc >>> 1) ^ (bit ? 0xedb88320 : 0);
        b = b >>> 1;
      }
    }
    return (crc ^ -1) >>> 0;
  }

  function makeChunk(type: string, data: Buffer) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = crc32(Buffer.concat([typeBuf, data]));
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const raw = Buffer.alloc(128 * (1 + 128 * 3), 255);
  for (let y = 0; y < 128; y++) {
    raw[y * (1 + 128 * 3)] = 0;
  }
  const idat = deflateSync(raw);

  const png = Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(filePath, png);
}

describe('OCR preview CLI script', () => {
  const scriptPath = join(import.meta.dir, '../scripts/preview-receipt-ocr.ts');

  test('returns EMPTY_INPUT error JSON when invoked with no arguments', () => {
    const result = spawnSync('bun', [scriptPath], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.manualReviewRequired).toBe(true);
    expect(parsed.cloudCalls).toBe(0);
    expect(parsed.error).toBe('EMPTY_INPUT');
  });

  test('returns INVALID_IMAGE_DATA when image path does not exist', () => {
    const result = spawnSync('bun', [scriptPath, '/non/existent/image.png'], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.manualReviewRequired).toBe(true);
    expect(parsed.cloudCalls).toBe(0);
    expect(parsed.error).toBe('INVALID_IMAGE_DATA');
  });

  test('denies Gemini execution when cloud execution is not permitted by CLI flags', () => {
    const tempFile = join(tmpdir(), `test-receipt-${Date.now()}.png`);
    createSyntheticPngFile(tempFile);

    try {
      const result = spawnSync('bun', [scriptPath, tempFile, '--provider', 'gemini'], {
        encoding: 'utf8',
      });

      expect(result.status).toBe(1);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.manualReviewRequired).toBe(true);
      expect(parsed.cloudCalls).toBe(0);
      expect(parsed.error).toBe('POLICY_DENIED_LOCAL_ONLY');
    } finally {
      try { unlinkSync(tempFile); } catch { /* ignore */ }
    }
  });

  test('denies OpenAI execution when paid cloud is not permitted by CLI flags', () => {
    const tempFile = join(tmpdir(), `test-receipt-${Date.now()}.png`);
    createSyntheticPngFile(tempFile);

    try {
      const result = spawnSync('bun', [scriptPath, tempFile, '--provider', 'openai'], {
        encoding: 'utf8',
      });

      expect(result.status).toBe(1);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.manualReviewRequired).toBe(true);
      expect(parsed.cloudCalls).toBe(0);
      expect(parsed.error).toBe('OPENAI_PAID_POLICY_DENIED');
    } finally {
      try { unlinkSync(tempFile); } catch { /* ignore */ }
    }
  });

  test.skipIf(process.platform !== 'darwin')('runs local vision engine with synthetic image without errors', () => {
    const tempFile = join(tmpdir(), `test-receipt-${Date.now()}.png`);
    createSyntheticPngFile(tempFile);

    try {
      const result = spawnSync('bun', [scriptPath, tempFile, '--provider', 'local'], {
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.engine).toBe('local-vision');
      expect(parsed.manualReviewRequired).toBe(true);
      expect(parsed.cloudCalls).toBe(0);
      expect(parsed.result).toBeDefined();
    } finally {
      try { unlinkSync(tempFile); } catch { /* ignore */ }
    }
  });
});
