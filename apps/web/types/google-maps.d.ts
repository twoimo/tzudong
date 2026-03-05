declare namespace google.maps {
    class Map {
        constructor(mapDiv: Element | null, opts?: MapOptions);
        panTo(latLng: LatLng | LatLngLiteral): void;
        setZoom(zoom: number): void;
        getBounds(): LatLngBounds | null;
        setCenter(latLng: LatLng | LatLngLiteral): void;
        addListener(eventName: string, handler: (...args: unknown[]) => void): MapsEventListener;
    }

    class LatLngBounds {
        getNorthEast(): LatLng;
        getSouthWest(): LatLng;
    }

    class LatLng {
        lat(): number;
        lng(): number;
    }

    interface LatLngLiteral {
        lat: number;
        lng: number;
    }

    interface MapOptions {
        center?: LatLng | LatLngLiteral;
        zoom?: number;
        mapId?: string;
        disableDefaultUI?: boolean;
        zoomControl?: boolean;
        mapTypeControl?: boolean;
        streetViewControl?: boolean;
        fullscreenControl?: boolean;
    }

    interface MapsEventListener {
        remove(): void;
    }

    namespace marker {
        class AdvancedMarkerElement {
            constructor(options?: AdvancedMarkerElementOptions);
            map: Map | null;
            position: LatLng | LatLngLiteral | null;
            content: Element | null;
            title: string | null;
        }

        interface AdvancedMarkerElementOptions {
            map?: Map | null;
            position?: LatLng | LatLngLiteral | null;
            content?: Element | null;
            title?: string | null;
        }
    }

    namespace event {
        function trigger(instance: unknown, eventName: string, ...args: unknown[]): void;
        function removeListener(listener: MapsEventListener): void;
    }
}
