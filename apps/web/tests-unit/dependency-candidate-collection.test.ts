import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { collectCandidates, companionContentMirrorsOnly, descriptor, lockfileChanges } from '../scripts/collect-dependency-candidates.mjs';
import { buildPreflightReceipt, buildRunReceipt } from '../scripts/verify-dependency-freshness.mjs';

const pr = { number: 42, user: { login: 'dependabot[bot]' },
  base: { ref: 'develop' }, head: { sha: 'a'.repeat(40) } };
const file = (name = 'next', version = '16.3.0', fromVersion = '16.2.0') => ({
  filename: 'apps/web/package.json', status: 'modified',
  patch: `-    "${name}": "${fromVersion}",\n+    "${name}": "${version}",`,
});
describe('real dependency candidate ingestion', () => {
  test('PR preflight isolates other holds, missing metadata and aggregate limits', async () => {
    const current = descriptor(pr, [file('test-package', '16.2.1')]);
    const others = Array.from({ length: 6 }, (_, i) => ({
      ...descriptor({ ...pr, number: 50 + i, head: { sha: 'b'.repeat(40) } }, [file()]),
      metadataIncomplete: i === 0,
    }));
    expect(buildRunReceipt({ candidates: [current, ...others] }).candidates.every(
      (entry: {code: string | null}) => entry.code !== null)).toBe(true);
    expect(buildPreflightReceipt([current, ...others], pr.head.sha).candidates[0].code).toBeNull();
    expect(buildPreflightReceipt([current, ...others]).candidates).toHaveLength(7);
    expect(() => buildPreflightReceipt(others, pr.head.sha)).toThrow('checked_candidate_metadata_unavailable');
    expect(() => buildPreflightReceipt([current, current], pr.head.sha)).toThrow('checked_candidate_metadata_unavailable');
    const calls: string[] = [];
    const scoped = await collectCandidates(async (path: string) => {
      calls.push(path);
      return path.includes('/files') ? [file('test-package', '16.2.1')]
        : [pr, { ...pr, number: 99, head: { sha: 'b'.repeat(40) } }];
    }, pr.head.sha);
    expect(scoped).toHaveLength(1);
    expect(calls.some((path) => path.includes('/pulls/99/'))).toBe(false);
  });

  test('derives a lockfile-only update from the merge base even after develop advances', async () => {
    const baseSha = 'b'.repeat(40);
    const mergeBase = 'c'.repeat(40);
    const lock = (version: string) => ({ lockfileVersion: 3, packages: {
      '': { name: 'fixture' },
      'node_modules/parent/node_modules/@scope/leaf': { version },
    } });
    const blob = (value: object) => {
      const bytes = Buffer.from(JSON.stringify(value));
      return { encoding: 'base64', content: bytes.toString('base64'), size: bytes.length,
        sha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') };
    };
    const calls: string[] = [];
    const candidates = await collectCandidates(async (path: string) => {
      calls.push(path);
      if (path.includes('/compare/')) return { base_commit: { sha: baseSha }, merge_base_commit: { sha: mergeBase } };
      if (path.includes('/contents/')) {
        // Updated develop has unrelated additions/held-package changes. Its
        // lockfile is not the old side of this PR's actual diff.
        if (path.endsWith(baseSha)) throw new Error('unrelated_base_lockfile_requested');
        return blob(lock(path.endsWith(mergeBase) ? '1.2.3' : '1.2.4'));
      }
      if (path.includes('/files')) return [{ filename: 'apps/web/package-lock.json', status: 'modified' }];
      return [{ ...pr, base: { ...pr.base, sha: baseSha } }];
    });
    expect(candidates[0].unit).toBe('/apps/web');
    expect(candidates[0].metadataIncomplete).toBe(false);
    expect(candidates[0].packages).toEqual([{ name: '@scope/leaf', fromVersion: '1.2.3', toVersion: '1.2.4' }]);
    expect(buildRunReceipt({ candidates }).candidates[0].code).toBeNull();
    expect(calls.filter((path) => path.includes('/contents/'))).toEqual([
      `/contents/apps/web/package-lock.json?ref=${mergeBase}`,
      `/contents/apps/web/package-lock.json?ref=${pr.head.sha}`,
    ]);
  });

  test('lockfile metadata cannot bypass holds or admit unbound and incomplete blobs', async () => {
    const lock = (version: string) => ({ lockfileVersion: 3, packages: { 'node_modules/typescript-eslint': { version } } });
    const file = { filename: 'apps/web/package-lock.json', status: 'modified' };
    const candidate = descriptor(pr, [file], { [file.filename]: { before: lock('8.63.0'), after: lock('8.64.0') } });
    expect(buildRunReceipt({ candidates: [candidate] }).candidates[0].code).toBe('dependency_hold_violation');
    expect(descriptor(pr, [file]).metadataIncomplete).toBe(true);
    expect(lockfileChanges(lock('8.63.0'), { lockfileVersion: 3, packages: {} }).incomplete).toBe(true);
    await expect(collectCandidates(async (path: string) => {
      if (path.includes('/compare/')) return { base_commit: { sha: 'b'.repeat(40) }, merge_base_commit: { sha: 'c'.repeat(40) } };
      if (path.includes('/contents/')) return { encoding: 'base64', content: 'e30=', size: 2, sha: '0'.repeat(40) };
      return path.includes('/files') ? [file] : [{ ...pr, base: { ...pr.base, sha: 'b'.repeat(40) } }];
    })).rejects.toThrow('candidate_metadata_unavailable');
  });

  test('missing or mismatched merge-base metadata cannot admit a lockfile candidate', async () => {
    for (const comparison of [{}, { base_commit: { sha: 'd'.repeat(40) }, merge_base_commit: { sha: 'c'.repeat(40) } },
      { base_commit: { sha: 'b'.repeat(40) }, merge_base_commit: { sha: 'invalid' } }]) {
      await expect(collectCandidates(async (path: string) => {
        if (path.includes('/compare/')) return comparison;
        if (path.includes('/files')) return [{ filename: 'apps/web/package-lock.json', status: 'modified' }];
        return [{ ...pr, base: { ...pr.base, sha: 'b'.repeat(40) } }];
      })).rejects.toThrow('candidate_metadata_unavailable');
    }
  });

  test('fetches Dependabot PR files and enforces hold and target on actual descriptors', async () => {
    const calls: string[] = [];
    const candidates = await collectCandidates(async (path: string) => {
      calls.push(path);
      return path.includes('/files') ? [file('typescript-eslint', '8.64.0', '8.63.0')] : [pr, { ...pr, user: { login: 'human' } }];
    });
    expect(calls).toHaveLength(2);
    const receipt = buildRunReceipt({ candidates });
    expect(receipt.units[0].candidateCount).toBe(1);
    expect(receipt.candidates[0].code).toBe('dependency_hold_violation');
    expect(buildRunReceipt({ candidates: [descriptor({ ...pr, base: { ref: 'main' } }, [file('typescript-eslint', '8.64.0', '8.63.0')])] })
      .candidates[0].code).toBe('target_branch_violation');
  });
  test('rejects pin changes, truncated metadata and excess open candidates', () => {
    expect(buildRunReceipt({ candidates: [descriptor(pr, [file('typescript', '16.2.1')])] })
      .candidates[0].code).toBe('pin_contract_violation');
    expect(buildRunReceipt({ candidates: [descriptor(pr, [{ ...file(), patch: undefined }])] })
      .candidates[0].code).toBe('dependency_check_failed');
    const candidates = Array.from({ length: 6 }, (_, i) => descriptor({ ...pr, number: i }, [file('test-package', '16.2.1')]));
    expect(buildRunReceipt({ candidates }).candidates.every((c: {code: string}) => c.code === 'dependency_check_failed')).toBe(true);
  });
  test('real manifest version ranges cannot bypass held versions', () => {
    for (const version of ['^8.64.0', '~8.64.0', '>=8.64.0']) {
      expect(buildRunReceipt({ candidates: [descriptor(pr, [file('typescript-eslint', version, '8.63.0')])] })
        .candidates[0].code).toBe('dependency_hold_violation');
    }
    const changed = { ...file(), patch: '-"eslint": "^9.0.0",\n+"eslint": "^10.0.0",' };
    expect(buildRunReceipt({ candidates: [descriptor(pr, [changed])] })
      .candidates[0].code).toBe('dependency_hold_violation');
  });
  test('uses each ecosystem directory and refuses missing API pages', async () => {
    for (const [filename, patch, unit] of [
      ['backend/pipeline/requirements.txt', '-requests==2.32.0\n+requests==2.32.1', '/backend/pipeline'],
      ['backend/rust/Cargo.toml', '-serde = "1.0.0"\n+serde = "1.0.1"', '/backend/rust'],
      ['.github/workflows/ci.yml', '-uses: actions/checkout@old\n+uses: actions/checkout@new', '/'],
    ]) expect(descriptor(pr, [{ filename, status: 'modified', patch }]).unit).toBe(unit);
    await expect(collectCandidates(async () => ({ error: true }))).rejects.toThrow('candidate_metadata_unavailable');
  });
});

describe('governed companion file narrow admission', () => {
  const COMPANION = 'apps/web/tests-unit/nightly-regression-workflow.test.ts';
  const manifest = () => ({
    filename: 'apps/web/package.json', status: 'modified',
    patch: '@@ -1,2 +1,2 @@\n-    "supabase": "^2.117.0",\n+    "supabase": "^2.121.0",\n-    "postcss": "^8.5.28",\n+    "postcss": "^8.5.31",',
  });
  const beforeText = [
    'describe("nightly regression contracts", () => {',
    '  it("pins supabase", () => {',
    '    expect(lock).toContain(\'"supabase": ["supabase@2.117.0"\');',
    '    expect(other).toBe(true);',
    '  });',
    '});',
  ].join('\n');
  const mirrorAfter = beforeText.replace('2.117.0', '2.121.0');
  const contents = (after: string) => ({ [COMPANION]: { before: beforeText, after } });
  const companion = (patch?: string, status = 'modified') => ({
    filename: COMPANION, status, ...(patch === undefined ? {} : { patch }),
  });
  const cleanPatch = '@@ -1,4 +1,4 @@\n describe("nightly regression contracts", () => {\n'
    + '   it("pins supabase", () => {\n'
    + '-    expect(lock).toContain(\'"supabase": ["supabase@2.117.0"\');\n'
    + '+    expect(lock).toContain(\'"supabase": ["supabase@2.121.0"\');\n'
    + '     expect(other).toBe(true);\n';
  const pairs = [{ name: 'supabase', fromVersion: '2.117.0', toVersion: '2.121.0' }];

  test('complete content proving an exact manifest mirror is admitted', () => {
    const d = descriptor(pr, [manifest(), companion(cleanPatch)], {}, contents(mirrorAfter));
    expect(d.metadataIncomplete).toBe(false);
    expect(d.packages).toHaveLength(2);
    expect(companionContentMirrorsOnly(beforeText, mirrorAfter, pairs)).toBe(true);
  });

  test('a patch string alone never admits; completeness comes only from verified contents', () => {
    // Same clean patch, no verified contents supplied.
    expect(descriptor(pr, [manifest(), companion(cleanPatch)]).metadataIncomplete).toBe(true);
    // A clean-looking patch cannot hide a later non-mirror hunk: the verified
    // head content carries a semantic change the patch rendering omitted.
    const hiddenHunk = mirrorAfter.replace('toBe(true)', 'toBe(false)');
    expect(descriptor(pr, [manifest(), companion(cleanPatch)], {}, contents(hiddenHunk))
      .metadataIncomplete).toBe(true);
    // Trailing truncation of the rendering is irrelevant: content compare sees it all.
    const truncatedPatch = cleanPatch.split('\n').slice(0, 3).join('\n');
    expect(descriptor(pr, [manifest(), companion(truncatedPatch)], {}, contents(mirrorAfter))
      .metadataIncomplete).toBe(false);
  });

  test('every adversarial non-mirror content change fails closed', () => {
    const bad = [
      mirrorAfter.replaceAll('2.121.0', '2.122.0'), // version not in the manifest bump
      mirrorAfter.replace('supabase@2.121.0', 'supabase-extra@2.121.0'), // semantic edit on the changed line
      mirrorAfter + '\n    expect(true).toBe(true);', // pure addition
      mirrorAfter.replace('    expect(other).toBe(true);\n', ''), // deletion
      mirrorAfter.replaceAll('2.121.0', '8.5.31'), // cross-package version swap
      mirrorAfter.replace('2.121.0', '2.117.0'), // one-sided (from-version kept)
      mirrorAfter.replaceAll('supabase', 'unrelated'), // changed line names no bumped package
      mirrorAfter.replace('toBe(true)', 'toBe(false)'), // semantic change on another line
      beforeText.replace('expect(other).toBe(true);', 'expect(lock).toContain(\'"supabase": ["supabase@2.121.0"\');')
        .replace('supabase@2.117.0', 'supabase@2.121.0').replace('2.121.0\');\n  });', '2.121.0\');\n    expect(other).toBe(true);\n  });'), // reordered lines
      beforeText.replace('2.117.0', '2.121.0').replace('2.121.0\');\n', '2.121.0\');\n'), // identical (control: not in bad list)
    ].slice(0, 9);
    for (const after of bad) {
      expect(companionContentMirrorsOnly(beforeText, after, pairs)).toBe(false);
      expect(descriptor(pr, [manifest(), companion()], {}, contents(after)).metadataIncomplete).toBe(true);
    }
  });

  test('wrong path, wrong status and empty manifest changes fail closed', () => {
    expect(descriptor(pr, [manifest(), { filename: 'apps/web/tests-unit/other.test.ts', status: 'modified', patch: cleanPatch }], {}, contents(mirrorAfter)).metadataIncomplete).toBe(true);
    expect(descriptor(pr, [manifest(), companion(cleanPatch, 'added')], {}, contents(mirrorAfter)).metadataIncomplete).toBe(true);
    expect(descriptor(pr, [companion(cleanPatch)], {}, contents(mirrorAfter)).metadataIncomplete).toBe(true);
    expect(companionContentMirrorsOnly(beforeText, mirrorAfter, [])).toBe(false);
    expect(companionContentMirrorsOnly(undefined as never, mirrorAfter, pairs)).toBe(false);
    expect(companionContentMirrorsOnly(beforeText, beforeText, pairs)).toBe(false); // no change is not a mirror
  });

  test('same-version pairs stay identity-bound by package name', () => {
    const before = 'pin "alpha": "1.0.0"\n';
    const dup = [
      { name: 'alpha', fromVersion: '1.0.0', toVersion: '2.0.0' },
      { name: 'beta', fromVersion: '1.0.0', toVersion: '2.0.0' },
    ];
    expect(companionContentMirrorsOnly(before, 'pin "alpha": "2.0.0"\n', dup)).toBe(true);
    expect(companionContentMirrorsOnly('pin: "1.0.0"\n', 'pin: "2.0.0"\n', dup)).toBe(false);
  });

  test('collection always verifies companion contents, even when a patch string exists', async () => {
    const baseSha = 'b'.repeat(40);
    const mergeBase = 'c'.repeat(40);
    const blobOf = (value: string) => {
      const bytes = Buffer.from(value);
      return { encoding: 'base64', content: bytes.toString('base64'), size: bytes.length,
        sha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') };
    };
    const collect = async (after: string, corrupt = false) => {
      const calls: string[] = [];
      const out = await collectCandidates(async (path: string) => {
        calls.push(path);
        if (path.includes('/compare/')) return { base_commit: { sha: baseSha }, merge_base_commit: { sha: mergeBase } };
        if (path.includes('/contents/')) {
          if (corrupt) return { encoding: 'base64', content: 'e30=', size: 2, sha: '0'.repeat(40) };
          return blobOf(path.endsWith(mergeBase) ? beforeText : after);
        }
        if (path.includes('/files')) return [manifest(), companion(cleanPatch)]; // patch present
        return [{ ...pr, base: { ...pr.base, sha: baseSha } }];
      }, undefined as never);
      return { candidate: out[0], calls };
    };
    const admitted = await collect(mirrorAfter);
    expect(admitted.candidate.metadataIncomplete).toBe(false);
    expect(admitted.calls.filter((path) => path.includes('/contents/'))).toEqual([
      `/contents/${COMPANION}?ref=${mergeBase}`,
      `/contents/${COMPANION}?ref=${pr.head.sha}`,
    ]);
    expect((await collect(mirrorAfter.replace('toBe(true)', 'toBe(false)'))).candidate.metadataIncomplete).toBe(true);
    await expect(collect(mirrorAfter, true)).rejects.toThrow('candidate_metadata_unavailable');
  });
});
