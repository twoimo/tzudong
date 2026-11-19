// Bun exits 0 when a test path matches nothing or a test file calls
// process.exit(0) before its tests run, so the exit status alone cannot prove
// that every assigned file ran. Each Bun process also writes a JUnit report,
// and a file passes only when it appears there as a top-level suite with tests.
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(value) {
  return value.replace(/&(?:#x([0-9a-f]+)|#([0-9]+)|(amp|lt|gt|quot|apos));/gi, (_match, hex, dec, name) => {
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    if (dec) return String.fromCodePoint(Number.parseInt(dec, 10));
    return ENTITIES[name.toLowerCase()];
  });
}

function attribute(tagBody, name) {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tagBody);
  return match ? decode(match[1]) : null;
}

// Bun 1.4.0 writes `file` relative to its cwd with forward slashes, whether the
// argument was relative, `./`-prefixed or absolute.
export function normalizeTestPath(file, cwd) {
  return path.relative(cwd, path.resolve(cwd, file)).replaceAll('\\', '/');
}

// Returns file -> test count for the suites directly under <testsuites>, or
// null when the report is absent, truncated or malformed. Nested suites are
// describe blocks and carry no new files.
export function parseTopLevelSuites(xml) {
  if (typeof xml !== 'string' || !/<testsuites[\s>]/.test(xml) || !/<\/testsuites>\s*$/.test(xml)) return null;
  const suites = new Map();
  let depth = 0;
  for (const [, closing, body] of xml.matchAll(/<(\/?)testsuite(?=[\s/>])([^>]*)>/g)) {
    if (closing) {
      depth -= 1;
      if (depth < 0) return null;
      continue;
    }
    if (depth === 0) {
      const file = attribute(body, 'file');
      const tests = Number(attribute(body, 'tests'));
      if (!file || !Number.isInteger(tests) || tests < 0) return null;
      suites.set(file, (suites.get(file) ?? 0) + tests);
    }
    if (!body.endsWith('/')) depth += 1;
  }
  return depth === 0 ? suites : null;
}

export function verifyFileResults(xml, files, cwd) {
  const expected = new Set(files.map((file) => normalizeTestPath(file, cwd)));
  const suites = new Map();
  for (const [file, tests] of parseTopLevelSuites(xml) ?? []) {
    const key = normalizeTestPath(file, cwd);
    suites.set(key, (suites.get(key) ?? 0) + tests);
  }
  return {
    missing: [...expected].filter((file) => !(suites.get(file) > 0)).sort(),
    unexpected: [...suites.keys()].filter((file) => !expected.has(file)).sort(),
  };
}

function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

export function runBunTestFiles(files, { cwd = process.cwd(), env = process.env, args = [] } = {}) {
  const absent = files.filter((file) => !isFile(path.resolve(cwd, file)));
  if (absent.length > 0) {
    console.error(`[unit-tests] test files not found: ${absent.join(', ')}`);
    return 1;
  }
  const reportDir = mkdtempSync(path.join(tmpdir(), 'tzudong-unit-junit-'));
  const reportFile = path.join(reportDir, 'results.xml');
  try {
    const result = spawnSync('bun', ['test', ...files, ...args, '--reporter', 'junit', '--reporter-outfile', reportFile], {
      cwd, env, stdio: 'inherit', shell: false,
    });
    if (result.error) {
      console.error(`[unit-tests] runner failed: ${result.error.code ?? result.error.name}`);
      return 1;
    }
    if (result.status !== 0) return typeof result.status === 'number' ? result.status : 1;
    const xml = existsSync(reportFile) ? readFileSync(reportFile, 'utf8') : null;
    const { missing, unexpected } = verifyFileResults(xml, files, cwd);
    if (missing.length > 0) console.error(`[unit-tests] files without results: ${missing.join(', ')}`);
    if (unexpected.length > 0) console.error(`[unit-tests] unassigned files with results: ${unexpected.join(', ')}`);
    return missing.length > 0 || unexpected.length > 0 ? 1 : 0;
  } finally {
    rmSync(reportDir, { recursive: true, force: true });
  }
}
