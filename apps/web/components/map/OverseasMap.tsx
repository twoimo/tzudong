'use client';

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import '@/styles/maplibre-gl.css';
import type { Restaurant } from '@/types/restaurant';
import type { FilterState } from '@/components/filters/filter-state';
import { useRestaurants } from '@/hooks/use-restaurants';
import { MapSkeleton } from '@/components/skeletons/MapSkeleton';
import { buildOverseasRestaurantsQueryOptions } from '@/lib/map-query-helpers';
import {
    DEFAULT_OVERSEAS_PADDING,
    getNextOverseasWheelSlider,
    getOverseasInitialConfig,
    getRestaurantCategoryIcon,
    mapZoomToSlider,
    sliderToMapZoom,
} from '@/lib/overseas-map-helpers';
import {
    applyOverseasMarkerSelectedState,
    buildOverseasMarkerHtml,
    getOverseasMarkerActiveId,
} from '@/lib/overseas-map-marker-helpers';
import {
    mergeOverseasRestaurants,
    uniqueRestaurantsById,
} from '@/lib/overseas-map-restaurant-helpers';

interface OverseasMapProps {
    className?: string;
    mapFocusZoom?: number | null; // [New] 강제 줌 레벨
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
    mapPadding?: { top: number; bottom: number; left: number; right: number };
    onVisibleRestaurantsChange?: (restaurants: Restaurant[]) => void;
}

import { OVERSEAS_REGIONS } from '@/constants/overseas-regions';

const OverseasMap: React.FC<OverseasMapProps> = ({
    className,
    mapFocusZoom,
    filters,
    selectedCountry,
    searchedRestaurant,
    selectedRestaurant,
    refreshTrigger, // Used to trigger data refresh
    onRestaurantSelect,
    onMarkerClick,
    onMapReady,
    mapPadding = DEFAULT_OVERSEAS_PADDING,
    onVisibleRestaurantsChange,
}) => {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<maplibregl.Map | null>(null);
    const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    const mapPaddingRef = useRef(mapPadding);
    const [isMapLoaded, setIsMapLoaded] = useState(false);


    // Update ref whenever prop changes
    useEffect(() => {
        mapPaddingRef.current = mapPadding;
    }, [mapPadding]);

    // Filtered restaurants with optimization
    const restaurantsOptions = useMemo(() => buildOverseasRestaurantsQueryOptions({
        filters,
        refreshTrigger,
        selectedCountry,
    }), [filters, selectedCountry, refreshTrigger]);

    const { data: restaurants = [], isLoading: isLoadingRestaurants } = useRestaurants(restaurantsOptions);

    const restaurantsToShow = useMemo(() => {
        return mergeOverseasRestaurants(restaurants, searchedRestaurant);
    }, [restaurants, searchedRestaurant]);

    useEffect(() => {
        if (!onVisibleRestaurantsChange) return;

        onVisibleRestaurantsChange(uniqueRestaurantsById(restaurantsToShow));
    }, [restaurantsToShow, onVisibleRestaurantsChange]);

    // MAP INITIALIZATION
    useEffect(() => {
        if (map.current || !mapContainer.current) return;

        const initialConfig = getOverseasInitialConfig(selectedCountry);



        try {
            const mapInstance = new maplibregl.Map({
                container: mapContainer.current,
                style: 'https://tiles.openfreemap.org/styles/positron',
                center: [initialConfig.lng, initialConfig.lat],
                zoom: initialConfig.zoom,
                attributionControl: false,
                localIdeographFontFamily: 'sans-serif',
                renderWorldCopies: true,
                scrollZoom: false, // [Modified] 커스텀 스크롤 핸들러 사용 (0.5 단위 제어)
            });

            // mapInstance.addControl(new maplibregl.NavigationControl(), 'top-right'); // [Modified] 기본 컨트롤 제거 (커스텀 줌 컨트롤 사용)
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

        // [New] 커스텀 스크롤 휠 핸들러 (0.5 단위 줌 -> 1단위 슬라이더 줌)
        // 연속 스크롤 시 목표 슬라이더 값 추적 변수
        let targetSlider = mapZoomToSlider(initialConfig.zoom);
        let lastWheelTime = 0;

        const handleWheel = (e: WheelEvent) => {
            if (!map.current) return;
            e.preventDefault();

            const now = Date.now();
            const timeDiff = now - lastWheelTime;
            lastWheelTime = now;

            const currentMapZoom = map.current.getZoom();
            const nextSlider = getNextOverseasWheelSlider({
                currentMapZoom,
                deltaY: e.deltaY,
                previousTargetSlider: targetSlider,
                timeDiffMs: timeDiff,
            });

            // 3. 적용
            if (nextSlider !== targetSlider) {
                targetSlider = nextSlider;

                // [UX] 즉각적인 슬라이더 UI 갱신
                const nextZoom = sliderToMapZoom(nextSlider);
                // [UX] 깜빡임 방지를 위해 easeTo 사용 (200ms)
                map.current.easeTo({ zoom: nextZoom, duration: 200 });
            }
        };

        const mapContainerEl = mapContainer.current;
        if (mapContainerEl) {
            mapContainerEl.addEventListener('wheel', handleWheel, { passive: false });
        }

        return () => {
            if (mapContainerEl) {
                mapContainerEl.removeEventListener('wheel', handleWheel);
            }
            if (map.current) {
                map.current.remove();
                map.current = null;
            }
        };
    }, [selectedCountry]);

    const moveToRestaurant = useCallback((restaurant: Restaurant) => {
        if (!map.current) return;

        // [New] 강제 줌 레벨이 있으면 사용, 없으면 현재 줌 유지
        const targetZoom = mapFocusZoom ?? map.current.getZoom();

        map.current.jumpTo({
            center: [Number(restaurant.lng), Number(restaurant.lat)],
            zoom: targetZoom,
            padding: mapPaddingRef.current
        });
    }, [mapFocusZoom]);

    useEffect(() => {
        if (onMapReady) onMapReady(moveToRestaurant);
    }, [onMapReady, moveToRestaurant]);

    useEffect(() => {
        if (!map.current || !selectedCountry) return;
        const config = OVERSEAS_REGIONS[selectedCountry]?.center;
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
                const imagePath = getRestaurantCategoryIcon(restaurant);

                const el = document.createElement('div');
                el.id = `marker-${restaurant.id}`;
                el.style.width = `32px`;
                el.style.height = `32px`;
                el.style.cursor = 'pointer';
                el.style.willChange = 'transform';
                el.innerHTML = buildOverseasMarkerHtml({
                    imagePath,
                    name: restaurant.name,
                });

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

        const activeId = getOverseasMarkerActiveId({
            searchedRestaurantId: searchedRestaurant?.id,
            selectedRestaurantId: selectedRestaurant?.id,
        });

        markersRef.current.forEach((marker, id) => {
            const el = marker.getElement();
            const container = el.querySelector('.marker-container') as HTMLElement;
            const isSelected = id === activeId;

            applyOverseasMarkerSelectedState({
                container,
                isSelected,
                markerElement: el,
            });
        });
    }, [selectedRestaurant, searchedRestaurant, isMapLoaded]);

    // Re-center if mapPadding changes (e.g. panel opens) while a restaurant is selected
    useEffect(() => {
        if (selectedRestaurant && isMapLoaded) {
            moveToRestaurant(selectedRestaurant);
        }
    }, [mapPadding, selectedRestaurant, isMapLoaded, moveToRestaurant]);

    return (
        <div className={`relative w-full h-full bg-[#E5E5E5] ${className}`}>
            <div
                ref={mapContainer}
                className="w-full h-full"
                data-testid="map-container"
            />

            {(!isMapLoaded || isLoadingRestaurants) && (
                <div className="absolute inset-0 z-10 bg-background/80 backdrop-blur-sm">
                    <MapSkeleton />
                </div>
            )}



        </div>
    );
};

export default OverseasMap;

