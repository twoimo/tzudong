import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  copyFileSync, linkSync, mkdirSync, mkdtempSync, readFileSync,
  renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyNextSyncPatch, nextSyncPatchErrorCode } from '../scripts/apply-next-sync-patch.mjs';

const ORIGINAL_SHA = 'dfe8d350b7d13436f8409892c992cf90f20d7795a25235c4ca30764353b6afcc';
const PATCHED_SHA = 'a8e1623f41b8df1d17e6e90c4ae3d439b24b654ba035a03b3d91e8b22c11d56c';
const OLD = '                this.publish({\n                    type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.SYNC,';
const NEW = '                this.publishToClient(client, {\n                    type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.SYNC,';
const appRoot = join(import.meta.dir, '..');
const installer = join(appRoot, 'scripts', 'apply-next-sync-patch.mjs');
const cleanNext = join(appRoot, 'scripts', 'clean-next.mjs');
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

// A release checkout has the installed module; an ignored-script local install may
// still have original bytes. Either source must reconstruct the exact npm tarball
// bytes without relying on /private/tmp in CI.
function originalNextModule(): Buffer {
  const installed = readFileSync(join(appRoot, 'node_modules', 'next', 'dist', 'server', 'dev', 'hot-middleware.js'));
  if (sha(installed) === ORIGINAL_SHA) return installed;
  if (sha(installed) !== PATCHED_SHA) throw new Error('installed Next module has unknown bytes');
  const text = installed.toString('utf8');
  if (text.split(NEW).length !== 2) throw new Error('installed Next module anchor mismatch');
  const original = Buffer.from(text.replace(NEW, OLD), 'utf8');
  if (sha(original) !== ORIGINAL_SHA) throw new Error('installed Next module cannot reconstruct original');
  return original;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'tzudong-next-sync-'));
  const next = join(root, 'node_modules', 'next');
  const target = join(next, 'dist', 'server', 'dev', 'hot-middleware.js');
  mkdirSync(join(next, 'dist', 'server', 'dev'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { next: '16.3.8' } }));
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({
    packages: { '': { dependencies: { next: '16.3.8' } }, 'node_modules/next': { version: '16.3.8' } },
  }));
  writeFileSync(join(next, 'package.json'), JSON.stringify({ name: 'next', version: '16.3.8' }));
  writeFileSync(target, originalNextModule());
  return { root, next, target };
}

function withFixture<T>(run: (item: ReturnType<typeof fixture>) => T): T {
  const item = fixture();
  try { return run(item); }
  finally { rmSync(item.root, { recursive: true, force: true }); }
}

function rejects(action: () => unknown, code: string) {
  let observed = '';
  try { action(); }
  catch (error) { observed = error instanceof Error ? error.message : String(error); }
  expect(observed).toBe(`NEXT_SYNC_PATCH_${code}`);
}

describe('Next 16.3.8 initial SYNC installer trust boundary', () => {
  test('maps unexpected native errors to one fixed code', () => {
    expect(nextSyncPatchErrorCode(new Error('private/path or content'))).toBe('NEXT_SYNC_PATCH_FAILED');
  });

  test('applies exact original bytes once and verifies applied bytes without rewriting the inode', () => {
    withFixture(({ root, target }) => {
      expect(sha(readFileSync(target))).toBe(ORIGINAL_SHA);
      rejects(() => applyNextSyncPatch(root, { verifyOnly: true }), 'NOT_APPLIED');
      const originalInode = statSync(target).ino;
      expect(applyNextSyncPatch(root)).toBe('applied');
      expect(sha(readFileSync(target))).toBe(PATCHED_SHA);
      expect(readFileSync(target, 'utf8').split(NEW)).toHaveLength(2);
      if (process.platform !== 'win32') expect(statSync(target).ino).not.toBe(originalInode);
      const patchedInode = statSync(target).ino;
      expect(applyNextSyncPatch(root)).toBe('already-applied');
      expect(applyNextSyncPatch(root, { verifyOnly: true })).toBe('already-applied');
      expect(statSync(target).ino).toBe(patchedInode);
      expect(sha(readFileSync(target))).toBe(PATCHED_SHA);
    });
  });

  test('fails closed on unknown or oversized module bytes and a nonregular target', () => {
    withFixture(({ root, target }) => {
      writeFileSync(target, 'unknown module');
      rejects(() => applyNextSyncPatch(root), 'UNKNOWN_SOURCE');
      expect(readFileSync(target, 'utf8')).toBe('unknown module');
      expect(readFileSync(join(root, 'package.json'), 'utf8')).toContain('16.3.8');
    });
    withFixture(({ root, target }) => {
      writeFileSync(target, Buffer.alloc(64 * 1024 + 1));
      rejects(() => applyNextSyncPatch(root), 'SIZE_REJECTED');
      expect(statSync(target).size).toBe(64 * 1024 + 1);
    });
    withFixture(({ root, target }) => {
      unlinkSync(target);
      mkdirSync(target);
      rejects(() => applyNextSyncPatch(root), 'SHAPE_REJECTED');
    });
  });

  test('rejects wrong manifest, npm lock, or installed package identity', () => {
    for (const [relative, body] of [
      ['package.json', JSON.stringify({ dependencies: { next: '16.3.9' } })],
      ['package-lock.json', JSON.stringify({ packages: { '': { dependencies: { next: '16.3.8' } }, 'node_modules/next': { version: '16.3.9' } } })],
      ['node_modules/next/package.json', JSON.stringify({ name: 'not-next', version: '16.3.8' })],
    ] as const) {
      withFixture(({ root, target }) => {
        writeFileSync(join(root, relative), body);
        rejects(() => applyNextSyncPatch(root), 'VERSION_REJECTED');
        expect(sha(readFileSync(target))).toBe(ORIGINAL_SHA);
      });
    }
  });

  const symlinkTest = process.platform === 'win32' ? test.skip : test;
  symlinkTest('rejects symlinked module, metadata, and parent directories', () => {
    withFixture(({ root, target }) => {
      const source = join(root, 'module-source.js');
      copyFileSync(target, source);
      unlinkSync(target);
      symlinkSync(source, target);
      rejects(() => applyNextSyncPatch(root), 'SYMLINK_REJECTED');
      expect(sha(readFileSync(source))).toBe(ORIGINAL_SHA);
    });
    for (const relative of ['package.json', 'package-lock.json', 'node_modules/next/package.json']) {
      withFixture(({ root, target }) => {
        const metadata = join(root, relative);
        const source = join(root, 'metadata-source.json');
        copyFileSync(metadata, source);
        unlinkSync(metadata);
        symlinkSync(source, metadata);
        rejects(() => applyNextSyncPatch(root), 'SYMLINK_REJECTED');
        expect(sha(readFileSync(target))).toBe(ORIGINAL_SHA);
      });
    }
    withFixture(({ root, next, target }) => {
      const dist = join(next, 'dist');
      renameSync(dist, join(next, 'dist-real'));
      symlinkSync('dist-real', dist, 'dir');
      rejects(() => applyNextSyncPatch(root), 'SYMLINK_REJECTED');
      expect(sha(readFileSync(target))).toBe(ORIGINAL_SHA);
    });
  });

  const junctionTest = process.platform === 'win32' ? test : test.skip;
  junctionTest('rejects a Windows directory junction parent', () => {
    withFixture(({ root, next }) => {
      const dist = join(next, 'dist');
      const realDist = join(next, 'dist-real');
      renameSync(dist, realDist);
      symlinkSync(realDist, dist, 'junction');
      rejects(() => applyNextSyncPatch(root), 'SYMLINK_REJECTED');
      expect(sha(readFileSync(join(realDist, 'server', 'dev', 'hot-middleware.js')))).toBe(ORIGINAL_SHA);
    });
  });

  test('atomic replacement leaves a hardlinked cache inode unchanged', () => {
    withFixture(({ root, target }) => {
      const cache = join(root, 'cache-original.js');
      unlinkSync(target);
      writeFileSync(cache, originalNextModule());
      linkSync(cache, target);
      expect(statSync(cache).nlink).toBeGreaterThanOrEqual(2);
      expect(applyNextSyncPatch(root)).toBe('applied');
      expect(sha(readFileSync(target))).toBe(PATCHED_SHA);
      expect(sha(readFileSync(cache))).toBe(ORIGINAL_SHA);
      expect(statSync(cache).nlink).toBe(1);
    });
  });

  test('CLI rejects unknown arguments both directly and through a symlink with fixed output', () => {
    const run = (script: string) => spawnSync('node', [script, '--unknown'], {
      cwd: appRoot, encoding: 'utf8', timeout: 5_000, maxBuffer: 8 * 1024,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', SystemRoot: process.env.SystemRoot ?? '' },
    });
    const direct = run(installer);
    expect(direct.status).toBe(1);
    expect(direct.stdout).toBe('');
    expect(direct.stderr).toBe('NEXT_SYNC_PATCH_ARGUMENT_REJECTED\n');
    if (process.platform !== 'win32') {
      withFixture(({ root }) => {
        const linked = join(root, 'linked-installer.mjs');
        symlinkSync(installer, linked);
        const viaLink = run(linked);
        expect(viaLink.status).toBe(1);
        expect(viaLink.stdout).toBe('');
        expect(viaLink.stderr).toBe('NEXT_SYNC_PATCH_ARGUMENT_REJECTED\n');
      });
    }
  });

  test('ignored-script original bytes are rejected by the actual dev entry guard', () => {
    withFixture(({ root, target }) => {
      const nextBin = join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
      const slashPath = nextBin.replaceAll('\\', '/');
      const backslashPath = nextBin.replaceAll('/', '\\');
      for (const commandPath of [slashPath, backslashPath]) {
        const result = spawnSync('node', [cleanNext, '--skip-clean', '--', 'node', commandPath, 'dev'], {
          cwd: root, encoding: 'utf8', timeout: 5_000, maxBuffer: 8 * 1024,
          env: {
            PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', SystemRoot: process.env.SystemRoot ?? '',
            NIGHTLY_MODE: 'local', NIGHTLY_LOCAL_ENV_ONLY: '1', NIGHTLY_ENV_FILE_ONLY: '1',
            NIGHTLY_ENV_PROVENANCE_SHA256: 'a'.repeat(64), NODE_ENV: 'test',
          },
        });
        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe(
          '[clean-next] error=NEXT_SYNC_PATCH_NOT_APPLIED\n'
          + '[clean-next] run: node scripts/apply-next-sync-patch.mjs\n',
        );
        expect(sha(readFileSync(target))).toBe(ORIGINAL_SHA);
      }
    });
  });
});
