import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const packageJson = readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf8');
const syncScript = readFileSync(join(import.meta.dir, '..', 'scripts', 'sync-standalone-static.mjs'), 'utf8');

describe('standalone static sync source contract', () => {
    test('start scripts copy static and public assets before launching standalone server', () => {
        expect(packageJson).toContain('"start": "node scripts/sync-standalone-static.mjs &&');
        expect(packageJson).toContain('"start:playwright": "node scripts/sync-standalone-static.mjs && PORT=8080 HOSTNAME=127.0.0.1');
    });

    test('sync script copies .next/static and public into the standalone app tree', () => {
        expect(syncScript).toContain("path.join(projectRoot, '.next', 'static')");
        expect(syncScript).toContain("path.join(standaloneAppDir, '.next', 'static')");
        expect(syncScript).toContain("path.join(projectRoot, 'public')");
        expect(syncScript).toContain("path.join(standaloneAppDir, 'public')");
        expect(syncScript).toContain('fs.cpSync(source, target');
    });
});
