import { useEffect, useState } from "react";

interface UseGoogleMapsOptions {
    apiKey: string;
    libraries?: string[];
}

// 전역 로드 상태 캐시 (여러 컴포넌트에서 중복 로드 방지)
let globalLoadState: { isLoaded: boolean; error: Error | null; isLoading: boolean } = {
    isLoaded: false,
    error: null,
    isLoading: false
};

export function useGoogleMaps({ apiKey, libraries = ["places", "marker"] }: UseGoogleMapsOptions) {
    const [isLoaded, setIsLoaded] = useState(globalLoadState.isLoaded);
    const [loadError, setLoadError] = useState<Error | null>(globalLoadState.error);

    useEffect(() => {
        // 이미 로드된 경우 즉시 반환
        if (globalLoadState.isLoaded) {
            setIsLoaded(true);
            return;
        }

        // 로딩 중인 경우 기다림
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

        // Check if already loaded globally
        if (window.google && window.google.maps) {
            globalLoadState.isLoaded = true;
            setIsLoaded(true);
            return;
        }

        // Check if script is already loading
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
            console.error("Error loading Google Maps:", e);
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

