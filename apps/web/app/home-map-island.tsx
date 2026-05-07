'use client';

import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { buildHomeMapActivationPlan } from './home-map-runtime-activation';

type HomeMapIslandProps = {
    children: ReactNode;
};

type ActivatedHomeRuntime = {
    HomeClientComponent: ComponentType;
    AppRuntimeShell: ComponentType<{ children: ReactNode }>;
};

export default function HomeMapIsland({ children }: HomeMapIslandProps) {
    const [activatedRuntime, setActivatedRuntime] = useState<ActivatedHomeRuntime | null>(null);
    const hasStartedLoadingRef = useRef(false);
    const isUnmountedRef = useRef(false);

    useEffect(() => {
        isUnmountedRef.current = false;
        return () => {
            isUnmountedRef.current = true;
        };
    }, []);

    const activateHomeRuntime = useCallback(() => {
        if (hasStartedLoadingRef.current) return;
        hasStartedLoadingRef.current = true;

        void Promise.all([
            import('./home-client'),
            import('./app-runtime-shell'),
        ]).then(([homeClientModule, appRuntimeShellModule]) => {
            if (isUnmountedRef.current) return;
            setActivatedRuntime({
                HomeClientComponent: homeClientModule.default,
                AppRuntimeShell: appRuntimeShellModule.AppRuntimeShell,
            });
        });
    }, []);

    useEffect(() => {
        if (activatedRuntime) return;

        const plan = buildHomeMapActivationPlan({
            search: window.location.search,
            hash: window.location.hash,
        });

        if (plan.activateImmediately) {
            activateHomeRuntime();
            return;
        }

        let timeoutId = 0;

        const scheduleActivation = () => {
            timeoutId = window.setTimeout(activateHomeRuntime, plan.delayMs);
        };

        for (const eventName of plan.events) {
            window.addEventListener(eventName, activateHomeRuntime, { once: true, passive: true });
        }
        scheduleActivation();

        return () => {
            window.clearTimeout(timeoutId);
            for (const eventName of plan.events) {
                window.removeEventListener(eventName, activateHomeRuntime);
            }
        };
    }, [activatedRuntime, activateHomeRuntime]);

    if (!activatedRuntime) {
        return <>{children}</>;
    }

    const { AppRuntimeShell, HomeClientComponent } = activatedRuntime;

    return (
        <AppRuntimeShell>
            <HomeClientComponent />
        </AppRuntimeShell>
    );
}
