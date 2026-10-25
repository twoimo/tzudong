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
export const GOVERNED_COMPANION_PATHS = new Set([
  'apps/web/tests-unit/nightly-regression-workflow.test.ts',
]);

const COMPANION_VERSION_TOKEN = /\d+\.\d+\.\d+(?:[-+][\w.-]+)?/g;
const stripRange = (value) => String(value).replace(/^[~^<>=v ]+/, '');

function companionLineMirrorsOnly(before, after, pairSet, fromSet, toSet, byName) {
  const removed = before.match(COMPANION_VERSION_TOKEN) ?? [];
  const added = after.match(COMPANION_VERSION_TOKEN) ?? [];
  if (removed.length !== added.length) return false;
  // Every admitted change must be anchored to at least one bumped package
  // named on the line, and must mirror that package's own pair.
  const named = byName.filter((pkg) => before.includes(pkg.name) || after.includes(pkg.name));
  if (named.length === 0) return false;
  for (const pkg of named) {
    if (!before.includes(stripRange(pkg.fromVersion)) || !after.includes(stripRange(pkg.toVersion))) {
      return false;
    }
  }
  // Non-version text must be identical once mirrored tokens are masked.
  const maskedBefore = before.replace(COMPANION_VERSION_TOKEN, (tok) => (fromSet.has(tok) ? ' \0 ' : tok));
  const maskedAfter = after.replace(COMPANION_VERSION_TOKEN, (tok) => (toSet.has(tok) ? ' \0 ' : tok));
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
    for (const line of file.patch.split('\n')) {
      if (!/^[+-](?![+-])/.test(line)) continue;
      const raw = line.slice(1).trim(); let match;
      if (unit.ecosystem === 'npm') match = raw.match(/^"([@\w./-]+)"\s*:\s*"([^"]+)"[,]?$/);
      else if (unit.ecosystem === 'pip') match = raw.match(/^([\w.-]+)(?:\[[\w,.-]+\])?==([^ #;]+)(?:\s*[#;].*)?$/);
      else if (unit.ecosystem === 'cargo') match = raw.match(/^([\w-]+)\s*=\s*(?:\{\s*version\s*=\s*)?"([^"]+)"/);
      else match = raw.match(/^(?:-\s*)?uses:\s*([\w./-]+)@([\w.-]+)(?:\s+#.*)?$/);
      if (!match || (unit.ecosystem !== 'github-actions' && !VERSION.test(match[2]))) continue;
      (line[0] === '-' ? before : after).set(match[1], match[2]);
    }
    for (const [name, toVersion] of after) {
      const fromVersion = before.get(name);
      if (!fromVersion) { incomplete = true; continue; }
      if (fromVersion !== toVersion) packages.push({ name, fromVersion, toVersion });
    }
    if (after.size === 0 || [...before.keys()].some((name) => !after.has(name))) incomplete = true;
  }
  // Companion pass: an allowlisted file is admitted only when its complete
  // verified base/head contents mirror manifest from/to pairs exactly.
  // Anything else fails closed.
  for (const file of companionFiles) {
    if (file.status !== 'modified' || packages.length === 0) { incomplete = true; continue; }
    if (!companionContentMirrorsOnly(companionContents[file.filename]?.before,
      companionContents[file.filename]?.after, packages)) incomplete = true;
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
      for (const file of files) {
        if (!GOVERNED_COMPANION_PATHS.has(file.filename) || file.status !== 'modified') continue;
        const base = await ensureMergeBase();
        companionContents[file.filename] = {
          before: (await fetchVerifiedBytes(file.filename, base)).toString('utf8'),
          after: (await fetchVerifiedBytes(file.filename, pr.head?.sha)).toString('utf8'),
        };
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
