type NaverWheelPoint = {
    x: number;
    y: number;
};

type NaverWheelLatLng = {
    lat: number;
    lng: number;
};

type NaverWheelProjectionLike = {
    fromCoordToOffset: (coord: unknown) => NaverWheelPoint;
    fromOffsetToCoord: (offset: unknown) => { lat: () => number; lng: () => number };
};

export type NaverWheelInput = {
    clientX: number;
    clientY: number;
    deltaY: number;
};

export function resolveNaverWheelZoomPlan({
    currentMapZoom,
    deltaY,
    maxZoom,
    minZoom,
    previousTargetZoom,
    timeDiffMs,
}: {
    currentMapZoom: number;
    deltaY: number;
    maxZoom: number;
    minZoom: number;
    previousTargetZoom: number;
    timeDiffMs: number;
}) {
    const normalizedDirection = Math.sign(deltaY);
    if (normalizedDirection === 0) {
        return {
            nextZoom: previousTargetZoom,
            normalizedDirection,
            shouldApply: false,
        } as const;
    }

    const baseZoom =
        timeDiffMs < 400 && Math.abs(previousTargetZoom - currentMapZoom) < 1.5
            ? previousTargetZoom
            : currentMapZoom;

    const zoomChange = normalizedDirection > 0 ? -1 : 1;
    const nextZoom = Math.max(minZoom, Math.min(maxZoom, Math.round(baseZoom) + zoomChange));

    return {
        nextZoom,
        normalizedDirection,
        shouldApply: nextZoom !== previousTargetZoom,
    } as const;
}

export function buildNaverWheelViewportPlan({
    centerOffset,
    clientX,
    clientY,
    rectHeight,
    rectLeft,
    rectTop,
    rectWidth,
}: {
    centerOffset: NaverWheelPoint;
    clientX: number;
    clientY: number;
    rectHeight: number;
    rectLeft: number;
    rectTop: number;
    rectWidth: number;
}) {
    const mousePoint = {
        x: clientX - rectLeft,
        y: clientY - rectTop,
    } satisfies NaverWheelPoint;
    const viewportCenterPoint = {
        x: rectWidth / 2,
        y: rectHeight / 2,
    } satisfies NaverWheelPoint;

    return {
        isInsideViewport: isNaverWheelPointInsideViewport({
            point: mousePoint,
            rectHeight,
            rectWidth,
        }),
        mouseOffset: {
            x: centerOffset.x + (mousePoint.x - viewportCenterPoint.x),
            y: centerOffset.y + (mousePoint.y - viewportCenterPoint.y),
        } satisfies NaverWheelPoint,
        mousePoint,
        viewportCenterPoint,
    } as const;
}

export function buildNaverWheelCenterOffsetAfterZoom({
    centerOffsetAfterZoom,
    mousePoint,
    viewportCenterPoint,
}: {
    centerOffsetAfterZoom: NaverWheelPoint;
    mousePoint: NaverWheelPoint;
    viewportCenterPoint: NaverWheelPoint;
}) {
    return {
        x: centerOffsetAfterZoom.x + (mousePoint.x - viewportCenterPoint.x),
        y: centerOffsetAfterZoom.y + (mousePoint.y - viewportCenterPoint.y),
    } as const;
}

export function buildNaverWheelAnchorAdjustmentPlan({
    anchorCoordBeforeZoom,
    centerOffsetAfterZoom,
    currentCenter,
    mousePoint,
    viewportCenterPoint,
}: {
    anchorCoordBeforeZoom: NaverWheelLatLng;
    centerOffsetAfterZoom: NaverWheelPoint;
    currentCenter: NaverWheelLatLng;
    mousePoint: NaverWheelPoint;
    viewportCenterPoint: NaverWheelPoint;
}) {
    return {
        anchorCoordBeforeZoom,
        currentCenter,
        mouseOffset: buildNaverWheelCenterOffsetAfterZoom({
            centerOffsetAfterZoom,
            mousePoint,
            viewportCenterPoint,
        }),
    } as const;
}

export function buildNaverWheelInput({
    clientX,
    clientY,
    deltaY,
}: NaverWheelInput) {
    return {
        clientX,
        clientY,
        deltaY,
    } as const;
}

export function resolveNaverWheelInputDispatch({
    input,
    isAnchorAdjusting,
}: {
    input: NaverWheelInput;
    isAnchorAdjusting: boolean;
}) {
    return {
        nextQueuedWheelInput: isAnchorAdjusting ? input : null,
        shouldHandleImmediately: !isAnchorAdjusting,
    } as const;
}

export function flushQueuedNaverWheelInput({
    isAnchorAdjusting,
    queuedWheelInput,
}: {
    isAnchorAdjusting: boolean;
    queuedWheelInput: NaverWheelInput | null;
}) {
    if (isAnchorAdjusting || !queuedWheelInput) {
        return {
            nextInput: null,
            nextQueuedWheelInput: queuedWheelInput,
            shouldHandleNextInput: false,
        } as const;
    }

    return {
        nextInput: queuedWheelInput,
        nextQueuedWheelInput: null,
        shouldHandleNextInput: true,
    } as const;
}

export function resolveNaverWheelPostAdjustPlan({
    currentZoom,
    hasQueuedWheelInput,
}: {
    currentZoom: number;
    hasQueuedWheelInput: boolean;
}) {
    return {
        nextIsAnchorAdjusting: false,
        nextTargetZoomLevel: currentZoom,
        shouldScheduleQueuedInput: hasQueuedWheelInput,
    } as const;
}

export function buildNaverWheelProjectionAdapter({
    createLatLng,
    createPoint,
    projection,
}: {
    createLatLng: (lat: number, lng: number) => unknown;
    createPoint: (x: number, y: number) => unknown;
    projection: NaverWheelProjectionLike;
}) {
    return {
        fromCoordToOffset: (coord: NaverWheelLatLng) =>
            projection.fromCoordToOffset(createLatLng(coord.lat, coord.lng)),
        fromOffsetToCoord: (offset: NaverWheelPoint) => {
            const coord = projection.fromOffsetToCoord(createPoint(offset.x, offset.y));
            return { lat: coord.lat(), lng: coord.lng() };
        },
    } as const;
}

export function clearNaverPendingAnchorAdjustListener<TListener>({
    pendingAnchorAdjustListener,
    removeListener,
}: {
    pendingAnchorAdjustListener: TListener | null;
    removeListener: (listener: TListener) => void;
}) {
    if (pendingAnchorAdjustListener) {
        removeListener(pendingAnchorAdjustListener);
    }

    return {
        nextPendingAnchorAdjustListener: null,
    } as const;
}

export function resolveNaverWheelCleanupState() {
    return {
        nextIsAnchorAdjusting: false,
        nextQueuedWheelInput: null,
    } as const;
}

function isNaverWheelPointInsideViewport({
    point,
    rectHeight,
    rectWidth,
}: {
    point: NaverWheelPoint;
    rectHeight: number;
    rectWidth: number;
}) {
    return point.x >= 0 && point.y >= 0 && point.x <= rectWidth && point.y <= rectHeight;
}
