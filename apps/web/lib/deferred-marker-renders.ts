/** Render offscreen tail work after the first paint, with bounded task slices. */
export function deferMarkerRenders(jobs: Array<(() => void) | undefined>, complete: (finished: boolean) => void) {
    const channel = new MessageChannel();
    let cursor = 0;
    let stopped = false;
    const stop = () => {
        if (stopped) return;
        stopped = true;
        cancelAnimationFrame(frame);
        jobs.length = 0;
        channel.port1.onmessage = null;
        channel.port1.close();
        channel.port2.close();
    };
    channel.port1.onmessage = () => {
        if (stopped) return;
        const end = Math.min(cursor + 32, jobs.length);
        while (cursor < end && !stopped) {
            const render = jobs[cursor];
            jobs[cursor++] = undefined;
            try { render?.(); }
            catch { stop(); complete(false); return; }
        }
        if (stopped) return;
        if (cursor === jobs.length) { stop(); complete(true); }
        else channel.port2.postMessage(null);
    };
    const frame = requestAnimationFrame(() => channel.port2.postMessage(null));
    return stop;
}
