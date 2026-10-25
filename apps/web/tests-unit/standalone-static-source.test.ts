import { describe, expect, test } from 'bun:test';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const packageJson = readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf8');
const syncScript = readFileSync(join(import.meta.dir, '..', 'scripts', 'sync-standalone-static.mjs'), 'utf8');
const startScript = readFileSync(join(import.meta.dir, '..', 'scripts', 'start-standalone.mjs'), 'utf8');
const appRoot = join(import.meta.dir, '..');

describe('standalone static sync source contract', () => {
    test('start scripts copy static and public assets before launching standalone server', () => {
        expect(packageJson).toContain('"start": "node scripts/start-standalone.mjs"');
        expect(packageJson).toContain('"start:playwright": "node scripts/start-standalone.mjs --port 3000 --hostname localhost"');
        expect(startScript).toContain("spawnSync(process.execPath, ['scripts/sync-standalone-static.mjs']");
        expect(startScript).toContain("'--skip-clean'");
        expect(startScript).toContain("path.join(nextDirectoryName, 'standalone', 'apps', 'web', 'server.js')");
    });

    test('sync script copies .next/static and public into the standalone app tree', () => {
        expect(syncScript).toContain("path.join(projectRoot, nextDirectoryName, 'static')");
        expect(syncScript).toContain("path.join(standaloneAppDir, nextDirectoryName, 'static')");
        expect(syncScript).toContain("path.join(projectRoot, 'public')");
        expect(syncScript).toContain("path.join(standaloneAppDir, 'public')");
        expect(syncScript).toContain('fs.cpSync(source, target');
    });
});

describe('standalone selected build runtime', () => {
    test('launch and copied assets come from the same selected build while another build remains intact', () => {
        const root = mkdtempSync(join(tmpdir(), 'standalone-dist-'));
        try {
            mkdirSync(join(root, 'scripts'));
            for (const script of ['start-standalone.mjs', 'sync-standalone-static.mjs', 'clean-next.mjs', 'privacy-safe-cli-log.mjs', 'apply-next-sync-patch.mjs']) {
                copyFileSync(join(appRoot, 'scripts', script), join(root, 'scripts', script));
            }
            symlinkSync(join(appRoot, 'node_modules'), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
            mkdirSync(join(root, 'public'));
            writeFileSync(join(root, 'public', 'public-marker.txt'), 'public-fixture');
            const directories = ['.next', '.next-proof'];
            for (const directory of directories) {
                const standalone = join(root, directory, 'standalone', 'apps', 'web');
                mkdirSync(standalone, { recursive: true });
                mkdirSync(join(root, directory, 'static'), { recursive: true });
                writeFileSync(join(root, directory, 'static', 'asset-marker.txt'), directory);
                mkdirSync(join(standalone, directory, 'static'), { recursive: true });
                writeFileSync(join(standalone, directory, 'static', 'asset-marker.txt'), 'untouched');
                writeFileSync(join(standalone, 'server.js'), `
                    const fs = require('node:fs');
                    const path = require('node:path');
                    const directory = ${JSON.stringify(directory)};
                    if (fs.readFileSync(path.join(__dirname, directory, 'static', 'asset-marker.txt'), 'utf8') !== directory) process.exit(12);
                    if (fs.readFileSync(path.join(__dirname, 'public', 'public-marker.txt'), 'utf8') !== 'public-fixture') process.exit(13);
                    process.stdout.write('served-build:' + directory + '\\n');
                `);
            }
            // Select the isolated build first; a stale default server would exit
            // successfully too, so assert its identity and asset provenance.
            for (const directory of ['.next-proof', '.next']) {
                const other = directories.find((value) => value !== directory)!;
                const otherAsset = join(root, other, 'standalone', 'apps', 'web', other, 'static', 'asset-marker.txt');
                const otherBefore = readFileSync(otherAsset, 'utf8');
                const result = spawnSync(process.execPath, ['scripts/start-standalone.mjs'], {
                    cwd: root,
                    env: { ...process.env, TZUDONG_NEXT_DIST_DIR: directory === '.next' ? '' : directory },
                    encoding: 'utf8', timeout: 15_000,
                });
                expect(result.status).toBe(0);
                expect(result.stdout.match(/served-build:(\.next(?:-proof)?)(?:\s|$)/)?.[1]).toBe(directory);
                expect(readFileSync(otherAsset, 'utf8')).toBe(otherBefore);
            }
            for (const invalid of ['../outside', '.next/escape', '/tmp/outside']) {
                for (const script of ['start-standalone.mjs', 'sync-standalone-static.mjs']) {
                    const result = spawnSync(process.execPath, [`scripts/${script}`], {
                        cwd: root, env: { ...process.env, TZUDONG_NEXT_DIST_DIR: invalid },
                        encoding: 'utf8', timeout: 5000,
                    });
                    expect(result.status).toBe(1);
                    expect(result.stderr).toContain('InvalidDistDir');
                    expect(result.stdout).toBe('');
                }
            }
        } finally { rmSync(root, { recursive: true, force: true }); }
    });
});
