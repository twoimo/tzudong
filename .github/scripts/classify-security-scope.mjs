import { appendFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SHA = /^(?!0{40}$)[0-9a-f]{40}$/;
const KNOWN_ROOT = /^(?:apps\/web\/|backend\/|docs\/|\.github\/|\.kiro\/|\.agents\/)/;
const ROOT_DOCUMENTS = new Set(['README.md', 'README.ko.md', 'CHANGELOG.md', 'CHANGELOG.ko.md', 'CONTRIBUTING.md', 'SECURITY.md', 'TASKS.md', 'AGENTS.md', 'LICENSE', 'LICENSE.md', 'LICENSE.txt', '.gitignore', 'scripts/README.md']);
const full = (reason, fatal = false) => ({ security: true, reason, fatal });
const skip = () => ({ security: false, reason: 'SECURITY_INPUTS_UNCHANGED', fatal: false });
const safePath = (value) => typeof value === 'string' && value.length > 0 && value.length <= 4096
  && !value.startsWith('/') && !value.includes('\\') && !/[\x00-\x1f\x7f]/.test(value)
  && !value.split('/').some((part) => part === '..' || part === '.' || part === '');

function readPolicy() {
  try {
    const raw = readFileSync(new URL('../ci-security-paths.json', import.meta.url), 'utf8');
    if (Buffer.byteLength(raw) > 256 * 1024) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

// These are the retained GitHub trigger globs. Keep **/ able to match zero
// directories, and * bounded by a slash. Unsupported syntax selects every check.
export function compilePattern(pattern) {
  if (!safePath(pattern) || /[!\[\]{}]/.test(pattern)) throw new Error('POLICY_INVALID');
  let source = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*' && pattern[i + 1] === '*') {
      i += 1;
      if (pattern[i + 1] === '/') { i += 1; source += '(?:.*/)?'; }
      else source += '.*';
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^$()|\\]/g, '\\$&');
  }
  return new RegExp(`${source}$`);
}

export function classifyPaths(paths, policy = readPolicy()) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 20_000) return full('DIFF_UNAVAILABLE');
  if (paths.some((path) => !safePath(path))) return full('PATH_INVALID');
  if (!policy || policy.schemaVersion !== 1 || !Array.isArray(policy.paths)
      || policy.paths.length === 0 || policy.paths.length > 1000) return full('POLICY_INVALID', true);
  let patterns;
  try { patterns = policy.paths.map(compilePattern); }
  catch { return full('POLICY_INVALID', true); }
  for (const path of paths) {
    if (patterns.some((pattern) => pattern.test(path))) return full('SECURITY_INPUT_CHANGED');
    if (!KNOWN_ROOT.test(path) && !ROOT_DOCUMENTS.has(path)) return full('UNKNOWN_INPUT');
  }
  return skip();
}

export function classifyEvent({ eventName, event, ref, head, changedPaths }, policy) {
  if (!SHA.test(head ?? '')) return full('SOURCE_INVALID', true);
  if (eventName === 'pull_request') {
    const pr = event?.pull_request;
    if (!SHA.test(pr?.head?.sha ?? '')) return full('SOURCE_INVALID', true);
    if (pr.head.sha !== head) return full('SOURCE_MISMATCH', true);
    if (!SHA.test(pr?.base?.sha ?? '')) return full('DIFF_UNAVAILABLE');
    if (['data', 'develop'].includes(pr.base.ref) || ['data', 'develop', 'main'].includes(pr.head.ref)) return full('PROTECTED_PROMOTION');
    if (pr.base.ref !== 'main') return full('UNKNOWN_BASE');
  } else if (eventName === 'schedule' || eventName === 'workflow_dispatch') return full('PERIODIC_OR_MANUAL');
  else if (eventName === 'push') {
    if (!SHA.test(event?.after ?? '')) return full('SOURCE_INVALID', true);
    if (event.after !== head) return full('SOURCE_MISMATCH', true);
    if (event.deleted || !SHA.test(event.before ?? '')) return full('DIFF_UNAVAILABLE');
    if (['refs/heads/main', 'refs/heads/develop', 'refs/heads/data'].includes(ref)) return full('PROTECTED_PUSH');
    return full('UNKNOWN_REF');
  } else return full('UNKNOWN_EVENT');
  return classifyPaths(changedPaths, policy);
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  if (result.error || result.signal || result.status !== 0) throw new Error('DIFF_UNAVAILABLE');
  return result.stdout;
}

export function classifyCheckout({ root, eventName, event, ref, expectedHead }, policy) {
  try {
    const head = git(root, ['rev-parse', 'HEAD']).trim();
    if (eventName !== 'pull_request' && expectedHead !== undefined) {
      if (!SHA.test(expectedHead)) return full('SOURCE_INVALID', true);
      if (expectedHead !== head) return full('SOURCE_MISMATCH', true);
    }
    const preliminary = classifyEvent({ eventName, event, ref, head }, policy);
    if (preliminary.reason !== 'DIFF_UNAVAILABLE') return preliminary;
    const base = eventName === 'pull_request'
      ? git(root, ['merge-base', event.pull_request.base.sha, head]).trim()
      : event.before;
    if (!SHA.test(base ?? '')) return full('DIFF_UNAVAILABLE');
    const names = git(root, ['diff', '--name-only', '--no-renames', '-z', base, head, '--']);
    const paths = names.endsWith('\0') ? names.slice(0, -1).split('\0') : [];
    return classifyEvent({ eventName, event, ref, head, changedPaths: paths }, policy);
  } catch { return full('DIFF_UNAVAILABLE'); }
}

function main() {
  let decision;
  try {
    const raw = readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8');
    if (Buffer.byteLength(raw) > 4 * 1024 * 1024) throw new Error('EVENT_TOO_LARGE');
    decision = classifyCheckout({ root: process.cwd(), eventName: process.env.GITHUB_EVENT_NAME,
      event: JSON.parse(raw), ref: process.env.GITHUB_REF, expectedHead: process.env.GITHUB_SHA });
  } catch { decision = full('EVENT_UNAVAILABLE'); }
  process.stdout.write(`${JSON.stringify(decision)}\n`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
    `security=${decision.security}\nreason=${decision.reason}\nfatal=${decision.fatal}\n`);
  if (decision.fatal) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
