import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packageDirectory = path.dirname(require.resolve('maplibre-gl/package.json'));
const files = [
    ['dist/maplibre-gl-worker.mjs', 'maplibre-gl-worker.mjs'],
    ['dist/maplibre-gl-shared.mjs', 'maplibre-gl-shared.mjs'],
    ['LICENSE.txt', 'LICENSE.txt'],
];

// MapLibre 6.11's worker imports a sibling shared module. Publish the pinned
// dependency closure together, for both Next bundlers, without rewriting it.
export function prepareMapLibreWorkerAssets(webRoot, packageRoot = packageDirectory) {
    const assets = files.map(([input, name]) => ({ name, bytes: readFileSync(path.join(packageRoot, input)) }));
    const hash = createHash('sha256');
    for (const asset of assets) hash.update(asset.name).update('\0').update(asset.bytes).update('\0');
    const digest = hash.digest('hex');
    const parent = path.join(webRoot, 'public', 'scripts', 'maplibre');
    const destination = path.join(parent, digest);
    const verify = () => {
        for (const asset of assets) {
            if (!readFileSync(path.join(destination, asset.name)).equals(asset.bytes)) {
                throw new Error('MAPLIBRE_IMMUTABLE_ASSET_MISMATCH');
            }
        }
    };
    mkdirSync(parent, { recursive: true });
    if (!existsSync(destination)) {
        const staging = mkdtempSync(path.join(parent, '.prepare-'));
        try {
            for (const asset of assets) writeFileSync(path.join(staging, asset.name), asset.bytes);
            try {
                renameSync(staging, destination);
            } catch (error) {
                if (!existsSync(destination)) throw error;
                verify();
            }
        } finally {
            rmSync(staging, { recursive: true, force: true });
        }
    }
    verify();
    return { digest, workerUrl: `/scripts/maplibre/${digest}/maplibre-gl-worker.mjs` };
}
