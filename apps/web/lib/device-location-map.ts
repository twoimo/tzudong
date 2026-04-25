export type DeviceLocationMode = 'position' | 'heading';

export interface DeviceMapLocation {
    lat: number;
    lng: number;
    accuracy: number | null;
    heading: number | null;
    mode: DeviceLocationMode;
    focusRequestId: number;
    updatedAt: number;
}

export interface DeviceLocationButtonStateInput {
    hasLocation: boolean;
    isHeadingMode: boolean;
    isPending: boolean;
}

export function normalizeCompassHeading(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return ((value % 360) + 360) % 360;
}

export function resolveDeviceOrientationHeading(
    event: Pick<DeviceOrientationEvent, 'alpha' | 'absolute'> & { webkitCompassHeading?: number | null }
): number | null {
    const webkitHeading = normalizeCompassHeading(event.webkitCompassHeading);
    if (webkitHeading !== null) return webkitHeading;

    if (event.absolute !== true) return null;
    const alphaHeading = normalizeCompassHeading(event.alpha);
    if (alphaHeading === null) return null;

    // DeviceOrientation alpha grows counter-clockwise on many Android browsers;
    // convert it to the same clockwise-from-north convention as compass headings.
    return normalizeCompassHeading(360 - alphaHeading);
}

export function resolveGeolocationHeading(value: number | null | undefined): number | null {
    return normalizeCompassHeading(value);
}

export function resolveDeviceLocationButtonLabel({
    hasLocation,
    isHeadingMode,
    isPending,
}: DeviceLocationButtonStateInput): string {
    if (isPending) return '현재 위치 확인 중';
    if (isHeadingMode) return '현재 위치와 방향 다시 확인';
    if (hasLocation) return '현재 위치 기준 방향 확인';
    return '현재 위치 보기';
}

export function shouldFocusDeviceLocation(
    previousFocusRequestId: number | null,
    location: Pick<DeviceMapLocation, 'focusRequestId'> | null
): boolean {
    return location !== null && previousFocusRequestId !== location.focusRequestId;
}

export function buildDeviceLocationMarkerHtml(location: Pick<DeviceMapLocation, 'accuracy' | 'heading' | 'mode'>): string {
    const heading = normalizeCompassHeading(location.heading);
    const showHeading = location.mode === 'heading' && heading !== null;
    const markerHeading = heading === null ? null : Math.round(heading * 10) / 10;
    const accuracyLabel = typeof location.accuracy === 'number' && Number.isFinite(location.accuracy)
        ? `${Math.round(location.accuracy)}m`
        : '현재 위치';

    return `
        <div style="position:relative;width:56px;height:56px;display:flex;align-items:center;justify-content:center;pointer-events:none;">
            <div style="position:absolute;width:34px;height:34px;border-radius:9999px;background:rgba(37,99,235,0.14);border:1px solid rgba(37,99,235,0.25);"></div>
            ${showHeading ? `<div aria-hidden="true" style="position:absolute;left:50%;top:2px;width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:22px solid rgba(37,99,235,0.68);transform:translateX(-50%) rotate(${markerHeading}deg);transform-origin:50% 26px;filter:drop-shadow(0 2px 3px rgba(15,23,42,0.22));"></div>` : ''}
            <div style="position:relative;width:18px;height:18px;border-radius:9999px;background:#2563eb;border:3px solid white;box-shadow:0 4px 12px rgba(37,99,235,0.45),0 0 0 1px rgba(15,23,42,0.16);"></div>
            <span style="position:absolute;left:50%;top:44px;transform:translateX(-50%);white-space:nowrap;border-radius:9999px;background:rgba(15,23,42,0.78);color:white;font-size:10px;font-weight:700;line-height:1;padding:4px 7px;box-shadow:0 2px 8px rgba(15,23,42,0.18);">${showHeading ? `${Math.round(heading)}°` : accuracyLabel}</span>
        </div>
    `;
}
