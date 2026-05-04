'use client';

import { useEffect, useState, type ComponentType } from 'react';

interface UseDeferredComponentOptions {
    onError?: (error: unknown) => void;
    resetWhenDisabled?: boolean;
}

export function useDeferredComponent<TProps>(
    enabled: boolean,
    loader: () => Promise<ComponentType<TProps>>,
    options: UseDeferredComponentOptions = {}
) {
    const { onError, resetWhenDisabled = false } = options;
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

        loader()
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
    }, [Component, enabled, loader, onError, resetWhenDisabled]);

    return Component;
}
