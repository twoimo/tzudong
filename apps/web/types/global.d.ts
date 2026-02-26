interface Window {
    naver: typeof naver;
    google: typeof google;
}
declare var naver: typeof naver;
declare var google: typeof google;

declare namespace naver {
    namespace maps {
        class Map {
            constructor(element: HTMLElement | string, options?: MapOptions);
            setCenter(center: LatLng | LatLngLiteral): void;
            setZoom(zoom: number, useEffect?: boolean): void;
            getCenter(): LatLng;
            getZoom(): number;
            panTo(coord: LatLng | LatLngLiteral, transitionOptions?: TransitionOptions): void;
            morph(coord: LatLng | LatLngLiteral, zoom?: number, transitionOptions?: TransitionOptions): void;
        }

        class LatLng {
            constructor(lat: number, lng: number);
            lat(): number;
            lng(): number;
        }

        class Marker {
            constructor(options: MarkerOptions);
            setMap(map: Map | null): void;
            setPosition(position: LatLng | LatLngLiteral): void;
            setIcon(icon: HtmlIcon | ImageIcon | SymbolIcon | string): void;
        }

        class Event {
            static addListener(target: any, eventName: string, listener: (event: any) => void): any;
        }

        class Point {
            constructor(x: number, y: number);
        }

        interface MapOptions {
            center: LatLng | LatLngLiteral;
            zoom?: number;
            minZoom?: number;
            maxZoom?: number;
            zoomControl?: boolean;
            zoomControlOptions?: ZoomControlOptions;
            mapTypeControl?: boolean;
        }

        interface LatLngLiteral {
            lat: number;
            lng: number;
        }

        interface MarkerOptions {
            position: LatLng | LatLngLiteral;
            map?: Map;
            title?: string;
            icon?: string | HtmlIcon | ImageIcon | SymbolIcon;
            clickable?: boolean;
        }

        interface HtmlIcon {
            content: string;
            size?: Size;
            anchor?: Point;
        }

        interface ImageIcon {
            url: string;
            size?: Size;
            scaledSize?: Size;
            origin?: Point;
            anchor?: Point;
        }

        interface SymbolIcon {
            path: SymbolPath | string;
            style?: SymbolStyle;
        }

        interface Size {
            width: number;
            height: number;
        }

        interface ZoomControlOptions {
            position: Position;
        }

        interface TransitionOptions {
            duration?: number;
            easing?: string;
        }

        enum Position {
            TOP_LEFT,
            TOP_RIGHT,
            BOTTOM_LEFT,
            BOTTOM_RIGHT,
        }

        enum SymbolPath {
            CIRCLE,
            BACKWARD_CLOSED_ARROW,
            FORWARD_CLOSED_ARROW,
            BACKWARD_OPEN_ARROW,
            FORWARD_OPEN_ARROW,
        }

        enum SymbolStyle {
            CIRCLE,
            PATH,
            CLOSED_PATH,
        }
    }
}

declare namespace google {
    namespace maps {
        class Map {
            constructor(mapDiv: Element | null, opts?: MapOptions);
            addListener(eventName: string, handler: Function): any;
            getBounds(): LatLngBounds | null;
            panTo(latLng: LatLng | LatLngLiteral): void;
            setZoom(zoom: number): void;
            setCenter(latLng: LatLng | LatLngLiteral): void;
        }
        namespace marker {
            class AdvancedMarkerElement {
                constructor(opts?: AdvancedMarkerElementOptions);
                map: Map | null;
                position: LatLng | LatLngLiteral | null;
                content: Element | null;
                title: string | null;
            }
        }
        namespace event {
            function trigger(instance: any, eventName: string, ...args: any[]): void;
            function removeListener(listener: any): void;
        }
        class Marker {
            constructor(opts?: MarkerOptions);
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
        interface MarkerOptions {
            position: LatLng | LatLngLiteral;
            map: Map;
            title?: string;
            icon?: string | HtmlIcon | ImageIcon | SymbolIcon;
        }
        interface AdvancedMarkerElementOptions {
            map?: Map;
            position?: LatLng | LatLngLiteral;
            content?: Element;
            title?: string;
        }
        class LatLng {
            constructor(lat: number, lng: number);
            lat(): number;
            lng(): number;
        }
        interface LatLngLiteral {
            lat: number;
            lng: number;
        }
        class LatLngBounds {
            getNorthEast(): LatLng;
            getSouthWest(): LatLng;
        }
    }
}
