'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const LEGACY_STORAGE_KEY = 'restaurant_search_history';
const SESSION_STORAGE_PREFIX = 'tzudong_search_history_v2';
const MAX_HISTORY = 12;
const HISTORY_TTL_MS = 24 * 60 * 60 * 1000;
const SAFE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/;

export interface SearchHistoryItem {
    id: string;
    name: string;
    address: string;
    searchedAt: number;
}

function normalizeItem(value: unknown, now = Date.now()): SearchHistoryItem | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const item = value as Record<string, unknown>;
    if (
        typeof item.id !== 'string'
        || !SAFE_ID_PATTERN.test(item.id)
        || typeof item.name !== 'string'
        || item.name.length < 1
        || item.name.length > 120
        || typeof item.address !== 'string'
        || item.address.length > 240
        || typeof item.searchedAt !== 'number'
        || !Number.isSafeInteger(item.searchedAt)
        || item.searchedAt > now
        || now - item.searchedAt >= HISTORY_TTL_MS
    ) return null;
    return {
        id: item.id,
        name: item.name,
        address: item.address,
        searchedAt: item.searchedAt,
    };
}

function parseHistory(raw: string | null): SearchHistoryItem[] {
    if (!raw || raw.length > 16 * 1024) return [];
    try {
        const value = JSON.parse(raw) as unknown;
        if (!Array.isArray(value)) return [];
        return value
            .slice(0, MAX_HISTORY)
            .map((item) => normalizeItem(item))
            .filter((item): item is SearchHistoryItem => item !== null);
    } catch {
        return [];
    }
}

export function useSearchHistory() {
    const { user } = useAuth();
    const [history, setHistory] = useState<SearchHistoryItem[]>([]);
    const storageKey = useMemo(
        () => `${SESSION_STORAGE_PREFIX}:${user?.id ?? 'anonymous'}`,
        [user?.id],
    );

    useEffect(() => {
        try {
            localStorage.removeItem(LEGACY_STORAGE_KEY);
            const current = parseHistory(sessionStorage.getItem(storageKey));
            setHistory(current);
            if (current.length) sessionStorage.setItem(storageKey, JSON.stringify(current));
            else sessionStorage.removeItem(storageKey);
        } catch {
            setHistory([]);
        }

        return () => {
            try {
                sessionStorage.removeItem(storageKey);
            } catch {
                // Browser storage may be unavailable; in-memory state is discarded on unmount.
            }
        };
    }, [storageKey]);

    const addToHistory = useCallback((item: Omit<SearchHistoryItem, 'searchedAt'>) => {
        const nextItem = normalizeItem({ ...item, searchedAt: Date.now() });
        if (!nextItem) return;
        const current = (() => {
            try {
                return parseHistory(sessionStorage.getItem(storageKey));
            } catch {
                return [];
            }
        })();
        const next = [nextItem, ...current.filter((entry) => entry.id !== nextItem.id)].slice(0, MAX_HISTORY);
        try {
            sessionStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
            // The current tab still receives the in-memory update.
        }
        setHistory(next);
    }, [storageKey]);

    const removeFromHistory = useCallback((id: string) => {
        if (!SAFE_ID_PATTERN.test(id)) return;
        setHistory((previous) => {
            const next = previous.filter((item) => item.id !== id);
            try {
                if (next.length) sessionStorage.setItem(storageKey, JSON.stringify(next));
                else sessionStorage.removeItem(storageKey);
            } catch {
                // The current tab still receives the in-memory update.
            }
            return next;
        });
    }, [storageKey]);

    const clearHistory = useCallback(() => {
        setHistory([]);
        try {
            sessionStorage.removeItem(storageKey);
        } catch {
            // In-memory state is already cleared.
        }
    }, [storageKey]);

    return { history, addToHistory, removeFromHistory, clearHistory };
}
