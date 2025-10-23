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
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=${libraries.join(",")}`;
        script.async = true;
        script.defer = true;

        script.addEventListener("load", () => {
            setIsLoaded(true);
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

