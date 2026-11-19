import { describe, expect, test } from 'bun:test';
import { createClusterIndexBuildScheduler } from '../lib/cluster-index-build-scheduler';

function fixture() {
    const schedule = createClusterIndexBuildScheduler();
    const tasks: Array<{ queue: 'initial' | 'rebuild'; callback: () => void; cancellations: number }> = [];
    const queue = (kind: 'initial' | 'rebuild') => (callback: () => void) => {
        const task = { queue: kind, callback, cancellations: 0 };
        tasks.push(task);
        return () => { task.cancellations += 1; };
    };
    return {
        tasks,
        schedule: (build: () => boolean) => schedule({
            build, scheduleInitial: queue('initial'), scheduleRebuild: queue('rebuild'),
        }),
    };
}

describe('first complete cluster index scheduling', () => {
    test('queues the first build without running it synchronously and defers subsequent builds', () => {
        const f = fixture();
        let builds = 0;
        f.schedule(() => { builds += 1; return true; });
        expect(builds).toBe(0);
        expect(f.tasks[0].queue).toBe('initial');
        f.tasks[0].callback();
        f.schedule(() => { builds += 1; return true; });
        expect(builds).toBe(1);
        expect(f.tasks[1].queue).toBe('rebuild');
        f.tasks[1].callback();
        expect(builds).toBe(2);
    });

    test('a cancelled first task cannot publish stale input or consume initial priority', () => {
        const f = fixture();
        const published: string[] = [];
        const cancel = f.schedule(() => { published.push('old-query'); return true; });
        cancel();
        cancel();
        // Exercise an already-dispatched callback even if host cancellation is late.
        f.tasks[0].callback();
        f.schedule(() => { published.push('current-query'); return true; });
        expect(f.tasks.map((task) => task.queue)).toEqual(['initial', 'initial']);
        expect(f.tasks[0].cancellations).toBe(1);
        f.tasks[1].callback();
        expect(published).toEqual(['current-query']);
    });

    test('a detached map that skips its build leaves the next eligible build initial', () => {
        const f = fixture();
        f.schedule(() => false);
        f.tasks[0].callback();
        f.schedule(() => true);
        expect(f.tasks[1].queue).toBe('initial');
        f.tasks[1].callback();
        f.schedule(() => true);
        expect(f.tasks[2].queue).toBe('rebuild');
    });

    test('a throwing build keeps its failure observable and does not consume initial priority', () => {
        const f = fixture();
        f.schedule(() => { throw new Error('cluster-build-failed'); });
        expect(() => f.tasks[0].callback()).toThrow('cluster-build-failed');
        f.schedule(() => true);
        expect(f.tasks[1].queue).toBe('initial');
    });

    test('clearing the current index after a completed build does not restart initial priority', () => {
        const f = fixture();
        let currentIndex: string | null = null;
        f.schedule(() => { currentIndex = 'complete'; return true; });
        f.tasks[0].callback();
        currentIndex = null;
        f.schedule(() => { currentIndex = 'next-complete'; return true; });
        expect(currentIndex).toBeNull();
        expect(f.tasks[1].queue).toBe('rebuild');
        f.tasks[1].callback();
        expect(currentIndex).toBe('next-complete');
    });

    test('cancelled rebuilds retain the last complete index and later work stays deferred', () => {
        const f = fixture();
        let currentIndex = 'none';
        f.schedule(() => { currentIndex = 'first'; return true; });
        f.tasks[0].callback();
        const cancel = f.schedule(() => { currentIndex = 'stale'; return true; });
        cancel();
        f.tasks[1].callback();
        f.schedule(() => { currentIndex = 'latest'; return true; });
        expect(currentIndex).toBe('first');
        expect(f.tasks[2].queue).toBe('rebuild');
        f.tasks[2].callback();
        expect(currentIndex).toBe('latest');
    });

    test('a new mounted-map scheduler gets its own initial build', () => {
        const previous = fixture();
        previous.schedule(() => true);
        previous.tasks[0].callback();
        const next = fixture();
        next.schedule(() => true);
        expect(next.tasks[0].queue).toBe('initial');
    });
});
