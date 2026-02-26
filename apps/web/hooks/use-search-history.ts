'use client';

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'restaurant_search_history';
const MAX_HISTORY = 3;

export interface SearchHistoryItem {
    id: string;
    name: string;
    address: string;
    searchedAt: number;
}

export function useSearchHistory() {
    const [history, setHistory] = useState<SearchHistoryItem[]>([]);

    // 로컬스토리지에서 검색 기록 로드
    useEffect(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored) as SearchHistoryItem[];
                setHistory(parsed);
            }
        } catch (error) {
            console.error('검색 기록 로드 실패:', error);
        }
    }, []);

    // 검색 기록 추가
    const addToHistory = useCallback((item: Omit<SearchHistoryItem, 'searchedAt'>) => {
        // 기존 기록 불러오기
        let current: SearchHistoryItem[] = [];
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                current = JSON.parse(stored);
            }
        } catch (error) {
            console.error('검색 기록 로드 실패:', error);
        }

        // 중복 제거 (같은 ID가 있으면 제거)
        const filtered = current.filter(h => h.id !== item.id);

        // 새로운 항목을 맨 앞에 추가
        const newHistory = [
            { ...item, searchedAt: Date.now() },
            ...filtered
        ].slice(0, MAX_HISTORY); // 최대 5개까지만 유지

        // 로컬스토리지에 먼저 저장 (동기적으로, 컴포넌트 언마운트되어도 유실 방지)
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory));
        } catch (error) {
            console.error('검색 기록 저장 실패:', error);
        }

        // 상태 업데이트 (비동기, UI 반영용)
        setHistory(newHistory);
    }, []);

    // 검색 기록 삭제
    const removeFromHistory = useCallback((id: string) => {
        setHistory(prev => {
            const newHistory = prev.filter(h => h.id !== id);

            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory));
            } catch (error) {
                console.error('검색 기록 삭제 실패:', error);
            }

            return newHistory;
        });
    }, []);

    // 검색 기록 전체 삭제
    const clearHistory = useCallback(() => {
        setHistory([]);
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (error) {
            console.error('검색 기록 초기화 실패:', error);
        }
    }, []);

    return {
        history,
        addToHistory,
        removeFromHistory,
        clearHistory,
    };
}
