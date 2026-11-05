import { describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { ThumbnailWorkerOutbox, type ThumbnailOutboxIdentity } from '../lib/admin/youtube-thumbnail-generator/worker-outbox';
import { thumbnailJob } from '../lib/admin/youtube-thumbnail-generator/queue-contract';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const fixture = () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'thumbnail-outbox-test-')); chmodSync(directory, 0o700);
  const identity: ThumbnailOutboxIdentity = { providerId: 'gemini-api', model: 'gemini-3.1-flash-image', ownerId: randomUUID(),
    workerId: randomUUID(), jobId: randomUUID(), attemptId: randomUUID(), fence: 1, inputSha256: 'a'.repeat(64), origin: 'https://www.tzudong.app' };
  const outbox = new ThumbnailWorkerOutbox(directory);
  return { directory, identity, outbox, cleanup: () => { outbox.close(); rmSync(directory, { recursive: true, force: true }); } };
};
async function sample(identity: ThumbnailOutboxIdentity) {
  const bytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#987624' } }).png().toBuffer();
  return { bytes, metadata: { original: { sha256: hash(bytes), mimeType: 'image/png' as const, bytes: bytes.length, width: 16, height: 16 },
    provenance: { providerId: 'gemini-api' as const, model: identity.model, responseModel: identity.model, responseId: 'synthetic-outbox-response',
      verification: 'official-api' as const, modelEvidence: 'response' as const, generatedAt: '2026-10-23T09:00:00Z',
      attemptId: identity.attemptId, inputSha256: identity.inputSha256 } } };
}

describe('thumbnail durable SQLite outbox', () => {
  test('fresh intent is granted once, survives reopening, and is bound to the complete identity', () => {
    const f = fixture();
    try {
      expect(f.outbox.begin(f.identity)).toBe(true); expect(f.outbox.begin(f.identity)).toBe(false);
      f.outbox.close(); const reopened = new ThumbnailWorkerOutbox(f.directory);
      try {
        expect(reopened.begin(f.identity)).toBe(false); expect(reopened.pending()).toEqual([{ identity: f.identity, phase: 'start_requested' }]);
        for (const changed of [{ fence: 2 }, { model: 'gemini-3-pro-image' }, { inputSha256: 'b'.repeat(64) }, { origin: 'https://tzudong.app' }, { workerId: randomUUID() }]) {
          expect(() => reopened.begin({ ...f.identity, ...changed } as ThumbnailOutboxIdentity)).toThrow('outbox_conflict');
        }
      } finally { reopened.close(); }
    } finally { f.cleanup(); }
  });
  test('original bytes and proof commit together, preserve immutable retries, and remain after delivery', async () => {
    const f = fixture();
    try {
      const saved = await sample(f.identity); expect(f.outbox.begin(f.identity)).toBe(true);
      f.outbox.save(f.identity, saved.bytes, saved.metadata); const copy = Buffer.from(saved.bytes);
      f.outbox.save(f.identity, saved.bytes, saved.metadata); saved.bytes.fill(0);
      expect(f.outbox.result(f.identity).bytes.equals(copy)).toBe(true);
      expect(() => f.outbox.save(f.identity, copy, { ...saved.metadata, provenance: { ...saved.metadata.provenance, responseId: 'changed' } })).toThrow('outbox_conflict');
      const now = new Date().toISOString(); const prefix = `${f.identity.ownerId}/${f.identity.jobId}/${f.identity.attemptId}/`;
      const job = thumbnailJob.parse({ id: f.identity.jobId, ownerId: f.identity.ownerId, requestId: randomUUID(), inputSha256: f.identity.inputSha256,
        model: f.identity.model, input: { contract: 'thumbnail-gemini-image-v1', model: f.identity.model, prompt: 'synthetic food', references: [] },
        state: 'succeeded', workerId: f.identity.workerId, attemptId: f.identity.attemptId, fence: f.identity.fence,
        leaseExpiresAt: null, providerStartedAt: now, cancelRequested: false, createdAt: now, updatedAt: now,
        result: { original: { ...saved.metadata.original, path: `${prefix}original.png` }, normalized: { path: `${prefix}normalized.png`, mimeType: 'image/png',
          bytes: 100, width: 1280, height: 720, sha256: 'c'.repeat(64) }, provenance: saved.metadata.provenance } });
      expect(() => f.outbox.delivered(f.identity, { ...job, fence: 2 })).toThrow('outbox_conflict');
      f.outbox.delivered(f.identity, job); expect(f.outbox.pending()).toHaveLength(0);
      expect(f.outbox.result(f.identity).bytes.equals(copy)).toBe(true);
    } finally { f.cleanup(); }
  });
  test('actual process death after result commit preserves complete WAL data and never regrants start', async () => {
    const f = fixture();
    try {
      f.outbox.begin(f.identity); const saved = await sample(f.identity); f.outbox.close();
      const child = spawnSync(process.execPath, ['--no-env-file', 'run', join(import.meta.dir, 'fixtures/thumbnail-outbox-child.ts'), 'save-and-kill'], {
        cwd: join(import.meta.dir, '..'), encoding: 'utf8', timeout: 10_000,
        env: { PATH: process.env.PATH, HOME: f.directory, FIXTURE_OUTBOX: f.directory, FIXTURE_IDENTITY: JSON.stringify(f.identity),
          FIXTURE_BYTES: saved.bytes.toString('base64'), FIXTURE_BUNDLE: JSON.stringify(saved.metadata) },
      });
      expect(child.signal).toBe('SIGKILL');
      const reopened = new ThumbnailWorkerOutbox(f.directory);
      try { expect(reopened.begin(f.identity)).toBe(false); expect(reopened.result(f.identity).bytes.equals(saved.bytes)).toBe(true); }
      finally { reopened.close(); }
    } finally { f.cleanup(); }
  });
  test('two actual processes race the same intent and exactly one commit grants admission', async () => {
    const f = fixture();
    try {
      f.outbox.close();
      const run = () => {
        const child = spawn(process.execPath, ['--no-env-file', 'run', join(import.meta.dir, 'fixtures/thumbnail-outbox-child.ts'), 'begin'], {
          cwd: join(import.meta.dir, '..'), env: { PATH: process.env.PATH, HOME: f.directory, FIXTURE_OUTBOX: f.directory, FIXTURE_IDENTITY: JSON.stringify(f.identity) },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = ''; let stderr = ''; child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
        const done = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => child.on('close', (code) => resolve({ code, stdout, stderr })));
        return { child, done };
      };
      const a = run(); const b = run();
      try {
        const deadline = Date.now() + 5000;
        while (readdirSync(f.directory).filter((name) => name.startsWith('ready-')).length !== 2) {
          if (Date.now() > deadline) throw new Error('fixture readiness deadline'); await delay(5);
        }
        writeFileSync(join(f.directory, 'release'), 'release');
        const results = await Promise.all([a.done, b.done]); expect(results.map((r) => r.code)).toEqual([0, 0]);
        expect(results.map((r) => JSON.parse(r.stdout).admitted).sort()).toEqual([false, true]);
      } finally { a.child.kill(); b.child.kill(); await Promise.all([a.done, b.done]); }
    } finally { f.cleanup(); }
  });
  test('a failed transaction leaves no partial BLOB/proof and later saves the same RAM bundle', async () => {
    const f = fixture();
    try {
      f.outbox.begin(f.identity); const saved = await sample(f.identity); const db = new DatabaseSync(f.outbox.file);
      try {
        db.exec("CREATE TRIGGER fixture_disk_failure BEFORE UPDATE ON thumbnail_outbox BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END;");
        expect(() => f.outbox.save(f.identity, saved.bytes, saved.metadata)).toThrow('outbox_unavailable');
        expect(f.outbox.pending()[0].phase).toBe('start_requested'); expect(() => f.outbox.result(f.identity)).toThrow('outbox_conflict');
        db.exec('DROP TRIGGER fixture_disk_failure;');
        f.outbox.save(f.identity, saved.bytes, saved.metadata); expect(f.outbox.result(f.identity).bytes.equals(saved.bytes)).toBe(true);
      } finally { db.close(); }
    } finally { f.cleanup(); }
  });
  test('unsafe directories, file links, dangling sidecars and foreign SQLite databases fail without adoption', () => {
    const parent = mkdtempSync(join(realpathSync(tmpdir()), 'thumbnail-outbox-security-'));
    try {
      const unsafe = join(parent, 'unsafe'); mkdirSync(unsafe, 0o755); chmodSync(unsafe, 0o755);
      expect(() => new ThumbnailWorkerOutbox(unsafe)).toThrow('outbox_invalid');
      for (const mode of ['symlink', 'hardlink', 'sidecar', 'foreign']) {
        const dir = join(parent, mode); mkdirSync(dir, 0o700); const file = join(dir, 'thumbnail-outbox.sqlite'); const target = join(parent, `${mode}.sqlite`);
        writeFileSync(target, '', { mode: 0o600 });
        if (mode === 'symlink') symlinkSync(target, file);
        if (mode === 'hardlink') linkSync(target, file);
        if (mode === 'sidecar') symlinkSync(join(parent, 'does-not-exist'), file + '-wal');
        if (mode === 'foreign') {
          const db = new DatabaseSync(file); db.exec('CREATE TABLE user_data(secret TEXT);'); db.close(); chmodSync(file, 0o600);
        }
        const before = mode === 'foreign' ? hash(readFileSync(file)) : null;
        expect(() => new ThumbnailWorkerOutbox(dir)).toThrow('outbox_invalid');
        if (before) expect(hash(readFileSync(file))).toBe(before);
      }
    } finally { rmSync(parent, { recursive: true, force: true }); }
  });
  test('outbox and WAL/SHM are private and corrupt bytes cannot be delivered as a valid bundle', async () => {
    const f = fixture();
    try {
      f.outbox.begin(f.identity); const saved = await sample(f.identity); f.outbox.save(f.identity, saved.bytes, saved.metadata);
      for (const name of readdirSync(f.directory).filter((name) => name.startsWith('thumbnail-outbox.sqlite'))) {
        expect(statSync(join(f.directory, name)).mode & 0o777).toBe(0o600);
      }
      const db = new DatabaseSync(f.outbox.file);
      try { db.prepare('UPDATE thumbnail_outbox SET original=?').run(Buffer.alloc(saved.bytes.length)); }
      finally { db.close(); }
      expect(() => f.outbox.result(f.identity)).toThrow('outbox_invalid');
      expect(f.outbox.begin(f.identity)).toBe(false);
    } finally { f.cleanup(); }
  });
});
