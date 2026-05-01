import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, test } from 'bun:test';

import {
    validatePencilReviewQueueItem,
    type PencilReviewQueueItem,
} from '../lib/pencil-storyboard/contracts';

function makeFixtureRoot(): string {
    const root = join(tmpdir(), `pencil-storyboard-review-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(join(root, 'app'), { recursive: true });
    mkdirSync(join(root, 'components/map'), { recursive: true });
    mkdirSync(join(root, 'design/pencil/storyboards'), { recursive: true });
    mkdirSync(join(root, 'design/pencil/exports'), { recursive: true });
    writeFileSync(join(root, 'app/page.tsx'), 'export default function Page() { return null; }\n');
    writeFileSync(join(root, 'components/map/HomeMap.tsx'), 'export function HomeMap() { return null; }\n');
    writeFileSync(join(root, 'design/pencil/storyboards/home-map.pen'), 'pen');
    writeFileSync(join(root, 'design/pencil/exports/home-map-frame.png'), 'png');
    return root;
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

describe('Pencil storyboard review queue contract', () => {
    test('accepts a mapped review item that points Pencil exports to reviewable source files', () => {
        const result = validatePencilReviewQueueItem(makeReviewQueueItem(), {
            rootDir: makeFixtureRoot(),
            requireExistingFiles: true,
        });

        expect(result).toEqual({ ok: true, errors: [] });
    });

    test('accepts unresolved items as review queue entries without pretending to mutate code', () => {
        const item: PencilReviewQueueItem = {
            ...makeReviewQueueItem(),
            id: 'unknown-pencil-frame',
            mapping: {
                status: 'unresolved',
                reason: 'No route/component mapping found for exported Pencil node.',
            },
            suggestedSourceFiles: ['app/page.tsx'],
            riskLevel: 'high',
            status: 'needs-triage',
        };

        const result = validatePencilReviewQueueItem(item, {
            rootDir: makeFixtureRoot(),
            requireExistingFiles: true,
        });

        expect(result).toEqual({ ok: true, errors: [] });
    });

    test('rejects direct React generation, source mutation, missing exports, and unmapped Pencil nodes', () => {
        const item = {
            ...makeReviewQueueItem(),
            codeMutationMode: 'direct-react-codegen',
            directReactGeneration: true,
            sourceMutationPerformed: true,
            pencil: {
                penPath: 'design/pencil/storyboards/home-map.pen',
                exportPath: 'design/pencil/exports/missing-frame.png',
            },
        };

        const result = validatePencilReviewQueueItem(item, {
            rootDir: makeFixtureRoot(),
            requireExistingFiles: true,
        });

        expect(result.ok).toBe(false);
        expect(result.errors).toContain('pencil.frameId or pencil.nodeId is required');
        expect(result.errors).toContain('pencil.exportPath does not exist: design/pencil/exports/missing-frame.png');
        expect(result.errors).toContain('codeMutationMode must be review-queue-only');
        expect(result.errors).toContain('directReactGeneration must be false when present');
        expect(result.errors).toContain('sourceMutationPerformed must be false when present');
    });
});
