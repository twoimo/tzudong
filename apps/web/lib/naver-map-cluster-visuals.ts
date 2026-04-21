import type Supercluster from 'supercluster';
import { createClusterMarkerHTML } from '@/lib/cluster-marker';
import type { ClusterProperties } from '@/lib/clustering';

export function getClusterVisualKey(uniqueKey: string | number) {
    if (typeof uniqueKey === 'string') {
        return Math.abs(uniqueKey.split('').reduce((acc, value) => (acc * 31 + value.charCodeAt(0)) | 0, 0));
    }

    return uniqueKey;
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
    return createClusterMarkerHTML(
        buildClusterMarkerFeature({ count, lat, lng }),
        categories,
        currentIndex,
    );
}

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
    return {
        content: buildClusterMarkerContent({ categories, count, currentIndex, lat, lng }),
        anchor: { x: 24, y: 24 },
    };
}

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

    return {
        anchor: visual.anchor,
        content: visual.content,
        position,
    } as const;
}
