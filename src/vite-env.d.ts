/// <reference types="vite/client" />

// Google Maps TypeScript definitions
declare namespace google {
  namespace maps {
    interface LatLngLiteral {
      lat: number;
      lng: number;
    }
    
    class Map {
      constructor(element: HTMLElement, options?: any);
      setCenter(latlng: LatLngLiteral): void;
      setZoom(zoom: number): void;
      getBounds(): LatLngBounds | undefined;
      addListener(eventName: string, handler: Function): any;
    }
    
    class LatLngBounds {
      contains(latLng: LatLngLiteral): boolean;
      extend(point: LatLngLiteral): LatLngBounds;
      getNorthEast(): LatLng;
      getSouthWest(): LatLng;
    }
    
    class LatLng {
      lat(): number;
      lng(): number;
    }
    
    namespace marker {
      class AdvancedMarkerElement {
        constructor(options?: any);
        position: LatLngLiteral | null;
        map: Map | null;
        addListener(eventName: string, handler: Function): any;
      }
    }
  }
}

declare global {
  interface Window {
    google: typeof google;
  }
}
