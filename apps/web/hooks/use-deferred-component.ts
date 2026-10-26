'use client';

import { useCallback, useEffect, useState, type ComponentType } from 'react';

interface UseDeferredComponentOptions {
    onError?: (error: unknown) => void;
    resetWhenDisabled?: boolean;
    retryKey?: number;
}

export function useDeferredComponent<TProps>(
    enabled: boolean,
    loader: () => Promise<ComponentType<TProps>>,
    options: UseDeferredComponentOptions = {}
) {
    const { onError, resetWhenDisabled = false, retryKey = 0 } = options;
    const [Component, setComponent] = useState<ComponentType<TProps> | null>(null);

    useEffect(() => {
        let cancelled = false;

        if (!enabled) {
            if (resetWhenDisabled) {
                setComponent(null);
            }
            return () => {
                cancelled = true;
            };
        }

        if (Component) {
            return () => {
                cancelled = true;
            };
        }

        Promise.resolve().then(loader)
            .then((LoadedComponent) => {
                if (!cancelled) {
                    setComponent(() => LoadedComponent);
                }
            })
            .catch((error) => {
                if (!cancelled) {
                    onError?.(error);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [Component, enabled, loader, onError, resetWhenDisabled, retryKey]);

    return Component;
}

/** A recoverable loader boundary; callers keep destination and input state. */
export function useDeferredComponentWithRetry<TProps>(enabled: boolean, loader: () => Promise<ComponentType<TProps>>) {
    const [failed, setFailed] = useState(false);
    const [retryKey, setRetryKey] = useState(0);
    const onError = useCallback(() => setFailed(true), []);
    const retry = useCallback(() => { setFailed(false); setRetryKey(value => value + 1); }, []);
    const Component = useDeferredComponent(enabled, loader, { onError, retryKey });
    return { Component, failed, retry };
}
