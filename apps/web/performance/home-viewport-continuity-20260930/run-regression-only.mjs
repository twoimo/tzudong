import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { redactCliText } from '../../scripts/privacy-safe-cli-log.mjs';

assert.equal(Number(process.versions.node.split('.')[0]), 24);
const here = new URL('./', import.meta.url), app = new URL('../../', here);
const server = spawn(process.execPath, ['.next-viewport-candidate-v2-20260930/standalone/apps/web/server.js'], {
    cwd: fileURLToPath(app), env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
        NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: '3000' }, stdio: 'ignore',
});
try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
        if (server.exitCode !== null) throw new Error('Owned server stopped');
        try { if ((await fetch('http://localhost:3000', { signal: AbortSignal.timeout(500) })).ok) { ready = true; break; } }
        catch { /* bounded owned-server startup */ }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(ready, true);
    const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config',
        fileURLToPath(new URL('playwright.config.mjs', here)), '--project', 'candidate'], {
        cwd: fileURLToPath(app), env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {
        const text = redactCliText(bytes.toString('utf8'), 4096);
        log += text;
        process.stdout.write(text);
    });
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    await writeFile(new URL('checks/regression-repair.log', here), log);
    assert.equal(code, 0);
} finally { if (server.exitCode === null) server.kill('SIGTERM'); }
