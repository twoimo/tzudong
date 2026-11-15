type WorkQueue = (callback: () => void) => () => void;

/** One instance belongs to one mounted map, independently of its current index. */
export function createClusterIndexBuildScheduler() {
    let hasCompletedInitialBuild = false;

    return ({ build, scheduleInitial, scheduleRebuild }: {
        build: () => boolean;
        scheduleInitial: WorkQueue;
        scheduleRebuild: WorkQueue;
    }): (() => void) => {
        let cancelled = false;
        const schedule = hasCompletedInitialBuild ? scheduleRebuild : scheduleInitial;
        const cancelQueuedWork = schedule(() => {
            if (cancelled) return;
            // A detached map, cancellation or failure must not consume the first
            // visible build. Clearing an index later must not reset this latch.
            const completed = build();
            if (completed && !cancelled) hasCompletedInitialBuild = true;
        });

        return () => {
            if (cancelled) return;
            cancelled = true;
            cancelQueuedWork();
        };
    };
}
