"use client";

import { useState, useEffect, useSyncExternalStore } from "react";

// 전역 hydration 상태 관리 (싱글톤)
let isHydratedGlobal = false;
const listeners = new Set<() => void>();

const subscribe = (callback: () => void) => {
    listeners.add(callback);
    return () => listeners.delete(callback);
};

const getSnapshot = () => isHydratedGlobal;
const getServerSnapshot = () => false;

// 최초 1회만 hydration 상태 업데이트
if (typeof window !== "undefined" && !isHydratedGlobal) {
    isHydratedGlobal = true;
    listeners.forEach((listener) => listener());
}

/**
 * Hydration 완료 여부를 반환하는 커스텀 훅
 * 
 * 모든 컴포넌트에서 공유되는 전역 상태를 사용하여
 * 불필요한 상태 생성 및 useEffect 호출을 방지합니다.
 * 
 * @returns {boolean} hydration 완료 여부
 * 
 * @example
 * const isHydrated = useHydration();
 * 
 * return (
 *   <div className={isHydrated ? "opacity-100" : "opacity-0"}>
 *     Content
 *   </div>
 * );
 */
export function useHydration(): boolean {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * 간단한 버전의 useHydration (개별 컴포넌트용)
 * 컴포넌트별로 독립적인 hydration 상태가 필요한 경우 사용
 */
export function useHydrationLocal(): boolean {
    const [isHydrated, setIsHydrated] = useState(false);

    useEffect(() => {
        setIsHydrated(true);
    }, []);

    return isHydrated;
}
