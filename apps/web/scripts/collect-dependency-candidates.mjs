#!/usr/bin/env node
// Read-only GitHub metadata; never check out or execute candidate content.
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { UNITS } from './verify-dependency-freshness.mjs';

const VERSION = /^[~^<>=v ]*\d+(?:\.\d+){1,3}(?:[-+][\w.-]+)?$/;
const LOCKFILE_LIMIT = 10 * 1024 * 1024;
export function lockfileChanges(before, after) {
  const valid = (lock) => [2, 3].includes(lock?.lockfileVersion)
    && lock.packages && typeof lock.packages === 'object' && !Array.isArray(lock.packages);
  if (!valid(before) || !valid(after)) return { packages: [], incomplete: true };
  const packages = [];
  let incomplete = false;
  for (const path of new Set([...Object.keys(before.packages), ...Object.keys(after.packages)])) {
    if (path === '') continue;
    const old = before.packages[path]; const current = after.packages[path];
    if (old?.link && current?.link) continue;
    if (!old || !current) { incomplete = true; continue; }
    if (old.version === current.version) continue;
    const name = path.split('node_modules/').at(-1);
    if (!path.includes('node_modules/') || !/^(@[\w.-]+\/)?[\w.-]+$/.test(name)
      || typeof old.version !== 'string' || typeof current.version !== 'string'
      || !VERSION.test(old.version) || !VERSION.test(current.version)) {
      incomplete = true; continue;
    }
    packages.push({ name, fromVersion: old.version, toVersion: current.version });
  }
  return { packages, incomplete };
}


// Narrow admission for explicitly governed companion files that must mirror
// manifest version pins (currently the nightly-regression workflow contract
// test). Admission always compares verified complete merge-base/head contents:
// an API patch string is only a rendering and can be omitted or truncated, so
// it is never trusted as evidence of the whole change. Fail-closed: anything
// outside the allowlist, any non-mirror change, any missing evidence keeps
// metadataIncomplete = true.
export const ACTION_PIN_MIRROR = 'action-pin-mirror';
export const RECONCILIATION_MANIFEST = 'reconciliation-manifest';
export const RECONCILIATION_MANIFEST_PATH =
  '.kiro/specs/crawler-pipeline-operational-readiness/platform-modernization-reconciliation.v1.json';
// Explicit paths only, no globs. Every entry names the one verifier that may
// admit it; a path that is absent here is never admitted.
export const GOVERNED_COMPANION_PATHS = new Map([
  ['apps/web/tests-unit/nightly-regression-workflow.test.ts', ACTION_PIN_MIRROR],
  ['apps/web/tests-unit/release-workflow-governance-source.test.ts', ACTION_PIN_MIRROR],
  ['apps/web/tests-unit/account-deletion-contract.test.ts', ACTION_PIN_MIRROR],
  ['apps/web/tests-unit/review-media-sql-successor-workflow-contract.test.ts', ACTION_PIN_MIRROR],
  ['apps/web/tests-unit/youtube-kpi-snapshot-contract.test.ts', ACTION_PIN_MIRROR],
  ['backend/supabase/tests/test_g037_hosted_closure_workflow.py', ACTION_PIN_MIRROR],
  ['backend/supabase/tests/test_g038_workflow.py', ACTION_PIN_MIRROR],
  ['backend/supabase/tests/test_g040_prefix_recovery_workflow.py', ACTION_PIN_MIRROR],
  ['backend/utils/tests/test_gdrive_frame_inventory.py', ACTION_PIN_MIRROR],
  [RECONCILIATION_MANIFEST_PATH, RECONCILIATION_MANIFEST],
]);

// "[name@]vX.Y.Z" version comment written by Dependabot next to a pinned action.
const ACTION_COMMENT_TAG = /^(?:([\w./-]+)@)?(v\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/;
const COMPANION_VERSION_TOKEN = /\d+\.\d+\.\d+(?:[-+][\w.-]+)?/g;
const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stripRange = (value) => String(value).replace(/^[~^<>=v ]+/, '');

function companionLineMirrorsOnly(before, after, pairSet, fromSet, toSet, byName) {
  // Every admitted change must be anchored to at least one bumped package
  // named on the line, and must mirror that package's own pair.
  const named = byName.filter((pkg) => before.includes(pkg.name) || after.includes(pkg.name));
  if (named.length === 0) return false;
  const names = [...new Set(named.map((pkg) => pkg.name))];
  // Each named action must have one of its own exact pairs present on this line
  // (from on the before side, to on the after side).
  for (const name of names) {
    if (!byName.some((pkg) => pkg.name === name
      && before.includes(stripRange(pkg.fromVersion)) && after.includes(stripRange(pkg.toVersion)))) return false;
  }
  // Exact refs that are not semver (full-length commit SHAs used by pinned
  // GitHub Actions) are masked only as the complete string "<name>@<ref>", and
  // the version comment only as "# <same name>@<tag>". The name must start at a
  // token boundary (so "evil/actions/x" never matches "actions/x") and the ref
  // must end at one. A bare SHA, a tuple or a loose major tag is never admitted
  // by name presence alone; those shapes are refactored to exact pin records
  // before a bot bump instead. One action can carry several historical pins
  // (several from-refs), so every masked occurrence is recorded in order and
  // must be one exact (from, to) pair of that same action. The k-th masked
  // occurrence before must pair with the k-th after; counts must match.
  const pairKeys = new Set();
  const tagPairKeys = new Set();
  for (const pkg of byName) {
    pairKeys.add([pkg.name, stripRange(pkg.fromVersion), stripRange(pkg.toVersion)].join('\0'));
    if (pkg.fromTag !== undefined && pkg.toTag !== undefined) tagPairKeys.add([pkg.name, pkg.fromTag, pkg.toTag].join('\0'));
  }
  const mask = (text, side) => {
    const refKey = side === 'before' ? 'fromVersion' : 'toVersion';
    const tagKey = side === 'before' ? 'fromTag' : 'toTag';
    const refSeq = []; const tagSeq = []; let out = text;
    for (const name of names) {
      const refs = [...new Set(byName.filter((pkg) => pkg.name === name)
        .map((pkg) => stripRange(pkg[refKey])).filter((ref) => /^[0-9a-f]{40}$/.test(ref)))];
      if (refs.length > 0) {
        out = out.replace(new RegExp(`(?<![\\w./@-])${escapeRegExp(name)}@(${refs.join('|')})(?![\\w])`, 'g'),
          (m, ref) => { refSeq.push([name, ref]); return `${name}@ \0 `; });
      }
      const tags = [...new Set(byName.filter((pkg) => pkg.name === name && pkg[tagKey] !== undefined)
        .map((pkg) => pkg[tagKey]))];
      if (tags.length > 0) {
        out = out.replace(new RegExp(`# ${escapeRegExp(name)}@(${tags.map(escapeRegExp).join('|')})(?![\\w.-])`, 'g'),
          (m, tag) => { tagSeq.push([name, tag]); return `# ${name}@ \u0001 `; });
      }
    }
    return { out, refSeq, tagSeq };
  };
  const b = mask(before, 'before'); const a = mask(after, 'after');
  const sameSeq = (x, y, keys) => x.length === y.length
    && x.every(([name, ref], i) => y[i][0] === name && keys.has([name, ref, y[i][1]].join('\0')));
  if (!sameSeq(b.refSeq, a.refSeq, pairKeys) || !sameSeq(b.tagSeq, a.tagSeq, tagPairKeys)) return false;
  const exactBefore = b.out;
  const exactAfter = a.out;
  const removed = exactBefore.match(COMPANION_VERSION_TOKEN) ?? [];
  const added = exactAfter.match(COMPANION_VERSION_TOKEN) ?? [];
  if (removed.length !== added.length) return false;
  const maskedBefore = exactBefore.replace(COMPANION_VERSION_TOKEN, (tok) => (fromSet.has(tok) ? ' \0 ' : tok));
  const maskedAfter = exactAfter.replace(COMPANION_VERSION_TOKEN, (tok) => (toSet.has(tok) ? ' \0 ' : tok));
  if (maskedBefore !== maskedAfter) return false;
  // Every changed token must be one package's exact from->to pair. Pairs stay
  // identity-bound: two packages can share a from-version with different
  // to-versions, so a from-keyed map would lose pairs and flip with ordering.
  for (let i = 0; i < removed.length; i++) {
    if (removed[i] === added[i]) continue;
    if (!pairSet.has(`${removed[i]}\0${added[i]}`)) return false;
  }
  return true;
}

const companionPairs = (packages) => ({
  pairSet: new Set(packages.map((pkg) => `${stripRange(pkg.fromVersion)}\0${stripRange(pkg.toVersion)}`)),
  fromSet: new Set(packages.map((pkg) => stripRange(pkg.fromVersion))),
  toSet: new Set(packages.map((pkg) => stripRange(pkg.toVersion))),
  byName: packages,
});

export function companionContentMirrorsOnly(before, after, packages) {
  if (typeof before !== 'string' || typeof after !== 'string'
    || !Array.isArray(packages) || packages.length === 0) return false;
  const { pairSet, fromSet, toSet, byName } = companionPairs(packages);
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  if (beforeLines.length !== afterLines.length) return false;
  let changes = 0;
  for (let i = 0; i < beforeLines.length; i++) {
    if (beforeLines[i] === afterLines[i]) continue;
    changes += 1;
    if (!companionLineMirrorsOnly(beforeLines[i], afterLines[i], pairSet, fromSet, toSet, byName)) return false;
  }
  return changes > 0;
}


// ---- Reconciliation manifest: exact derived-artifact verifier ----------------
// The manifest is produced by backend/bin/build_platform_modernization_
// reconciliation.py. Its only legitimate candidate-side change is the git blob
// SHA1 of a workflow file the same PR modified, plus the derived
// candidateContentSha256 over the entries. The hash below must reproduce the
// Python builder bytes exactly:
//   hashlib.sha256(json.dumps(entries, sort_keys=True, separators=(",", ":"))).
const codePointCompare = (l, r) => {
  const a = Array.from(l); const b = Array.from(r);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const d = a[i].codePointAt(0) - b[i].codePointAt(0);
    if (d !== 0) return d;
  }
  return a.length - b.length;
};
const pythonJsonString = (value) => JSON.stringify(value)
  .replace(/[^\x20-\x7e]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
export function pythonCanonicalJson(value) {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('manifest_number_unsupported');
    return String(value);
  }
  if (typeof value === 'string') return pythonJsonString(value);
  if (Array.isArray(value)) return `[${value.map(pythonCanonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort(codePointCompare)
      .map((key) => `${pythonJsonString(key)}:${pythonCanonicalJson(value[key])}`).join(',')}}`;
  }
  throw new Error('manifest_value_unsupported');
}
export const manifestEntriesDigest = (entries) =>
  createHash('sha256').update(pythonCanonicalJson(entries)).digest('hex');

const GIT_BLOB_SHA1 = /^[0-9a-f]{40}$/;
const canonicalRepoPath = (value) => typeof value === 'string' && value.length > 0
  && !value.startsWith('/') && !value.includes('\\') && !value.includes('//')
  && value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
const parseManifest = (text) => {
  let doc;
  try { doc = JSON.parse(text); } catch { return null; }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return null;
  if (doc.schemaVersion !== 3 || doc.kind !== 'platform_modernization_reconciliation'
    || !Array.isArray(doc.entries) || !/^[0-9a-f]{64}$/.test(doc.candidateContentSha256 ?? '')) return null;
  if (doc.entries.some((entry) => entry === null || typeof entry !== 'object' || Array.isArray(entry))) return null;
  return doc;
};
const entryIdentity = (entry) => pythonCanonicalJson([entry.sourceStatus, entry.basePath, entry.sourcePath]);

// Tracked paths (head manifest) that this PR touches in any way; used to
// prefetch verified blob bytes. Null when the pair is not a comparable manifest.
export function manifestTrackedPaths(before, after, touchedFiles) {
  const b = parseManifest(before); const a = parseManifest(after);
  if (!b || !a || !(touchedFiles instanceof Set)) return null;
  const paths = new Set();
  for (const entry of [...b.entries, ...a.entries]) {
    if (typeof entry.candidateInspectionPath !== 'string') continue;
    if (touchedFiles.has(entry.candidateInspectionPath)) paths.add(entry.candidateInspectionPath);
  }
  return [...paths];
}

// context: { modifiedFiles: Set<path modified by this PR>,
//            otherFiles: Set<path added/removed/renamed/copied by this PR>,
//            beforeBlobs / afterBlobs: Map<path, git blob sha1 computed from the
//            verified merge-base / head bytes> }
// Rendering must be the builder's own (json.dumps indent=2, trailing newline),
// so formatting-only churn is never admitted.
const renderedLikeBuilder = (text, doc) => text === `${JSON.stringify(doc, null, 2)}\n`;
export function reconciliationManifestMirrorsOnly(before, after, context) {
  const { modifiedFiles, otherFiles, beforeBlobs, afterBlobs } = context ?? {};
  if (!(modifiedFiles instanceof Set) || !(otherFiles instanceof Set)
    || !(beforeBlobs instanceof Map) || !(afterBlobs instanceof Map)) return false;
  const b = parseManifest(before); const a = parseManifest(after);
  if (!b || !a) return false;
  try {
    if (!renderedLikeBuilder(before, b) || !renderedLikeBuilder(after, a)) return false;
    // Both sides must be self-consistent with the builder's derived hash.
    if (manifestEntriesDigest(b.entries) !== b.candidateContentSha256
      || manifestEntriesDigest(a.entries) !== a.candidateContentSha256) return false;
    const topKeys = Object.keys(a).sort(codePointCompare);
    if (pythonCanonicalJson(topKeys) !== pythonCanonicalJson(Object.keys(b).sort(codePointCompare))) return false;
    for (const key of topKeys) {
      if (key === 'entries' || key === 'candidateContentSha256') continue;
      if (pythonCanonicalJson(a[key]) !== pythonCanonicalJson(b[key])) return false;
    }
    if (a.entries.length !== b.entries.length) return false;
    const seen = new Set();
    let changes = 0;
    for (let i = 0; i < a.entries.length; i++) {
      const old = b.entries[i]; const current = a.entries[i];
      const identity = entryIdentity(current);
      if (identity !== entryIdentity(old) || seen.has(identity)) return false;
      seen.add(identity);
      const keys = Object.keys(current).sort(codePointCompare);
      if (pythonCanonicalJson(keys) !== pythonCanonicalJson(Object.keys(old).sort(codePointCompare))) return false;
      for (const key of keys) {
        if (key === 'candidateGitBlobSha1') continue;
        if (pythonCanonicalJson(current[key]) !== pythonCanonicalJson(old[key])) return false;
      }
      const tracked = current.candidateInspectionPath;
      // A tracked path this PR deletes, renames or re-adds cannot be mirrored.
      if (otherFiles.has(tracked)) return false;
      // Every tracked path this PR modifies must carry the exact verified blobs
      // on both sides, whether or not the manifest changed it.
      if (modifiedFiles.has(tracked)
        && (old.candidateGitBlobSha1 !== beforeBlobs.get(tracked)
          || current.candidateGitBlobSha1 !== afterBlobs.get(tracked))) return false;
      if (old.candidateGitBlobSha1 === current.candidateGitBlobSha1) continue;
      changes += 1;
      const path = current.candidateInspectionPath;
      if (!canonicalRepoPath(path) || !modifiedFiles.has(path)
        || current.candidatePresentAtInspectionPath !== true
        || !GIT_BLOB_SHA1.test(old.candidateGitBlobSha1 ?? '')
        || !GIT_BLOB_SHA1.test(current.candidateGitBlobSha1 ?? '')
        || old.candidateGitBlobSha1 !== beforeBlobs.get(path)
        || current.candidateGitBlobSha1 !== afterBlobs.get(path)) return false;
    }
    return changes > 0;
  } catch { return false; }
}

export function descriptor(pr, files, lockfiles = {}, companionContents = {}) {
  const units = new Set();
  const packages = [];
  let incomplete = files.length === 0;
  const companionFiles = [];
  for (const file of files) {
    const path = file.filename;
    if (/package-lock\.json$/.test(path)) {
      const unit = UNITS.find((u) => u.ecosystem === 'npm'
        && path === `${u.directory.slice(1)}/package-lock.json`);
      if (!unit) { incomplete = true; continue; }
      if (files.some((entry) => entry.filename === `${unit.directory.slice(1)}/package.json`)) continue;
      units.add(unit.directory);
      const pair = lockfiles[path];
      const changes = lockfileChanges(pair?.before, pair?.after);
      packages.push(...changes.packages);
      incomplete ||= file.status !== 'modified' || changes.incomplete;
      continue;
    }
    if (/bun\.lock$|Cargo\.lock$/.test(path)) continue;
    const unit = UNITS.find((u) => u.ecosystem === 'github-actions'
      ? path.startsWith('.github/workflows/')
      : path.startsWith(`${u.directory.slice(1)}/`) && (
        u.ecosystem === 'npm' ? path === `${u.directory.slice(1)}/package.json`
          : u.ecosystem === 'cargo' ? /Cargo\.toml$/.test(path)
            : /requirements[^/]*\.txt$/.test(path)));
    if (!unit) {
      if (GOVERNED_COMPANION_PATHS.has(path)) { companionFiles.push(file); continue; }
      incomplete = true; continue;
    }
    if (file.status !== 'modified' || typeof file.patch !== 'string') {
      incomplete = true; continue;
    }
    units.add(unit.directory);
    const before = new Map(); const after = new Map();
    const beforeTag = new Map(); const afterTag = new Map();
    for (const line of file.patch.split('\n')) {
      if (!/^[+-](?![+-])/.test(line)) continue;
      const raw = line.slice(1).trim(); let match;
      if (unit.ecosystem === 'npm') match = raw.match(/^"([@\w./-]+)"\s*:\s*"([^"]+)"[,]?$/);
      else if (unit.ecosystem === 'pip') match = raw.match(/^([\w.-]+)(?:\[[\w,.-]+\])?==([^ #;]+)(?:\s*[#;].*)?$/);
      else if (unit.ecosystem === 'cargo') match = raw.match(/^([\w-]+)\s*=\s*(?:\{\s*version\s*=\s*)?"([^"]+)"/);
      else match = raw.match(/^(?:-\s*)?uses:\s*([\w./-]+)@([\w.-]+)(?:\s+#\s*(.*))?$/);
      if (!match || (unit.ecosystem !== 'github-actions' && !VERSION.test(match[2]))) continue;
      (line[0] === '-' ? before : after).set(match[1], match[2]);
      // Version comment of a pinned action: bound to this action only. A
      // comment that names another action or is not a plain tag is ignored.
      if (unit.ecosystem === 'github-actions') {
        const tag = (match[3] ?? '').trim().match(ACTION_COMMENT_TAG);
        if (tag && (tag[1] === undefined || tag[1] === match[1])) {
          (line[0] === '-' ? beforeTag : afterTag).set(match[1], tag[2]);
        }
      }
    }
    for (const [name, toVersion] of after) {
      const fromVersion = before.get(name);
      if (!fromVersion) { incomplete = true; continue; }
      if (fromVersion !== toVersion) {
        const pkg = { name, fromVersion, toVersion };
        const fromTag = beforeTag.get(name); const toTag = afterTag.get(name);
        if (fromTag && toTag && fromTag !== toTag) Object.assign(pkg, { fromTag, toTag });
        packages.push(pkg);
      }
    }
    if (after.size === 0 || [...before.keys()].some((name) => !after.has(name))) incomplete = true;
  }
  // Companion pass: an allowlisted file is admitted only when its complete
  // verified base/head contents mirror manifest from/to pairs exactly.
  // Anything else fails closed.
  const modifiedFiles = new Set(files.filter((f) => f.status === 'modified').map((f) => f.filename));
  const otherFiles = new Set(files.filter((f) => f.status !== 'modified').map((f) => f.filename));
  for (const file of companionFiles) {
    if (file.status !== 'modified' || packages.length === 0) { incomplete = true; continue; }
    const content = companionContents[file.filename];
    const kind = GOVERNED_COMPANION_PATHS.get(file.filename);
    const admitted = kind === ACTION_PIN_MIRROR
      ? companionContentMirrorsOnly(content?.before, content?.after, packages)
      : kind === RECONCILIATION_MANIFEST
        ? reconciliationManifestMirrorsOnly(content?.before, content?.after,
          { modifiedFiles, otherFiles, beforeBlobs: content?.beforeBlobs, afterBlobs: content?.afterBlobs })
        : false;
    if (!admitted) incomplete = true;
  }
  return { number: pr.number, headSha: pr.head.sha, targetBranch: pr.base.ref,
    unit: units.size === 1 ? [...units][0] : 'unknown', packages,
    metadataIncomplete: incomplete || units.size !== 1 || packages.length === 0 };
}

export async function collectCandidates(request, checkedCommit = null) {
  if (checkedCommit !== null && !/^[0-9a-f]{40}$/.test(checkedCommit))
    throw new Error('checked_commit_invalid');
  const candidates = [];
  for (let page = 1; page <= 10; page++) {
    const prs = await request(`/pulls?state=open&per_page=100&page=${page}`);
    if (!Array.isArray(prs) || prs.length > 100) throw new Error('candidate_metadata_unavailable');
    for (const pr of prs) {
      if (pr.user?.login !== 'dependabot[bot]') continue;
      if (checkedCommit !== null && pr.head?.sha !== checkedCommit) continue;
      const files = [];
      for (let fp = 1; fp <= 3; fp++) {
        const batch = await request(`/pulls/${pr.number}/files?per_page=100&page=${fp}`);
        if (!Array.isArray(batch) || batch.length > 100) throw new Error('candidate_metadata_unavailable');
        files.push(...batch);
        if (batch.length < 100) break;
        if (fp === 3) throw new Error('candidate_metadata_limit');
      }
      const lockfiles = {};
      let mergeBase = null;
      const ensureMergeBase = async () => {
        if (mergeBase !== null) return mergeBase;
        if (![pr.base?.sha, pr.head?.sha].every((sha) => /^[0-9a-f]{40}$/.test(sha ?? '')))
          throw new Error('candidate_metadata_unavailable');
        const comparison = await request(`/compare/${pr.base.sha}...${pr.head.sha}?per_page=1`);
        if (comparison?.base_commit?.sha !== pr.base.sha
          || !/^[0-9a-f]{40}$/.test(comparison?.merge_base_commit?.sha ?? ''))
          throw new Error('candidate_metadata_unavailable');
        mergeBase = comparison.merge_base_commit.sha;
        return mergeBase;
      };
      const fetchVerifiedBytes = async (filename, sha) => {
        if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error('candidate_metadata_unavailable');
        const blob = await request(`/contents/${filename}?ref=${sha}`);
        if (blob?.encoding !== 'base64' || typeof blob.content !== 'string'
          || !Number.isSafeInteger(blob.size) || blob.size < 0 || blob.size > LOCKFILE_LIMIT
          || blob.content.length > Math.ceil(LOCKFILE_LIMIT / 3) * 4 * 1.1)
          throw new Error('candidate_metadata_unavailable');
        const bytes = Buffer.from(blob.content, 'base64');
        const digest = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
        if (bytes.length !== blob.size || digest !== blob.sha) throw new Error('candidate_metadata_unavailable');
        return bytes;
      };
      for (const file of files) {
        const unit = UNITS.find((u) => u.ecosystem === 'npm'
          && file.filename === `${u.directory.slice(1)}/package-lock.json`);
        if (!unit || file.status !== 'modified'
          || files.some((entry) => entry.filename === `${unit.directory.slice(1)}/package.json`)) continue;
        const base = await ensureMergeBase();
        const pair = [];
        for (const sha of [base, pr.head?.sha]) {
          pair.push(JSON.parse((await fetchVerifiedBytes(file.filename, sha)).toString('utf8')));
        }
        lockfiles[file.filename] = { before: pair[0], after: pair[1] };
      }
      // Governed companion files are always verified from complete merge-base
      // /head contents, whether or not the API supplied a patch string;
      // unavailable evidence fails closed inside the descriptor.
      const companionContents = {};
      const gitBlobSha1 = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      for (const file of files) {
        if (!GOVERNED_COMPANION_PATHS.has(file.filename) || file.status !== 'modified') continue;
        const base = await ensureMergeBase();
        const content = {
          before: (await fetchVerifiedBytes(file.filename, base)).toString('utf8'),
          after: (await fetchVerifiedBytes(file.filename, pr.head?.sha)).toString('utf8'),
        };
        if (GOVERNED_COMPANION_PATHS.get(file.filename) === RECONCILIATION_MANIFEST) {
          // Blob SHA1s are recomputed from verified bytes of the tracked files
          // this PR modifies (never trusted from the manifest or API patch).
          const touched = new Set(files.map((f) => f.filename));
          const tracked = manifestTrackedPaths(content.before, content.after, touched) ?? [];
          const modified = new Set(files.filter((f) => f.status === 'modified').map((f) => f.filename));
          content.beforeBlobs = new Map(); content.afterBlobs = new Map();
          if (tracked.length <= 100) {
            for (const path of tracked) {
              if (!modified.has(path)) continue;
              content.beforeBlobs.set(path, gitBlobSha1(await fetchVerifiedBytes(path, base)));
              content.afterBlobs.set(path, gitBlobSha1(await fetchVerifiedBytes(path, pr.head?.sha)));
            }
          }
        }
        companionContents[file.filename] = content;
      }
      candidates.push(descriptor(pr, files, lockfiles, companionContents));
    }
    if (prs.length < 100) return candidates;
  }
  throw new Error('candidate_metadata_limit');
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !process.env.GH_TOKEN)
    throw new Error('candidate_metadata_unavailable');
  const checkedCommit = process.env.GITHUB_EVENT_NAME === 'pull_request'
    ? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() : null;
  const candidates = await collectCandidates(async (path) => {
    const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
      headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(30000), redirect: 'error',
    });
    if (!response.ok) throw new Error('candidate_metadata_unavailable');
    return response.json();
  }, checkedCommit);
  if (!process.argv[2]) throw new Error('candidate_output_required');
  await writeFile(process.argv[2], `${JSON.stringify(candidates)}\n`, { mode: 0o600 });
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(() => {
  process.stderr.write('candidate_metadata_unavailable\n'); process.exitCode = 1;
});
