import { appendFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SHA = /^(?!0{40}$)[0-9a-f]{40}$/;
const full = (reason) => ({ benchmark: true, reason });
const invalidSource = (reason) => ({ benchmark: true, reason, fatal: true });
const regular = (reason) => ({ benchmark: false, reason });

// Ordinary feature changes retain all four diagnostic/platform lanes. Full-program
// performance is checked weekly and before data/main promotion, as well as on
// changes to compiler, dependency, configuration and measurement inputs.
export function classifyPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 20_000) return full('DIFF_UNAVAILABLE');
  for (const file of paths) {
    if (typeof file !== 'string' || !file || file.startsWith('/') || file.includes('\\') || file.split('/').includes('..')) return full('PATH_INVALID');
    if (/^(\.github\/|\.kiro\/|\.agents\/)/.test(file)) return full('CI_OR_EVIDENCE_CHANGE');
    if (/(^|\/)(package(?:-lock)?\.json|bun\.lockb?|.*\.lock|requirements[^/]*\.txt|pyproject\.toml|Cargo\.toml|go\.mod|go\.sum)$/.test(file)) return full('DEPENDENCY_CHANGE');
    if (/^(apps\/web\/(scripts|config|vendor|performance|fixtures\/typecheck-benchmark)\/)/.test(file)
      || /(^|\/)(tsconfig[^/]*\.json|[^/]*\.config\.[^/]+|next-env\.d\.ts|\.npmrc|\.node-version|\.nvmrc|\.tool-versions)$/.test(file)
      || /^apps\/web\/tests-unit\/(typescript-toolchain|typecheck-benchmark|cross-platform-web-tooling|dependency-modernization)/.test(file)) return full('TOOLCHAIN_OR_MEASUREMENT_CHANGE');
    // Unrecognised roots are intentionally full: new build inputs need an explicit
    // classification instead of silently losing performance coverage.
    if (!/^(apps\/web\/|backend\/|docs\/)/.test(file) && !/^(README[^/]*|AGENTS\.md|LICENSE[^/]*|\.gitignore)$/.test(file)) return full('UNKNOWN_INPUT');
  }
  return regular('FEATURE_DIAGNOSTICS_ONLY');
}

export function classifyEvent({ eventName, event, ref, head, changedPaths }) {
  if (!SHA.test(head ?? '')) return full('SOURCE_INVALID');
  if (eventName === 'schedule' || eventName === 'workflow_dispatch') return full('PERIODIC_OR_MANUAL');
  if (eventName === 'pull_request') {
    const pr = event?.pull_request;
    if (!SHA.test(pr?.head?.sha ?? '')) return invalidSource('SOURCE_INVALID');
    if (pr.head.sha !== head) return invalidSource('SOURCE_MISMATCH');
    if (!SHA.test(pr?.base?.sha ?? '')) return full('DIFF_UNAVAILABLE');
    if (['data', 'main'].includes(pr.base.ref)) return full('PROTECTED_PROMOTION');
    if (pr.base.ref !== 'develop') return full('UNKNOWN_BASE');
  } else if (eventName === 'push') {
    if (!SHA.test(event?.after ?? '')) return invalidSource('SOURCE_INVALID');
    if (event.after !== head) return invalidSource('SOURCE_MISMATCH');
    if (event.deleted || !SHA.test(event.before ?? '')) return full('DIFF_UNAVAILABLE');
    if (['refs/heads/data', 'refs/heads/main'].includes(ref)) return full('PROTECTED_PUSH');
    if (ref !== 'refs/heads/develop') return full('UNKNOWN_REF');
  } else return full('UNKNOWN_EVENT');
  return classifyPaths(changedPaths);
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  if (result.error || result.signal || result.status !== 0) throw new Error('DIFF_UNAVAILABLE');
  return result.stdout;
}

export function classifyCheckout({ root, eventName, event, ref, expectedHead }) {
  try {
    const head = git(root, ['rev-parse', 'HEAD']).trim();
    if (eventName !== 'pull_request' && expectedHead !== undefined) {
      if (!SHA.test(expectedHead)) return invalidSource('SOURCE_INVALID');
      if (expectedHead !== head) return invalidSource('SOURCE_MISMATCH');
    }
    const preliminary = classifyEvent({ eventName, event, ref, head });
    if (preliminary.reason !== 'DIFF_UNAVAILABLE') return preliminary;
    let base;
    if (eventName === 'pull_request') base = git(root, ['merge-base', event.pull_request.base.sha, head]).trim();
    else base = event.before;
    if (!SHA.test(base ?? '')) return full('DIFF_UNAVAILABLE');
    // Disable rename heuristics so both removed and added names are classified.
    // NUL framing preserves filenames containing spaces or line breaks.
    const names = git(root, ['diff', '--name-only', '--no-renames', '-z', base, head, '--']);
    const changedPaths = names.endsWith('\0') ? names.slice(0, -1).split('\0') : [];
    return classifyEvent({ eventName, event, ref, head, changedPaths });
  } catch {
    // Missing shallow/fork history or malformed events request the full proof.
    return full('DIFF_UNAVAILABLE');
  }
}

function main() {
  let decision;
  try {
    const body = readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8');
    if (Buffer.byteLength(body) > 4 * 1024 * 1024) throw new Error('EVENT_TOO_LARGE');
    decision = classifyCheckout({ root: process.cwd(), eventName: process.env.GITHUB_EVENT_NAME, event: JSON.parse(body), ref: process.env.GITHUB_REF, expectedHead: process.env.GITHUB_SHA });
  } catch {
    decision = full('EVENT_UNAVAILABLE');
  }
  // Only fixed codes and booleans leave this process; never publish paths/bodies.
  process.stdout.write(`${JSON.stringify(decision)}\n`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `benchmark=${decision.benchmark}\nreason=${decision.reason}\n`);
  if (decision.fatal) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
