import React, { StrictMode, Suspense, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useInitialLoadPending } from '../../lib/use-initial-load-pending';

type ProbeProps = { ready: boolean; suspend?: boolean; onReady?: () => void };

function Probe({ ready, suspend = false, onReady }: ProbeProps) {
    const pending = useInitialLoadPending(ready);
    useLayoutEffect(() => {
        if (!pending && ready) onReady?.();
    }, [onReady, pending, ready]);
    if (suspend) throw new Promise<never>(() => {});
    return <output data-pending={String(pending)} data-ready={String(ready)} />;
}

function render(root: Root, props: ProbeProps, strict: boolean) {
    flushSync(() => root.render(
        <Suspense fallback={<output data-suspended="true" />}>
            {strict ? <StrictMode><Probe {...props} /></StrictMode> : <Probe {...props} />}
        </Suspense>,
    ));
}

function assert(name: string, condition: boolean, checks: string[]) {
    if (!condition) throw new Error(`CHECK_FAILED:${name}`);
    checks.push(name);
}

function pending(container: HTMLElement) {
    return container.querySelector('output[data-pending]')?.getAttribute('data-pending');
}

export function verifyInitialLoadPending() {
    const checks: string[] = [];
    for (const strict of [false, true]) {
        let readyCalls = 0;
        const onReady = () => { readyCalls += 1; };
        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);
        try {
            render(root, { ready: false, onReady }, strict);
            assert(`initial loading ${strict}`, pending(container) === 'true' && readyCalls === 0, checks);

            render(root, { ready: true, onReady }, strict);
            assert(`ready commit ${strict}`, pending(container) === 'false' && readyCalls >= 1, checks);

            render(root, { ready: false, onReady }, strict);
            assert(`background refresh ${strict}`, pending(container) === 'false', checks);
        } finally {
            flushSync(() => root.unmount());
            container.remove();
        }

        const freshContainer = document.createElement('div');
        document.body.append(freshContainer);
        const freshRoot = createRoot(freshContainer);
        try {
            render(freshRoot, { ready: false }, strict);
            assert(`fresh mount resets loading ${strict}`, pending(freshContainer) === 'true', checks);
            render(freshRoot, { ready: true, suspend: true }, strict);
            render(freshRoot, { ready: false }, strict);
            assert(`aborted ready render does not latch ${strict}`, pending(freshContainer) === 'true', checks);
        } finally {
            flushSync(() => freshRoot.unmount());
            freshContainer.remove();
        }
    }
    return checks;
}

Object.assign(window, { verifyInitialLoadPending });
