import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('local dev keeps the selected Node through prewarm and the Next launcher without PATH lookup', () => {
    const node = Bun.which('node');
    expect(node).not.toBeNull();
    const root = mkdtempSync(path.join(os.tmpdir(), 'tzudong-runtime-'));
    try {
        mkdirSync(path.join(root, 'scripts'));
        mkdirSync(path.join(root, 'empty-path'));
        mkdirSync(path.join(root, 'node_modules/next/dist/bin'), { recursive: true });
        for (const file of ['run-local-dev.mjs', 'dev-prewarm.mjs', 'local-dev-dist-dir.mjs', 'privacy-safe-cli-log.mjs']) {
            copyFileSync(path.resolve(import.meta.dir, '../scripts', file), path.join(root, 'scripts', file));
        }
        // Isolate DB admission; this regression exercises executable selection only.
        writeFileSync(path.join(root, 'scripts/local-supabase-runtime.mjs'), `
            export const loadLocalSupabaseEnvironment = () => ({ projectName: 'fixture', supabaseOrigin: 'http://127.0.0.1:20000', repositoryRoot: process.cwd() });
            export const assertLocalWebOrigin = () => {};
            export const assertLocalSupabaseReady = () => {};
            export const loadLocalWebInputEnvironment = () => ({});
            export const buildLocalWebEnvironment = () => ({ PATH: process.env.PATH, TZUDONG_DEV_PREWARM: '0' });
        `);
        // Forward the exact command chosen by prewarm, without a real server/cache.
        writeFileSync(path.join(root, 'scripts/clean-next.mjs'), `
            import { spawnSync } from 'node:child_process';
            const command = process.argv.slice(process.argv.indexOf('--') + 1);
            const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit' });
            process.exit(result.status ?? 99);
        `);
        writeFileSync(path.join(root, 'node_modules/next/dist/bin/next'), `
            const fs = require('node:fs');
            fs.writeFileSync('runtime.json', JSON.stringify({ executable: process.execPath, args: process.argv.slice(2) }));
        `);
        const result = spawnSync(node!, ['scripts/run-local-dev.mjs', '--port', '18080'], {
            cwd: root,
            env: { PATH: path.join(root, 'empty-path') },
            encoding: 'utf8',
            timeout: 10_000,
        });
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        const expected = spawnSync(node!, ['-p', 'process.execPath'], { encoding: 'utf8' }).stdout.trim();
        const observed = JSON.parse(readFileSync(path.join(root, 'runtime.json'), 'utf8'));
        expect(observed.executable).toBe(expected);
        expect(observed.args).toEqual(['dev', '--webpack', '--port', '18080', '--hostname', '127.0.0.1']);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
