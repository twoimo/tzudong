import { appendFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { classifyPaths as classifyBenchmarkPaths } from './classify-ci-benchmark.mjs';

const SHA = /^(?!0{40}$)[0-9a-f]{40}$/;
export const SCOPE_FLAGS = Object.freeze(['authority', 'unit', 'build', 'compatibility', 'install', 'admin']);
export const SCOPE_REASONS = Object.freeze([
  'DOCUMENTATION_ONLY', 'WEB_CHANGE', 'SOURCE_CONTRACT_CHANGE', 'MIXED_CHANGE',
  'BENCHMARK_INPUT', 'WEB_TOOLING_CHANGE', 'CI_POLICY_CHANGE', 'UNKNOWN_INPUT',
  'PATH_INVALID', 'DIFF_UNAVAILABLE', 'EVENT_UNAVAILABLE', 'SOURCE_INVALID',
  'SOURCE_MISMATCH', 'SOURCE_UNAVAILABLE', 'PROTECTED_PROMOTION', 'PROTECTED_PUSH',
  'PERIODIC_OR_MANUAL', 'UNKNOWN_BASE', 'UNKNOWN_REF', 'UNKNOWN_EVENT',
]);
const DOCUMENTATION_FILES = new Set([
  'README.md', 'README.ko.md', 'CHANGELOG.md', 'CHANGELOG.ko.md',
  'CONTRIBUTING.md', 'SECURITY.md', 'TASKS.md', 'LICENSE', 'LICENSE.md', 'LICENSE.txt',
  'scripts/README.md',
]);
const WEB_COMPATIBILITY_TEST = /^apps\/web\/tests-unit\/(?:cross-platform-web-tooling|typescript-toolchain|typecheck-benchmark|dependency-modernization|performance-backlog-governance|auth-release-smoke|release-visual-privacy|release-visual-runner|release-workflow-governance|next-sync-patch|next-hmr-initial-sync)/;
const CI_POLICY = /^\.github\/scripts\/(?:classify-ci-(?:scope|benchmark)|verify-ci-results)(?:\.test)?\.mjs$/;

function decision(flags, reason, fatal = false) {
  return { ...Object.fromEntries(SCOPE_FLAGS.map((flag) => [flag, flags.includes(flag)])), reason, fatal };
}
const full = (reason, fatal = false) => decision(SCOPE_FLAGS, reason, fatal);
const invalidSource = (reason) => full(reason, true);

function validPath(file) {
  return typeof file === 'string' && file.length > 0 && !file.startsWith('/') &&
    !file.includes('\\') && !file.includes('\0') && !file.split('/').some((part) => part === '..' || part === '.' || part === '');
}

function isDocumentation(file) {
  return DOCUMENTATION_FILES.has(file) || /^docs\/.+\.(?:md|txt)$/.test(file);
}

export function classifyPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 20_000) return full('DIFF_UNAVAILABLE');
  if (paths.some((file) => !validPath(file))) return full('PATH_INVALID');
  if (paths.some((file) => CI_POLICY.test(file))) return full('CI_POLICY_CHANGE');
  // Existing compiler evidence still requires all four profiles. Never select a
  // full benchmark and silently remove its Windows/Bun owners.
  const benchmark = classifyBenchmarkPaths(paths);
  if (benchmark.benchmark) return full(benchmark.reason === 'UNKNOWN_INPUT' ? 'UNKNOWN_INPUT' : 'BENCHMARK_INPUT');
  if (paths.some((file) => /^apps\/web\/scripts\//.test(file) || WEB_COMPATIBILITY_TEST.test(file))) return full('WEB_TOOLING_CHANGE');

  let web = false;
  let sourceContracts = false;
  for (const file of paths) {
    if (isDocumentation(file)) continue;
    if (file.startsWith('apps/web/')) {
      web = true;
      continue;
    }
    if (file === 'AGENTS.md' || /^(?:backend\/|\.github\/|\.kiro\/|\.agents\/)/.test(file)) {
      sourceContracts = true;
      continue;
    }
    return full('UNKNOWN_INPUT');
  }
  if (web) {
    // Install includes the real production map/select/panel browser proof. Keep
    // it for runtime changes until that proof has an independent affected graph.
    return decision(['authority', 'unit', 'build', 'install', 'admin'], sourceContracts ? 'MIXED_CHANGE' : 'WEB_CHANGE');
  }
  // Web unit/source contracts and the Admin PostgreSQL/ledger probes read backend
  // and governance inputs. They stay selected even when a Next build is unrelated.
  if (sourceContracts) return decision(['unit', 'admin'], 'SOURCE_CONTRACT_CHANGE');
  return decision([], 'DOCUMENTATION_ONLY');
}

export function classifyEvent({ eventName, event, ref, head, changedPaths }) {
  if (!SHA.test(head ?? '')) return invalidSource('SOURCE_INVALID');
  if (eventName === 'schedule' || eventName === 'workflow_dispatch') return full('PERIODIC_OR_MANUAL');
  if (eventName === 'pull_request') {
    const pr = event?.pull_request;
    if (!SHA.test(pr?.head?.sha ?? '')) return invalidSource('SOURCE_INVALID');
    if (pr.head.sha !== head) return invalidSource('SOURCE_MISMATCH');
    if (!SHA.test(pr?.base?.sha ?? '')) return full('DIFF_UNAVAILABLE');
    // Keep the one-time installation through the legacy protected path full.
    // Ordinary feature/dependency PRs use main after trusted policy activation.
    if (['data', 'develop'].includes(pr.base.ref) || ['data', 'develop', 'main'].includes(pr.head.ref)) return full('PROTECTED_PROMOTION');
    if (pr.base.ref !== 'main') return full('UNKNOWN_BASE');
  } else if (eventName === 'push') {
    if (!SHA.test(event?.after ?? '')) return invalidSource('SOURCE_INVALID');
    if (event.after !== head) return invalidSource('SOURCE_MISMATCH');
    if (event.deleted || !SHA.test(event.before ?? '')) return full('DIFF_UNAVAILABLE');
    if (['refs/heads/main', 'refs/heads/develop', 'refs/heads/data'].includes(ref)) return full('PROTECTED_PUSH');
    return full('UNKNOWN_REF');
  } else return full('UNKNOWN_EVENT');
  return classifyPaths(changedPaths);
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  if (result.error || result.signal || result.status !== 0) throw new Error('GIT_UNAVAILABLE');
  return result.stdout;
}

export function classifyCheckout({ root, eventName, event, ref, expectedHead }) {
  let head;
  try {
    head = git(root, ['rev-parse', 'HEAD']).trim();
  } catch {
    return invalidSource('SOURCE_UNAVAILABLE');
  }
  if (!SHA.test(head)) return invalidSource('SOURCE_INVALID');
  if (eventName !== 'pull_request' && expectedHead !== undefined) {
    if (!SHA.test(expectedHead)) return invalidSource('SOURCE_INVALID');
    if (expectedHead !== head) return invalidSource('SOURCE_MISMATCH');
  }
  const preliminary = classifyEvent({ eventName, event, ref, head });
  if (preliminary.reason !== 'DIFF_UNAVAILABLE') return preliminary;
  try {
    const base = eventName === 'pull_request'
      ? git(root, ['merge-base', event.pull_request.base.sha, head]).trim()
      : event?.before;
    if (!SHA.test(base ?? '')) return full('DIFF_UNAVAILABLE');
    // Classify both sides of renames and all deletions, with NUL framing so names
    // containing whitespace cannot change the inventory being classified.
    const names = git(root, ['diff', '--name-only', '--no-renames', '-z', base, head, '--']);
    const changedPaths = names.endsWith('\0') ? names.slice(0, -1).split('\0') : [];
    return classifyEvent({ eventName, event, ref, head, changedPaths });
  } catch {
    return full('DIFF_UNAVAILABLE');
  }
}

function main() {
  let result;
  try {
    const body = readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8');
    if (Buffer.byteLength(body) > 4 * 1024 * 1024) throw new Error('EVENT_TOO_LARGE');
    result = classifyCheckout({ root: process.cwd(), eventName: process.env.GITHUB_EVENT_NAME,
      event: JSON.parse(body), ref: process.env.GITHUB_REF, expectedHead: process.env.GITHUB_SHA });
  } catch {
    result = full('EVENT_UNAVAILABLE');
  }
  // Emit only fixed codes and booleans, never event bodies or changed paths.
  process.stdout.write(JSON.stringify(result) + '\n');
  if (process.env.GITHUB_OUTPUT) {
    const output = [...SCOPE_FLAGS, 'reason', 'fatal'].map((key) => key + '=' + result[key]).join('\n');
    appendFileSync(process.env.GITHUB_OUTPUT, output + '\n');
  }
  if (result.fatal) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
