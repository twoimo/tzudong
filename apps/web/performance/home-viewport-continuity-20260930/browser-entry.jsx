import React, { memo, useLayoutEffect, useState } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { renderToString } from 'react-dom/server.browser';
import { HomeRuntimeShell as BaselineShell } from 'baseline-shell';
import { HomeRuntimeShell as CandidateShell } from 'candidate-shell';

const modes = ['pending', 'desktop', 'mobileOrTablet'];
let counters;
const Row = memo(function Row({ index }) {
    useLayoutEffect(() => {
        counters.mounts++;
        return () => counters.unmounts++;
    }, []);
    return <div data-row={index}>Synthetic map row {index}</div>;
});
const MapProbe = memo(function MapProbe() {
    const [selection, setSelection] = useState('initial');
    return <section data-lab-map="true">
        <input aria-label="Synthetic map selection" value={selection} onChange={event => setSelection(event.target.value)} />
        <button onClick={() => setSelection('selected')}>Select synthetic item</button>
        {Array.from({ length: 200 }, (_, index) => <Row key={index} index={index} />)}
    </section>;
});
const probe = <MapProbe />;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

async function sample(kind, from, to, hydration = false) {
    if (!modes.includes(from) || !modes.includes(to)) throw new Error('Invalid mode');
    const Shell = kind === 'baseline' ? BaselineShell : CandidateShell;
    const host = document.createElement('div');
    document.body.append(host);
    globalThis.__viewportMode = from;
    counters = { mounts: 0, unmounts: 0 };
    let root;
    if (hydration) {
        host.innerHTML = renderToString(<Shell>{probe}</Shell>);
        root = hydrateRoot(host, <Shell>{probe}</Shell>);
        await tick();
        await tick();
    } else {
        root = createRoot(host);
        flushSync(() => root.render(<Shell>{probe}</Shell>));
    }
    await tick();
    flushSync(() => root.render(<Shell>{probe}</Shell>)); // Reveal loaded lazy chrome before timing.
    flushSync(() => host.querySelector('button').click());
    const input = host.querySelector('input');
    const map = host.querySelector('[data-lab-map]');
    const main = host.querySelector('main');
    input.focus();
    counters = { mounts: 0, unmounts: 0 };
    globalThis.__viewportMode = to;
    const start = performance.now();
    flushSync(() => root.render(<Shell>{probe}</Shell>));
    const durationMs = performance.now() - start;
    await tick();
    flushSync(() => root.render(<Shell>{probe}</Shell>));
    const result = {
        durationMs,
        ...counters,
        mapRetained: map === host.querySelector('[data-lab-map]'),
        mainRetained: main === host.querySelector('main'),
        selectionRetained: host.querySelector('input').value === 'selected',
        focusRetained: document.activeElement === input,
        mainCount: host.querySelectorAll('main').length,
        skeletonCount: host.querySelectorAll('[data-home-static-skeleton]').length,
        chrome: host.querySelector('nav')?.dataset.labChrome ?? null,
    };
    flushSync(() => root.unmount());
    host.remove();
    return result;
}

globalThis.viewportContinuityHarness = { sample };
