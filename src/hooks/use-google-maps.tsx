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
        if (window.google && window.google.maps) {
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

        // Load Google Maps script
        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=${libraries.join(",")}&loading=async&v=weekly`;
        script.async = true;
        script.defer = false; // defer를 false로 해서 더 빠르게 로드

        // Add to head for faster loading (before other scripts)
        const firstScript = document.head.querySelector('script');
        if (firstScript) {
            document.head.insertBefore(script, firstScript);
        } else {
            document.head.appendChild(script);
        }

        globalLoadState.isLoading = true;
        script.addEventListener("load", () => {
            // Double check if Google Maps is fully loaded
            if (window.google && window.google.maps && window.google.maps.Map) {
                globalLoadState.isLoaded = true;
                globalLoadState.isLoading = false;
                setIsLoaded(true);
            } else {
                // Retry after a short delay
                setTimeout(() => {
                    if (window.google && window.google.maps && window.google.maps.Map) {
                        globalLoadState.isLoaded = true;
                        globalLoadState.isLoading = false;
                        setIsLoaded(true);
                    }
                }, 100);
            }
        });

        script.addEventListener("error", (e) => {
            globalLoadState.error = new Error("Failed to load Google Maps");
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
    }
}

