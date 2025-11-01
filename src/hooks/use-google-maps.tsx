import { useEffect, useState } from "react";

interface UseGoogleMapsOptions {
    apiKey: string;
    libraries?: string[];
}

// 전역 로드 상태 캐시 (중복 로드 방지)
let globalLoadState: { isLoaded: boolean; error: Error | null; isLoading: boolean } = {
    isLoaded: false,
    error: null,
    isLoading: false
};

export function useGoogleMaps({ apiKey, libraries = ["places", "marker"] }: UseGoogleMapsOptions) {
    const [isLoaded, setIsLoaded] = useState(false);
    const [loadError, setLoadError] = useState<Error | null>(null);

    useEffect(() => {
        // 이미 로드된 경우
        if (globalLoadState.isLoaded) {
            setIsLoaded(true);
            return;
        }

        // 로딩 중인 경우
        if (globalLoadState.isLoading) {
            const checkLoaded = () => {
                if (globalLoadState.isLoaded) {
                    setIsLoaded(true);
                } else if (globalLoadState.error) {
                    setLoadError(globalLoadState.error);
                } else {
                    setTimeout(checkLoaded, 100);
                }
            };
            checkLoaded();
            return;
        }

        // 이미 전역적으로 로드된 경우
        if (window.google && window.google.maps && window.google.maps.Map) {
            globalLoadState.isLoaded = true;
            setIsLoaded(true);
            return;
        }

        // 스크립트가 이미 존재하는 경우
        const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
        if (existingScript) {
            globalLoadState.isLoading = true;
            existingScript.addEventListener("load", () => {
                globalLoadState.isLoaded = true;
                globalLoadState.isLoading = false;
                setIsLoaded(true);
            });
            existingScript.addEventListener("error", (e) => {
                globalLoadState.error = new Error("Failed to load Google Maps");
                globalLoadState.isLoading = false;
                setLoadError(globalLoadState.error);
            });
            return;
        }

        // Load Google Maps script - 더 빠른 로딩을 위해 최적화된 URL 사용
        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=${libraries.join(",")}&loading=async&v=weekly&callback=googleMapsCallback`;
        script.async = true;

        // Google Maps 콜백 함수 설정 (더 빠른 로딩 감지)
        window.googleMapsCallback = () => {
            if (window.google && window.google.maps && window.google.maps.Map) {
                globalLoadState.isLoaded = true;
                globalLoadState.isLoading = false;
                setIsLoaded(true);
            }
        };

        // 로딩 타임아웃 설정 (5초로 단축)
        const timeoutId = setTimeout(() => {
            if (!globalLoadState.isLoaded) {
                globalLoadState.error = new Error("Google Maps 로딩 시간 초과 (네트워크 연결을 확인해주세요)");
                globalLoadState.isLoading = false;
                setLoadError(globalLoadState.error);
            }
        }, 5000);

        // 스크립트를 head의 맨 위에 추가해서 가장 먼저 로드되도록 함
        const head = document.head;
        const firstChild = head.firstChild;
        head.insertBefore(script, firstChild);

        globalLoadState.isLoading = true;

        script.addEventListener("load", () => {
            // 콜백이 아직 호출되지 않았을 수 있으므로 확인
            setTimeout(() => {
                if (window.google && window.google.maps && window.google.maps.Map && !globalLoadState.isLoaded) {
                    globalLoadState.isLoaded = true;
                    globalLoadState.isLoading = false;
                    setIsLoaded(true);
                }
            }, 100);
        });

        script.addEventListener("error", (e) => {
            globalLoadState.error = new Error(`Google Maps 로딩 실패: ${e.message || '알 수 없는 오류'}`);
            globalLoadState.isLoading = false;
            setLoadError(globalLoadState.error);
        });

        document.head.appendChild(script);

        return () => {
            // Cleanup if needed
        };
    }, [apiKey, libraries]);

    return { isLoaded, loadError };
}

declare global {
    interface Window {
        google: typeof google;
        googleMapsCallback?: () => void;
    }
}

