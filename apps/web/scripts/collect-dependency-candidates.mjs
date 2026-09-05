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

export function descriptor(pr, files, lockfiles = {}) {
  const units = new Set();
  const packages = [];
  let incomplete = files.length === 0;
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
    if (!unit || file.status !== 'modified' || typeof file.patch !== 'string') {
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
      for (const file of files) {
        const unit = UNITS.find((u) => u.ecosystem === 'npm'
          && file.filename === `${u.directory.slice(1)}/package-lock.json`);
        if (!unit || file.status !== 'modified'
          || files.some((entry) => entry.filename === `${unit.directory.slice(1)}/package.json`)) continue;
        if (mergeBase === null) {
          if (![pr.base?.sha, pr.head?.sha].every((sha) => /^[0-9a-f]{40}$/.test(sha ?? '')))
            throw new Error('candidate_metadata_unavailable');
          const comparison = await request(`/compare/${pr.base.sha}...${pr.head.sha}?per_page=1`);
          if (comparison?.base_commit?.sha !== pr.base.sha
            || !/^[0-9a-f]{40}$/.test(comparison?.merge_base_commit?.sha ?? ''))
            throw new Error('candidate_metadata_unavailable');
          mergeBase = comparison.merge_base_commit.sha;
        }
        const pair = [];
        for (const sha of [mergeBase, pr.head?.sha]) {
          if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error('candidate_metadata_unavailable');
          const blob = await request(`/contents/${file.filename}?ref=${sha}`);
          if (blob?.encoding !== 'base64' || typeof blob.content !== 'string'
            || !Number.isSafeInteger(blob.size) || blob.size < 0 || blob.size > LOCKFILE_LIMIT
            || blob.content.length > Math.ceil(LOCKFILE_LIMIT / 3) * 4 * 1.1)
            throw new Error('candidate_metadata_unavailable');
          const bytes = Buffer.from(blob.content, 'base64');
          const digest = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
          if (bytes.length !== blob.size || digest !== blob.sha) throw new Error('candidate_metadata_unavailable');
          pair.push(JSON.parse(bytes.toString('utf8')));
        }
        lockfiles[file.filename] = { before: pair[0], after: pair[1] };
      }
      candidates.push(descriptor(pr, files, lockfiles));
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
