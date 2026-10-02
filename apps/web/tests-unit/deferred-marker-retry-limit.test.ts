import { test, expect } from 'bun:test';
import { Transpiler } from 'bun';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../components/map/NaverMapView.tsx', import.meta.url), 'utf8');
const compile = (code: string, bindings: Record<string, unknown>) => {
    const js = new Transpiler({ loader: 'tsx' }).transformSync(`function run() { ${code} }`);
    return new Function(...Object.keys(bindings), `${js}\nreturn run();`)(...Object.values(bindings));
};
const retryStart = source.indexOf('const clearMarkerRenderRetryTimer = useCallback(() => {');
const resetStart = source.indexOf('const resetMarkerRenderRetry = useCallback(() => {', retryStart);
const resetEnd = source.indexOf('}, [clearMarkerRenderRetryTimer]);', resetStart) + '}, [clearMarkerRenderRetryTimer]);'.length;
const limit = Number(/const MARKER_RENDER_EMPTY_RETRY_LIMIT = (\d+);/.exec(source)![1]);
const branchResets = [...source.matchAll(/markerRenderSignatureRef\.current = nextMarkerRenderSignature;\n\s+if \(deferredMarkerRenders.length === 0\) resetMarkerRenderRetry\(\);/g)].map(m => m[0]);
const tailStart = source.indexOf('        if (deferredMarkerRenders.length > 0) {');
const tailEnd = source.indexOf('\n    }, [clusters,', tailStart);

for (const [branch, resetCode] of branchResets.entries()) {
    test(`deferred provider failures preserve the real retry limit in branch ${branch}`, () => {
        const count = { current: 0 };
        const timer = { current: null as number | null };
        const timers = new Map<number, () => void>();
        let timerId = 0;
        let ticks = 0;
        const signature = { current: null as unknown };
        const callbacks = compile(`${source.slice(retryStart, resetEnd)}\nreturn {scheduleMarkerRenderRetry,resetMarkerRenderRetry};`, {
            useCallback: (fn: unknown) => fn,
            MARKER_RENDER_EMPTY_RETRY_LIMIT: limit,
            markerRenderEmptyRetryCountRef: count,
            markerRenderSignatureRef: signature,
            markerRenderRetryTimerRef: timer,
            MARKER_RENDER_EMPTY_RETRY_DELAY_MS: 120,
            window: {
                setTimeout: (fn: () => void) => { timers.set(++timerId, fn); return timerId; },
                clearTimeout: (id: number) => timers.delete(id),
            },
            setMarkerRenderRetryTick: (update: (n: number) => number) => { ticks = update(ticks); },
        });
        const expectedSignature = {};
        const pending = { current: null as unknown };
        let complete: (finished: boolean) => void = () => undefined;
        const render = () => compile(`${resetCode}\n${source.slice(tailStart, tailEnd)}`, {
            ...callbacks,
            markerRenderSignatureRef: signature,
            nextMarkerRenderSignature: expectedSignature,
            pendingOffscreenMarkerRendersRef: pending,
            earlyMarkerRenderKeyRef: { current: null },
            deferredMarkerRenders: [() => undefined],
            deferMarkerRenders: (_jobs: unknown, done: (finished: boolean) => void) => { complete = done; return () => undefined; },
        });
        for (let attempt = 0; attempt <= limit; attempt++) {
            render();
            complete(false);
            const first = timers.entries().next().value;
            if (first) { timers.delete(first[0]); first[1](); }
        }
        expect(count.current).toBe(limit);
        expect(ticks).toBe(limit);
        expect(signature.current).toBe(null);
        render();
        expect(count.current).toBe(limit); // The new batch has not succeeded yet.
        complete(true);
        expect(count.current).toBe(0);
        expect(signature.current).toBe(expectedSignature);
    });
}

test('both production rendering branches participate in the bounded failure checks', () => {
    expect(branchResets).toHaveLength(2);
    expect(tailStart).toBeGreaterThan(0);
    expect(resetEnd).toBeGreaterThan(resetStart);
});
