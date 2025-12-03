'use client';

import { useEffect, useState, useCallback } from "react";
import { NAVER_MAPS_CONFIG } from "@/config/maps";

declare global {
    interface Window {
        naver: {
            maps: Record<string, unknown>;
        };
    }
}

interface UseNaverMapsOptions {
    /** true면 즉시 로드, false면 수동 로드 (기본값: false - 지연 로딩) */
    autoLoad?: boolean;
}

export function useNaverMaps(options: UseNaverMapsOptions = {}) {
    const { autoLoad = false } = options;

    // 초기 상태를 스크립트 로드 여부로 설정 (페이지 전환 시 즉시 감지)
    const [isLoaded, setIsLoaded] = useState(() => {
        if (typeof window === 'undefined') return false;
        return !!(window.naver && window.naver.maps);
    });
    const [loadError, setLoadError] = useState<Error | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // 수동으로 스크립트 로드하는 함수
    const load = useCallback(() => {
        // 이미 로드되었거나 로딩 중이면 무시
        if (isLoaded || isLoading) return;

        // Client ID 검증
        if (!NAVER_MAPS_CONFIG.clientId) {
            setLoadError(new Error("네이버 지도 Client ID가 설정되지 않았습니다."));
            return;
        }

        // 이미 로드되었는지 확인
        if (window.naver && window.naver.maps) {
            setIsLoaded(true);
            return;
        }

        // 이미 로딩 중인 스크립트가 있는지 확인
        const existingScript = document.querySelector(
            'script[src*="oapi.map.naver.com"]'
        );

        if (existingScript) {
            setIsLoading(true);
            existingScript.addEventListener("load", () => {
                if (window.naver && window.naver.maps) {
                    setIsLoaded(true);
                    setIsLoading(false);
                } else {
                    setLoadError(new Error("네이버 지도 API 초기화 실패"));
                    setIsLoading(false);
                }
            });
            existingScript.addEventListener("error", () => {
                setLoadError(new Error("네이버 지도 API 로딩 실패 - 네트워크 오류"));
                setIsLoading(false);
            });
            return;
        }

        // 스크립트 로드 시작
        setIsLoading(true);
        const script = document.createElement("script");
        script.type = "text/javascript";
        script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${NAVER_MAPS_CONFIG.clientId}`;
        script.async = true;

        script.onload = () => {
            if (window.naver && window.naver.maps) {
                setIsLoaded(true);
                setIsLoading(false);
            } else {
                console.error("❌ 네이버 지도 API 초기화 실패");
                setLoadError(new Error("네이버 지도 API 초기화 실패"));
                setIsLoading(false);
            }
        };

        script.onerror = (error) => {
            console.error("❌ 네이버 지도 API 스크립트 로드 실패:", error);
            setLoadError(
                new Error(
                    "네이버 지도 API 스크립트 로드 실패 - Client ID 또는 웹 서비스 URL을 확인해주세요."
                )
            );
            setIsLoading(false);
        };

        document.head.appendChild(script);
    }, [isLoaded, isLoading]);

    // autoLoad가 true면 즉시 로드 (기존 동작)
    useEffect(() => {
        if (autoLoad) {
            load();
        }
    }, [autoLoad, load]);

    return { isLoaded, loadError, isLoading, load };
}

