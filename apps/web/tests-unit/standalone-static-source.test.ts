import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const packageJson = readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf8');
const syncScript = readFileSync(join(import.meta.dir, '..', 'scripts', 'sync-standalone-static.mjs'), 'utf8');
const startScript = readFileSync(join(import.meta.dir, '..', 'scripts', 'start-standalone.mjs'), 'utf8');

describe('standalone static sync source contract', () => {
    test('start scripts copy static and public assets before launching standalone server', () => {
        expect(packageJson).toContain('"start": "node scripts/start-standalone.mjs"');
        expect(packageJson).toContain('"start:playwright": "node scripts/start-standalone.mjs --port 3000 --hostname localhost"');
        expect(startScript).toContain("spawnSync(process.execPath, ['scripts/sync-standalone-static.mjs']");
        expect(startScript).toContain("'--skip-clean'");
        expect(startScript).toContain("'.next/standalone/apps/web/server.js'");
    });

    test('sync script copies .next/static and public into the standalone app tree', () => {
        expect(syncScript).toContain("path.join(projectRoot, '.next', 'static')");
        expect(syncScript).toContain("path.join(standaloneAppDir, '.next', 'static')");
        expect(syncScript).toContain("path.join(projectRoot, 'public')");
        expect(syncScript).toContain("path.join(standaloneAppDir, 'public')");
        expect(syncScript).toContain('fs.cpSync(source, target');
    });
});
