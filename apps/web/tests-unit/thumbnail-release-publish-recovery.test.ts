import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { thumbnailReleaseFixture } from './fixtures/thumbnail-release-fixture';
import { publishThumbnailDurableRelease, readThumbnailDurableReleaseAsset,
  type ThumbnailReleaseRegistryAdapter } from '../lib/admin/youtube-thumbnail-generator/release-registry';

const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-fixture' };
type Row = Awaited<ReturnType<ThumbnailReleaseRegistryAdapter['publishRelease']>>;
type Mode = 'ack-lost' | 'ack-lost-read-fails' | 'late-commit' | 'ack-lost-mismatch' | 'success-read-fails' | 'missing-rpc';

function registry(mode: Mode) {
  const rows: Row[] = [];
  const assets = new Map<string, Buffer>();
  let calls = 0, deletes = 0;
  let pending: (() => void) | undefined;
  const adapter: ThumbnailReleaseRegistryAdapter = {
    async readCurrentRelease() {
      if (mode === 'ack-lost-read-fails' || mode === 'success-read-fails') throw new Error('synthetic-private-read-diagnostic');
      const row = rows.find((row) => row.status === 'active') ?? null;
      return mode === 'ack-lost-mismatch' && row ? { ...row, sha256: 'b'.repeat(64) } : row;
    },
    async publishRelease(input) {
      calls++;
      const row = { ...input, updated_at: input.published_at };
      pending = () => { rows.forEach((r) => { r.status = 'superseded'; }); rows.push(row); };
      if (mode === 'missing-rpc') throw Object.assign(new Error('synthetic-private-rpc-diagnostic'), { code: 'PGRST202' });
      if (mode !== 'late-commit') pending();
      if (mode !== 'success-read-fails') throw new Error('synthetic-private-publish-diagnostic');
      return row;
    },
    async uploadReleaseAsset(_bucket, path, bytes) { assets.set(path, bytes); },
    async deleteReleaseAsset(_bucket, path) { deletes++; assets.delete(path); },
    async downloadReleaseAsset(_bucket, path) {
      const bytes = assets.get(path);
      if (!bytes) throw new Error('fixture_asset_missing');
      return { bytes, contentType: 'image/png' };
    },
  };
  return { adapter, rows, assets, commitLate: () => pending?.(), counters: () => ({ calls, deletes }) };
}

test('thumbnail committed publish ACK loss recovers the exact release without deleting its image', async () => {
  const f = await thumbnailReleaseFixture();
  try {
    const db = registry('ack-lost');
    const result = await publishThumbnailDurableRelease({ candidateId: 'fixture' }, env, { ...f.options, adapter: db.adapter }).catch(() => undefined);
    expect(db.rows).toHaveLength(1);
    expect(db.assets.size).toBe(1);
    expect(result?.status).toBe('ready');
    expect(result?.release?.id).toBe(f.options.releaseId);
    expect(result?.release?.sha256).toBe(f.sha256);
    expect(db.counters()).toEqual({ calls: 1, deletes: 0 });
    const image = await readThumbnailDurableReleaseAsset(f.options.releaseId, env, { adapter: db.adapter });
    expect(image.bytes.equals(f.bytes)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('synthetic-private');
  } finally { f.cleanup(); }
});

for (const mode of ['ack-lost-read-fails', 'ack-lost-mismatch', 'success-read-fails', 'late-commit'] as const) {
  test(`thumbnail uncertain ${mode} keeps uploaded bytes and emits a fixed failure`, async () => {
    const f = await thumbnailReleaseFixture();
    try {
      const db = registry(mode);
      const failure = await publishThumbnailDurableRelease({ candidateId: 'fixture' }, env, { ...f.options, adapter: db.adapter }).then(() => null, (error: unknown) => error);
      expect(db.counters()).toEqual({ calls: 1, deletes: 0 });
      expect(db.assets.size).toBe(1);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe('thumbnail_durable_release_publish_unconfirmed');
      if (mode === 'late-commit') {
        db.commitLate();
        const image = await readThumbnailDurableReleaseAsset(f.options.releaseId, env, { adapter: db.adapter });
        expect(image.bytes.equals(f.bytes)).toBe(true);
      }
    } finally { f.cleanup(); }
  });
}

test('thumbnail missing RPC remains unavailable without treating its uploaded asset as safe to delete', async () => {
  const f = await thumbnailReleaseFixture();
  try {
    const db = registry('missing-rpc');
    const result = await publishThumbnailDurableRelease({ candidateId: 'fixture' }, env, { ...f.options, adapter: db.adapter });
    expect(result.status).toBe('unavailable');
    expect(db.counters()).toEqual({ calls: 1, deletes: 0 });
    expect(db.assets.size).toBe(1);
  } finally { f.cleanup(); }
});

test('thumbnail actual Storage client cannot overwrite an existing immutable release object', () => {
  const home = mkdtempSync(join(tmpdir(), 'thumbnail-storage-sdk-'));
  const policy = '(version 1)(allow default)(deny network*)';
  try {
    for (const sandboxed of process.platform === 'darwin' ? [false, true] : [false]) {
    const args = ['--no-env-file', 'run', join(import.meta.dir, 'fixtures/thumbnail-storage-immutability.ts')];
    const result = spawnSync(sandboxed ? '/usr/bin/sandbox-exec' : process.execPath,
      sandboxed ? ['-p', policy, process.execPath, ...args] : args, {
      cwd: join(import.meta.dir, '..'), encoding: 'utf8', timeout: 15_000,
      env: { PATH: process.env.PATH, HOME: home, ...env },
    });
    expect(result.status).toBe(0);
    const observed = JSON.parse(result.stdout.trim());
    expect(observed).toEqual({ unmodified: true, uploadCount: 1, publishCalls: 0, deleteCount: 0, upsertHeader: 'false' });
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
});
