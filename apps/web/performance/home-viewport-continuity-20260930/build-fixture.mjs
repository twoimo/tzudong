import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, cp, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { redactCliText } from '../../scripts/privacy-safe-cli-log.mjs';

const [kind, label = 'v2'] = process.argv.slice(2);
assert.ok(['baseline', 'candidate'].includes(kind));
assert.match(label, /^[a-z0-9-]+$/);
assert.equal(Number(process.versions.node.split('.')[0]), 24);
const here = new URL('./', import.meta.url), app = new URL('../../', here);
const repo = fileURLToPath(new URL('../../../../', here));
const baselineSha = '157ced98a2414d434132c99f74c72bbe5f796ca4';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const distDir = `.next-viewport-${kind}-${label}-20260930`;
const output = new URL(`build-${kind}-${label}/`, here);
await mkdir(output);
const scratch = await mkdtemp(join(tmpdir(), 'tzudong-home-fixture-'));
const copyRoot = join(scratch, 'source');
const copyApp = join(copyRoot, 'apps/web');
await mkdir(copyRoot);
if (kind === 'baseline') {
    const archive = join(scratch, 'source.tar');
    execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, baselineSha], { cwd: repo });
    execFileSync('tar', ['-xf', archive, '-C', copyRoot, '--exclude=apps/web/performance']);
} else {
    // Read current tracked bytes into task-owned scratch; never replace caller files.
    const names = execFileSync('git', ['ls-files', '-z'], { cwd: repo, encoding: 'utf8' }).split('\0').filter(Boolean);
    for (const name of names) {
        if (name.startsWith('apps/web/performance/')) continue;
        const target = join(copyRoot, name);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(join(repo, name), target);
    }
}
// Clone/copy the installed exact lockfile dependency tree into scratch, without
// symlinking it outside the standalone tracing root or touching global runtimes.
await cp(new URL('node_modules/', app), join(copyApp, 'node_modules'), {
    recursive: true, mode: constants.COPYFILE_FICLONE,
});
const inputs = [];
for (const [index, original] of ['app/home-runtime-shell.tsx', 'app/home-client.tsx',
    'components/home/home-map-container.tsx', 'hooks/useHomeViewportMode.ts', 'package-lock.json'].entries()) {
    const bytes = await readFile(join(copyApp, original));
    const retained = `build-${kind}-${label}/input-${index}.txt`;
    await writeFile(new URL(retained, here), bytes, { flag: 'wx' });
    inputs.push({ original, retained, sha256: hash(bytes) });
}
// These are intercepted public fixture identifiers, not operator credentials.
const environment = {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
    NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', TZUDONG_NEXT_DIST_DIR: distDir,
    NEXT_PUBLIC_SUPABASE_URL: 'https://render-lab.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'render-lab-fixture-public-key',
    NEXT_PUBLIC_NAVER_MAPS_SCRIPT_URL: '/__local/naver-maps.js',
};
let log = '';
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'build', '--webpack'], {
    cwd: copyApp, env: environment, stdio: ['ignore', 'pipe', 'pipe'],
});
for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {
    const text = redactCliText(bytes.toString('utf8'), 16384);
    log += text;
    process.stdout.write(text);
});
const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
await writeFile(new URL('build.log', output), log, { flag: 'wx' });
assert.equal(code, 0, 'fixture production build');
const built = join(copyApp, distDir);
const standalone = join(built, 'standalone/apps/web');
await cp(join(built, 'static'), join(standalone, distDir, 'static'), { recursive: true, errorOnExist: true, force: false });
await cp(join(copyApp, 'public'), join(standalone, 'public'), { recursive: true, errorOnExist: false, force: false });
const buildIdBytes = await readFile(join(built, 'BUILD_ID'));
const retainedBuildId = `build-${kind}-${label}/BUILD_ID`;
await writeFile(new URL(retainedBuildId, here), buildIdBytes, { flag: 'wx' });
await cp(built, new URL(distDir, app), { recursive: true, errorOnExist: true, force: false, mode: constants.COPYFILE_FICLONE });
await writeFile(new URL('receipt.json', output), JSON.stringify({
    scope: 'Isolated copied production source with intercepted public fixtures. No DB or hosted correctness claim.',
    kind, distDir, buildId: buildIdBytes.toString('utf8').trim(), retainedBuildId, inputs,
    node: process.version, sourceSha256: inputs[0].sha256, logSha256: hash(log),
}, null, 2) + '\n', { flag: 'wx' });
await rm(scratch, { recursive: true });
