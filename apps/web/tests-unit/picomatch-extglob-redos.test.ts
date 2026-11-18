import { describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';

// Exercise the vendored source before the archive is installed. The shared
// node_modules checkout must stay on the registry copies.
const require = createRequire(import.meta.url);
const webRoot = join(import.meta.dir, '..');

const copies = [
  {
    dir: 'picomatch-2',
    tarball: 'vendor/tzudong-picomatch-2.3.2-tzudong.1.tgz',
    name: '@tzudong/picomatch-2',
  },
  {
    dir: 'picomatch-4',
    tarball: 'vendor/tzudong-picomatch-4.0.7-tzudong.1.tgz',
    name: '@tzudong/picomatch-4',
  },
] as const;

describe('vendored picomatch repeated extglobs', () => {
  for (const copy of copies) {
    test(`${copy.dir} matches a repeated extglob without stalling`, () => {
      const picomatch = require(join(webRoot, 'vendor', copy.dir));
      const started = performance.now();
      expect(picomatch.isMatch(`${'a'.repeat(24)}/`, '+(*a)')).toBe(false);
      expect(performance.now() - started).toBeLessThan(1000);
      expect(picomatch.isMatch('aaa', '+(*a)')).toBe(true);
      expect(picomatch.isMatch('file.js', '*.js')).toBe(true);
      expect(picomatch.isMatch('file.ts', '*.js')).toBe(false);
    });

    test(`${copy.dir} archive contains the collapse and the renamed package`, () => {
      const source = readFileSync(join(webRoot, 'vendor', copy.dir, 'lib/parse.js'), 'utf8');
      const packed = gunzipSync(readFileSync(join(webRoot, copy.tarball))).toString('utf8');
      expect(source).toContain('GHSA-fc5q-39xc-vjpf');
      expect(source).toContain('analysis.collapse');
      expect(packed).toContain('analysis.collapse');
      expect(packed).toContain(`"name": "${copy.name}"`);
    });
  }

  test('neither lockfile still resolves a registry picomatch tarball', () => {
    const npmLock = JSON.parse(readFileSync(join(webRoot, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, { name?: string; resolved?: string }>;
    };
    const installed = Object.entries(npmLock.packages).filter(([key]) =>
      key.endsWith('/picomatch') || key.endsWith('/picomatch-2') || key.endsWith('/picomatch-4'),
    );
    expect(installed.map(([key]) => key).sort()).toEqual([
      'node_modules/@rollup/plugin-commonjs/node_modules/picomatch',
      'node_modules/@rollup/pluginutils/node_modules/picomatch',
      'node_modules/picomatch',
      'node_modules/picomatch-2',
      'node_modules/picomatch-4',
      'node_modules/tinyglobby/node_modules/picomatch',
    ]);
    for (const [, entry] of installed) {
      expect(entry.name).toMatch(/^@tzudong\/picomatch-[24]$/);
      expect(entry.resolved).toMatch(/^file:vendor\/tzudong-picomatch-/);
    }
    expect(JSON.stringify(npmLock)).not.toContain('registry.npmjs.org/picomatch/');
    const bunLock = readFileSync(join(webRoot, 'bun.lock'), 'utf8');
    expect(bunLock).not.toContain('registry.npmjs.org/picomatch/');
    expect(bunLock).toContain('@tzudong/picomatch-2@vendor/tzudong-picomatch-2.3.2-tzudong.1.tgz');
    expect(bunLock).toContain('@tzudong/picomatch-4@vendor/tzudong-picomatch-4.0.7-tzudong.1.tgz');
  });
});
