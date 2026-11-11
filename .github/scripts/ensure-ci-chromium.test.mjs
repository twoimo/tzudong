import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { ensureCiChromium, isMissingLibraryDiagnostic, loadPinnedPlaywright, probeChromium, runBounded } from './ensure-ci-chromium.mjs';

const version = '1.64.1';
const browserVersion = '156.0.8078.4';
const ready = { status: 0, error: null, output: 'CI_CHROMIUM_PROBE_READY\n' };
const missing = { status: 2, error: null, output: 'CI_CHROMIUM_MISSING_OS_LIBRARIES\n' };
const success = { status: 0, error: null, output: '' };
const loaderError = 'chrome: error while loading shared libraries: libX11.so.6: cannot open shared object file: No such file or directory';

function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), 'ci-chromium-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, value) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));
  };
  write('apps/web/package.json', { name: 'ci-chromium-fixture' });
  write('.github/chrome-for-testing.v1.json', { schemaVersion: 1, version: browserVersion, playwrightVersion: version });
  const packages = {};
  for (const name of ['@playwright/test', 'playwright', 'playwright-core']) {
    packages[`node_modules/${name}`] = { version };
    write(`apps/web/node_modules/${name}/package.json`, { name, version });
  }
  write('apps/web/package-lock.json', { lockfileVersion: 3, packages });
  write('apps/web/node_modules/playwright/cli.js', '');
  return { root, write };
}

async function setupFixture(t, results, options = {}) {
  const { root } = workspace(t);
  const calls = [];
  const codes = [];
  const result = await ensureCiChromium({
    repoRoot: root,
    platform: 'linux',
    run: async (command, args, settings) => {
      calls.push({ command, args, ...settings });
      assert.ok(results.length, 'no unexpected additional attempt');
      return results.shift();
    },
    report: (code) => codes.push(code),
    ...options,
  });
  assert.equal(results.length, 0);
  return { result, calls, codes, root };
}

test('a launch-ready host downloads the locked browser without invoking apt', async (t) => {
  const { result, calls, codes, root } = await setupFixture(t, [success, ready]);
  assert.equal(result, true);
  assert.deepEqual(calls.map(({ args }) => args.slice(1)), [['install', 'chromium'], ['--probe']]);
  assert.equal(calls[0].args[0], join(root, 'apps/web/node_modules/playwright/cli.js'));
  assert.ok(calls.every(({ command, cwd, timeoutMs }) => command === process.execPath && cwd === join(root, 'apps/web') && timeoutMs > 0));
  assert.equal(codes.at(-1), 'CI_CHROMIUM_READY_WITH_EXISTING_OS_LIBRARIES');
});

test('only explicit missing libraries trigger one OS install followed by a new real probe', async (t) => {
  const { result, calls, codes } = await setupFixture(t, [success, missing, success, ready]);
  assert.equal(result, true);
  assert.deepEqual(calls.map(({ args }) => args.slice(1)), [['install', 'chromium'], ['--probe'], ['install-deps', 'chromium'], ['--probe']]);
  assert.equal(codes.at(-1), 'CI_CHROMIUM_READY_AFTER_OS_DEPENDENCIES');
});

test('download errors, timeouts and bounded-output failures stop before probing or apt', async (t) => {
  for (const failure of [
    { status: 1, output: loaderError },
    { status: null, error: 'TIMEOUT', output: 'PRIVATE_DIAGNOSTIC_SENTINEL' },
    { status: null, error: 'OUTPUT_LIMIT', output: 'PRIVATE_DIAGNOSTIC_SENTINEL' },
  ]) {
    const { result, calls, codes } = await setupFixture(t, [failure]);
    assert.equal(result, false);
    assert.equal(calls.length, 1);
    assert.doesNotMatch(codes.join('\n'), /PRIVATE_DIAGNOSTIC_SENTINEL|shared libraries/);
  }
});

test('generic failure, timeout, signal, empty success and malformed probe evidence never run apt', async (t) => {
  for (const failure of [
    { status: 1, output: 'CI_CHROMIUM_PROBE_FAILED\n' },
    { status: null, error: 'TIMEOUT', output: missing.output },
    { status: null, output: missing.output },
    { status: 0, output: '' },
    { status: 2, output: `${missing.output}PRIVATE_DIAGNOSTIC_SENTINEL` },
    { status: 0, output: missing.output },
  ]) {
    const { result, calls, codes } = await setupFixture(t, [success, failure]);
    assert.equal(result, false);
    assert.equal(calls.length, 2);
    assert.doesNotMatch(codes.join('\n'), /PRIVATE_DIAGNOSTIC_SENTINEL/);
  }
});

test('a non-Linux host never attempts the Linux OS dependency fallback', async (t) => {
  const { result, calls } = await setupFixture(t, [success, missing], { platform: 'darwin' });
  assert.equal(result, false);
  assert.equal(calls.length, 2);
});

test('failed OS installation and failed second probe remain failures without retry loops', async (t) => {
  const failedInstall = await setupFixture(t, [success, missing, { status: 1, output: 'PRIVATE_DIAGNOSTIC_SENTINEL' }]);
  assert.equal(failedInstall.result, false);
  assert.equal(failedInstall.calls.length, 3);
  for (const failure of [missing, { status: 1, output: '' }, { status: null, error: 'TIMEOUT', output: '' }]) {
    const afterInstall = await setupFixture(t, [success, missing, success, failure]);
    assert.equal(afterInstall.result, false);
    assert.equal(afterInstall.calls.length, 4);
    assert.doesNotMatch(afterInstall.codes.join('\n'), /READY_AFTER/);
  }
});

test('missing, installed-version and lock-version mismatches fail before any subprocess', async (t) => {
  for (const change of ['missing', 'installed-version', 'lock-version']) {
    const { root, write } = workspace(t);
    if (change === 'missing') rmSync(join(root, 'apps/web/node_modules/playwright-core/package.json'));
    if (change === 'installed-version') write('apps/web/node_modules/playwright-core/package.json', { name: 'playwright-core', version: '0.0.0' });
    if (change === 'lock-version') {
      const lock = JSON.parse(readFileSync(join(root, 'apps/web/package-lock.json'), 'utf8'));
      lock.packages['node_modules/playwright'].version = '0.0.0';
      write('apps/web/package-lock.json', lock);
    }
    assert.throws(() => loadPinnedPlaywright(root));
    const codes = [];
    assert.equal(await ensureCiChromium({ repoRoot: root, run: () => assert.fail('must not execute'), report: (code) => codes.push(code) }), false);
    assert.deepEqual(codes, ['CI_CHROMIUM_PIN_INVALID']);
  }
});

test('only explicit OS shared-library diagnostics permit repair', () => {
  for (const diagnostic of [
    loaderError,
    '║ Host system is missing dependencies to run browsers. ║\n║ Missing libraries: ║\n║     libglib-2.0.so.0 ║',
    '║ Host system is missing dependencies to run browsers. ║\n║ sudo apt-get install libnss3\\ ║\n║ libatk1.0-0 ║',
  ]) assert.equal(isMissingLibraryDiagnostic(diagnostic), true);
  for (const diagnostic of [
    '', undefined, 'Host system is missing dependencies to run browsers.',
    'install-deps recommended after Target page, context or browser has been closed',
    'Executable does not exist at /private/chromium', 'libX11.so.6: Permission denied',
    'Error: sandbox permission denied', 'Timeout 15000ms exceeded', 'SIGSEGV',
    'Missing libraries: libX11.so.6', 'HTTP request failed while downloading Chromium',
  ]) assert.equal(isMissingLibraryDiagnostic(diagnostic), false);
});

function fakeChromium({ launchError, version = browserVersion, clickWorks = true, pageError, closeError } = {}) {
  const launches = [];
  let closed = 0;
  let clicks = 0;
  return {
    launches,
    get closed() { return closed; },
    get clicks() { return clicks; },
    executablePath: () => '/fixture/full-chromium',
    launch: async (options) => {
      launches.push(options);
      if (launchError) throw new Error(launchError);
      return {
        version: () => version,
        newPage: async () => {
          if (pageError) throw new Error(pageError);
          let clicked = false;
          return {
            setContent: async (html) => assert.match(html, /onclick=/),
            locator: () => ({
              click: async () => { clicked = clickWorks; clicks += 1; },
              textContent: async () => clicked ? 'clicked' : 'ready',
            }),
          };
        },
        close: async () => { closed += 1; if (closeError) throw new Error(closeError); },
      };
    },
  };
}

test('probe opens both actual browser modes, exercises a DOM click, checks version and closes each', async () => {
  const chromium = fakeChromium();
  assert.equal(await probeChromium(chromium, browserVersion), 'CI_CHROMIUM_PROBE_READY');
  assert.deepEqual(chromium.launches, [
    { headless: true, timeout: 15000, executablePath: '/fixture/full-chromium' },
    { headless: true, timeout: 15000 },
  ]);
  assert.equal(chromium.clicks, 2);
  assert.equal(chromium.closed, 2);
});

test('only launch-time library failure is repairable; wrong version, broken interaction and close errors fail', async () => {
  assert.equal(await probeChromium(fakeChromium({ launchError: loaderError }), browserVersion), 'CI_CHROMIUM_MISSING_OS_LIBRARIES');
  assert.equal(await probeChromium(fakeChromium({ launchError: 'SIGSEGV' }), browserVersion), 'CI_CHROMIUM_PROBE_FAILED');
  const wrongVersion = fakeChromium({ version: '1.2.3.4' });
  assert.equal(await probeChromium(wrongVersion, browserVersion), 'CI_CHROMIUM_VERSION_MISMATCH');
  assert.equal(wrongVersion.closed, 1);
  for (const options of [{ clickWorks: false }, { pageError: loaderError }, { closeError: loaderError }]) {
    const chromium = fakeChromium(options);
    assert.equal(await probeChromium(chromium, browserVersion), 'CI_CHROMIUM_PROBE_FAILED');
    assert.equal(chromium.closed, 1);
  }
});

test('real subprocesses have bounded output, hard timeouts and explicit nonzero failures', async () => {
  assert.equal((await runBounded(process.execPath, ['-e', 'process.exit(7)'], { timeoutMs: 5000 })).status, 7);
  const noisy = await runBounded(process.execPath, ['-e', 'process.stdout.write("x".repeat(10000)); setInterval(() => {}, 1000)'], { timeoutMs: 5000, maxOutputBytes: 128 });
  assert.equal(noisy.error, 'OUTPUT_LIMIT');
  assert.equal(Buffer.byteLength(noisy.output), 128);
  const stalled = await runBounded(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { timeoutMs: 200 });
  assert.equal(stalled.error, 'TIMEOUT');
  assert.equal(stalled.status, null);
  assert.equal((await runBounded('/ci-chromium-nonexistent-executable', [], { timeoutMs: 5000 })).error, 'SPAWN_FAILED');
});
