import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { sha256, startFixtureServer } from '../apps/web/tests/bombadil/fixture-server.mjs';
import { safeFailureCode } from '../apps/web/tests/bombadil/policy.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const web = path.join(root, 'apps/web');
const harness = path.join(web, 'tests/bombadil');

function parseArguments(args) {
  const result = {};
  const modes = ['--build-fixture', '--serve-fixture', '--run-hosted'];
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (modes.includes(key)) {
      if (result.mode) throw new Error('QA_ARGUMENTS');
      result.mode = key;
    } else if (['--out', '--bun', '--bombadil', '--port'].includes(key) && args[index + 1]) {
      if (result[key]) throw new Error('QA_ARGUMENTS');
      result[key] = args[++index];
    } else throw new Error('QA_ARGUMENTS');
  }
  if (!result.mode || !result['--out'] || !result['--bun']) throw new Error('QA_ARGUMENTS');
  if (!path.isAbsolute(result['--out']) || !path.isAbsolute(result['--bun'])) throw new Error('QA_ABSOLUTE_PATH_REQUIRED');
  if (result['--port'] && (!/^\d+$/.test(result['--port']) || +result['--port'] < 1024 || +result['--port'] > 65535)) throw new Error('QA_PORT');
  if (result.mode === '--run-hosted' && (!result['--bombadil'] || !path.isAbsolute(result['--bombadil']))) throw new Error('QA_ARGUMENTS');
  return result;
}

function buildFixture(bun, output) {
  let version;
  try { version = execFileSync(bun, ['--version'], { encoding: 'utf8', timeout: 5000 }).trim(); }
  catch { throw new Error('QA_BUN_UNAVAILABLE'); }
  if (version !== '1.4.0') throw new Error('QA_BUN_VERSION');
  try {
    execFileSync(bun, [path.join(harness, 'build.mjs'), path.join(output, 'bundle.js')],
      { cwd: web, stdio: 'pipe', timeout: 60_000 });
    execFileSync(bun, [path.join(web, 'node_modules/@tailwindcss/cli/dist/index.mjs'),
      '-i', path.join(harness, 'input.css'), '-o', path.join(output, 'bundle.css')],
    { cwd: web, stdio: 'pipe', timeout: 60_000 });
  } catch { throw new Error('QA_FIXTURE_BUILD_FAILED'); }
  return version;
}

async function main() {
  if (process.version !== 'v24.22.1') throw new Error('QA_NODE_VERSION');
  const options = parseArguments(process.argv.slice(2));
  const output = options['--out'];
  if (options.mode === '--run-hosted' && (process.env.GITHUB_ACTIONS !== 'true'
    || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' || process.platform !== 'linux'
    || process.getuid?.() === 0)) throw new Error('QA_HOSTED_ENVIRONMENT_REQUIRED');
  await mkdir(output, { recursive: false });
  const bunVersion = buildFixture(options['--bun'], output);
  const sourcePaths = [
    'apps/web/package.json', 'apps/web/package-lock.json', '.github/chrome-for-testing.v1.json',
    'scripts/run-bombadil-qa.mjs', 'apps/web/tests/bombadil/build.mjs',
    'apps/web/tests/bombadil/fixture-entry.tsx', 'apps/web/tests/bombadil/input.css',
    'apps/web/tests/bombadil/specification.js', 'apps/web/tests/bombadil/policy.mjs',
    'apps/web/tests/bombadil/fixture-server.mjs', 'apps/web/tests/bombadil/hosted-run.mjs',
    'apps/web/public/images/ui-noise.png',
    'apps/web/components/home/DeviceLocationDisclosure.tsx',
    'apps/web/components/home/HomeMapThemeFilters.tsx', 'apps/web/components/home/HomeMapRegionFilter.tsx',
    'apps/web/components/map/MapThemeNotice.tsx',
    'apps/web/components/admin/performance/AdminPerformanceAudit.tsx',
    'apps/web/lib/admin/performance-audit-snapshot.json',
    'apps/web/components/admin/thumbnail-generator/ThumbnailBriefEditor.tsx',
    'apps/web/components/admin/storyboard/StoryboardComicBoard.tsx',
    'apps/web/components/admin/storyboard/StoryboardConversation.tsx',
    'apps/web/components/admin/storyboard/StoryboardWorkspaceSkeleton.tsx',
    'apps/web/tests/fixtures/local-storyboard-ui/next-image-shim.ts',
  ];
  const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async name =>
    [name, sha256(await readFile(path.join(root, name)))])));
  const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const worktreeDirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0;
  const receipt = {
    schema: 'tzudong-bombadil-component-qa-v1', scope: 'isolated-actual-components-synthetic-state',
    createdAtUtc: new Date().toISOString(), sourceSha, worktreeDirty, sourceHashes, node: process.version, bunVersion,
    browserLaunched: false, productionRequests: 0, providerRequests: 0,
    assets: { javascriptSha256: sha256(await readFile(path.join(output, 'bundle.js'))),
      cssSha256: sha256(await readFile(path.join(output, 'bundle.css'))) },
  };
  await writeFile(path.join(output, 'build-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  if (options.mode === '--build-fixture') {
    process.stdout.write(`${JSON.stringify({ status: 'built', receipt: path.join(output, 'build-receipt.json') })}\n`);
    return;
  }
  const fixture = await startFixtureServer(output, Number(options['--port'] ?? 0));
  if (options.mode === '--serve-fixture') {
    process.stdout.write(`${JSON.stringify({ status: 'serving-fixture', url: `${fixture.origin}/fixture`, browserLaunched: false })}\n`);
    let closing = false;
    const close = async () => { if (!closing) { closing = true; await fixture.close(); } };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    return;
  }
  try {
    const { runHostedQa } = await import('../apps/web/tests/bombadil/hosted-run.mjs');
    await runHostedQa({ root, web, harness, output, fixture, bombadil: options['--bombadil'], buildReceipt: receipt });
  } finally { await fixture.close(); }
}

main().catch(error => {
  process.stderr.write(`${safeFailureCode(error)}\n`);
  process.exitCode = 1;
});
