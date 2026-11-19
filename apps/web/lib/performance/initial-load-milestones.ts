/** Fixed, identifier-free phases for the explicitly requested diagnostic page. */
export type InitialLoadMilestone =
    | 'homeClientCommitted' | 'viewportResolved'
    | 'dataQueryStarted' | 'dataFetchCompleted' | 'dataMergeCompleted' | 'dataReady' | 'dataError'
    | 'naverSdkRequested' | 'naverSdkReady' | 'naverSdkError'
    | 'mapConstructionStarted' | 'mapConstructed' | 'mapConstructionError'
    | 'clusterIndexStarted' | 'clusterIndexReady'
    | 'controlsWrapperMounted' | 'mobileControlsMounted' | 'desktopPanelSettled';

declare global {
    interface Window {
        __tzudongInitialLoadDiagnostic?: {
            mark: (phase: InitialLoadMilestone, count?: number) => void;
        };
    }
}

// Ordinary visits neither install a collector nor import its implementation.
export function markInitialLoadMilestone(phase: InitialLoadMilestone, count?: number): void {
    if (typeof window !== 'undefined') window.__tzudongInitialLoadDiagnostic?.mark(phase, count);
}
