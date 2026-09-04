#!/usr/bin/env node
// Read-only GitHub metadata; never check out or execute candidate content.
import { writeFile } from 'node:fs/promises';
import { UNITS } from './verify-dependency-freshness.mjs';

const VERSION = /^[~^<>=v ]*\d+(?:\.\d+){1,3}(?:[-+][\w.-]+)?$/;
export function descriptor(pr, files) {
  const units = new Set();
  const packages = [];
  let incomplete = files.length === 0;
  for (const file of files) {
    const path = file.filename;
    if (/package-lock\.json$|bun\.lock$|Cargo\.lock$/.test(path)) continue;
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

export async function collectCandidates(request) {
  const candidates = [];
  for (let page = 1; page <= 10; page++) {
    const prs = await request(`/pulls?state=open&per_page=100&page=${page}`);
    if (!Array.isArray(prs) || prs.length > 100) throw new Error('candidate_metadata_unavailable');
    for (const pr of prs) {
      if (pr.user?.login !== 'dependabot[bot]') continue;
      const files = [];
      for (let fp = 1; fp <= 3; fp++) {
        const batch = await request(`/pulls/${pr.number}/files?per_page=100&page=${fp}`);
        if (!Array.isArray(batch) || batch.length > 100) throw new Error('candidate_metadata_unavailable');
        files.push(...batch);
        if (batch.length < 100) break;
        if (fp === 3) throw new Error('candidate_metadata_limit');
      }
      candidates.push(descriptor(pr, files));
    }
    if (prs.length < 100) return candidates;
  }
  throw new Error('candidate_metadata_limit');
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !process.env.GH_TOKEN)
    throw new Error('candidate_metadata_unavailable');
  const candidates = await collectCandidates(async (path) => {
    const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
      headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(30000), redirect: 'error',
    });
    if (!response.ok) throw new Error('candidate_metadata_unavailable');
    return response.json();
  });
  if (!process.argv[2]) throw new Error('candidate_output_required');
  await writeFile(process.argv[2], `${JSON.stringify(candidates)}\n`, { mode: 0o600 });
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(() => {
  process.stderr.write('candidate_metadata_unavailable\n'); process.exitCode = 1;
});
