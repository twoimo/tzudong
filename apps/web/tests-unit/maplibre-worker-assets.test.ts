import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareMapLibreWorkerAssets } from '../scripts/prepare-maplibre-worker-assets.mjs';

const owned: string[] = [];
afterEach(() => { for (const root of owned.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'tzudong-worker-assets-'));
    owned.push(root);
    const pkg = join(root, 'package');
    const dist = join(pkg, 'dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, 'maplibre-gl-worker.mjs'), "import './maplibre-gl-shared.mjs';\n");
    writeFileSync(join(dist, 'maplibre-gl-shared.mjs'), 'export const shared = 1;\n');
    writeFileSync(join(pkg, 'LICENSE.txt'), 'fixture license\n');
    return { root, pkg, dist };
}

describe('MapLibre immutable worker dependency closure', () => {
    test('publishes the worker, its relative module and license together without rewriting bytes', () => {
        const { root, pkg, dist } = fixture();
        const result = prepareMapLibreWorkerAssets(root, pkg);
        const worker = join(root, 'public', result.workerUrl);
        const shared = join(root, 'public/scripts/maplibre', result.digest, 'maplibre-gl-shared.mjs');
        expect(readFileSync(worker)).toEqual(readFileSync(join(dist, 'maplibre-gl-worker.mjs')));
        expect(readFileSync(shared)).toEqual(readFileSync(join(dist, 'maplibre-gl-shared.mjs')));
        expect(readFileSync(join(root, 'public/scripts/maplibre', result.digest, 'LICENSE.txt'), 'utf8')).toBe('fixture license\n');
        const mtime = statSync(worker).mtimeMs;
        expect(prepareMapLibreWorkerAssets(root, pkg)).toEqual(result);
        expect(statSync(worker).mtimeMs).toBe(mtime);
    });

    test('a shared-module change changes the entire worker URL and preserves the earlier build', () => {
        const { root, pkg, dist } = fixture();
        const before = prepareMapLibreWorkerAssets(root, pkg);
        writeFileSync(join(dist, 'maplibre-gl-shared.mjs'), 'export const shared = 2;\n');
        const after = prepareMapLibreWorkerAssets(root, pkg);
        expect(after.workerUrl).not.toBe(before.workerUrl);
        expect(existsSync(join(root, 'public', before.workerUrl))).toBe(true);
        expect(existsSync(join(root, 'public', after.workerUrl))).toBe(true);
    });

    test('refuses to overwrite a changed supposedly immutable asset', () => {
        const { root, pkg } = fixture();
        const result = prepareMapLibreWorkerAssets(root, pkg);
        const worker = join(root, 'public', result.workerUrl);
        writeFileSync(worker, 'changed');
        expect(() => prepareMapLibreWorkerAssets(root, pkg)).toThrow('MAPLIBRE_IMMUTABLE_ASSET_MISMATCH');
        expect(readFileSync(worker, 'utf8')).toBe('changed');
    });

    test('a missing sibling does not publish a partial worker set', () => {
        const { root, pkg, dist } = fixture();
        rmSync(join(dist, 'maplibre-gl-shared.mjs'));
        expect(() => prepareMapLibreWorkerAssets(root, pkg)).toThrow();
        expect(existsSync(join(root, 'public/scripts/maplibre'))).toBe(false);
    });
});
