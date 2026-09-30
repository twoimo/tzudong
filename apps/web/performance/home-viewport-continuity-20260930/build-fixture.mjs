import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { redactCliText } from '../../scripts/privacy-safe-cli-log.mjs';

const kind = process.argv[2];
assert.ok(['baseline', 'candidate'].includes(kind));
assert.equal(Number(process.versions.node.split('.')[0]), 24);
const here = new URL('./', import.meta.url), app = new URL('../../', here);
const sourcePath = new URL('../../app/home-runtime-shell.tsx', here);
const tsconfigPath = new URL('../../tsconfig.json', here);
const tsconfigBefore = await readFile(tsconfigPath);
const candidate = await readFile(sourcePath), baseline = await readFile(new URL('baseline-home-runtime-shell.tsx.txt', here));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const frozen = JSON.parse(await readFile(new URL('candidate-v2/artifact-map.json', here)));
assert.equal(hash(candidate), frozen.artifacts['source-1.txt'].sha256);
const distDir = `.next-viewport-${kind}-20260930`;
const output = new URL(`build-${kind}/`, here);
await mkdir(output);
// These values identify intercepted test fixtures, not operator credentials or a
// running local stack. The route runner blocks every non-local external request.
const environment = {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
    NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', TZUDONG_NEXT_DIST_DIR: distDir,
    NEXT_PUBLIC_SUPABASE_URL: 'https://render-lab.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'render-lab-fixture-public-key',
    NEXT_PUBLIC_NAVER_MAPS_SCRIPT_URL: '/__local/naver-maps.js',
};
let log = '';
try {
    if (kind === 'baseline') await writeFile(sourcePath, baseline);
    const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'build', '--webpack'], {
        cwd: fileURLToPath(app), env: environment, stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {
        const text = redactCliText(bytes.toString('utf8'), 16384);
        log += text;
        process.stdout.write(text);
    });
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    await writeFile(new URL('build.log', output), log, { flag: 'wx' });
    assert.equal(code, 0, 'fixture production build');
    const standalone = new URL(`${distDir}/standalone/apps/web/`, app);
    await cp(new URL(`${distDir}/static/`, app), new URL(`${distDir}/static/`, standalone), { recursive: true, errorOnExist: true, force: false });
    await cp(new URL('public/', app), new URL('public/', standalone), { recursive: true, errorOnExist: false, force: false });
    const buildId = (await readFile(new URL(`${distDir}/BUILD_ID`, app), 'utf8')).trim();
    await writeFile(new URL('receipt.json', output), JSON.stringify({
        scope: 'Local production bundle using fully intercepted public data/provider fixtures. No local DB admission or hosted correctness claim.',
        kind, distDir, buildId, node: process.version, sourceSha256: hash(kind === 'baseline' ? baseline : candidate),
        logSha256: hash(log),
    }, null, 2) + '\n', { flag: 'wx' });
} finally {
    if (kind === 'baseline') await writeFile(sourcePath, candidate);
    await writeFile(tsconfigPath, tsconfigBefore);
}
