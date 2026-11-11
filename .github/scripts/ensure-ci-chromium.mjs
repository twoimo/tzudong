import { spawn } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const READY = 'CI_CHROMIUM_PROBE_READY';
const MISSING_LIBRARIES = 'CI_CHROMIUM_MISSING_OS_LIBRARIES';
const PROBE_FAILED = 'CI_CHROMIUM_PROBE_FAILED';
const VERSION_MISMATCH = 'CI_CHROMIUM_VERSION_MISMATCH';
const OUTPUT_LIMIT = 256 * 1024;

// Resolve only the installed npm-lock authority. Never let npx fetch a different
// Playwright release, or accept a package inherited from a parent workspace.
export function loadPinnedPlaywright(repoRoot = repositoryRoot) {
  const webRoot = join(repoRoot, 'apps/web');
  const lock = JSON.parse(readFileSync(join(webRoot, 'package-lock.json'), 'utf8'));
  const pin = JSON.parse(readFileSync(join(repoRoot, '.github/chrome-for-testing.v1.json'), 'utf8'));
  if (pin.schemaVersion !== 1 || !/^\d+\.\d+\.\d+\.\d+$/.test(pin.version)
      || !/^\d+\.\d+\.\d+$/.test(pin.playwrightVersion)) throw new Error('PIN_INVALID');
  const requireWeb = createRequire(join(webRoot, 'package.json'));
  for (const name of ['@playwright/test', 'playwright', 'playwright-core']) {
    const manifestPath = requireWeb.resolve(`${name}/package.json`);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (realpathSync(manifestPath) !== realpathSync(join(webRoot, 'node_modules', name, 'package.json'))
        || lock.packages?.[`node_modules/${name}`]?.version !== pin.playwrightVersion
        || manifest.version !== pin.playwrightVersion) throw new Error('PIN_INVALID');
  }
  const cliPath = join(dirname(requireWeb.resolve('playwright/package.json')), 'cli.js');
  if (!statSync(cliPath).isFile()) throw new Error('PIN_INVALID');
  return { webRoot, cliPath, requireWeb, browserVersion: pin.version };
}

// These are the Linux loader diagnostic and Playwright's explicit dependency
// validator formats. A generic launch error, missing executable, crash, timeout,
// sandbox denial or download failure never authorizes a package-manager retry.
export function isMissingLibraryDiagnostic(message) {
  if (typeof message !== 'string') return false;
  const diagnostic = message.slice(0, OUTPUT_LIMIT).replace(/[\u2500-\u257f]/g, ' ');
  if (/error while loading shared libraries: [\w.+-]+\.so(?:\.[\w+-]+)*: cannot open shared object file: No such file or directory/.test(diagnostic)) return true;
  return diagnostic.includes('Host system is missing dependencies to run browsers.')
    && (/Missing libraries:\s+lib[\w.+-]+\.so(?:\.[\w+-]+)*(?:\s|$)/.test(diagnostic)
      || /apt-get install\s+lib[a-z0-9.+-]+(?:\s|\\|$)/.test(diagnostic));
}

// Keep diagnostics in bounded memory, never in CI logs or artifacts. Terminate
// the whole process group on Linux so a timed-out apt/browser child cannot keep
// the build alive. This also works on the two-CPU Linux Cloudflare build image.
export function runBounded(command, args, {
  cwd, env = process.env, timeoutMs, maxOutputBytes = OUTPUT_LIMIT,
}) {
  return new Promise((fulfill) => {
    const grouped = process.platform !== 'win32';
    let child;
    let timer;
    let finished = false;
    let bytes = 0;
    const chunks = [];
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      fulfill({ ...result, output: Buffer.concat(chunks).toString('utf8') });
    };
    const stop = (error) => {
      if (finished) return;
      try {
        if (grouped && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        try { child.kill('SIGKILL'); } catch { /* The child may have already exited. */ }
      }
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
      finish({ status: null, error });
    };
    try {
      child = spawn(command, args, { cwd, env, shell: false, detached: grouped, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      finish({ status: null, error: 'SPAWN_FAILED' });
      return;
    }
    const collect = (chunk) => {
      if (finished) return;
      const remaining = maxOutputBytes - bytes;
      chunks.push(chunk.subarray(0, remaining));
      bytes += Math.min(chunk.length, remaining);
      if (chunk.length > remaining) stop('OUTPUT_LIMIT');
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', () => finish({ status: null, error: 'SPAWN_FAILED' }));
    child.on('close', (status) => finish({ status, error: null }));
    timer = setTimeout(() => stop('TIMEOUT'), timeoutMs);
  });
}

export async function probeChromium(chromium, expectedVersion) {
  // The unit tests explicitly use executablePath(); probe that full browser as
  // well as Playwright's default headless shell, which install chromium retains.
  for (const explicitExecutable of [true, false]) {
    let browser;
    try {
      browser = await chromium.launch({
        headless: true,
        timeout: 15_000,
        ...(explicitExecutable ? { executablePath: chromium.executablePath() } : {}),
      });
    } catch (error) {
      return isMissingLibraryDiagnostic(error?.message) ? MISSING_LIBRARIES : PROBE_FAILED;
    }
    let result = READY;
    try {
      if (browser.version() !== expectedVersion) result = VERSION_MISMATCH;
      else {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><button id="probe" onclick="this.textContent=\'clicked\'">ready</button>', { timeout: 10_000 });
        await page.locator('#probe').click({ timeout: 10_000 });
        if (await page.locator('#probe').textContent({ timeout: 5_000 }) !== 'clicked') result = PROBE_FAILED;
      }
    } catch {
      result = PROBE_FAILED;
    } finally {
      try { await browser.close(); } catch { result = PROBE_FAILED; }
    }
    if (result !== READY) return result;
  }
  return READY;
}

export async function ensureCiChromium({
  repoRoot = repositoryRoot, run = runBounded, platform = process.platform,
  report = (code) => process.stdout.write(`${code}\n`),
} = {}) {
  let pinned;
  try { pinned = loadPinnedPlaywright(repoRoot); } catch {
    report('CI_CHROMIUM_PIN_INVALID');
    return false;
  }
  const invoke = (args, timeoutMs) => run(process.execPath, args, { cwd: pinned.webRoot, timeoutMs });
  const stageFailed = (result, stage) => {
    if (result.status === 0 && !result.error) return false;
    const suffix = ['TIMEOUT', 'OUTPUT_LIMIT', 'SPAWN_FAILED'].includes(result.error) ? result.error : 'FAILED';
    report(`CI_CHROMIUM_${stage}_${suffix}`);
    return true;
  };
  report('CI_CHROMIUM_DOWNLOAD');
  if (stageFailed(await invoke([pinned.cliPath, 'install', 'chromium'], 300_000), 'DOWNLOAD')) return false;

  const probe = () => invoke([join(repoRoot, '.github/scripts/ensure-ci-chromium.mjs'), '--probe'], 90_000);
  const first = await probe();
  if (first.status === 0 && !first.error && first.output.trim() === READY) {
    report('CI_CHROMIUM_READY_WITH_EXISTING_OS_LIBRARIES');
    return true;
  }
  if (platform !== 'linux' || first.error || first.status !== 2 || first.output.trim() !== MISSING_LIBRARIES) {
    if (!stageFailed(first, 'PROBE')) report(PROBE_FAILED);
    return false;
  }

  report('CI_CHROMIUM_INSTALL_MISSING_OS_LIBRARIES');
  if (stageFailed(await invoke([pinned.cliPath, 'install-deps', 'chromium'], 600_000), 'OS_DEPS')) return false;
  const second = await probe();
  if (second.status !== 0 || second.error || second.output.trim() !== READY) {
    if (!stageFailed(second, 'REPROBE')) report('CI_CHROMIUM_REPROBE_FAILED');
    return false;
  }
  report('CI_CHROMIUM_READY_AFTER_OS_DEPENDENCIES');
  return true;
}

async function main() {
  if (process.argv.length === 3 && process.argv[2] === '--probe') {
    let result = PROBE_FAILED;
    try {
      const pinned = loadPinnedPlaywright();
      result = await probeChromium(pinned.requireWeb('playwright').chromium, pinned.browserVersion);
    } catch { /* Package or probe exceptions are not system-library evidence. */ }
    process.stdout.write(`${result}\n`);
    process.exitCode = result === READY ? 0 : result === MISSING_LIBRARIES ? 2 : 1;
  } else if (process.argv.length === 2) {
    process.exitCode = await ensureCiChromium() ? 0 : 1;
  } else {
    process.stdout.write('CI_CHROMIUM_ARGUMENTS_INVALID\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stdout.write('CI_CHROMIUM_SETUP_FAILED\n');
    process.exitCode = 1;
  });
}
