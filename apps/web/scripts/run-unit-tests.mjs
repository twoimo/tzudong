import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve('tests-unit');
const isolated = new Set([
  'admin-storyboard-generator.test.ts',
  'admin-storyboard-langgraph.test.ts',
  'admin-storyboard-caption-provenance.test.ts',
  'admin-youtube-thumbnail-readiness-gate.test.ts',
  'auth-callback-session.test.ts',
  'account-deletion-reauth-validation.test.ts',
  'db-conflict-checker.test.ts',
  'require-admin-fail-closed.test.ts',
  'shorten-target-allowlist.test.ts',
]);

const files = readdirSync(root, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.test\.(?:[cm]?[jt]sx?)$/.test(entry.name))
  .map((entry) => path.relative(process.cwd(), path.join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
  .sort();
const isolatedFiles = files.filter((file) => isolated.has(path.basename(file)));
const generalFiles = files.filter((file) => !isolated.has(path.basename(file)));

if (isolatedFiles.length !== isolated.size || generalFiles.length === 0) {
  console.error('[unit-tests] deterministic test inventory is incomplete');
  process.exit(1);
}

function run(filesToRun) {
  const localDiagnostic = process.env.NIGHTLY_MODE === 'local';
  if (localDiagnostic && process.platform === 'linux') {
    // Linux libuv extra pipes are sockets and cannot be reopened through
    // /dev/fd. A memfd is an anonymous RAM file inherited only by this Bun.
    const result = spawnSync('python3', [path.resolve('../../.github/scripts/nightly-unit-failure-sites.py'), '--run-linux'], {
      input: JSON.stringify({ files: filesToRun }), encoding: 'utf8',
      env: process.env, stdio: ['pipe', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024, shell: false,
    });
    if (result.stdout?.trim()) console.log(`NIGHTLY_UNIT_DIAGNOSTIC=${result.stdout.trim()}`);
    return typeof result.status === 'number' ? result.status : 1;
  }
  const reportArgs = localDiagnostic ? ['--reporter', 'junit', '--reporter-outfile', '/dev/fd/3'] : [];
  const result = spawnSync('bun', ['test', ...filesToRun, '--timeout', '30000', ...reportArgs], {
    cwd: process.cwd(),
    env: process.env,
    // The extra fd is a private pipe: raw JUnit/console diagnostics never land
    // in the nightly log or an artifact. Ordinary developer output is unchanged.
    stdio: localDiagnostic ? ['inherit', 'ignore', 'ignore', 'pipe'] : 'inherit',
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
  });
  if (result.error) {
    console.error(`[unit-tests] runner failed: ${result.error.code ?? result.error.name}`);
    return 1;
  }
  if (localDiagnostic) {
    const xml = result.output[3]?.toString('utf8');
    const diagnostic = spawnSync('python3', [path.resolve('../../.github/scripts/nightly-unit-failure-sites.py')], {
      input: JSON.stringify({ xml, files: filesToRun }),
      encoding: 'utf8', maxBuffer: 64 * 1024,
      stdio: ['pipe', 'pipe', 'ignore'], shell: false,
    });
    if (diagnostic.status !== 0) {
      console.error('[unit-tests] bounded diagnostic unavailable');
      return 1;
    }
    console.log(`NIGHTLY_UNIT_DIAGNOSTIC=${diagnostic.stdout.trim()}`);
  }
  return typeof result.status === 'number' ? result.status : 1;
}

const generalStatus = run(generalFiles);
if (generalStatus !== 0) process.exit(generalStatus);
process.exit(run(isolatedFiles));
