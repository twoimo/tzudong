import { useEffect, useState } from "react";
import { NAVER_MAPS_CONFIG } from "@/config/maps";

declare global {
    interface Window {
        naver: any;
    }
}

export function useNaverMaps() {
    const [isLoaded, setIsLoaded] = useState(false);
    const [loadError, setLoadError] = useState<Error | null>(null);

    useEffect(() => {
        // 이미 로드되었는지 확인
        if (window.naver && window.naver.maps) {
            setIsLoaded(true);
            return;
        }

        // 이미 로딩 중인지 확인
        const existingScript = document.querySelector(
            'script[src*="openapi.map.naver.com"]'
        );
        if (existingScript) {
            existingScript.addEventListener("load", () => setIsLoaded(true));
            existingScript.addEventListener("error", (e) =>
                setLoadError(new Error("네이버 지도 API 로딩 실패"))
            );
            return;
        }

        // 스크립트 로드
        const script = document.createElement("script");
        script.src = `https://openapi.map.naver.com/openapi/v3/maps.js?ncpClientId=${NAVER_MAPS_CONFIG.clientId}&submodules=clustering`;
        script.async = true;

        script.onload = () => {
            if (window.naver && window.naver.maps) {
                setIsLoaded(true);
            } else {
                setLoadError(new Error("네이버 지도 API 초기화 실패"));
            }
        };

        script.onerror = () => {
            setLoadError(new Error("네이버 지도 API 스크립트 로드 실패"));
        };

        document.head.appendChild(script);

        return () => {
            // Cleanup은 필요하지 않음 (전역 스크립트이므로)
        };
    }, []);

    return { isLoaded, loadError };
}

