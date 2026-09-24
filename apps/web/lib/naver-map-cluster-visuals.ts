import type Supercluster from 'supercluster';
import { createClusterMarkerHTML } from '@/lib/cluster-marker';
import type { ClusterProperties } from '@/lib/clustering';

const clusterVisualKeyCache = new Map<string, number>();

export function getClusterVisualKey(uniqueKey: string | number) {
    if (typeof uniqueKey === 'number') return uniqueKey;
    const cached = clusterVisualKeyCache.get(uniqueKey);
    if (cached !== undefined) return cached;

    const hash = Math.abs(uniqueKey.split('').reduce((acc, value) => (acc * 31 + value.charCodeAt(0)) | 0, 0));
    clusterVisualKeyCache.set(uniqueKey, hash);
    return hash;
}

export function buildClusterMarkerFeature({
    count,
    lat,
    lng,
}: {
    count: number;
    lat: number;
    lng: number;
}): Supercluster.ClusterFeature<ClusterProperties> {
    return {
        properties: { point_count: count },
        geometry: { coordinates: [lng, lat] },
    } as unknown as Supercluster.ClusterFeature<ClusterProperties>;
}

const clusterMarkerHtmlCache = new Map<string, string>();
const categoryJoinCache = new WeakMap<string[], string>();
const CLUSTER_MARKER_HTML_CACHE_LIMIT = 256;

function joinedClusterCategories(categories: string[]) {
    const cached = categoryJoinCache.get(categories);
    if (cached !== undefined) return cached;
    const joined = categories.join('\n');
    categoryJoinCache.set(categories, joined);
    return joined;
}

export function buildClusterMarkerContent({
    categories,
    count,
    currentIndex,
    lat,
    lng,
}: {
    categories: string[];
    count: number;
    currentIndex: number;
    lat: number;
    lng: number;
}) {
    const cacheKey = `${count}:${currentIndex}:${joinedClusterCategories(categories)}`;
    const cached = clusterMarkerHtmlCache.get(cacheKey);
    if (cached) return cached;

    const html = createClusterMarkerHTML(
        buildClusterMarkerFeature({ count, lat, lng }),
        categories,
        currentIndex,
    );
    if (clusterMarkerHtmlCache.size >= CLUSTER_MARKER_HTML_CACHE_LIMIT) {
        const oldest = clusterMarkerHtmlCache.keys().next().value;
        if (oldest !== undefined) clusterMarkerHtmlCache.delete(oldest);
    }
    clusterMarkerHtmlCache.set(cacheKey, html);
    return html;
}

const CLUSTER_MARKER_ANCHOR = { x: 24, y: 24 };
const clusterVisualCache = new WeakMap<string[], Map<number, Map<number, { content: string; anchor: { x: number; y: number } }>>>();

export function getNaverClusterMarkerVisual({
    categories,
    count,
    currentIndex,
    lat,
    lng,
}: {
    categories: string[];
    count: number;
    currentIndex: number;
    lat: number;
    lng: number;
}) {
    let byCount = clusterVisualCache.get(categories);
    if (!byCount) {
        byCount = new Map();
        clusterVisualCache.set(categories, byCount);
    }
    let byIndex = byCount.get(count);
    if (!byIndex) {
        byIndex = new Map();
        byCount.set(count, byIndex);
    }
    const cached = byIndex.get(currentIndex);
    if (cached) return cached;

    const visual = {
        content: buildClusterMarkerContent({ categories, count, currentIndex, lat, lng }),
        anchor: CLUSTER_MARKER_ANCHOR,
    };
    byIndex.set(currentIndex, visual);
    return visual;
}

const clusterPlanCache = new WeakMap<object, {
    anchor: { x: number; y: number };
    content: string;
    position: { lat: number; lng: number };
}>();

export function buildNaverClusterMarkerRenderPlan({
    categories,
    count,
    currentIndex,
    position,
}: {
    categories: string[];
    count: number;
    currentIndex: number;
    position: { lat: number; lng: number };
}) {
    const visual = getNaverClusterMarkerVisual({
        categories,
        count,
        currentIndex,
        lat: position.lat,
        lng: position.lng,
    });
    const cachedPlan = clusterPlanCache.get(visual);
    if (
        cachedPlan &&
        cachedPlan.position.lat === position.lat &&
        cachedPlan.position.lng === position.lng
    ) {
        return cachedPlan;
    }

    const plan = {
        anchor: visual.anchor,
        content: visual.content,
        position,
    };
    clusterPlanCache.set(visual, plan);
    return plan;
}

export function buildNaverClusterAnimationIconPlan({
    categories,
    count,
    getCurrentIndex,
    position,
    uniqueKey,
}: {
    categories: string[];
    count: number;
    getCurrentIndex: (hash: number, categoryCount: number) => number;
    position: { lat: number; lng: number };
    uniqueKey: string | number;
}) {
    const hash = getClusterVisualKey(uniqueKey);
    const currentIndex = getCurrentIndex(hash, categories.length);
    const renderPlan = buildNaverClusterMarkerRenderPlan({
        categories,
        count,
        currentIndex,
        position,
    });

    return {
        ...renderPlan,
        currentIndex,
        hash,
    } as const;
}

export function shouldReplaceNaverMarkerIcon(
    current: { content?: unknown; anchor?: { x?: number; y?: number } | null } | null | undefined,
    next: { content: unknown; anchor: { x: number; y: number } },
): boolean {
    if (!current || current.content !== next.content) return true;
    return current.anchor?.x !== next.anchor.x || current.anchor?.y !== next.anchor.y;
}
