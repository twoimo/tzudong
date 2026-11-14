/** Fixed, identifier-free phases for the separate paint calibration opt-in. */
export const PAINT_CALIBRATION_MILESTONE_KEYS = [
    'desktopImplementationLoadStarted', 'desktopImplementationLoadReady',
    'mobileImplementationLoadStarted', 'mobileImplementationLoadReady',
    'latestQueryStarted', 'latestRestaurantRowsReady',
    'latestKpiStarted', 'latestKpiReady', 'latestSortReady', 'latestFirstCardCommitted',
] as const;

export type PaintCalibrationMilestone = typeof PAINT_CALIBRATION_MILESTONE_KEYS[number];
export type PaintCalibrationLatestQueryPhase = Extract<PaintCalibrationMilestone, `latest${string}`>;
export type PaintCalibrationLatestQueryMarker = (phase: PaintCalibrationLatestQueryPhase) => void;

declare global {
    interface Window {
        __tzudongPaintCalibration?: {
            mark: (phase: PaintCalibrationMilestone) => void;
            claimInitialLatestQuery: () => boolean;
        };
    }
}

// Ordinary visits never install this bag or import the collector implementation.
export function markPaintCalibrationMilestone(phase: PaintCalibrationMilestone): void {
    if (typeof window === 'undefined') return;
    try {
        window.__tzudongPaintCalibration?.mark(phase);
    } catch {
        // A diagnostic failure must not change module loading or application data.
    }
}

/** The initial home query retains its one marker across its existing retries. */
export function createPaintCalibrationInitialLatestQueryMarker(): PaintCalibrationLatestQueryMarker | null {
    if (typeof window === 'undefined') return null;
    const collector = window.__tzudongPaintCalibration;
    if (!collector) return null;
    try {
        if (!collector.claimInitialLatestQuery()) return null;
    } catch {
        return null;
    }

    let hasSortedInitialQuery = false;
    return (phase) => {
        if (phase === 'latestSortReady') hasSortedInitialQuery = true;
        // Cached or placeholder cards must not be attributed to this query.
        if (phase === 'latestFirstCardCommitted' && !hasSortedInitialQuery) return;
        try {
            collector.mark(phase);
        } catch {
            // Do not turn successful reads or commits into diagnostic failures.
        }
    };
}
