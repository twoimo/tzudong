import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve('tests-unit');
const isolated = new Set([
  'admin-storyboard-generator.test.ts',
  'admin-storyboard-langgraph.test.ts',
  'admin-storyboard-caption-provenance.test.ts',
  'admin-youtube-thumbnail-readiness-gate.test.ts',
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
  const result = spawnSync('bun', ['test', ...filesToRun, '--timeout', '30000'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) {
    console.error(`[unit-tests] runner failed: ${result.error.code ?? result.error.name}`);
    return 1;
  }
  return typeof result.status === 'number' ? result.status : 1;
}

const generalStatus = run(generalFiles);
if (generalStatus !== 0) process.exit(generalStatus);
process.exit(run(isolatedFiles));
