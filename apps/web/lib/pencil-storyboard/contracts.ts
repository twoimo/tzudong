import { existsSync } from 'node:fs';
import path from 'node:path';

export type PencilStoryboardSurfaceType = 'route' | 'component' | 'flow';
export type PencilStoryboardViewportKey = 'mobile' | 'tablet' | 'desktop';
export type PencilStoryboardStatus = 'planned' | 'captured' | 'generated' | 'stale' | 'review-needed';
export type PencilReviewQueueStatus = 'proposed' | 'needs-triage' | 'approved' | 'rejected' | 'implemented';
export type PencilReviewRiskLevel = 'low' | 'medium' | 'high';

export type PencilStoryboardViewport = {
    key: PencilStoryboardViewportKey;
    width: number;
    height: number;
    deviceScaleFactor?: number;
    screenshotPath?: string;
    screenshotHash?: string;
};

export type PencilStoryboardEntry = {
    id: string;
    type: PencilStoryboardSurfaceType;
    title: string;
    routePath?: string;
    sourcePaths: string[];
    viewports: PencilStoryboardViewport[];
    fixture?: string;
    authState?: 'public' | 'authenticated' | 'admin' | 'fixture';
    screenshotPath?: string;
    screenshotHash?: string;
    penPath?: string;
    exportPaths?: string[];
    sourceHash?: string;
    owner?: string;
    status: PencilStoryboardStatus;
    reviewNotes?: string;
};

export type PencilStoryboardManifest = {
    manifestVersion: 1;
    generatedAt: string;
    artifactRoot: string;
    sourceRoot?: string;
    entries: PencilStoryboardEntry[];
};

export type PencilReviewQueueItem = {
    queueVersion: 1;
    id: string;
    createdAt: string;
    pencil: {
        penPath: string;
        frameId?: string;
        nodeId?: string;
        exportPath: string;
    };
    mapping:
        | {
            status: 'mapped';
            surfaceId: string;
            routePath?: string;
            componentPath?: string;
            sourcePaths: string[];
        }
        | {
            status: 'unresolved';
            sourcePaths?: string[];
            reason: string;
        };
    visualDeltaSummary: string;
    suggestedSourceFiles: string[];
    riskLevel: PencilReviewRiskLevel;
    acceptanceCriteria: string[];
    status: PencilReviewQueueStatus;
    codeMutationMode: 'review-queue-only';
    directReactGeneration?: false;
    sourceMutationPerformed?: false;
};

export type PencilContractValidationOptions = {
    rootDir?: string;
    requireExistingFiles?: boolean;
};

export type PencilContractValidationResult = {
    ok: boolean;
    errors: string[];
};

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const HASH_PATTERN = /^[a-f0-9]{12,128}$/;
const VIEWPORT_KEYS = new Set<PencilStoryboardViewportKey>(['mobile', 'tablet', 'desktop']);
const SURFACE_TYPES = new Set<PencilStoryboardSurfaceType>(['route', 'component', 'flow']);
const MANIFEST_STATUSES = new Set<PencilStoryboardStatus>(['planned', 'captured', 'generated', 'stale', 'review-needed']);
const QUEUE_STATUSES = new Set<PencilReviewQueueStatus>(['proposed', 'needs-triage', 'approved', 'rejected', 'implemented']);
const RISK_LEVELS = new Set<PencilReviewRiskLevel>(['low', 'medium', 'high']);

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(isNonEmptyString);
}

function resolveWithinRoot(rootDir: string | undefined, filePath: string): string {
    return path.isAbsolute(filePath) ? filePath : path.resolve(rootDir ?? process.cwd(), filePath);
}

function pushIfMissingFile(
    errors: string[],
    label: string,
    filePath: unknown,
    options: PencilContractValidationOptions,
): void {
    if (!isNonEmptyString(filePath)) return;
    if (!options.requireExistingFiles) return;
    const resolved = resolveWithinRoot(options.rootDir, filePath);
    if (!existsSync(resolved)) {
        errors.push(`${label} does not exist: ${filePath}`);
    }
}

function validateStableId(errors: string[], label: string, value: unknown): void {
    if (!isNonEmptyString(value)) {
        errors.push(`${label} is required`);
        return;
    }
    if (!STABLE_ID_PATTERN.test(value)) {
        errors.push(`${label} must be lowercase kebab-case: ${value}`);
    }
}

function validateIsoTimestamp(errors: string[], label: string, value: unknown): void {
    if (!isNonEmptyString(value) || !ISO_TIMESTAMP_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
        errors.push(`${label} must be an ISO UTC timestamp`);
    }
}

function validateHash(errors: string[], label: string, value: unknown): void {
    if (value === undefined) return;
    if (!isNonEmptyString(value) || !HASH_PATTERN.test(value)) {
        errors.push(`${label} must be a lowercase hex hash with at least 12 characters`);
    }
}

function validateSourcePaths(
    errors: string[],
    label: string,
    value: unknown,
    options: PencilContractValidationOptions,
): string[] {
    if (!isStringArray(value) || value.length === 0) {
        errors.push(`${label} must include at least one source path`);
        return [];
    }
    for (const sourcePath of value) {
        pushIfMissingFile(errors, `${label} entry`, sourcePath, options);
    }
    return value;
}

function validateViewport(
    errors: string[],
    viewport: unknown,
    index: number,
    options: PencilContractValidationOptions,
): void {
    if (!isRecord(viewport)) {
        errors.push(`entries[].viewports[${index}] must be an object`);
        return;
    }
    const key = viewport.key;
    if (!isNonEmptyString(key) || !VIEWPORT_KEYS.has(key as PencilStoryboardViewportKey)) {
        errors.push(`entries[].viewports[${index}].key must be mobile, tablet, or desktop`);
    }
    for (const sizeKey of ['width', 'height'] as const) {
        if (typeof viewport[sizeKey] !== 'number' || viewport[sizeKey] <= 0) {
            errors.push(`entries[].viewports[${index}].${sizeKey} must be a positive number`);
        }
    }
    if (viewport.deviceScaleFactor !== undefined && (typeof viewport.deviceScaleFactor !== 'number' || viewport.deviceScaleFactor <= 0)) {
        errors.push(`entries[].viewports[${index}].deviceScaleFactor must be a positive number`);
    }
    validateHash(errors, `entries[].viewports[${index}].screenshotHash`, viewport.screenshotHash);
    pushIfMissingFile(errors, `entries[].viewports[${index}].screenshotPath`, viewport.screenshotPath, options);
}

function validateManifestEntry(
    errors: string[],
    entry: unknown,
    index: number,
    options: PencilContractValidationOptions,
): void {
    if (!isRecord(entry)) {
        errors.push(`entries[${index}] must be an object`);
        return;
    }
    validateStableId(errors, `entries[${index}].id`, entry.id);
    if (!isNonEmptyString(entry.type) || !SURFACE_TYPES.has(entry.type as PencilStoryboardSurfaceType)) {
        errors.push(`entries[${index}].type must be route, component, or flow`);
    }
    if (!isNonEmptyString(entry.title)) {
        errors.push(`entries[${index}].title is required`);
    }
    if (entry.routePath !== undefined && !isNonEmptyString(entry.routePath)) {
        errors.push(`entries[${index}].routePath must be non-empty when provided`);
    }
    validateSourcePaths(errors, `entries[${index}].sourcePaths`, entry.sourcePaths, options);
    if (!Array.isArray(entry.viewports) || entry.viewports.length === 0) {
        errors.push(`entries[${index}].viewports must include at least one viewport`);
    } else {
        entry.viewports.forEach((viewport, viewportIndex) => validateViewport(errors, viewport, viewportIndex, options));
    }
    if (entry.screenshotPath !== undefined) {
        pushIfMissingFile(errors, `entries[${index}].screenshotPath`, entry.screenshotPath, options);
    }
    if (entry.penPath !== undefined) {
        if (!isNonEmptyString(entry.penPath) || !entry.penPath.endsWith('.pen')) {
            errors.push(`entries[${index}].penPath must point to a .pen file`);
        }
        pushIfMissingFile(errors, `entries[${index}].penPath`, entry.penPath, options);
    }
    if (entry.exportPaths !== undefined) {
        if (!isStringArray(entry.exportPaths)) {
            errors.push(`entries[${index}].exportPaths must be an array of paths`);
        } else {
            entry.exportPaths.forEach((exportPath, exportIndex) => {
                pushIfMissingFile(errors, `entries[${index}].exportPaths[${exportIndex}]`, exportPath, options);
            });
        }
    }
    validateHash(errors, `entries[${index}].sourceHash`, entry.sourceHash);
    validateHash(errors, `entries[${index}].screenshotHash`, entry.screenshotHash);
    if (!isNonEmptyString(entry.status) || !MANIFEST_STATUSES.has(entry.status as PencilStoryboardStatus)) {
        errors.push(`entries[${index}].status must be a known storyboard status`);
    }
}

export function validatePencilStoryboardManifest(
    manifest: unknown,
    options: PencilContractValidationOptions = {},
): PencilContractValidationResult {
    const errors: string[] = [];
    if (!isRecord(manifest)) {
        return { ok: false, errors: ['manifest must be an object'] };
    }
    if (manifest.manifestVersion !== 1) {
        errors.push('manifestVersion must be 1');
    }
    validateIsoTimestamp(errors, 'generatedAt', manifest.generatedAt);
    if (!isNonEmptyString(manifest.artifactRoot)) {
        errors.push('artifactRoot is required');
    }
    if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
        errors.push('entries must include at least one storyboard entry');
    } else {
        const seenIds = new Set<string>();
        manifest.entries.forEach((entry, index) => {
            if (isRecord(entry) && isNonEmptyString(entry.id)) {
                if (seenIds.has(entry.id)) errors.push(`duplicate storyboard entry id: ${entry.id}`);
                seenIds.add(entry.id);
            }
            validateManifestEntry(errors, entry, index, options);
        });
    }
    return { ok: errors.length === 0, errors };
}

function validateReviewMapping(
    errors: string[],
    mapping: unknown,
    options: PencilContractValidationOptions,
): void {
    if (!isRecord(mapping)) {
        errors.push('mapping must be an object');
        return;
    }
    if (mapping.status === 'mapped') {
        validateStableId(errors, 'mapping.surfaceId', mapping.surfaceId);
        validateSourcePaths(errors, 'mapping.sourcePaths', mapping.sourcePaths, options);
        if (mapping.routePath !== undefined && !isNonEmptyString(mapping.routePath)) {
            errors.push('mapping.routePath must be non-empty when provided');
        }
        if (mapping.componentPath !== undefined) {
            if (!isNonEmptyString(mapping.componentPath)) {
                errors.push('mapping.componentPath must be non-empty when provided');
            } else {
                pushIfMissingFile(errors, 'mapping.componentPath', mapping.componentPath, options);
            }
        }
        return;
    }
    if (mapping.status === 'unresolved') {
        if (!isNonEmptyString(mapping.reason)) {
            errors.push('mapping.reason is required when mapping is unresolved');
        }
        if (mapping.sourcePaths !== undefined && !isStringArray(mapping.sourcePaths)) {
            errors.push('mapping.sourcePaths must be an array when provided');
        }
        return;
    }
    errors.push('mapping.status must be mapped or unresolved');
}

export function validatePencilReviewQueueItem(
    item: unknown,
    options: PencilContractValidationOptions = {},
): PencilContractValidationResult {
    const errors: string[] = [];
    if (!isRecord(item)) {
        return { ok: false, errors: ['review queue item must be an object'] };
    }
    if (item.queueVersion !== 1) {
        errors.push('queueVersion must be 1');
    }
    validateStableId(errors, 'id', item.id);
    validateIsoTimestamp(errors, 'createdAt', item.createdAt);

    if (!isRecord(item.pencil)) {
        errors.push('pencil must be an object');
    } else {
        if (!isNonEmptyString(item.pencil.penPath) || !item.pencil.penPath.endsWith('.pen')) {
            errors.push('pencil.penPath must point to a .pen file');
        }
        if (!isNonEmptyString(item.pencil.frameId) && !isNonEmptyString(item.pencil.nodeId)) {
            errors.push('pencil.frameId or pencil.nodeId is required');
        }
        if (!isNonEmptyString(item.pencil.exportPath)) {
            errors.push('pencil.exportPath is required');
        }
        pushIfMissingFile(errors, 'pencil.penPath', item.pencil.penPath, options);
        pushIfMissingFile(errors, 'pencil.exportPath', item.pencil.exportPath, options);
    }

    validateReviewMapping(errors, item.mapping, options);
    if (!isNonEmptyString(item.visualDeltaSummary)) {
        errors.push('visualDeltaSummary is required');
    }
    validateSourcePaths(errors, 'suggestedSourceFiles', item.suggestedSourceFiles, options);
    if (!isNonEmptyString(item.riskLevel) || !RISK_LEVELS.has(item.riskLevel as PencilReviewRiskLevel)) {
        errors.push('riskLevel must be low, medium, or high');
    }
    if (!isStringArray(item.acceptanceCriteria) || item.acceptanceCriteria.length === 0) {
        errors.push('acceptanceCriteria must include at least one criterion');
    }
    if (!isNonEmptyString(item.status) || !QUEUE_STATUSES.has(item.status as PencilReviewQueueStatus)) {
        errors.push('status must be a known review queue status');
    }
    if (item.codeMutationMode !== 'review-queue-only') {
        errors.push('codeMutationMode must be review-queue-only');
    }
    if (item.directReactGeneration !== undefined && item.directReactGeneration !== false) {
        errors.push('directReactGeneration must be false when present');
    }
    if (item.sourceMutationPerformed !== undefined && item.sourceMutationPerformed !== false) {
        errors.push('sourceMutationPerformed must be false when present');
    }
    return { ok: errors.length === 0, errors };
}

export function buildStoryboardDriftFingerprint(entry: PencilStoryboardEntry): string {
    const sourcePaths = [...entry.sourcePaths].sort();
    const viewportParts = [...entry.viewports]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((viewport) => [
            viewport.key,
            viewport.width,
            viewport.height,
            viewport.deviceScaleFactor ?? 1,
            viewport.screenshotHash ?? '',
            viewport.screenshotPath ?? '',
        ].join(':'));

    return JSON.stringify({
        id: entry.id,
        type: entry.type,
        routePath: entry.routePath ?? '',
        sourcePaths,
        sourceHash: entry.sourceHash ?? '',
        screenshotHash: entry.screenshotHash ?? '',
        viewports: viewportParts,
    });
}
