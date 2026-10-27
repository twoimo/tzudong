import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GOVERNED_COMPANION_PATHS, RECONCILIATION_MANIFEST_PATH, collectCandidates, companionContentMirrorsOnly, descriptor,
  lockfileChanges, manifestTrackedPaths, manifestEntriesDigest, pythonCanonicalJson, reconciliationManifestMirrorsOnly,
} from '../scripts/collect-dependency-candidates.mjs';
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
    ];
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

  test('shared from-version pairs stay bound to their own to-version', () => {
    const dup = [
      { name: 'alpha', fromVersion: '1.0.0', toVersion: '2.0.0' },
      { name: 'beta', fromVersion: '1.0.0', toVersion: '3.0.0' },
    ];
    // Each package's own pair is admitted regardless of pair order.
    expect(companionContentMirrorsOnly('pin "alpha": "1.0.0"\n', 'pin "alpha": "2.0.0"\n', dup)).toBe(true);
    expect(companionContentMirrorsOnly('pin "beta": "1.0.0"\n', 'pin "beta": "3.0.0"\n', dup)).toBe(true);
    expect(companionContentMirrorsOnly('pin "alpha": "1.0.0"\n', 'pin "alpha": "2.0.0"\n', [...dup].reverse())).toBe(true);
    // Cross-pair swaps are rejected even though every token is a real manifest version.
    expect(companionContentMirrorsOnly('pin "alpha": "1.0.0"\n', 'pin "alpha": "3.0.0"\n', dup)).toBe(false);
    expect(companionContentMirrorsOnly('pin "beta": "1.0.0"\n', 'pin "beta": "2.0.0"\n', dup)).toBe(false);
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

describe('governed companion exact action SHA pin mirror', () => {
  const OLD = 'd3f86a106a0bac45b974a628896c90dbdf5c8093';
  const NEW = '9000827ccba6bdab643e8b6fd33ac0654aef8333';
  const OTHER = 'cf430e030ddbb5b0abf93d22962f4752f3646cd9';
  const pairs = [{ name: 'actions/download-artifact', fromVersion: OLD, toVersion: NEW }];
  const line = (sha: string, tail = '') => `      "actions/download-artifact@${sha}",${tail}`;
  const doc = (l: string) => ['expect(a).toBe(1);', l, 'expect(b).toBe(2);'].join('\n');

  test('exact from->to SHA on a line naming the bumped action is admitted', () => {
    expect(companionContentMirrorsOnly(doc(line(OLD)), doc(line(NEW)), pairs)).toBe(true);
  });

  test('every SHA deviation fails closed', () => {
    const before = doc(line(OLD));
    const bad = [
      doc(line(OTHER)), // to-ref is not this package's bumped ref
      doc(line(OLD)), // unchanged: no change at all
      doc(line(NEW, ' // extra')), // extra edit on the changed line
      doc(line(NEW).replace('download-artifact', 'upload-artifact')), // different action name
      doc(line(NEW).replace(NEW.slice(0, 39), NEW.slice(0, 38) + '0')), // truncated or altered ref
      doc(line(NEW)).replace('toBe(2)', 'toBe(3)'), // second, non-mirror line change
      doc(line(NEW)) + '\n' + line(NEW), // added line
    ];
    for (const after of bad) expect(companionContentMirrorsOnly(before, after, pairs)).toBe(false);
    // Swapped direction is not the manifest pair.
    expect(companionContentMirrorsOnly(doc(line(NEW)), doc(line(OLD)), pairs)).toBe(false);
    // A line that does not name the bumped action is never admitted, even with the right refs.
    expect(companionContentMirrorsOnly(doc(`  "x@${OLD}",`), doc(`  "x@${NEW}",`), pairs)).toBe(false);
    // Short or non-hex refs are not treated as SHA pins.
    const short = [{ name: 'actions/download-artifact', fromVersion: 'v4', toVersion: 'v8' }];
    expect(companionContentMirrorsOnly(doc(line('v4')), doc(line('v8')), short)).toBe(false);
  });

  test('a second action sharing the line cannot ride along unless it is also a bumped pair', () => {
    const before = doc(`  "actions/download-artifact@${OLD}", "actions/upload-artifact@${OLD}",`);
    const after = doc(`  "actions/download-artifact@${NEW}", "actions/upload-artifact@${NEW}",`);
    expect(companionContentMirrorsOnly(before, after, pairs)).toBe(false);
  });
});

describe('governed companion pin record binds SHA and version comment to the same action', () => {
  const OLD = 'd3f86a106a0bac45b974a628896c90dbdf5c8093';
  const NEW = '9000827ccba6bdab643e8b6fd33ac0654aef8333';
  const pairs = [{ name: 'actions/download-artifact', fromVersion: OLD, toVersion: NEW, fromTag: 'v4.3.0', toTag: 'v8.0.2' }];
  const pin = (sha: string, tag: string, action = 'actions/download-artifact') =>
    `const PIN = "actions/download-artifact@${sha} # ${action}@${tag}";`;
  const flow = {
    number: 9, head: { sha: 'h' }, base: { ref: 'develop' },
  };
  const wf = (comment: string) => ({
    filename: '.github/workflows/nightly-local-regression.yml', status: 'modified',
    patch: `@@ -1,1 +1,1 @@\n-        uses: actions/download-artifact@${OLD} # actions/download-artifact@v4.3.0\n+        uses: actions/download-artifact@${NEW}${comment}`,
  });
  const COMPANION = 'apps/web/tests-unit/nightly-regression-workflow.test.ts';
  const verdict = (after: string, comment = ' # actions/download-artifact@v8.0.2') =>
    descriptor(flow, [wf(comment), { filename: COMPANION, status: 'modified' }], {},
      { [COMPANION]: { before: pin(OLD, 'v4.3.0'), after } }).metadataIncomplete;

  test('exact SHA plus exact version comment of the same action is admitted', () => {
    expect(verdict(pin(NEW, 'v8.0.2'))).toBe(false);
    expect(companionContentMirrorsOnly(pin(OLD, 'v4.3.0'), pin(NEW, 'v8.0.2'), pairs)).toBe(true);
  });

  test('stale, wrong, other-action or missing version evidence fails closed', () => {
    expect(verdict(pin(NEW, 'v4.3.0'))).toBe(true); // stale comment kept
    expect(verdict(pin(NEW, 'v8.0.3'))).toBe(true); // version not in the bot diff
    expect(verdict(pin(NEW, 'v8.0.2', 'actions/upload-artifact'))).toBe(true); // comment names another action
    expect(verdict(pin(NEW, 'v8.0.2'), '')).toBe(true); // bot diff carries no version comment: tag not bound
    expect(verdict(pin(NEW, 'v8.0.2'), ' # actions/upload-artifact@v8.0.2')).toBe(true); // bot comment names another action
    expect(companionContentMirrorsOnly(pin(OLD, 'v4.3.0'), pin(OLD, 'v8.0.2'), pairs)).toBe(false); // tag moved, SHA kept
    expect(companionContentMirrorsOnly(pin(OLD, 'v4.3.0'), pin(NEW, 'v4.3.0'), pairs)).toBe(false); // SHA moved, tag stale
    expect(companionContentMirrorsOnly(pin(NEW, 'v8.0.2'), pin(OLD, 'v4.3.0'), pairs)).toBe(false); // reversed pair
  });
});

describe('governed companion bare SHA on a named line stays rejected', () => {
  const F = '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a';
  const T = 'cf430e030ddbb5b0abf93d22962f4752f3646cd9';
  const X = '65c4c4a1ddee5b72f698fdd19549f0f0fb45cf08';
  const E = 'ea165f8d65b6e75b540449e92b4886f43607fa02';
  const pairs = [{ name: 'actions/upload-artifact', fromVersion: F, toVersion: T }];
  const doc = (l: string) => ['const a = 1;', l, 'const b = 2;'].join('\n');
  const tuple = (sha: string, name = 'actions/upload-artifact') => `  ["${name}", "${sha}"],`;
  const pin = (sha: string, name = 'actions/upload-artifact') => `  "${name}@${sha}",`;
  const check = (before: string, after: string, p = pairs) => companionContentMirrorsOnly(doc(before), doc(after), p);

  test('only the exact name@sha string shape is admitted, TS and Python', () => {
    expect(check(pin(F), pin(T))).toBe(true);
    expect(check(`UPLOAD = "actions/upload-artifact@${F}"`, `UPLOAD = "actions/upload-artifact@${T}"`)).toBe(true);
    expect(check(`    self.assertEqual(pins, ["actions/upload-artifact@${F}"])`,
      `    self.assertEqual(pins, ["actions/upload-artifact@${T}"])`)).toBe(true);
  });

  test('tuple, bare SHA, name-in-comment and loose major shapes are not admitted', () => {
    expect(check(tuple(F), tuple(T))).toBe(false);
    expect(check(`  ['actions/upload-artifact', '${F}'],`, `  ['actions/upload-artifact', '${T}'],`)).toBe(false);
    expect(check(`${tuple(F, 'actions/other')} // actions/upload-artifact`, `${tuple(T, 'actions/other')} // actions/upload-artifact`)).toBe(false);
    expect(check(`  // actions/upload-artifact\n  const sha = "${F}";`, `  // actions/upload-artifact\n  const sha = "${T}";`)).toBe(false);
    expect(check(`  "actions/upload-artifact" + "${F}"`, `  "actions/upload-artifact" + "${T}"`)).toBe(false);
    expect(check('  "actions/upload-artifact@v4",', '  "actions/upload-artifact@v7.0.2",')).toBe(false);
    const tagged = [{ name: 'actions/upload-artifact', fromVersion: X, toVersion: T, fromTag: 'v4.6.0', toTag: 'v7.0.2' }];
    expect(check('  "actions/upload-artifact@v4.6.0",', '  "actions/upload-artifact@v7.0.2",', tagged)).toBe(false);
  });

  test('name boundaries, ambiguity, counts and shared SHAs fail closed', () => {
    expect(check(pin(F, 'evil/actions/upload-artifact'), pin(T, 'evil/actions/upload-artifact'))).toBe(false);
    expect(check(pin(F, 'actions/upload-artifact-x'), pin(T, 'actions/upload-artifact-x'))).toBe(false);
    expect(check(`  "x@actions/upload-artifact@${F}"`, `  "x@actions/upload-artifact@${T}"`)).toBe(false);
    const two = (a: string, b: string) => `  "actions/upload-artifact@${a}", "actions/upload-artifact@${b}",`;
    expect(check(two(F, F), two(T, T))).toBe(true);
    expect(check(two(F, F), two(T, F))).toBe(false);
    expect(check(two(F, F), two(T, X))).toBe(false);
    expect(check(pin(F), two(T, T))).toBe(false);
    expect(check(two(F, F), pin(T))).toBe(false);
    const shared = [
      { name: 'actions/a', fromVersion: F, toVersion: T },
      { name: 'actions/b', fromVersion: F, toVersion: X },
    ];
    expect(check(pin(F, 'actions/a'), pin(T, 'actions/a'), shared)).toBe(true);
    expect(check(pin(F, 'actions/a'), pin(X, 'actions/a'), shared)).toBe(false);
    expect(check(pin(F, 'actions/b'), pin(T, 'actions/b'), shared)).toBe(false);
    expect(check(`${pin(F, 'actions/a')} ${pin(F, 'actions/b')}`, `${pin(T, 'actions/a')} ${pin(X, 'actions/b')}`, shared)).toBe(true);
    expect(check(`${pin(F, 'actions/a')} ${pin(F, 'actions/b')}`, `${pin(X, 'actions/a')} ${pin(T, 'actions/b')}`, shared)).toBe(false);
  });

  test('three historical from-pins map only to their own pair; cross-pair swaps are rejected', () => {
    const upload = [
      { name: 'actions/upload-artifact', fromVersion: X, toVersion: T },
      { name: 'actions/upload-artifact', fromVersion: F, toVersion: T },
      { name: 'actions/upload-artifact', fromVersion: E, toVersion: T },
    ];
    for (const from of [X, F, E]) expect(check(pin(from), pin(T), upload)).toBe(true);
    // A from-pin moving to another historical from-pin, or to a SHA that is nobody's target.
    expect(check(pin(X), pin(F), upload)).toBe(false);
    expect(check(pin(E), pin(X), upload)).toBe(false);
    expect(check(pin(F), pin(E), upload)).toBe(false);
    expect(check(pin(X), pin('1'.repeat(40)), upload)).toBe(false);
    // A SHA that is the target on one side may not appear as the from-side change.
    expect(check(pin(T), pin(F), upload)).toBe(false);
  });

  test('assertion operator and whitespace edits fail closed', () => {
    expect(check(`  expect(w).toContain("actions/upload-artifact@${F}");`, `  expect(w).toContain("actions/upload-artifact@${T}");`)).toBe(true);
    expect(check(`  expect(w).toContain("actions/upload-artifact@${F}");`, `  expect(w).not.toContain("actions/upload-artifact@${T}");`)).toBe(false);
    expect(check(pin(F), pin(T).replace('",', '", '))).toBe(false);
    // Corrupt only the first quote, then every quote; both must be rejected.
    const quotedPin = pin(T);
    const firstQuote = quotedPin.indexOf('"');
    expect(firstQuote).toBeGreaterThanOrEqual(0);
    expect(check(pin(F), `${quotedPin.slice(0, firstQuote)}'${quotedPin.slice(firstQuote + 1)}`)).toBe(false);
    expect(check(pin(F), quotedPin.replaceAll('"', "'"))).toBe(false);
    expect(check(pin(F), pin(T.toUpperCase()))).toBe(false);
  });

  test('allowlist is explicit paths with a named verifier, nothing else', () => {
    expect([...GOVERNED_COMPANION_PATHS.keys()].sort()).toEqual([
      '.kiro/specs/crawler-pipeline-operational-readiness/platform-modernization-reconciliation.v1.json',
      'apps/web/tests-unit/account-deletion-contract.test.ts',
      'apps/web/tests-unit/nightly-regression-workflow.test.ts',
      'apps/web/tests-unit/release-workflow-governance-source.test.ts',
      'apps/web/tests-unit/review-media-sql-successor-workflow-contract.test.ts',
      'apps/web/tests-unit/youtube-kpi-snapshot-contract.test.ts',
      'backend/supabase/tests/test_g037_hosted_closure_workflow.py',
      'backend/supabase/tests/test_g038_workflow.py',
      'backend/supabase/tests/test_g040_prefix_recovery_workflow.py',
      'backend/utils/tests/test_gdrive_frame_inventory.py',
    ]);
    for (const path of GOVERNED_COMPANION_PATHS.keys()) expect(path.includes('*')).toBe(false);
  });
});

describe('governed reconciliation manifest verifier', () => {
  const repoRoot = resolve(import.meta.dir, '../../..');
  const manifestText = readFileSync(resolve(repoRoot, RECONCILIATION_MANIFEST_PATH), 'utf8');
  const base = JSON.parse(manifestText);
  const sha1 = (seed: string) => createHash('sha1').update(seed).digest('hex');
  const wf = base.entries.filter((e: { candidateInspectionPath: string; candidateGitBlobSha1: string | null }) =>
    e.candidateInspectionPath.startsWith('.github/workflows/') && e.candidateGitBlobSha1).slice(0, 2);
  const paths = wf.map((e: { candidateInspectionPath: string }) => e.candidateInspectionPath);
  const render = (doc: unknown) => `${JSON.stringify(doc, null, 2)}\n`;
  const rehash = (doc: any) => ({ ...doc, candidateContentSha256: manifestEntriesDigest(doc.entries) });
  const clone = () => JSON.parse(manifestText);
  const newBlobs = new Map<string, string>(paths.map((p: string, i: number) => [p, sha1(`new${i}`)]));
  const oldBlobs = new Map<string, string>(wf.map((e: any) => [e.candidateInspectionPath, e.candidateGitBlobSha1]));
  const goodAfter = () => {
    const doc = clone();
    for (const e of doc.entries) if (newBlobs.has(e.candidateInspectionPath)) e.candidateGitBlobSha1 = newBlobs.get(e.candidateInspectionPath);
    return rehash(doc);
  };
  const ctx = (over: Record<string, unknown> = {}) => ({
    modifiedFiles: new Set(paths), otherFiles: new Set<string>(), beforeBlobs: oldBlobs, afterBlobs: newBlobs, ...over,
  });
  const verify = (after: unknown, c = ctx()) => reconciliationManifestMirrorsOnly(manifestText, render(after), c);

  test('checked-in derived hash is reproduced from the Python builder bytes', () => {
    expect(manifestEntriesDigest(base.entries)).toBe(base.candidateContentSha256);
    const py = execFileSync('python3', ['-c',
      'import hashlib,json,sys;d=json.load(open(sys.argv[1]));'
      + 'print(hashlib.sha256(json.dumps(d["entries"],sort_keys=True,separators=(",",":")).encode()).hexdigest())',
      resolve(repoRoot, RECONCILIATION_MANIFEST_PATH)], { encoding: 'utf8' }).trim();
    expect(py).toBe(manifestEntriesDigest(base.entries));
  });

  test('canonical JSON matches Python for escapes, unicode and key order', () => {
    const sample = [{ z: 'a"b\\c\n\t\u0001\u007f', 'é': '한글 😀', a: [null, true, false, 0, -7, 12], b: {}, c: [] }];
    const py = execFileSync('python3', ['-c',
      'import json,sys;print(json.dumps(json.loads(sys.stdin.read()),sort_keys=True,separators=(",",":")),end="")'],
    { input: JSON.stringify(sample), encoding: 'utf8' });
    expect(pythonCanonicalJson(sample)).toBe(py);
  });

  test('exact blob-hash mirror with recomputed derived hash is admitted', () => {
    expect(verify(goodAfter())).toBe(true);
    expect(manifestTrackedPaths(manifestText, render(goodAfter()), new Set(paths))?.sort()).toEqual([...paths].sort());
  });

  test('every deviation fails closed', () => {
    const mutate = (fn: (d: any) => void, rehashIt = true) => { const d = goodAfter(); fn(d); return rehashIt ? rehash(d) : d; };
    const idx = (d: any) => d.entries.findIndex((e: any) => e.candidateInspectionPath === paths[0]);
    const cases: Array<[string, unknown]> = [
      ['stale derived hash', mutate(() => {}, false) && { ...goodAfter(), candidateContentSha256: base.candidateContentSha256 }],
      ['non-hash field changed', mutate((d) => { d.entries[idx(d)].disposition = 'source_exact_present'; })],
      ['contentState changed', mutate((d) => { d.entries[idx(d)].contentState = 'source_exact'; })],
      ['rationale changed', mutate((d) => { d.entries[idx(d)].rationale = 'x'; })],
      ['top-level count changed', mutate((d) => { d.sourceDeltaEntryCount += 1; })],
      ['baseCommit changed', mutate((d) => { d.baseCommit = 'f'.repeat(40); })],
      ['entry removed', mutate((d) => { d.entries.pop(); })],
      ['entry added', mutate((d) => { d.entries.push({ ...d.entries[0] }); })],
      ['entries reordered', mutate((d) => { [d.entries[0], d.entries[1]] = [d.entries[1], d.entries[0]]; })],
      ['duplicate entry identity', mutate((d) => { d.entries[2] = { ...d.entries[1] }; })],
      ['extra key on entry', mutate((d) => { d.entries[idx(d)].extra = 1; })],
      ['blob set to null', mutate((d) => { d.entries[idx(d)].candidateGitBlobSha1 = null; })],
      ['blob is not a sha1', mutate((d) => { d.entries[idx(d)].candidateGitBlobSha1 = 'abc'; })],
      ['wrong blob (not the verified head blob)', mutate((d) => { d.entries[idx(d)].candidateGitBlobSha1 = sha1('wrong'); })],
      ['inspection path non canonical', mutate((d) => { d.entries[idx(d)].candidateInspectionPath = `./${paths[0]}`; })],
      ['schema changed', mutate((d) => { d.schemaVersion = 4; })],
    ];
    for (const [name, doc] of cases) expect([name, verify(doc)]).toEqual([name, false]);
    // Context: file not modified by this PR, missing or wrong verified blobs.
    expect(verify(goodAfter(), ctx({ modifiedFiles: new Set([paths[0]]) }))).toBe(false);
    expect(verify(goodAfter(), ctx({ afterBlobs: new Map([[paths[0], newBlobs.get(paths[0])!]]) }))).toBe(false);
    expect(verify(goodAfter(), ctx({ beforeBlobs: new Map(oldBlobs).set(paths[0], sha1('other')) }))).toBe(false);
    expect(verify(goodAfter(), { modifiedFiles: new Set(paths) } as any)).toBe(false);
    // Tracked path removed/renamed by the PR; tracked modified path whose blobs are not both verified.
    expect(verify(goodAfter(), ctx({ otherFiles: new Set([paths[0]]) }))).toBe(false);
    const extra = base.entries.find((e: any) => !paths.includes(e.candidateInspectionPath) && e.candidateGitBlobSha1);
    expect(verify(goodAfter(), ctx({ modifiedFiles: new Set([...paths, extra.candidateInspectionPath]) }))).toBe(false);
    expect(verify(goodAfter(), ctx({ modifiedFiles: new Set([...paths, extra.candidateInspectionPath]),
      beforeBlobs: new Map(oldBlobs).set(extra.candidateInspectionPath, extra.candidateGitBlobSha1),
      afterBlobs: new Map(newBlobs).set(extra.candidateInspectionPath, extra.candidateGitBlobSha1) }))).toBe(true);
    // Formatting-only churn is not the builder rendering.
    expect(reconciliationManifestMirrorsOnly(manifestText, JSON.stringify(goodAfter()), ctx())).toBe(false);
    expect(reconciliationManifestMirrorsOnly(manifestText, JSON.stringify(goodAfter(), null, 4) + '\n', ctx())).toBe(false);
    // Convert only the first line break, then all of them; both must be rejected.
    const firstBreak = manifestText.indexOf('\n');
    expect(firstBreak).toBeGreaterThanOrEqual(0);
    expect(reconciliationManifestMirrorsOnly(`${manifestText.slice(0, firstBreak)}\r\n${manifestText.slice(firstBreak + 1)}`, render(goodAfter()), ctx())).toBe(false);
    expect(reconciliationManifestMirrorsOnly(manifestText.replaceAll('\n', '\r\n'), render(goodAfter()), ctx())).toBe(false);
    // No change at all, invalid JSON, wrong kind.
    expect(verify(base)).toBe(false);
    expect(reconciliationManifestMirrorsOnly(manifestText, '{', ctx())).toBe(false);
    expect(reconciliationManifestMirrorsOnly(manifestText, render({ ...goodAfter(), kind: 'x' }), ctx())).toBe(false);
  });

  test('descriptor admits the manifest only inside a bumped Actions candidate with verified blob evidence', () => {
    const F = '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a';
    const T = 'cf430e030ddbb5b0abf93d22962f4752f3646cd9';
    const wfFiles = paths.map((p: string) => ({ filename: p, status: 'modified',
      patch: `-      - uses: actions/upload-artifact@${F} # actions/upload-artifact@v4.3.3\n+      - uses: actions/upload-artifact@${T} # actions/upload-artifact@v7.0.2` }));
    const files = [...wfFiles, { filename: RECONCILIATION_MANIFEST_PATH, status: 'modified' }];
    const content = { before: manifestText, after: render(goodAfter()), beforeBlobs: oldBlobs, afterBlobs: newBlobs };
    const ok = descriptor(pr, files, {}, { [RECONCILIATION_MANIFEST_PATH]: content });
    expect(ok.metadataIncomplete).toBe(false);
    expect(ok.packages.length).toBe(paths.length);
    const bad = descriptor(pr, files, {}, { [RECONCILIATION_MANIFEST_PATH]: { ...content, afterBlobs: new Map() } });
    expect(bad.metadataIncomplete).toBe(true);
    const missing = descriptor(pr, files, {}, {});
    expect(missing.metadataIncomplete).toBe(true);
    const added = descriptor(pr, files.map((f) => f.filename === RECONCILIATION_MANIFEST_PATH ? { ...f, status: 'added' } : f), {},
      { [RECONCILIATION_MANIFEST_PATH]: content });
    expect(added.metadataIncomplete).toBe(true);
    const alone = descriptor(pr, [{ filename: RECONCILIATION_MANIFEST_PATH, status: 'modified' }], {},
      { [RECONCILIATION_MANIFEST_PATH]: content });
    expect(alone.metadataIncomplete).toBe(true);
  });
});
