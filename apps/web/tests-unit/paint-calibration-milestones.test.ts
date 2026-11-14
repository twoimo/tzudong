import { afterEach, describe, expect, test } from 'bun:test';
import {
    createPaintCalibrationInitialLatestQueryMarker,
    markPaintCalibrationMilestone,
    type PaintCalibrationMilestone,
} from '../lib/performance/paint-calibration-milestones';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
function installWindow(value: Partial<Window>) {
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value });
}
afterEach(() => {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
});

describe('paint calibration milestone boundary', () => {
    test('server and ordinary browser visits neither claim nor record diagnostics', () => {
        Reflect.deleteProperty(globalThis, 'window');
        expect(() => markPaintCalibrationMilestone('desktopImplementationLoadStarted')).not.toThrow();
        expect(createPaintCalibrationInitialLatestQueryMarker()).toBeNull();
        installWindow({});
        expect(() => markPaintCalibrationMilestone('mobileImplementationLoadStarted')).not.toThrow();
        expect(createPaintCalibrationInitialLatestQueryMarker()).toBeNull();
    });

    test('only the first claimed query owns phases; cached cards do not precede its sort', () => {
        const phases: PaintCalibrationMilestone[] = [];
        let claimed = false;
        installWindow({ __tzudongPaintCalibration: {
            mark: (phase) => { phases.push(phase); },
            claimInitialLatestQuery: () => {
                if (claimed) return false;
                claimed = true;
                return true;
            },
        } });
        markPaintCalibrationMilestone('desktopImplementationLoadStarted');
        markPaintCalibrationMilestone('desktopImplementationLoadReady');
        const query = createPaintCalibrationInitialLatestQueryMarker();
        expect(query).not.toBeNull();
        expect(createPaintCalibrationInitialLatestQueryMarker()).toBeNull();
        query!('latestFirstCardCommitted');
        query!('latestQueryStarted');
        // A retry uses this same marker. First-value retention belongs to the
        // collector, so a failed first request is not replaced by the retry.
        query!('latestQueryStarted');
        query!('latestRestaurantRowsReady');
        query!('latestKpiStarted');
        query!('latestKpiReady');
        query!('latestSortReady');
        query!('latestFirstCardCommitted');
        expect(phases).toEqual([
            'desktopImplementationLoadStarted', 'desktopImplementationLoadReady',
            'latestQueryStarted', 'latestQueryStarted', 'latestRestaurantRowsReady',
            'latestKpiStarted', 'latestKpiReady', 'latestSortReady', 'latestFirstCardCommitted',
        ]);
    });

    test('collector failures cannot fail an implementation import or successful query', () => {
        installWindow({ __tzudongPaintCalibration: {
            mark: () => { throw new Error('synthetic diagnostic failure'); },
            claimInitialLatestQuery: () => true,
        } });
        expect(() => markPaintCalibrationMilestone('mobileImplementationLoadReady')).not.toThrow();
        const query = createPaintCalibrationInitialLatestQueryMarker();
        expect(query).not.toBeNull();
        expect(() => {
            query!('latestQueryStarted');
            query!('latestSortReady');
            query!('latestFirstCardCommitted');
        }).not.toThrow();
        installWindow({ __tzudongPaintCalibration: {
            mark: () => {},
            claimInitialLatestQuery: () => { throw new Error('synthetic claim failure'); },
        } });
        expect(createPaintCalibrationInitialLatestQueryMarker()).toBeNull();
    });
});
