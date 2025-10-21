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

        // 이미 로딩 중인지 확인
        const existingScript = document.querySelector(
            'script[src*="oapi.map.naver.com"]'
        );
        if (existingScript) {
            existingScript.addEventListener("load", () => {
                if (window.naver && window.naver.maps) {
                    setIsLoaded(true);
                } else {
                    setLoadError(new Error("네이버 지도 API 초기화 실패"));
                }
            });
            existingScript.addEventListener("error", () =>
                setLoadError(new Error("네이버 지도 API 로딩 실패 - 네트워크 오류"))
            );
            return;
        }

        // 스크립트 로드
        const script = document.createElement("script");
        script.type = "text/javascript";
        script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${NAVER_MAPS_CONFIG.clientId}`;
        script.async = true;

        script.onload = () => {
            if (window.naver && window.naver.maps) {
                console.log("✅ 네이버 지도 API 로드 성공!");
                setIsLoaded(true);
            } else {
                console.error("❌ 네이버 지도 API 초기화 실패");
                setLoadError(new Error("네이버 지도 API 초기화 실패"));
            }
        };

        script.onerror = (error) => {
            console.error("❌ 네이버 지도 API 스크립트 로드 실패:", error);
            setLoadError(
                new Error(
                    "네이버 지도 API 스크립트 로드 실패 - Client ID 또는 웹 서비스 URL을 확인해주세요."
                )
            );
        };

        document.head.appendChild(script);

        return () => {
            // Cleanup은 필요하지 않음 (전역 스크립트이므로)
        };
    }, []);

    return { isLoaded, loadError };
}

