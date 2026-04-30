import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, test } from 'bun:test';

import {
    buildStoryboardDriftFingerprint,
    validatePencilStoryboardManifest,
    type PencilStoryboardEntry,
    type PencilStoryboardManifest,
} from '../lib/pencil-storyboard/contracts';

function makeFixtureRoot(): string {
    const root = join(tmpdir(), `pencil-storyboard-manifest-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(join(root, 'app'), { recursive: true });
    mkdirSync(join(root, 'design/pencil/screenshots'), { recursive: true });
    mkdirSync(join(root, 'design/pencil/storyboards'), { recursive: true });
    mkdirSync(join(root, 'design/pencil/exports'), { recursive: true });
    writeFileSync(join(root, 'app/page.tsx'), 'export default function Page() { return null; }\n');
    writeFileSync(join(root, 'design/pencil/screenshots/home-mobile.png'), 'png');
    writeFileSync(join(root, 'design/pencil/storyboards/home-map.pen'), 'pen');
    writeFileSync(join(root, 'design/pencil/exports/home-map.png'), 'png');
    return root;
}

function makeManifest(): PencilStoryboardManifest {
    return {
        manifestVersion: 1,
        generatedAt: '2026-04-30T07:00:00Z',
        artifactRoot: 'design/pencil',
        entries: [
            {
                id: 'home-map',
                type: 'route',
                title: 'Home map',
                routePath: '/',
                sourcePaths: ['app/page.tsx'],
                viewports: [
                    {
                        key: 'mobile',
                        width: 390,
                        height: 844,
                        deviceScaleFactor: 2,
                        screenshotPath: 'design/pencil/screenshots/home-mobile.png',
                        screenshotHash: 'abc123abc123',
                    },
                    {
                        key: 'desktop',
                        width: 1440,
                        height: 1024,
                    },
                ],
                screenshotPath: 'design/pencil/screenshots/home-mobile.png',
                screenshotHash: 'def456def456',
                sourceHash: '0123456789ab',
                penPath: 'design/pencil/storyboards/home-map.pen',
                exportPaths: ['design/pencil/exports/home-map.png'],
                status: 'generated',
            },
        ],
    };
}

describe('Pencil storyboard manifest contract', () => {
    test('accepts a generated route storyboard manifest with existing source and artifact files', () => {
        const rootDir = makeFixtureRoot();
        const result = validatePencilStoryboardManifest(makeManifest(), {
            rootDir,
            requireExistingFiles: true,
        });

        expect(result).toEqual({ ok: true, errors: [] });
    });

    test('rejects unstable ids, missing source files, invalid viewports, and duplicate entries', () => {
        const manifest = makeManifest();
        manifest.entries = [
            {
                ...manifest.entries[0],
                id: 'Home Map',
                sourcePaths: ['app/missing-page.tsx'],
                viewports: [
                    {
                        key: 'watch' as never,
                        width: 0,
                        height: 844,
                    },
                ],
            },
            {
                ...manifest.entries[0],
                id: 'Home Map',
            },
        ];

        const result = validatePencilStoryboardManifest(manifest, {
            rootDir: makeFixtureRoot(),
            requireExistingFiles: true,
        });

        expect(result.ok).toBe(false);
        expect(result.errors).toContain('entries[0].id must be lowercase kebab-case: Home Map');
        expect(result.errors).toContain('entries[0].sourcePaths entry does not exist: app/missing-page.tsx');
        expect(result.errors).toContain('entries[].viewports[0].key must be mobile, tablet, or desktop');
        expect(result.errors).toContain('entries[].viewports[0].width must be a positive number');
        expect(result.errors).toContain('duplicate storyboard entry id: Home Map');
    });

    test('builds a deterministic drift fingerprint from source, viewport, and screenshot hashes', () => {
        const entry: PencilStoryboardEntry = makeManifest().entries[0];
        const reordered: PencilStoryboardEntry = {
            ...entry,
            sourcePaths: [...entry.sourcePaths].reverse(),
            viewports: [...entry.viewports].reverse(),
            reviewNotes: 'Human-only note should not affect drift.',
        };

        expect(buildStoryboardDriftFingerprint(reordered)).toBe(buildStoryboardDriftFingerprint(entry));

        const stale = {
            ...entry,
            sourceHash: 'ffffffffffff',
        };

        expect(buildStoryboardDriftFingerprint(stale)).not.toBe(buildStoryboardDriftFingerprint(entry));
    });
});
