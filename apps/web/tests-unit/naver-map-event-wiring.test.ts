import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createNaverCancellableCallback, removeNaverMapListener } from '../lib/naver-map-event-cleanup';
import {
    buildNaverMapInteractionHandlers,
    buildNaverMapInteractionListenerPlan,
    NAVER_INTERACTION_LISTENER_OPTIONS,
    NAVER_INTERACTION_REMOVE_OPTIONS,
} from '../lib/naver-map-interaction-helpers';

// Execute the actual component effect bodies with a synthetic SDK. This tests
// registration/dispatch, without requiring a particular inline callback spelling.
const text = readFileSync(new URL('../components/map/NaverMapView.tsx', import.meta.url), 'utf8');
const source = ts.createSourceFile('NaverMapView.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const effects: string[] = [];
function collect(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useEffect') {
        const callback = node.arguments[0];
        if (callback && ts.isArrowFunction(callback)) effects.push(callback.getText(source));
    }
    ts.forEachChild(node, collect);
}
collect(source);

function executeEffect(select: (effect: string) => boolean, bindings: Record<string, unknown>): () => void {
    const matching = effects.filter(select);
    expect(matching).toHaveLength(1);
    const js = ts.transpileModule(`const effect = ${matching[0]};`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText;
    const effect = new Function(...Object.keys(bindings), `${js}; return effect;`)(...Object.values(bindings)) as () => (() => void);
    const cleanup = effect();
    expect(typeof cleanup).toBe('function');
    return cleanup;
}

function harness() {
    const calls: string[] = [];
    const map = {};
    const listeners: Array<{ event: string; target: unknown; callback: () => void }> = [];
    const domListeners: Array<{ event: string; callback: () => void }> = [];
    let providerRemovals = 0;
    let domRemovals = 0;
    const Event = {
        addListener(target: unknown, event: string, callback: () => void) {
            const listener = { target, event, callback }; listeners.push(listener); return listener;
        },
        removeListener(listener: { callback: () => void }) {
            providerRemovals += 1;
            listener.callback(); // A provider may deliver synchronously during removal.
            throw new Error('NAVER_LISTENER_CLEANUP_FAILED');
        },
    };
    const hasUserMovedMapRef = { current: false };
    const bindings = {
        window: { naver: { maps: { Event } } }, isMapInitialized: true,
        mapInstanceRef: { current: map },
        mapRef: { current: {
            addEventListener(event: string, callback: () => void) { domListeners.push({ event, callback }); },
            removeEventListener() { domRemovals += 1; },
        } },
        activateNoncriticalMapEffects: () => { calls.push('activate'); },
        onMapInteraction: () => { calls.push('interaction'); },
        onMapBlankClick: () => { calls.push('blank'); },
        releaseSearchSelectionOnUserInteraction: () => { calls.push('release'); },
        createNaverCancellableCallback, removeNaverMapListener, hasUserMovedMapRef,
        buildNaverMapInteractionHandlers, buildNaverMapInteractionListenerPlan,
        NAVER_INTERACTION_LISTENER_OPTIONS, NAVER_INTERACTION_REMOVE_OPTIONS,
    };
    return { bindings, calls, map, listeners, domListeners, hasUserMovedMapRef,
        removals: () => ({ provider: providerRemovals, dom: domRemovals }) };
}

test('actual Naver blank-click registration dispatches the current handlers and cancels retained callbacks', () => {
    const h = harness();
    const cleanup = executeEffect(effect => effect.includes('onMapBlankClick') && effect.includes('mapInstanceRef.current'), h.bindings);
    expect(h.listeners).toHaveLength(1);
    expect(h.listeners[0].event).toBe('click');
    expect(h.listeners[0].target).toBe(h.map);
    h.listeners[0].callback();
    expect(h.calls).toEqual(['activate', 'interaction', 'blank']);
    cleanup();
    h.listeners[0].callback();
    expect(h.calls).toEqual(['activate', 'interaction', 'blank']);
    expect(h.removals().provider).toBe(1);
});

test('actual drag/pinch registration releases search ownership and becomes inert after cleanup', () => {
    const h = harness();
    const cleanup = executeEffect(effect => effect.includes('buildNaverMapInteractionHandlers'), h.bindings);
    expect(h.listeners.map(listener => listener.event)).toEqual(['dragstart', 'pinchstart']);
    for (const listener of h.listeners) listener.callback();
    expect(h.calls).toEqual(['activate', 'interaction', 'release', 'activate', 'interaction', 'release']);
    expect(h.hasUserMovedMapRef.current).toBe(true);
    cleanup();
    for (const listener of [...h.listeners, ...h.domListeners]) listener.callback();
    expect(h.calls).toHaveLength(6);
    expect(h.removals()).toEqual({ provider: 2, dom: 4 });
});
