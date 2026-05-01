import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import {
    buildStoryboardDriftFingerprint,
    validatePencilReviewQueueItem,
    validatePencilStoryboardManifest,
    type PencilStoryboardEntry,
    type PencilStoryboardManifest,
    type PencilReviewQueueItem,
} from '../lib/pencil-storyboard/contracts';

function makeStoryboardFixtureRoot(): string {
    const root = fs.mkdtempSync(join(tmpdir(), 'pencil-storyboard-contract-'));
    fs.mkdirSync(join(root, 'app'), { recursive: true });
    fs.mkdirSync(join(root, 'components/map'), { recursive: true });
    fs.mkdirSync(join(root, 'design/pencil/storyboards'), { recursive: true });
    fs.mkdirSync(join(root, 'design/pencil/screenshots'), { recursive: true });
    fs.mkdirSync(join(root, 'design/pencil/exports'), { recursive: true });
    fs.writeFileSync(join(root, 'app/page.tsx'), 'export default function Page() { return null; }\n');
    fs.writeFileSync(join(root, 'components/map/HomeMap.tsx'), 'export function HomeMap() { return null; }\n');
    fs.writeFileSync(join(root, 'design/pencil/storyboards/home-map.pen'), 'pen');
    fs.writeFileSync(join(root, 'design/pencil/screenshots/home-mobile.png'), 'png');
    fs.writeFileSync(join(root, 'design/pencil/exports/home-map.png'), 'png');
    fs.writeFileSync(join(root, 'design/pencil/exports/home-map-frame.png'), 'png');
    return root;
}

function makeStoryboardManifest(): PencilStoryboardManifest {
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

function makeReviewQueueItem(): PencilReviewQueueItem {
    return {
        queueVersion: 1,
        id: 'home-map-marker-spacing',
        createdAt: '2026-04-30T07:05:00Z',
        pencil: {
            penPath: 'design/pencil/storyboards/home-map.pen',
            frameId: 'frame-home-map-mobile',
            exportPath: 'design/pencil/exports/home-map-frame.png',
        },
        mapping: {
            status: 'mapped',
            surfaceId: 'home-map',
            routePath: '/',
            componentPath: 'components/map/HomeMap.tsx',
            sourcePaths: ['app/page.tsx', 'components/map/HomeMap.tsx'],
        },
        visualDeltaSummary: 'Increase marker tap target spacing on the mobile map frame.',
        suggestedSourceFiles: ['app/page.tsx', 'components/map/HomeMap.tsx'],
        riskLevel: 'medium',
        acceptanceCriteria: [
            'Mobile marker tap targets remain visible after the bottom sheet opens.',
            'Desktop route screenshots do not regress.',
        ],
        status: 'proposed',
        codeMutationMode: 'review-queue-only',
        directReactGeneration: false,
        sourceMutationPerformed: false,
    };
}

describe('pencil storyboard sync contract', () => {
    test('validates a generated storyboard manifest with existing source and artifact files', () => {
        const rootDir = makeStoryboardFixtureRoot();
        const result = validatePencilStoryboardManifest(makeStoryboardManifest(), {
            rootDir,
            requireExistingFiles: true,
        });

        expect(result).toEqual({ ok: true, errors: [] });
    });

    test('rejects unstable ids, missing source files, and invalid viewports', () => {
        const manifest = makeStoryboardManifest();
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
                id: 'home-map',
            },
        ];

        const result = validatePencilStoryboardManifest(manifest, {
            rootDir: makeStoryboardFixtureRoot(),
            requireExistingFiles: true,
        });

        expect(result.ok).toBe(false);
        expect(result.errors).toContain('entries[0].id must be lowercase kebab-case: Home Map');
        expect(result.errors).toContain('entries[0].sourcePaths entry does not exist: app/missing-page.tsx');
        expect(result.errors).toContain('entries[].viewports[0].key must be mobile, tablet, or desktop');
        expect(result.errors).toContain('entries[].viewports[0].width must be a positive number');
    });

    test('rejects duplicate manifest entry ids when the manifest otherwise looks healthy', () => {
        const manifest = makeStoryboardManifest();
        manifest.entries = [
            manifest.entries[0],
            {
                ...manifest.entries[0],
                title: 'Home map duplicate',
            },
        ];

        const result = validatePencilStoryboardManifest(manifest, {
            rootDir: makeStoryboardFixtureRoot(),
            requireExistingFiles: true,
        });

        expect(result.ok).toBe(false);
        expect(result.errors).toContain('duplicate storyboard entry id: home-map');
    });

    test('keeps redirect-only and loading storyboard surfaces separate from final route screenshots', () => {
        const storyboardRoutes = new Map([
            ['mypage', { kind: 'redirect', redirectTarget: '/mypage/submissions/new' }],
            ['submissions', { kind: 'redirect', redirectTarget: '/mypage' }],
            ['admin-insight', { kind: 'loading', skipSnapshot: true }],
            ['root-loading', { kind: 'loading', skipSnapshot: true }],
        ]);

        expect(storyboardRoutes.get('mypage')).toMatchObject({
            kind: 'redirect',
            redirectTarget: '/mypage/submissions/new',
        });
        expect(storyboardRoutes.get('submissions')).toMatchObject({
            kind: 'redirect',
            redirectTarget: '/mypage',
        });
        expect(storyboardRoutes.get('admin-insight')).toMatchObject({
            kind: 'loading',
            skipSnapshot: true,
        });
        expect(storyboardRoutes.get('root-loading')).toMatchObject({
            kind: 'loading',
            skipSnapshot: true,
        });
    });

    test('rejects direct React generation proposals and source mutation flags in the reverse-sync queue', () => {
        const validItem = validatePencilReviewQueueItem(makeReviewQueueItem(), {
            rootDir: makeStoryboardFixtureRoot(),
            requireExistingFiles: true,
        });

        expect(validItem).toEqual({ ok: true, errors: [] });

        const invalidItem = validatePencilReviewQueueItem({
            ...makeReviewQueueItem(),
            codeMutationMode: 'direct-react-codegen',
            directReactGeneration: true,
            sourceMutationPerformed: true,
            pencil: {
                penPath: 'design/pencil/storyboards/home-map.pen',
                frameId: 'frame-home-map-mobile',
                exportPath: 'design/pencil/exports/missing-frame.png',
            },
        }, {
            rootDir: makeStoryboardFixtureRoot(),
            requireExistingFiles: true,
        });

        expect(invalidItem.ok).toBe(false);
        expect(invalidItem.errors).toContain('pencil.exportPath does not exist: design/pencil/exports/missing-frame.png');
        expect(invalidItem.errors).toContain('codeMutationMode must be review-queue-only');
        expect(invalidItem.errors).toContain('directReactGeneration must be false when present');
        expect(invalidItem.errors).toContain('sourceMutationPerformed must be false when present');
    });

    test('keeps drift fingerprints stable when only review notes or ordering changes', () => {
        const entry: PencilStoryboardEntry = makeStoryboardManifest().entries[0];
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
