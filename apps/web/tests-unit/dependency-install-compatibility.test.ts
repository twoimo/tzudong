import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(import.meta.dir, '..', path), 'utf8');
const parseBunLock = () => JSON.parse(read('bun.lock').replace(/,\s*([}\]])/g, '$1'));

const VENDORED_MINIMATCH_TGZ = 'vendor/tzudong-minimatch-3.1.5-tzudong.1.tgz';
const VENDORED_MINIMATCH_SHA256 =
  '5fd462549bdaa3ca7897cdeb956f6af1ac20d3107da5769f913cccbc66abca97';
const VENDORED_MINIMATCH_LOCK_INTEGRITY =
  'sha512-0VCca4It47/SgG+OA1DG91bIJ5v6AyYYjorswl2EkslQv0/q7Im77px8uG7f062SAiK2bLalVI55YhAE8+EgRQ==';
const PATCHED_REGISTRY_MINIMATCH = '11.0.3';

const readTarEntry = (tgzPath: string, entrySuffix: string): Buffer => {
  const { gunzipSync } = require('node:zlib');
  const { createHash } = require('node:crypto');
  const raw = readFileSync(join(import.meta.dir, '..', tgzPath));
  if (createHash('sha256').update(raw).digest('hex') !== VENDORED_MINIMATCH_SHA256) {
    throw new Error('vendored tarball bytes changed');
  }
  const tar: Buffer = gunzipSync(raw);
  for (let off = 0; off + 512 <= tar.length; ) {
    const name = tar.subarray(off, off + 100).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(tar.subarray(off + 124, off + 136).toString('utf8').trim(), 8) || 0;
    const body = tar.subarray(off + 512, off + 512 + size);
    if (name.endsWith(entrySuffix)) return body;
    off += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`tar entry not found: ${entrySuffix}`);
};

// Every lockfile entry whose identity is a registry minimatch tarball, keyed
// by basename so nested chains and alias entries (mm-legacy style) are seen.
const registryMinimatchVersions = (npmLock: {
  packages: Record<string, { resolved?: string }>;
}): string[] =>
  Object.values(npmLock.packages)
    .map((metadata) => String(metadata?.resolved ?? ''))
    .filter((resolved) => /\/minimatch\/-\/minimatch-[^/]+\.tgz$/.test(resolved))
    .map((resolved) => resolved.replace(/^.*\/minimatch\/-\/minimatch-/, '').replace(/\.tgz$/, ''));

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
    const npmLock = JSON.parse(read('package-lock.json'));
    const bunLock = parseBunLock();
    const patch = read('patches/minimatch@3.1.5.patch');

    // The registry minimatch@3.1.5 graph is retired in both toolchains. The
    // Bun patch entry stays in the manifest as an inert retention record (its
    // registry target no longer resolves), and the patch bytes stay pinned.
    expect(manifest.patchedDependencies['minimatch@3.1.5']).toBe(
      'patches/minimatch@3.1.5.patch',
    );
    expect(bunLock.patchedDependencies?.['minimatch@3.1.5']).toBeUndefined();
    expect(patch).toContain("typeof expandModule === 'function'");
    expect(patch).toContain('expandModule.expand');

    // Manifest wiring: the direct dependency is the vendored adapter and the
    // global override routes every minimatch consumer to it.
    expect(manifest.devDependencies['minimatch']).toBe(
      `file:${VENDORED_MINIMATCH_TGZ}`,
    );
    expect(manifest.overrides['minimatch']).toBe('$minimatch');
    expect(manifest.overrides['brace-expansion']).toBe('5.0.12');

    // Vendored bytes: the committed tarball is pinned by digest and is a thin
    // adapter that delegates to the patched registry 11.0.3 line through the
    // minimatch-11 alias; it bundles no implementation of its own.
    const adapterManifest = JSON.parse(
      readTarEntry(VENDORED_MINIMATCH_TGZ, 'package/package.json').toString('utf8'),
    );
    expect(adapterManifest.name).toBe('minimatch');
    expect(adapterManifest.version).toBe('3.1.5-tzudong.1');
    expect(adapterManifest.dependencies).toEqual({
      'minimatch-11': `npm:minimatch@${PATCHED_REGISTRY_MINIMATCH}`,
    });
    const adapterSource = readTarEntry(VENDORED_MINIMATCH_TGZ, 'package/index.js').toString(
      'utf8',
    );
    expect(adapterSource).toContain("require('minimatch-11')");
    // 3.x consumer boundary: the adapter maps the legacy windowsPathsNoEscape
    // semantics onto the 11.x allowWindowsEscape option.
    expect(adapterSource).toContain('allowWindowsEscape');
    expect(adapterSource).toContain('windowsPathsNoEscape');
    expect(
      readTarEntry(VENDORED_MINIMATCH_TGZ, 'package/PROVENANCE.md').length,
    ).toBeGreaterThan(0);

    // npm lock wiring: the adapter resolves from the vendored bytes with the
    // frozen integrity, and the alias resolves to the patched registry line.
    const npmAdapter = npmLock.packages['node_modules/minimatch'];
    expect(npmAdapter.version).toBe('3.1.5-tzudong.1');
    expect(npmAdapter.resolved).toBe(`file:${VENDORED_MINIMATCH_TGZ}`);
    expect(npmAdapter.integrity).toBe(VENDORED_MINIMATCH_LOCK_INTEGRITY);
    expect(npmAdapter.dependencies).toEqual({
      'minimatch-11': `npm:minimatch@${PATCHED_REGISTRY_MINIMATCH}`,
    });
    const npmAlias = npmLock.packages['node_modules/minimatch-11'];
    expect(npmAlias.version).toBe(PATCHED_REGISTRY_MINIMATCH);
    expect(npmAlias.resolved).toBe(
      `https://registry.npmjs.org/minimatch/-/minimatch-${PATCHED_REGISTRY_MINIMATCH}.tgz`,
    );
    expect(npmAlias.integrity).toMatch(/^sha512-/);

    // No vulnerable copies, by actual resolved identity: the ONLY registry
    // minimatch tarball anywhere in the npm lock (any nesting, any alias
    // name) is the patched 11.0.3 release.
    expect(new Set(registryMinimatchVersions(npmLock))).toEqual(
      new Set([PATCHED_REGISTRY_MINIMATCH]),
    );
    // The only minimatch-family package entries are the adapter and the alias.
    const npmFamilyPaths = Object.keys(npmLock.packages).filter((path) => {
      const base = path.split('node_modules/').pop() ?? '';
      return base === 'minimatch' || base === 'minimatch-11';
    });
    expect(new Set(npmFamilyPaths)).toEqual(
      new Set(['node_modules/minimatch', 'node_modules/minimatch-11']),
    );

    // Bun parity, by basename across every nesting level: the only
    // minimatch-family keys are the top-level adapter and alias, and every
    // minimatch@ identity in the Bun graph is the vendored tarball or the
    // patched registry 11.0.3.
    const bunFamilyKeys = Object.keys(bunLock.packages).filter((key) => {
      const base = key.split('/').pop() ?? '';
      return base === 'minimatch' || base === 'minimatch-11';
    });
    expect(new Set(bunFamilyKeys)).toEqual(new Set(['minimatch', 'minimatch-11']));
    expect(bunLock.packages.minimatch[0]).toBe(
      `minimatch@${VENDORED_MINIMATCH_TGZ}`,
    );
    expect(bunLock.packages['minimatch-11'][0]).toBe(
      `minimatch@${PATCHED_REGISTRY_MINIMATCH}`,
    );
    const bunMinimatchIdentities = Object.values(bunLock.packages)
      .map((entry) => (entry as string[])[0])
      .filter((identity) => identity.startsWith('minimatch@'));
    expect(new Set(bunMinimatchIdentities)).toEqual(
      new Set([
        `minimatch@${VENDORED_MINIMATCH_TGZ}`,
        `minimatch@${PATCHED_REGISTRY_MINIMATCH}`,
      ]),
    );
  });

  test('excludes all three vulnerable brace-expansion ranges from both lockfiles', () => {
    const npmLock = JSON.parse(read('package-lock.json'));
    const bunLock = parseBunLock();
    const npmVersions = Object.entries(npmLock.packages)
      .filter(([path]) => path.endsWith('node_modules/brace-expansion'))
      .map(([, metadata]) => (metadata as { version: string }).version);
    const bunVersions = Object.values(bunLock.packages)
      .map((entry) => (entry as string[])[0])
      .filter((identity) => identity.startsWith('brace-expansion@'))
      .map((identity) => identity.slice('brace-expansion@'.length));

    // GHSA-6j4f-fj2g-mc7p, GHSA-qhr7-859c-m2p7, GHSA-q2hr-2g5m-vwhr.
    // The 2.1.7 range served the retired registry minimatch@3.1.5 chain;
    // only the pinned 5.0.12 release may remain.
    expect(new Set(npmVersions)).toEqual(new Set(['5.0.12']));
    expect(new Set(bunVersions)).toEqual(new Set(npmVersions));
  });

  test('executes the installed adapter with the patched 11 engine contract', () => {
    // Installed-runtime probes, not source pins: these exercise the real
    // node_modules graph produced by either installer (npm ci or bun install
    // both resolve the same vendored adapter + registry 11.0.3 alias).
    const requireFromWeb = createRequire(join(import.meta.dir, '..', 'package.json'));
    const mm = requireFromWeb('minimatch');
    const mm11 = requireFromWeb('minimatch-11');

    expect(requireFromWeb('minimatch/package.json').version).toBe('3.1.5-tzudong.1');
    expect(requireFromWeb('minimatch-11/package.json').version).toBe(
      PATCHED_REGISTRY_MINIMATCH,
    );

    // GLOBSTAR identity: the adapter exposes the patched engine's own symbol.
    expect(typeof mm.GLOBSTAR).toBe('symbol');
    expect(mm.GLOBSTAR).toBe(mm11.GLOBSTAR);

    // makeRe test-only surface: a genuine RegExp whose test() delegates to
    // the patched 11 matcher.
    const re = mm.makeRe('**/*.js');
    expect(re).toBeInstanceOf(RegExp);
    expect(re.test('a/b/c.js')).toBe(true);
    expect(re.test('a/b/c.css')).toBe(false);

    // Loud-failure boundary: exec() and friends must THROW by design. If the
    // installed throw is removed (tarball bytes unchanged), silently wrong
    // results would follow - this probe fails instead.
    expect(() => re.exec('a/b/c.js')).toThrow(/loud failure/);

    // Patched-line execution: the over-length and non-string guards in the
    // installed graph must actually fire through the adapter.
    expect(() => mm('x', 'a'.repeat(70 * 1024))).toThrow(TypeError);
    expect(() => mm.makeRe('a'.repeat(70 * 1024))).toThrow(TypeError);
    expect(() => mm('x', 123)).toThrow(TypeError);
    expect(() => mm.makeRe(123)).toThrow(TypeError);

    // Representative 3.x consumer parity vectors (measured contract).
    expect(mm('a/b/c/d.js', '**/*.js')).toBe(true);
    expect(mm('a.js', 'b/**/*.js')).toBe(false);
    expect(mm('foo.js', '*.js')).toBe(true);
    expect(mm('foo/bar.js', '*.js')).toBe(false);
    expect(mm('a.js', '*.{js,css}')).toBe(true);
    expect(mm('.hidden', '*')).toBe(false);
    expect(mm('.hidden', '*', { dot: true })).toBe(true);
    expect(new mm.Minimatch('*.js').match('x.js')).toBe(true);
    expect(mm.match(['a.js', 'b.css'], '*.js')).toEqual(['a.js']);
    expect(['a.js', 'b.css'].filter(mm.filter('*.js'))).toEqual(['a.js']);

    // Windows consumer boundary: with no option stated the adapter injects
    // allowWindowsEscape (POSIX-neutral, 3.x win32 semantics); explicit
    // legacy/native options pass through untouched.
    expect(mm('foo/bar.js', 'foo\\bar.js')).toBe(false);
    expect(mm('foo/bar.js', 'foo\\bar.js', { windowsPathsNoEscape: true })).toBe(true);
    expect(mm('foo/bar.js', 'foo\\bar.js', { allowWindowsEscape: false })).toBe(true);
  });
});
