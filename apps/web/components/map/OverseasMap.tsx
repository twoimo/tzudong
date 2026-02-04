'use client';

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Restaurant, Region } from '@/types/restaurant';
import { FilterState } from '@/components/filters/FilterPanel';
import { useRestaurants } from '@/hooks/use-restaurants';
import { Loader2 } from 'lucide-react';

interface OverseasMapProps {
    className?: string;
    filters: FilterState;
    selectedCountry: string | null;
    searchedRestaurant: Restaurant | null;
    selectedRestaurant: Restaurant | null;
    refreshTrigger: number;
    onAdminEditRestaurant?: (restaurant: Restaurant) => void;
    onRestaurantSelect?: (restaurant: Restaurant | null) => void;
    onRequestEditRestaurant?: (restaurant: Restaurant) => void;
    onMapReady?: (moveFunction: (restaurant: Restaurant) => void) => void;
    onMarkerClick?: (restaurant: Restaurant) => void;
}

const COUNTRY_CENTERS: Record<string, { lat: number; lng: number; zoom: number }> = {
    "미국": { lat: 39.8283, lng: -98.5795, zoom: 4 },
    "일본": { lat: 35.1815, lng: 136.9066, zoom: 6 },
    "대만": { lat: 23.6978, lng: 120.9605, zoom: 7 },
    "태국": { lat: 13.7563, lng: 100.5018, zoom: 6 },
    "인도네시아": { lat: -2.5489, lng: 118.0149, zoom: 5 },
    "튀르키예": { lat: 38.9637, lng: 35.2433, zoom: 6 },
    "헝가리": { lat: 47.1625, lng: 19.5033, zoom: 7 },
    "오스트레일리아": { lat: -25.2744, lng: 133.7751, zoom: 4 },
};

const CATEGORY_ICON_MAP: Record<string, string> = {
    '고기': '/images/maker-images/meat_bbq.png',
    '치킨': '/images/maker-images/chicken.png',
    '한식': '/images/maker-images/korean.png',
    '중식': '/images/maker-images/chinese.png',
    '일식': '/images/maker-images/cutlet_sashimi.png',
    '양식': '/images/maker-images/western.png',
    '분식': '/images/maker-images/snack_bar.png',
    '카페·디저트': '/images/maker-images/cafe_dessert.png',
    '아시안': '/images/maker-images/asian.png',
    '패스트푸드': '/images/maker-images/fastfood.png',
};

const DEFAULT_ICON = '/images/maker-images/world_food.png';

const OverseasMap: React.FC<OverseasMapProps> = ({
    className,
    filters,
    selectedCountry,
    searchedRestaurant,
    selectedRestaurant,
    refreshTrigger, // Used to trigger data refresh
    onRestaurantSelect,
    onMarkerClick,
    onMapReady,
}) => {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<maplibregl.Map | null>(null);
    const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    const [isMapLoaded, setIsMapLoaded] = useState(false);

    // Filtered restaurants with optimization
    const restaurantsOptions = useMemo(() => ({
        category: filters.categories.length > 0 ? filters.categories : undefined,
        minReviews: filters.minReviews,
        region: selectedCountry as Region || undefined,
        enabled: !!selectedCountry,
        refreshTrigger, // Include refreshTrigger to ensure data revalidation
    }), [filters, selectedCountry, refreshTrigger]);

    const { data: restaurants = [], isLoading: isLoadingRestaurants } = useRestaurants(restaurantsOptions);

    const restaurantsToShow = useMemo(() => {
        if (!searchedRestaurant) return restaurants;
        const exists = restaurants.some(r => r.id === searchedRestaurant.id);
        return exists ? restaurants : [...restaurants, searchedRestaurant];
    }, [restaurants, searchedRestaurant]);

    // MAP INITIALIZATION
    useEffect(() => {
        if (map.current || !mapContainer.current) return;

        const initialConfig = selectedCountry && COUNTRY_CENTERS[selectedCountry]
            ? COUNTRY_CENTERS[selectedCountry]
            : { lat: 20, lng: 0, zoom: 2 };

        try {
            const mapInstance = new maplibregl.Map({
                container: mapContainer.current,
                style: 'https://tiles.openfreemap.org/styles/positron',
                center: [initialConfig.lng, initialConfig.lat],
                zoom: initialConfig.zoom,
                attributionControl: false,
                fadeDuration: 0,
                localIdeographFontFamily: 'sans-serif',
            });

            mapInstance.addControl(new maplibregl.NavigationControl(), 'top-right');
            mapInstance.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

            mapInstance.on('load', () => {
                mapInstance.resize();
                setIsMapLoaded(true);
            });

            mapInstance.on('error', (e) => {
                const msg = e.error?.message || '';
                if (msg.includes('Expected value') || msg.includes('null')) return;
                console.error("Map Error:", e.error || e);
            });

            map.current = mapInstance;
        } catch (err) {
            console.error("Map Init Error:", err);
        }

        return () => {
            if (map.current) {
                map.current.remove();
                map.current = null;
            }
        };
    }, []);

    const moveToRestaurant = useCallback((restaurant: Restaurant) => {
        if (!map.current) return;
        const targetZoom = map.current.getZoom();
        map.current.flyTo({
            center: [Number(restaurant.lng), Number(restaurant.lat)],
            zoom: targetZoom,
            essential: true,
            duration: 800
        });
    }, []);

    useEffect(() => {
        if (onMapReady) onMapReady(moveToRestaurant);
    }, [onMapReady, moveToRestaurant]);

    useEffect(() => {
        if (!map.current || !selectedCountry) return;
        const config = COUNTRY_CENTERS[selectedCountry];
        if (config) {
            map.current.flyTo({ center: [config.lng, config.lat], zoom: config.zoom });
        }
    }, [selectedCountry]);

    // OPTIMIZED MARKER RENDERING
    // Only re-create markers if the restaurant list changes.
    // Update marker styles (selected state) independently.
    useEffect(() => {
        if (!map.current || !isMapLoaded) return;

        const currentMarkerIds = new Set(restaurantsToShow.map(r => r.id));

        // 1. Remove markers that are no longer in the list
        markersRef.current.forEach((marker, id) => {
            if (!currentMarkerIds.has(id)) {
                marker.remove();
                markersRef.current.delete(id);
            }
        });

        // 2. Add or update markers
        restaurantsToShow.forEach(restaurant => {
            if (!markersRef.current.has(restaurant.id)) {
                const categories = restaurant.categories;
                const cat = Array.isArray(categories) ? categories[0] : categories;
                const imagePath = CATEGORY_ICON_MAP[cat] || DEFAULT_ICON;

                const el = document.createElement('div');
                el.id = `marker-${restaurant.id}`;
                el.style.width = `32px`;
                el.style.height = `32px`;
                el.style.cursor = 'pointer';
                el.style.willChange = 'transform';
                el.innerHTML = `
                    <div class="marker-container" style="width: 100%; height: 100%; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3)); transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
                        <img src="${imagePath}" style="width: 100%; height: 100%; object-fit: contain;" alt="${restaurant.name}" />
                    </div>
                `;

                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    onRestaurantSelect?.(restaurant);
                    onMarkerClick?.(restaurant);
                    moveToRestaurant(restaurant);
                });

                const marker = new maplibregl.Marker({ element: el })
                    .setLngLat([Number(restaurant.lng), Number(restaurant.lat)])
                    .addTo(map.current!);

                markersRef.current.set(restaurant.id, marker);
            }
        });
    }, [restaurantsToShow, isMapLoaded, moveToRestaurant, onRestaurantSelect, onMarkerClick]);

    // Handle Selection State (Update existing markers without re-creating)
    useEffect(() => {
        if (!isMapLoaded) return;

        const activeId = selectedRestaurant?.id || searchedRestaurant?.id;

        markersRef.current.forEach((marker, id) => {
            const el = marker.getElement();
            const container = el.querySelector('.marker-container') as HTMLElement;
            const isSelected = id === activeId;

            if (container) {
                if (isSelected) {
                    el.style.width = '42px';
                    el.style.height = '42px';
                    el.classList.add('selected');
                    container.style.transform = 'scale(1.1)';
                } else {
                    el.style.width = '32px';
                    el.style.height = '32px';
                    el.classList.remove('selected');
                    container.style.transform = 'scale(1)';
                }
            }
        });
    }, [selectedRestaurant, searchedRestaurant, isMapLoaded]);

    return (
        <div className={`relative w-full h-full bg-[#f8f9fa] ${className}`}>
            <div ref={mapContainer} className="w-full h-full" />

            {(!isMapLoaded || isLoadingRestaurants) && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-sm px-4 py-2 rounded-full shadow-lg flex items-center gap-2 z-10 border border-white/20">
                    <Loader2 className="animate-spin w-4 h-4 text-blue-600" />
                    <span className="text-sm font-semibold text-gray-800">지도를 로딩 중입니다...</span>
                </div>
            )}
        </div>
    );
};

export default OverseasMap;
