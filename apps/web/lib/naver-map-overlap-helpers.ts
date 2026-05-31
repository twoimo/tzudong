type OverlapMarkerCandidate = {
    id: string;
    lat?: number | null;
    lng?: number | null;
};

type OverlapMarkerOffset = {
    count: number;
    index: number;
    x: number;
    y: number;
};

type ProjectionAdapter = {
    fromCoordToOffset: (coord: unknown) => { x: number; y: number };
    fromOffsetToCoord: (offset: unknown) => unknown;
};

const DEFAULT_OVERLAP_COORD_PRECISION = 6;
const OVERLAP_PAIR_GAP_PX = 18;
const OVERLAP_RING_BASE_RADIUS_PX = 18;
const OVERLAP_RING_RADIUS_STEP_PX = 4;
const OVERLAP_RING_MAX_RADIUS_PX = 34;

function formatOverlapCoord(value: number, precision = DEFAULT_OVERLAP_COORD_PRECISION) {
    return value.toFixed(precision);
}

export function buildNaverOverlappingMarkerKey(
    lat: number | null | undefined,
    lng: number | null | undefined,
    precision = DEFAULT_OVERLAP_COORD_PRECISION,
) {
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return `${formatOverlapCoord(lat, precision)}:${formatOverlapCoord(lng, precision)}`;
}

function getNaverOverlapMarkerOffset(index: number, count: number): OverlapMarkerOffset {
    if (count <= 1) {
        return { count, index, x: 0, y: 0 };
    }

    if (count === 2) {
        return {
            count,
            index,
            x: index === 0 ? -OVERLAP_PAIR_GAP_PX / 2 : OVERLAP_PAIR_GAP_PX / 2,
            y: 0,
        };
    }

    const radius = Math.min(
        OVERLAP_RING_MAX_RADIUS_PX,
        OVERLAP_RING_BASE_RADIUS_PX + Math.floor((count - 3) / 4) * OVERLAP_RING_RADIUS_STEP_PX,
    );
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / count;

    return {
        count,
        index,
        x: Math.round(Math.cos(angle) * radius),
        y: Math.round(Math.sin(angle) * radius),
    };
}

export function buildNaverOverlappingMarkerOffsets(
    candidates: OverlapMarkerCandidate[],
    precision = DEFAULT_OVERLAP_COORD_PRECISION,
) {
    const groups = new Map<string, OverlapMarkerCandidate[]>();

    candidates.forEach((candidate) => {
        const key = buildNaverOverlappingMarkerKey(candidate.lat, candidate.lng, precision);
        if (!key) return;

        const group = groups.get(key) ?? [];
        group.push(candidate);
        groups.set(key, group);
    });

    const offsets = new Map<string, OverlapMarkerOffset>();

    groups.forEach((group) => {
        if (group.length <= 1) return;

        [...group]
            .sort((a, b) => a.id.localeCompare(b.id))
            .forEach((candidate, index, sortedGroup) => {
                offsets.set(candidate.id, getNaverOverlapMarkerOffset(index, sortedGroup.length));
            });
    });

    return offsets;
}

export function resolveNaverOverlappingMarkerPosition({
    basePosition,
    createPoint,
    offset,
    projection,
}: {
    basePosition: unknown;
    createPoint: (x: number, y: number) => unknown;
    offset: OverlapMarkerOffset | null | undefined;
    projection: ProjectionAdapter | null | undefined;
}) {
    if (!offset || offset.count <= 1 || (!offset.x && !offset.y) || !projection) {
        return basePosition;
    }

    try {
        const basePixel = projection.fromCoordToOffset(basePosition);
        return projection.fromOffsetToCoord(createPoint(
            basePixel.x + offset.x,
            basePixel.y + offset.y,
        ));
    } catch {
        return basePosition;
    }
}
