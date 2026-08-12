import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(import.meta.dir, '..', path), 'utf8');
const parseBunLock = () => JSON.parse(read('bun.lock').replace(/,\s*([}\]])/g, '$1'));

describe('npm and Bun dependency installation compatibility', () => {
  test('pins the fixed nanoid release in both release-authority lockfiles', () => {
    const manifest = JSON.parse(read('package.json'));
    const npmLock = JSON.parse(read('package-lock.json'));
    const bunLock = parseBunLock();

    expect(manifest.overrides.nanoid).toBe('3.3.18');
    expect(npmLock.packages['node_modules/nanoid'].version).toBe('3.3.18');
    expect(bunLock.packages.nanoid[0]).toBe('nanoid@3.3.18');
  });

  test('keeps minimatch 3 compatible with the security-pinned Bun graph', () => {
    const manifest = JSON.parse(read('package.json'));
    const bunLock = parseBunLock();
    const patch = read('patches/minimatch@3.1.5.patch');

    expect(manifest.patchedDependencies['minimatch@3.1.5']).toBe(
      'patches/minimatch@3.1.5.patch',
    );
    expect(bunLock.patchedDependencies['minimatch@3.1.5']).toBe(
      'patches/minimatch@3.1.5.patch',
    );
    expect(manifest.overrides['brace-expansion']).toBe('5.0.9');
    expect(manifest.overrides['minimatch@3.1.5']['brace-expansion']).toBe('2.1.4');
    expect(patch).toContain("typeof expandModule === 'function'");
    expect(patch).toContain('expandModule.expand');
  });
});
