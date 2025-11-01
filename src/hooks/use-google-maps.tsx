import { useEffect, useState } from "react";

interface UseGoogleMapsOptions {
    apiKey: string;
    libraries?: string[];
}

export function useGoogleMaps({ apiKey, libraries = ["places", "marker"] }: UseGoogleMapsOptions) {
    const [isLoaded, setIsLoaded] = useState(false);
    const [loadError, setLoadError] = useState<Error | null>(null);

    useEffect(() => {
        // Check if already loaded
        if (window.google && window.google.maps) {
            setIsLoaded(true);
            return;
        }

        // Check if script is already loading
        const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
        if (existingScript) {
            existingScript.addEventListener("load", () => setIsLoaded(true));
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

        script.addEventListener("load", () => {
            // Double check if Google Maps is fully loaded
            if (window.google && window.google.maps && window.google.maps.Map) {
                setIsLoaded(true);
            } else {
                // Retry after a short delay
                setTimeout(() => {
                    if (window.google && window.google.maps && window.google.maps.Map) {
                        setIsLoaded(true);
                    }
                }, 100);
            }
        });

        script.addEventListener("error", (e) => {
            setLoadError(new Error("Failed to load Google Maps"));
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

