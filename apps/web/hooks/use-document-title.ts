'use client';

import { useEffect, useRef } from 'react';

import { DEFAULT_TITLE, truncateBrowserTitleLabel } from '@/lib/seo';

export function useDocumentTitle(title: string | null | undefined): void {
    const lastAppliedTitleRef = useRef<string | null>(null);

    useEffect(() => {
        if (title == null || typeof document === 'undefined') {
            return;
        }

        const previousTitle = document.title;
        const nextTitle = truncateBrowserTitleLabel(title, Number.MAX_SAFE_INTEGER) || DEFAULT_TITLE;

        document.title = nextTitle;
        lastAppliedTitleRef.current = nextTitle;

        return () => {
            if (typeof document === 'undefined') {
                return;
            }

            if (lastAppliedTitleRef.current !== null && document.title === lastAppliedTitleRef.current) {
                document.title = previousTitle;
            }

            lastAppliedTitleRef.current = null;
        };
    }, [title]);
}
