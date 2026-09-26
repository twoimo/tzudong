import React, { StrictMode, useLayoutEffect, useState } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { renderToString } from 'react-dom/server.browser';
import { AuthContext, useAuth } from '../../contexts/AuthContextBase';
import { EMPTY_NOTIFICATION_CONTEXT, NotificationContext, useNotifications } from '../../contexts/NotificationContextBase';
import { BaselineBoundary } from './baseline-boundary.jsx';
import { CandidateBoundary } from './candidate-boundary.jsx';

const noop = () => {};
const authBase = {
    user: null, session: null, isLoading: true, isAdmin: false,
    needsNicknameSetup: false, profileNickname: null,
    signIn: async () => {}, signOut: async () => {}, completeNicknameSetup: noop,
    resetPassword: async () => {}, updatePassword: async () => {},
};

function makeRuntime(label, counters) {
    const controls = {};
    function AuthProvider({ children }) {
        const [auth, setAuth] = useState({ ...authBase, profileNickname: label });
        controls.setAuth = (patch) => setAuth(current => ({ ...current, ...patch }));
        counters.authRenders++;
        useLayoutEffect(() => {
            counters.activeAuth++;
            return () => { counters.activeAuth--; };
        }, []);
        return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
    }
    function NotificationProvider({ children }) {
        const { user } = useAuth();
        const [count, setCount] = useState(0);
        controls.setCount = setCount;
        counters.notificationRenders++;
        useLayoutEffect(() => {
            counters.activeNotifications++;
            return () => { counters.activeNotifications--; };
        }, []);
        // Intentionally allocate a value on every source render, as the real provider does.
        return <NotificationContext.Provider value={{ ...EMPTY_NOTIFICATION_CONTEXT,
            unreadCount: user ? count : 0, markAllAsRead: () => setCount(0),
        }}>{children}</NotificationContext.Provider>;
    }
    return { AuthProvider, NotificationProvider, controls };
}

function Row({ index, counters }) {
    useLayoutEffect(() => {
        counters.mounts++;
        return () => { counters.unmounts++; };
    }, [counters]);
    return <div data-row={index}><span>Fixture {index}</span><span>Static restaurant card</span></div>;
}

function Probe({ counters, rows }) {
    const auth = useAuth();
    const notifications = useNotifications();
    const [count, setCount] = useState(0);
    return <section data-probe="true">
        <input aria-label="Synthetic draft" defaultValue="" />
        <button onClick={() => setCount(value => value + 1)} data-state={count}>Increment</button>
        <output data-auth={auth.user?.id ?? 'anonymous'} data-loading={String(auth.isLoading)}
            data-source={auth.profileNickname ?? 'fallback'} data-unread={notifications.unreadCount} />
        <button data-clear="true" onClick={notifications.markAllAsRead}>Clear</button>
        {Array.from({ length: rows }, (_, index) => <Row key={index} index={index} counters={counters} />)}
    </section>;
}

function setup(kind, rows = 200, strict = false, hydrate = false) {
    const counters = { mounts: 0, unmounts: 0, authRenders: 0, notificationRenders: 0,
        activeAuth: 0, activeNotifications: 0 };
    const runtime = makeRuntime('source-a', counters);
    const container = document.createElement('div');
    document.body.append(container);
    const Boundary = kind === 'baseline' ? BaselineBoundary : CandidateBoundary;
    const child = <Probe counters={counters} rows={rows} />;
    const tree = (providers, hasStoredSession = true) => {
        const result = <Boundary {...providers} hasStoredSession={hasStoredSession}>{child}</Boundary>;
        return strict ? <StrictMode>{result}</StrictMode> : result;
    };
    const initial = tree({ AuthProvider: null, NotificationProvider: null });
    let root;
    let hydrationErrors = 0;
    if (hydrate) {
        container.innerHTML = renderToString(initial);
        root = hydrateRoot(container, initial, { onRecoverableError() { hydrationErrors++; } });
    } else {
        root = createRoot(container);
        flushSync(() => root.render(initial));
    }
    return {
        counters, runtime, container,
        render(providers = runtime, hasStoredSession = true) {
            flushSync(() => root.render(tree(providers, hasStoredSession)));
        },
        hydrationErrors: () => hydrationErrors,
        cleanup() { flushSync(() => root.unmount()); container.remove(); },
    };
}

const frame = () => new Promise(resolve => requestAnimationFrame(resolve));

async function verify() {
    const checks = [];
    const check = (name, ok) => {
        checks.push({ name, ok: Boolean(ok) });
        if (!ok) throw new Error(`CHECK_FAILED:${name}`);
    };
    for (const strict of [false, true]) {
        const run = setup('candidate', 4, strict);
        try {
            const input = run.container.querySelector('input');
            const button = run.container.querySelector('button');
            input.value = 'synthetic draft';
            flushSync(() => button.click());
            const mounted = run.counters.mounts;
            run.render({ AuthProvider: run.runtime.AuthProvider, NotificationProvider: null });
            check(`partial module readiness stays anonymous (${strict})`, run.container.querySelector('output').dataset.auth === 'anonymous');
            run.render();
            check(`module readiness retains DOM and draft (${strict})`, input === run.container.querySelector('input') && input.value === 'synthetic draft');
            check(`module readiness retains React state (${strict})`, run.container.querySelector('button').dataset.state === '1');
            check(`module readiness causes no row remount (${strict})`, run.counters.mounts === mounted);
            check(`source providers mounted once (${strict})`, run.counters.activeAuth === 1 && run.counters.activeNotifications === 1);
            flushSync(() => run.runtime.controls.setAuth({ user: { id: 'synthetic-a' }, isLoading: false }));
            flushSync(() => run.runtime.controls.setCount(3));
            check(`fresh contexts forwarded (${strict})`, run.container.querySelector('output').dataset.auth === 'synthetic-a' && run.container.querySelector('output').dataset.unread === '3');
            flushSync(() => run.container.querySelector('[data-clear]').click());
            check(`forwarded actions work (${strict})`, run.container.querySelector('output').dataset.unread === '0');
            const counts = { ...run.counters };
            await frame(); await frame();
            check(`no publish feedback loop (${strict})`, run.counters.authRenders === counts.authRenders && run.counters.notificationRenders === counts.notificationRenders);
            const other = makeRuntime('source-b', run.counters);
            run.render(other);
            check(`provider replacement drops old snapshot (${strict})`, run.container.querySelector('output').dataset.source === 'source-b' && run.container.querySelector('output').dataset.auth === 'anonymous');
            check(`provider replacement retains application DOM (${strict})`, run.container.querySelector('input') === input);
            run.render({ AuthProvider: null, NotificationProvider: null });
            check(`disabled runtime clears projected values (${strict})`, run.container.querySelector('output').dataset.source === 'fallback' && run.counters.activeAuth === 0);
            run.render();
            run.render(run.runtime, false);
            check(`session boundary resets private draft (${strict})`, run.container.querySelector('input') !== input && run.container.querySelector('input').value === '' && run.container.querySelector('output').dataset.auth === 'anonymous');
        } finally { run.cleanup(); }
        check(`source provider cleanup (${strict})`, run.counters.activeAuth === 0 && run.counters.activeNotifications === 0);
    }
    const hyd = setup('candidate', 4, false, true);
    try {
        const initialInput = hyd.container.querySelector('input');
        await frame(); await frame();
        hyd.render();
        check('SSR hydration preserves DOM', hyd.container.querySelector('input') === initialInput);
        check('SSR hydration has no recoverable errors', hyd.hydrationErrors() === 0);
    } finally { hyd.cleanup(); }
    const old = setup('baseline', 4);
    try {
        const input = old.container.querySelector('input');
        input.value = 'synthetic draft';
        old.render();
        check('baseline reproduces DOM replacement and draft loss', old.container.querySelector('input') !== input && old.container.querySelector('input').value === '' && old.counters.unmounts === 4);
    } finally { old.cleanup(); }
    return checks;
}

async function sample(kind, rows) {
    const run = setup(kind, rows);
    try {
        await frame();
        const input = run.container.querySelector('input');
        input.value = 'synthetic draft';
        const before = { ...run.counters };
        const started = performance.now();
        run.render();
        const durationMs = performance.now() - started;
        return { durationMs, rowMounts: run.counters.mounts - before.mounts,
            rowUnmounts: run.counters.unmounts - before.unmounts,
            inputRetained: run.container.querySelector('input') === input,
            draftRetained: run.container.querySelector('input').value === 'synthetic draft' };
    } finally { run.cleanup(); }
}

window.providerTransitionHarness = { verify, sample };
