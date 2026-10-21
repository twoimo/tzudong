'use client';

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import * as maplibregl from 'maplibre-gl';
import '@/styles/maplibre-gl.css';
import type { Restaurant } from '@/types/restaurant';
import type { FilterState } from '@/components/filters/filter-state';
import { useRestaurants } from '@/hooks/use-restaurants';
import { MapSkeleton } from '@/components/skeletons/MapSkeleton';
import { Button } from '@/components/ui/button';
import { OVERSEAS_MAP_STYLE_URL, OVERSEAS_MAP_WORKER_URL } from '@/lib/overseas-map-provider';
import {
    buildDeviceLocationMarkerHtml,
    shouldFocusDeviceLocation,
    type DeviceMapLocation,
} from '@/lib/device-location-map';
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
    onMapBlankClick?: () => void;
    onMapInteraction?: () => void;
    deviceLocation?: DeviceMapLocation | null;
}
const hasValidOverseasDeviceLocation = (
    location: DeviceMapLocation | null,
    zoom: number,
): location is DeviceMapLocation =>
    location !== null &&
    Number.isFinite(location.lat) &&
    Number.isFinite(location.lng) &&
    location.lat >= -90 &&
    location.lat <= 90 &&
    location.lng >= -180 &&
    location.lng <= 180 &&
    Number.isFinite(zoom);


import { OVERSEAS_REGIONS } from '@/constants/overseas-regions';

maplibregl.setWorkerUrl(OVERSEAS_MAP_WORKER_URL);

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
    onMapBlankClick,
    onMapInteraction,
    deviceLocation = null,
}) => {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<maplibregl.Map | null>(null);
    const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    const deviceLocationMarkerRef = useRef<maplibregl.Marker | null>(null);
    const lastFocusedDeviceLocationRequestRef = useRef<number | null>(null);
    const mapPaddingRef = useRef(mapPadding);
    const onMapBlankClickRef = useRef(onMapBlankClick);
    const onMapInteractionRef = useRef(onMapInteraction);
    const countryRef = useRef(selectedCountry);
    const [isMapLoaded, setIsMapLoaded] = useState(false);
    const [mapIssue, setMapIssue] = useState<'error' | 'slow' | null>(null);
    const [mapAttempt, setMapAttempt] = useState(0);


    // Update ref whenever prop changes
    useEffect(() => {
        mapPaddingRef.current = mapPadding;
    }, [mapPadding]);

    useEffect(() => {
        onMapBlankClickRef.current = onMapBlankClick;
    }, [onMapBlankClick]);
    useEffect(() => {
        onMapInteractionRef.current = onMapInteraction;
    }, [onMapInteraction]);


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

    // Renders authorized device coordinates at the approved map-provider boundary.
    useEffect(() => {
        if (!map.current || !isMapLoaded) return;

        if (!deviceLocation) {
            deviceLocationMarkerRef.current?.remove();
            deviceLocationMarkerRef.current = null;
            lastFocusedDeviceLocationRequestRef.current = null;
            return;
        }

        const currentMap = map.current;
        const currentZoom = currentMap.getZoom();

        if (!hasValidOverseasDeviceLocation(deviceLocation, currentZoom)) {
            deviceLocationMarkerRef.current?.remove();
            deviceLocationMarkerRef.current = null;
            lastFocusedDeviceLocationRequestRef.current = null;
            return;
        }

        // Provider boundary: keep device coordinates in React state memory, and only apply validated updates to the map provider.
        if (!deviceLocationMarkerRef.current) {
            const markerElement = document.createElement('div');
            markerElement.style.width = '56px';
            markerElement.style.height = '56px';
            markerElement.style.pointerEvents = 'none';
            markerElement.style.zIndex = '10000';
            markerElement.innerHTML = buildDeviceLocationMarkerHtml(deviceLocation);
            deviceLocationMarkerRef.current = new maplibregl.Marker({
                element: markerElement,
                anchor: 'center',
            })
                .setLngLat([deviceLocation.lng, deviceLocation.lat])
                .addTo(currentMap);
        } else {
            const markerElement = deviceLocationMarkerRef.current.getElement();
            markerElement.innerHTML = buildDeviceLocationMarkerHtml(deviceLocation);
            deviceLocationMarkerRef.current.setLngLat([deviceLocation.lng, deviceLocation.lat]).addTo(currentMap);
        }

        if (shouldFocusDeviceLocation(lastFocusedDeviceLocationRequestRef.current, deviceLocation)) {
            lastFocusedDeviceLocationRequestRef.current = deviceLocation.focusRequestId;
            currentMap.jumpTo({
                center: [deviceLocation.lng, deviceLocation.lat],
                zoom: Math.max(currentZoom, 14),
            });
        }
    }, [deviceLocation, isMapLoaded]);

    useEffect(() => () => {
        deviceLocationMarkerRef.current?.remove();
    }, []);

    // MAP INITIALIZATION
    useEffect(() => {
        if (map.current || !mapContainer.current) return;

        const initialConfig = getOverseasInitialConfig(countryRef.current);
        const markers = markersRef.current;
        let disposed = false;
        let loaded = false;
        let mapInstance: maplibregl.Map | null = null;
        setIsMapLoaded(false);
        setMapIssue(null);
        const startupTimer = window.setTimeout(() => {
            if (!disposed && !loaded) setMapIssue((current) => current ?? 'slow');
        }, 12000);

        try {
            mapInstance = new maplibregl.Map({
                container: mapContainer.current,
                style: OVERSEAS_MAP_STYLE_URL,
                center: [initialConfig.lng, initialConfig.lat],
                zoom: initialConfig.zoom,
                attributionControl: false,
                localIdeographFontFamily: 'sans-serif',
                renderWorldCopies: true,
                scrollZoom: false, // [Modified] 커스텀 스크롤 핸들러 사용 (0.5 단위 제어)
            });

            // mapInstance.addControl(new maplibregl.NavigationControl(), 'top-right'); // [Modified] 기본 컨트롤 제거 (커스텀 줌 컨트롤 사용)
            mapInstance.addControl(new maplibregl.AttributionControl({ compact: false }), 'bottom-right');

            mapInstance.on('load', () => {
                if (disposed) return;
                loaded = true;
                window.clearTimeout(startupTimer);
                mapInstance?.resize();
                setMapIssue(null);
                setIsMapLoaded(true);
            });

            mapInstance.on('error', () => {
                if (!disposed && !loaded) setMapIssue('error');
                console.error('OVERSEAS_MAP_RESOURCE_FAILED');
            });

            mapInstance.on('click', () => {
                onMapInteractionRef.current?.();
                onMapBlankClickRef.current?.();
            });
            mapInstance.on('dragstart', () => {
                onMapInteractionRef.current?.();
            });

            mapInstance.on('zoomstart', () => {
                onMapInteractionRef.current?.();
            });


            map.current = mapInstance;
        } catch {
            setMapIssue('error');
            console.error('OVERSEAS_MAP_INIT_FAILED');
        }

        // [New] 커스텀 스크롤 휠 핸들러 (0.5 단위 줌 -> 1단위 슬라이더 줌)
        // 연속 스크롤 시 목표 슬라이더 값 추적 변수
        let targetSlider = mapZoomToSlider(initialConfig.zoom);
        let lastWheelTime = 0;

        const handleWheel = (e: WheelEvent) => {
            if (!map.current) return;
            e.preventDefault();
            onMapInteractionRef.current?.();

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
        const resizeObserver = typeof ResizeObserver === 'undefined'
            ? null
            : new ResizeObserver(() => {
                if (!disposed) mapInstance?.resize();
            });
        if (mapContainerEl) resizeObserver?.observe(mapContainerEl);

        return () => {
            disposed = true;
            window.clearTimeout(startupTimer);
            resizeObserver?.disconnect();
            if (mapContainerEl) {
                mapContainerEl.removeEventListener('wheel', handleWheel);
            }
            markers.forEach((marker) => marker.remove());
            markers.clear();
            deviceLocationMarkerRef.current?.remove();
            deviceLocationMarkerRef.current = null;
            lastFocusedDeviceLocationRequestRef.current = null;
            mapInstance?.remove();
            if (map.current === mapInstance) {
                map.current = null;
            }
        };
    }, [mapAttempt]);

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
        countryRef.current = selectedCountry;
        if (!map.current || !selectedCountry) return;
        const config = OVERSEAS_REGIONS[selectedCountry]?.center;
        if (config) {
            map.current.jumpTo({ center: [config.lng, config.lat], zoom: config.zoom, padding: mapPaddingRef.current });
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
        <div
            className={`relative w-full h-full bg-[#E5E5E5] ${className}`}
            data-overseas-map-status={isMapLoaded ? 'ready' : mapIssue ?? 'loading'}
        >
            <div
                ref={mapContainer}
                className="w-full h-full"
                data-testid="map-container"
            />

            {!isMapLoaded && !mapIssue && (
                <div className="absolute inset-0 z-10">
                    <MapSkeleton message="해외 지도 화면을 준비하고 있어요" />
                </div>
            )}
            {!isMapLoaded && mapIssue && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/95 px-6 text-center" role="status">
                    <p className="text-sm text-muted-foreground">
                        {mapIssue === 'slow' ? '지도를 불러오는 데 시간이 걸리고 있어요.' : '해외 지도를 불러오지 못했어요.'}
                    </p>
                    <Button variant="outline" size="sm" onClick={() => setMapAttempt((current) => current + 1)}>
                        다시 불러오기
                    </Button>
                </div>
            )}
            {isMapLoaded && isLoadingRestaurants && (
                <div className="pointer-events-none absolute inset-x-3 top-28 z-10 flex justify-center" role="status">
                    <span className="rounded-full bg-background/95 px-3 py-1 text-xs text-muted-foreground shadow-sm">맛집 핀을 불러오고 있어요</span>
                </div>
            )}
        </div>
    );
};

export default OverseasMap;
