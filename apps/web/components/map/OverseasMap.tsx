'use client';

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Restaurant, Region } from '@/types/restaurant';
import { FilterState } from '@/components/filters/FilterPanel';
import { useRestaurants } from '@/hooks/use-restaurants';
import { MapSkeleton } from '@/components/skeletons/MapSkeleton';

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
}

import { OVERSEAS_REGIONS } from '@/constants/overseas-regions';

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
    '족발·보쌈': '/images/maker-images/pork_feet.png',
    '돈까스·회': '/images/maker-images/cutlet_sashimi.png',
    '피자': '/images/maker-images/pizza.png',
    '찜·탕': '/images/maker-images/stew.png',
    '야식': '/images/maker-images/late_night.png',
    '도시락': '/images/maker-images/lunch_box.png',
};

const DEFAULT_ICON = '/images/maker-images/asian.png';



const DEFAULT_PADDING = { top: 0, bottom: 0, left: 0, right: 0 };

// [Zoom Control] 줌 레벨 <-> 슬라이더 값(0-100) 매핑
const MIN_ZOOM = 2;
const MAX_ZOOM = 22;
const mapZoomToSlider = (zoom: number) => Math.round(((zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100);
const sliderToMapZoom = (val: number) => MIN_ZOOM + (val / 100) * (MAX_ZOOM - MIN_ZOOM);

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
    mapPadding = DEFAULT_PADDING,
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

        const initialConfig = selectedCountry && OVERSEAS_REGIONS[selectedCountry]
            ? OVERSEAS_REGIONS[selectedCountry].center
            : { lat: 20, lng: 0, zoom: 2 };



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
            const currentSlider = mapZoomToSlider(currentMapZoom);

            let baseSlider;

            // 1. 기준 슬라이더 값 설정 (연속성 보장)
            if (timeDiff < 400 && Math.abs(targetSlider - currentSlider) < 5) {
                baseSlider = targetSlider;
            } else {
                baseSlider = currentSlider;
            }

            // 2. 새로운 목표 계산 (슬라이더 1단위)
            const sliderStep = 1;
            const nextSlider = e.deltaY > 0
                ? Math.max(baseSlider - sliderStep, 0)
                : Math.min(baseSlider + sliderStep, 100);

            // 3. 적용
            if (nextSlider !== targetSlider) {
                targetSlider = nextSlider;

                // [UX] 즉각적인 슬라이더 UI 갱신
                const nextZoom = sliderToMapZoom(nextSlider);
                // [UX] 깜빡임 방지를 위해 easeTo 사용 (200ms)
                map.current.easeTo({ zoom: nextZoom, duration: 200 });
            }
        };

        if (mapContainer.current) {
            mapContainer.current.addEventListener('wheel', handleWheel, { passive: false });
        }

        return () => {
            if (mapContainer.current) {
                mapContainer.current.removeEventListener('wheel', handleWheel);
            }
            if (map.current) {
                map.current.remove();
                map.current = null;
            }
        };
    }, []);

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

    // Re-center if mapPadding changes (e.g. panel opens) while a restaurant is selected
    useEffect(() => {
        if (selectedRestaurant && isMapLoaded) {
            moveToRestaurant(selectedRestaurant);
        }
    }, [mapPadding, selectedRestaurant, isMapLoaded, moveToRestaurant]);

    return (
        <div className={`relative w-full h-full bg-[#E5E5E5] ${className}`}>
            <div ref={mapContainer} className="w-full h-full" />

            {(!isMapLoaded || isLoadingRestaurants) && (
                <div className="absolute inset-0 z-10 bg-background/80 backdrop-blur-sm">
                    <MapSkeleton />
                </div>
            )}



        </div>
    );
};

export default OverseasMap;
