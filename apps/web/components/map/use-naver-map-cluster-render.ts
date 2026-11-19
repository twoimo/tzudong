import { syncRetainedMarkerAccessibility } from '@/lib/retained-marker-accessibility';
import { markInitialLoadMilestone } from '@/lib/performance/initial-load-milestones';
import { createClusterIndexBuildScheduler } from '@/lib/cluster-index-build-scheduler';
import { removeNaverMapListener } from '@/lib/naver-map-event-cleanup';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject, RefObject } from "react";
import type { FilterState } from "@/components/filters/filter-state";
import type { Restaurant, Region } from "@/types/restaurant";
import {
    HOME_MAP_CONTEXTUAL_VISIBLE_RESTAURANTS_MIN_ZOOM,
    type HomeMapContextualRestaurantsIneligibilityReason,
    type HomeMapContextualRestaurantsPayload,
    type HomeMapRenderMode,
} from "@/lib/home-map-contextual-restaurants";
import type Supercluster from 'supercluster';
import type { ClusterFeature, PointFeature } from 'supercluster';
import {
    createClusterIndex,
    expandCluster,
    restaurantsToGeoJSON,
    getClusters,
    getClusterCategories,
    isCluster,
    getClusterIndexMaxZoom,
    getClusterMaxZoom,
    getRegionalClusters,
    type ClusterProperties,
    type RegionalCluster,
    type SeoulDistrictCluster,
    getSeoulDistrictClusters,
} from "@/lib/clustering";
import { markerPool } from "@/lib/marker-pool";
import { clusterAnimationManager, injectClusterCSS, removeClusterCSS } from "@/lib/cluster-marker";
import { getNaverIndividualMarkerVisual } from "@/lib/naver-map-marker-visuals";
import { projectPublishedPopularityTier } from "@/lib/evidence-engineering/published-popularity";
import { deferMarkerRenders } from "@/lib/deferred-marker-renders";
import {
    buildRestaurantMarkerKindSignature,
    isUserSubmittedRestaurant,
    RESTAURANT_MARKER_ASSET_VERSION,
} from "@/lib/restaurant-marker-kind";
import { buildNaverClusterAnimationIconPlan, buildNaverClusterMarkerRenderPlan } from "@/lib/naver-map-cluster-visuals";
import { perfMonitor } from "@/lib/performance-monitor";
import type { MapOptimizationSettings } from "@/hooks/useMapOptimization";
import type { HomeMapResultSummary } from "@/lib/home-map-result-summary";
import { buildMarkerRenderSignature, shouldSkipMarkerUpdate, type MarkerRenderSignature } from "@/lib/map-render-guard";
import {
    resolveExpandedClusterRestaurant,
    retainExpandedClusterRestaurantSnapshot,
} from "@/lib/expanded-cluster-restaurant-snapshot";
import { buildRestaurantLookup } from "@/lib/map-restaurant-lookup";
import { buildPostSearchSwipeCandidates, buildRestaurantsForSwipe } from "@/lib/mobile-home-search-selection";
import { fillExtendedBounds, isPointInSeoul } from "@/lib/naver-map-view-helpers";
import {
    buildRenderTargetIdsForSignature,
    deriveClusterRenderPlan,
    shouldRenderExpandedClusterMarker,
    getRestaurantsWithRenderableCoordinates,
    getSeoulIndividualRestaurantsForRender,
    getVisibleRestaurantsForRender,
    getVisibleRestaurantIdSet,
    nextEmptyIdentityArray,
    normalizeNaverMarkerCoordinates,
    resolveEmptyClusterMarkerCleanupPlan,
    resolveSkippedEmptyThemeMarkerPlan,
    shouldClearEmptyClusterState,
    shouldReportNaverMarkerRenderPerformance,
} from "@/lib/naver-map-render-plan";
import { debounce } from "@/lib/map-runtime-helpers";
import {
    getRegionalClusterTargetZoom,
    getSeoulDistrictTargetZoom,
    getSuperclusterTargetZoom,
    quantizeNaverClusterZoom,
    resolveNaverIslandClusterViewportByRegion,
    resolveNaverIslandClusterViewportForRestaurants,
    resolveNaverClusterBoundsBbox,
    resolveNaverClusterUpdateBbox,
    shouldHideInSeoulDistrictMode,
} from "@/lib/naver-map-cluster-helpers";
import {
    buildNaverOverlappingMarkerOffsets,
    resolveNaverOverlappingMarkerPosition,
    reuseMarkerLatLng,
    reuseMarkerAnchor,
    reuseProjectedLatLng,
} from "@/lib/naver-map-overlap-helpers";
import {
    buildVisibleRestaurantIdSignature,
    wrapNaverMarkerContentWithReviewBubble,
    buildVisibleMarkerReviewBubbleRenderToken,
    buildVisibleMarkerReviewBubbleTargetSignature,
    selectVisibleMarkerReviewBubbleTargets,
    VISIBLE_MARKER_REVIEW_BUBBLE_DESKTOP_LIMIT,
    VISIBLE_MARKER_REVIEW_BUBBLE_MOBILE_LIMIT,
    type VisibleMarkerReviewBubble,
    type VisibleMarkerReviewBubbleTarget,
} from "@/lib/visible-marker-review-bubbles";
interface NaverLatLngLike {
    lat: () => number;
    lng: () => number;
}

interface NaverProjectionLike {
    fromCoordToOffset: (coord: unknown) => { x: number; y: number };
    fromOffsetToCoord: (offset: unknown) => NaverLatLngLike;
}

export interface NaverMapLike {
    getBounds: () => {
        getSW: () => NaverLatLngLike;
        getNE: () => NaverLatLngLike;
        getWest: () => number;
        getSouth: () => number;
        getEast: () => number;
        getNorth: () => number;
    } | null;
    getCenter: () => NaverLatLngLike;
    getProjection: () => NaverProjectionLike;
    getZoom: () => number;
    getSize?: () => { width: number; height: number } | null;
    fitBounds?: (bounds: unknown, options?: unknown) => void;
    morph: (target: unknown, zoom?: number, options?: unknown) => void;
    panBy: (x: number, y: number) => void;
    panTo: (target: unknown, options?: unknown) => void;
    setCenter: (target: unknown) => void;
    setZoom: (zoom: number, effect?: boolean) => void;
}

function getNaverMarkerViewportKey(map: NaverMapLike, mapElement: HTMLElement | null): string {
    const viewportBounds = { south: 0, west: 0, north: 0, east: 0 };
    const hasViewportBounds = fillExtendedBounds(map, 0, viewportBounds);
    return JSON.stringify([
        map.getZoom(), hasViewportBounds ? viewportBounds : null,
        mapElement?.clientWidth, mapElement?.clientHeight,
    ]);
}

// [성능 최적화] 가시영역 필터링 및 이벤트 처리 상수
const VIEWPORT_FILTER_ENABLED = true; // 가시영역 필터링 활성화
const VIEWPORT_PADDING = 0.25; // 가시영역 여백 (25% 확장)
const resolveHomeMapContextualRenderMode = ({
    shouldUseRegionalCluster,
    shouldUseSeoulDistrictCluster,
    shouldCluster,
}: {
    shouldUseRegionalCluster: boolean;
    shouldUseSeoulDistrictCluster: boolean;
    shouldCluster: boolean;
}): HomeMapRenderMode => {
    if (shouldUseRegionalCluster) return 'regional-cluster';
    if (shouldUseSeoulDistrictCluster) return 'seoul-district';
    if (shouldCluster) return 'supercluster';
    return 'individual';
};

const resolveHomeMapContextualIneligibilityReason = ({
    renderMode,
    zoom,
    visibleCount,
}: {
    renderMode: HomeMapRenderMode;
    zoom: number;
    visibleCount: number;
}): HomeMapContextualRestaurantsIneligibilityReason | undefined => {
    if (renderMode !== 'individual') return 'clustered-render-mode';
    if (zoom < HOME_MAP_CONTEXTUAL_VISIBLE_RESTAURANTS_MIN_ZOOM) return 'below-threshold';
    if (visibleCount === 0) return 'empty';
    return undefined;
};

// 클러스터링 상수 (네이버 지도 스타일)
const ENABLE_CLUSTERING = true; // 클러스터링 전체 활성화
const MARKER_RENDER_EMPTY_RETRY_LIMIT = 6;
const MARKER_RENDER_EMPTY_RETRY_DELAY_MS = 250;
const CLUSTER_INDEX_IDLE_TIMEOUT_MS = 750;
// [OPTIMIZATION] 클러스터 반경, 최소 포인트, 애니메이션은 useMapOptimization 훅에서 동적으로 결정

export const EMPTY_CONTEXTUAL_RESTAURANTS: Restaurant[] = [];

let lastComposedMarkerLayerVersion = '';
let lastComposedMarkerKindSignature = '';

function composeMarkerLayerVersion(markerKindSignature: string) {
    if (markerKindSignature === lastComposedMarkerKindSignature) return lastComposedMarkerLayerVersion;
    lastComposedMarkerKindSignature = markerKindSignature;
    lastComposedMarkerLayerVersion = `${RESTAURANT_MARKER_ASSET_VERSION}:${markerKindSignature}`;
    return lastComposedMarkerLayerVersion;
}

let lastReviewSeed = '';
let lastReviewSeedZoom = Number.NaN;
let lastReviewSeedSouth = Number.NaN;
let lastReviewSeedWest = Number.NaN;
let lastReviewSeedNorth = Number.NaN;
let lastReviewSeedEast = Number.NaN;

function buildVisibleMarkerReviewSeed(
    zoom: number,
    bounds: { south: number; west: number; north: number; east: number } | null,
) {
    if (!bounds) return String(zoom);
    const south = Math.round(bounds.south * 1000);
    const west = Math.round(bounds.west * 1000);
    const north = Math.round(bounds.north * 1000);
    const east = Math.round(bounds.east * 1000);
    if (
        zoom === lastReviewSeedZoom &&
        south === lastReviewSeedSouth &&
        west === lastReviewSeedWest &&
        north === lastReviewSeedNorth &&
        east === lastReviewSeedEast
    ) {
        return lastReviewSeed;
    }
    lastReviewSeedZoom = zoom;
    lastReviewSeedSouth = south;
    lastReviewSeedWest = west;
    lastReviewSeedNorth = north;
    lastReviewSeedEast = east;
    lastReviewSeed = `${zoom}:${south}:${west}:${north}:${east}`;
    return lastReviewSeed;
}

function filterVisibleMarkerReviewBubbleViewportCandidates(
    restaurants: Restaurant[],
    options: {
        isMobile: boolean;
        map: NaverMapLike;
        mapElement: HTMLDivElement | null;
    },
) {
    const projection = options.map.getProjection?.();
    const size = options.map.getSize?.();
    const rect = size?.width && size?.height
        ? { width: size.width, height: size.height }
        : options.mapElement?.getBoundingClientRect();
    if (!projection || !rect?.width || !rect?.height) return restaurants;

    const bubbleHalfWidth = options.isMobile ? 118 : 118;
    const minY = options.isMobile ? 220 : 112;
    const maxY = options.isMobile ? rect.height * 0.46 : rect.height - 140;
    const minX = bubbleHalfWidth + 16;
    const maxX = rect.width - bubbleHalfWidth - 16;

    let inside: Restaurant[] | null = null;
    let scoredRestaurants: Array<{
        restaurant: Restaurant;
        x: number;
        y: number;
        centralityScore: number;
    }> | null = null;
    const targetY = options.isMobile ? rect.height * 0.34 : rect.height * 0.45;
    const centerX = rect.width / 2;
    for (let index = 0; index < restaurants.length; index += 1) {
        const normalizedRestaurant = normalizeNaverMarkerCoordinates(restaurants[index]);
        if (!normalizedRestaurant) continue;
        let point: { x: number; y: number };
        try {
            point = projection.fromCoordToOffset(
                reuseProjectedLatLng(
                    restaurants[index],
                    normalizedRestaurant.lat,
                    normalizedRestaurant.lng,
                    () => new window.naver.maps.LatLng(normalizedRestaurant.lat, normalizedRestaurant.lng),
                ),
            );
        } catch {
            continue;
        }
        const inStrict = point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
        if (inStrict) {
            if (!inside) inside = [];
            inside.push(normalizedRestaurant);
            continue;
        }
        if (inside) continue;
        if (!scoredRestaurants) scoredRestaurants = [];
        scoredRestaurants.push({
            restaurant: normalizedRestaurant,
            x: point.x,
            y: point.y,
            centralityScore: Math.abs(point.x - centerX) * 1.2 + Math.abs(point.y - targetY),
        });
    }

    if (inside && inside.length > 0) return inside;
    if (!scoredRestaurants) return restaurants;

    const broadMinY = options.isMobile ? 148 : 84;
    const broadMaxY = options.isMobile ? rect.height * 0.62 : rect.height - 96;
    const broadCandidates = scoredRestaurants
        .filter(({ x, y }) =>
            x >= bubbleHalfWidth &&
            x <= rect.width - bubbleHalfWidth &&
            y >= broadMinY &&
            y <= broadMaxY
        )
        .sort((left, right) => left.centralityScore - right.centralityScore)
        .slice(0, options.isMobile ? 12 : 24)
        .map(({ restaurant }) => restaurant);

    return broadCandidates.length > 0 ? broadCandidates : restaurants;
}

function clampVisibleMarkerReviewBubbleElements() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const viewportMinX = 8;
    const viewportMaxX = window.innerWidth - 8;
    const shifts: Array<{ element: HTMLElement; marginLeft: string }> = [];
    document.querySelectorAll<HTMLElement>('[data-visible-marker-review-bubble="true"]').forEach((element) => {
        const applied = Number.parseFloat(element.style.marginLeft) || 0;
        const rect = element.getBoundingClientRect();
        const naturalLeft = rect.left - applied;
        const naturalRight = rect.right - applied;
        let offsetX = 0;

        if (naturalLeft < viewportMinX) {
            offsetX = viewportMinX - naturalLeft;
        } else if (naturalRight > viewportMaxX) {
            offsetX = viewportMaxX - naturalRight;
        }

        const marginLeft = Math.abs(offsetX) > 0.5 ? `${offsetX}px` : '0px';
        if (element.style.marginLeft !== marginLeft) {
            shifts.push({ element, marginLeft });
        }
    });
    shifts.forEach(({ element, marginLeft }) => {
        element.style.marginLeft = marginLeft;
    });
}

export function hasVisibleMarkerReviewBubbles(bubbles: object) {
    for (const key in bubbles) {
        if (Object.prototype.hasOwnProperty.call(bubbles, key)) return true;
    }
    return false;
}

export function scheduleVisibleMarkerReviewBubbleClamp() {
    if (typeof window === 'undefined') return;

    window.requestAnimationFrame(() => {
        clampVisibleMarkerReviewBubbleElements();
    });
}

type NaverClusterFeature =
    | ClusterFeature<ClusterProperties>
    | PointFeature<ClusterProperties>;

const CLUSTER_SIGNATURE_COORD_PRECISION = 5;

function roundClusterCoord(value: number): number {
    const factor = 10 ** CLUSTER_SIGNATURE_COORD_PRECISION;
    return Math.round(value * factor) / factor;
}

function buildClusterFeatureSignature(feature: NaverClusterFeature): string {
    const [lng, lat] = feature.geometry.coordinates;
    if (isCluster(feature)) {
        return [
            'cluster',
            feature.properties.cluster_id,
            feature.properties.point_count,
            roundClusterCoord(lat),
            roundClusterCoord(lng),
        ].join(':');
    }

    return [
        'point',
        feature.properties.restaurantId,
        roundClusterCoord(lat),
        roundClusterCoord(lng),
    ].join(':');
}

function areClusterFeaturesEqual(
    previous: readonly NaverClusterFeature[],
    next: readonly NaverClusterFeature[],
): boolean {
    if (previous.length !== next.length) return false;

    for (let index = 0; index < previous.length; index += 1) {
        if (buildClusterFeatureSignature(previous[index]) !== buildClusterFeatureSignature(next[index])) {
            return false;
        }
    }

    return true;
}

function buildRegionalClusterSignature(cluster: RegionalCluster): string {
    return [
        cluster.region,
        cluster.count,
        roundClusterCoord(cluster.center.lat),
        roundClusterCoord(cluster.center.lng),
        cluster.restaurantIds.join(','),
        cluster.categories.join(','),
        cluster.popularityTier,
    ].join(':');
}

function areRegionalClustersEqual(
    previous: readonly RegionalCluster[],
    next: readonly RegionalCluster[],
): boolean {
    if (previous.length !== next.length) return false;

    for (let index = 0; index < previous.length; index += 1) {
        if (buildRegionalClusterSignature(previous[index]) !== buildRegionalClusterSignature(next[index])) {
            return false;
        }
    }

    return true;
}

function areStringArraysEqual(previous: readonly string[], next: readonly string[]): boolean {
    return previous.length === next.length && previous.every((value, index) => value === next[index]);
}

type NaverMapClusterRenderMap = {
    mapRef: RefObject<HTMLDivElement | null>;
    mapInstanceRef: ReadonlyRef<NaverMapLike | null>;
    isMapInitialized: boolean;
    // The map owner also nulls this when it clears markerPool for a new map.
    markerRenderSignatureRef: MutableRefObject<MarkerRenderSignature | null>;
};

type NaverMapClusterRenderSelection = {
    selectedRestaurant: Restaurant | null;
    gridSelectedRestaurant: Restaurant | null | undefined;
    activeSearchedRestaurant: Restaurant | null;
};

export type NaverClusterExpansion = {
    center: { lat: number; lng: number };
    islandViewport: ReturnType<typeof resolveNaverIslandClusterViewportByRegion>;
    // The camera owner calls this only when the island fit declines, so the zoom is read at click time.
    resolveTargetZoom(): number;
};

type NaverMapClusterRenderEvents = {
    onMarkerSelect(restaurant: Restaurant): void;
    onClusterExpand(expansion: NaverClusterExpansion): void;
    onReviewBubbleTargetsChange(targets: VisibleMarkerReviewBubbleTarget[]): void;
    onVisibleRestaurantsChange?: (restaurants: Restaurant[]) => void;
    onContextualRestaurantsChange?: (payload: HomeMapContextualRestaurantsPayload) => void;
};

export type NaverMapClusterRenderOptions = {
    map: NaverMapClusterRenderMap;
    displayRestaurants: Restaurant[];
    resultSummary: HomeMapResultSummary;
    query: { filters: FilterState; selectedRegion: Region | null; showUserSubmittedMarkers: boolean };
    selection: NaverMapClusterRenderSelection;
    device: { isMobileOrTablet: boolean; mapOptimization: MapOptimizationSettings };
    visibleMarkerReviewBubbles: Record<string, VisibleMarkerReviewBubble>;
    events: NaverMapClusterRenderEvents;
};

export type NaverMapClusterRenderState = {
    resolveMarkerRestaurant(restaurantId: string | null | undefined): Restaurant | undefined;
};

type ReadonlyRef<T> = { readonly current: T };

export function useNaverMapClusterRender({
    map: { mapRef, mapInstanceRef, isMapInitialized, markerRenderSignatureRef },
    displayRestaurants,
    resultSummary,
    query: { filters, selectedRegion, showUserSubmittedMarkers },
    selection: { selectedRestaurant, gridSelectedRestaurant, activeSearchedRestaurant },
    device: { isMobileOrTablet, mapOptimization },
    visibleMarkerReviewBubbles,
    events: { onMarkerSelect, onClusterExpand, onReviewBubbleTargetsChange, onVisibleRestaurantsChange, onContextualRestaurantsChange },
}: NaverMapClusterRenderOptions): NaverMapClusterRenderState {
    const pendingOffscreenMarkerRendersRef = useRef<(() => void) | null>(null);
    const extendedBoundsRef = useRef({ south: 0, west: 0, north: 0, east: 0 });
    const lastMarkerViewportRef = useRef<string | null>(null);
    const [markerViewportRevision, setMarkerViewportRevision] = useState(0);
    const lastPublishedMapListsRef = useRef({
        swipeCandidates: null as Restaurant[] | null,
        contextualRestaurants: null as Restaurant[] | null,
        zoom: Number.NaN,
        renderMode: '',
        isEligible: false,
        ineligibilityReason: undefined as HomeMapContextualRestaurantsIneligibilityReason | undefined,
    });
    const earlyMarkerRenderKeyRef = useRef<{
        zoom: number;
        south: number;
        west: number;
        north: number;
        east: number;
        clusters: unknown;
        regionalClusters: unknown;
        seoulDistrictClusters: unknown;
        seoulDistrictClustersFiltered: unknown;
        displayRestaurants: unknown;
        selectedRegion: Region | null;
        selectedRestaurantId: string;
        searchedRestaurantId: string;
        showUserSubmittedMarkers: boolean;
        markerKindSignature: string;
        expandedClusterRestaurantIds: unknown;
        visibleMarkerReviewBubbles: unknown;
        isMobileOrTablet: boolean;
        markerRenderRetryTick: number;
        markerViewportRevision: number;
    } | null>(null);

    // [Cluster] Supercluster 인덱스 및 클러스터 상태
    const clusterIndexRef = useRef<Supercluster<ClusterProperties> | null>(null);
    const [scheduleClusterIndexBuild] = useState(() => createClusterIndexBuildScheduler());
    const [clusterIndexVersion, setClusterIndexVersion] = useState(0);
    const [clusters, setClusters] = useState<Array<ClusterFeature<ClusterProperties> | PointFeature<ClusterProperties>>>([]);
    const [regionalClusters, setRegionalClusters] = useState<RegionalCluster[]>([]); // 17개 행정구역 클러스터
    const [seoulDistrictClusters, setSeoulDistrictClusters] = useState<SeoulDistrictCluster[]>([]); // 줄 9-10: 서울 자치구 25개 모두
    const [seoulDistrictClustersFiltered, setSeoulDistrictClustersFiltered] = useState<SeoulDistrictCluster[]>([]); // 줄 11-12: 마커 3개 이상만
    const [seoulIndividualIds, setSeoulIndividualIds] = useState<string[]>([]); // 줄 11-12: 마커 2개 이하
    const [expandedClusterRestaurantIds, setExpandedClusterRestaurantIds] = useState<string[]>([]);
    const [isClusterMode, setIsClusterMode] = useState(false); // 클러스터 모드 활성화 여부
    const [isRegionalClusterMode, setIsRegionalClusterMode] = useState(false); // 행정구역 클러스터 모드
    const [isSeoulDistrictMode, setIsSeoulDistrictMode] = useState(false); // 서울 자치구 모드
    const [markerRenderRetryTick, setMarkerRenderRetryTick] = useState(0);
    const markerRenderEmptyRetryCountRef = useRef(0);
    const markerRenderRetryTimerRef = useRef<number | null>(null);

    const visibleMarkerReviewBubbleTargetSignatureRef = useRef('');
    const reviewBubbleProjectionCacheRef = useRef<{
        seed: string;
        idSignature: string;
        restaurants: ReturnType<typeof getRestaurantsWithRenderableCoordinates>;
        targets: VisibleMarkerReviewBubbleTarget[];
        targetSignature: string;
    } | null>(null);

    // [OPTIMIZATION] 마커 및 클러스터 애니메이션 스타일 주입 + 클러스터 애니메이션 시작
    useEffect(() => {
        // 클러스터 CSS 주입
        injectClusterCSS();

        // 클러스터 애니메이션 시작 (성능 티어에 따라 조건부 실행)
        if (ENABLE_CLUSTERING && mapOptimization.clusterAnimationEnabled) {
            clusterAnimationManager.start(mapOptimization.clusterAnimationInterval);
        }

        // 정리: 컴포넌트 언마운트 시
        return () => {
            // 클러스터 CSS 및 애니메이션 정리
            removeClusterCSS();
            clusterAnimationManager.clear();

            // 마커 풀 정리
            markerPool.clear();
            markerRenderSignatureRef.current = null;
        };
    }, [mapOptimization.clusterAnimationEnabled, mapOptimization.clusterAnimationInterval, markerRenderSignatureRef]);

    useEffect(() => {
        if (!showUserSubmittedMarkers) {
            setExpandedClusterRestaurantIds([]);
        }
    }, [showUserSubmittedMarkers]);

    // History/search selections can outlive the visible query and omit its
    // projected tier. Use one publication projection for the guard and visual.
    const publishedSelectedRestaurant = useMemo(
        () => selectedRestaurant ? projectPublishedPopularityTier(selectedRestaurant) : null,
        [selectedRestaurant],
    );
    const publishedSearchedRestaurant = useMemo(
        () => activeSearchedRestaurant ? projectPublishedPopularityTier(activeSearchedRestaurant) : null,
        [activeSearchedRestaurant],
    );
    const markerKindSignature = useMemo(
        () => buildRestaurantMarkerKindSignature(displayRestaurants, undefined, {
            selected: publishedSelectedRestaurant?.popularity_tier,
            searched: publishedSearchedRestaurant?.popularity_tier,
        }),
        [displayRestaurants, publishedSelectedRestaurant?.popularity_tier, publishedSearchedRestaurant?.popularity_tier],
    );
    const overlappingMarkerOffsets = useMemo(
        () => buildNaverOverlappingMarkerOffsets(displayRestaurants),
        [displayRestaurants],
    );

    const [expandedClusterRestaurantSnapshot] = useState(() => new Map<string, Restaurant>());
    const restaurantLookup = useMemo(
        () => buildRestaurantLookup(displayRestaurants),
        [displayRestaurants],
    );
    const displayRestaurantLookup = useMemo(
        () => showUserSubmittedMarkers ? restaurantLookup : buildRestaurantLookup(displayRestaurants),
        [displayRestaurants, restaurantLookup, showUserSubmittedMarkers],
    );
    const { idSet: displayRestaurantIds, mergedRestaurantIds } = displayRestaurantLookup;
    const { byId: restaurantById, mergedRestaurantById } = restaurantLookup;
    const allowSelectionMarker = (restaurant: Restaurant | null) => resultSummary.status === 'ready'
        && (!resultSummary.active || Boolean(restaurant && (displayRestaurantIds.has(restaurant.id) || mergedRestaurantById.has(restaurant.id))));
    const markerVisibleActiveSearchedRestaurant =
        allowSelectionMarker(publishedSearchedRestaurant) && (showUserSubmittedMarkers || !isUserSubmittedRestaurant(publishedSearchedRestaurant))
            ? publishedSearchedRestaurant
            : null;
    const markerVisibleSelectedRestaurant =
        allowSelectionMarker(publishedSelectedRestaurant) && (showUserSubmittedMarkers || !isUserSubmittedRestaurant(publishedSelectedRestaurant))
            ? publishedSelectedRestaurant
            : null;
    const expandedClusterRetainIds = useMemo(() => {
        const ids: string[] = [];
        for (const id of expandedClusterRestaurantIds) {
            if (typeof id === 'string' && id.length > 0) ids.push(id);
        }
        for (const id of [selectedRestaurant?.id, gridSelectedRestaurant?.id, markerVisibleSelectedRestaurant?.id]) {
            if (typeof id === 'string' && id.length > 0) ids.push(id);
        }
        return ids;
    }, [expandedClusterRestaurantIds, gridSelectedRestaurant, markerVisibleSelectedRestaurant, selectedRestaurant]);
    useMemo(() => {
        retainExpandedClusterRestaurantSnapshot(
            expandedClusterRestaurantSnapshot,
            restaurantById,
            mergedRestaurantById,
            expandedClusterRetainIds,
        );
        return expandedClusterRetainIds.length;
    }, [expandedClusterRestaurantSnapshot, expandedClusterRetainIds, mergedRestaurantById, restaurantById]);
    const resolveMarkerRestaurant = useCallback((restaurantId: string | null | undefined) => resolveExpandedClusterRestaurant(
        restaurantId,
        restaurantById,
        mergedRestaurantById,
        expandedClusterRestaurantSnapshot,
        expandedClusterRestaurantIds.length > 0,
    ), [expandedClusterRestaurantIds, expandedClusterRestaurantSnapshot, mergedRestaurantById, restaurantById]);
    const restaurantsForSwipe = useMemo(() => buildRestaurantsForSwipe({
        activeSearchedRestaurant: markerVisibleActiveSearchedRestaurant,
        selectedRestaurant: markerVisibleSelectedRestaurant,
        displayRestaurantIds,
        displayRestaurants,
    }), [displayRestaurants, displayRestaurantIds, markerVisibleActiveSearchedRestaurant, markerVisibleSelectedRestaurant]);
    const filterSignature = useMemo(
        () => [
            ...filters.categories,
            filters.minRating,
            filters.minReviews,
            filters.minUserVisits,
            filters.minJjyangVisits,
            filters.featuredTheme ?? '',
        ].join('|'),
        [filters.categories, filters.featuredTheme, filters.minJjyangVisits, filters.minRating, filters.minReviews, filters.minUserVisits],
    );

    useEffect(() => {
        setExpandedClusterRestaurantIds([]);
    }, [filterSignature, selectedRegion]);

    const clearMarkerRenderRetryTimer = useCallback(() => {
        if (markerRenderRetryTimerRef.current === null) return;
        window.clearTimeout(markerRenderRetryTimerRef.current);
        markerRenderRetryTimerRef.current = null;
    }, []);

    const scheduleMarkerRenderRetry = useCallback(() => {
        if (markerRenderEmptyRetryCountRef.current >= MARKER_RENDER_EMPTY_RETRY_LIMIT) return;
        markerRenderEmptyRetryCountRef.current += 1;
        clearMarkerRenderRetryTimer();
        markerRenderRetryTimerRef.current = window.setTimeout(() => {
            markerRenderRetryTimerRef.current = null;
            markerRenderSignatureRef.current = null;
            setMarkerRenderRetryTick((tick) => tick + 1);
        }, MARKER_RENDER_EMPTY_RETRY_DELAY_MS);
    }, [clearMarkerRenderRetryTimer, markerRenderSignatureRef]);

    const resetMarkerRenderRetry = useCallback(() => {
        markerRenderEmptyRetryCountRef.current = 0;
        clearMarkerRenderRetryTimer();
    }, [clearMarkerRenderRetryTimer]);

    useEffect(() => () => clearMarkerRenderRetryTimer(), [clearMarkerRenderRetryTimer]);

    useEffect(() => {
        markerRenderEmptyRetryCountRef.current = 0;
        markerRenderSignatureRef.current = null;
        clearMarkerRenderRetryTimer();
    }, [clearMarkerRenderRetryTimer, filterSignature, markerKindSignature, selectedRegion, showUserSubmittedMarkers, markerRenderSignatureRef]);

    // [Cluster] 클러스터 인덱스 생성 및 업데이트
    useEffect(() => {

        if (shouldClearEmptyClusterState({
            clusteringEnabled: ENABLE_CLUSTERING,
            displayRestaurantCount: displayRestaurants.length,
            expandedRestaurantCount: expandedClusterRestaurantIds.length,
        })) {
            setClusters((previous) => nextEmptyIdentityArray(previous));
            setRegionalClusters((previous) => nextEmptyIdentityArray(previous));
            setSeoulDistrictClusters((previous) => nextEmptyIdentityArray(previous));
            setSeoulDistrictClustersFiltered((previous) => nextEmptyIdentityArray(previous));
            setSeoulIndividualIds((previous) => nextEmptyIdentityArray(previous));
            if (clusterIndexRef.current) {
                clusterIndexRef.current = null;
                setClusterIndexVersion((version) => version + 1);
            }
            return;
        }

        // [Fix] 지도가 초기화되지 않았으면 대기 (isMapInitialized 의존성으로 재실행됨)
        if (!isMapInitialized || !mapInstanceRef.current) {
            return;
        }

        let cancelled = false;
        const scheduleIdleWork = (callback: IdleRequestCallback): number => {
            if (window.requestIdleCallback) {
                return window.requestIdleCallback(callback, { timeout: CLUSTER_INDEX_IDLE_TIMEOUT_MS });
            }

            return window.setTimeout(() => callback({
                didTimeout: false,
                timeRemaining: () => 0,
            } as IdleDeadline), 0);
        };
        const cancelIdleWork = window.cancelIdleCallback
            ? window.cancelIdleCallback.bind(window)
            : window.clearTimeout.bind(window);

        const buildClusterIndex = () => {
            if (cancelled || !mapInstanceRef.current) return false;
            markInitialLoadMilestone('clusterIndexStarted');

            // GeoJSON 변환
            const geoJsonPoints = restaurantsToGeoJSON(displayRestaurants);

            // 클러스터 인덱스 생성 (지역별 동적 maxZoom, 성능 티어별 반경)
            // 현재 줌 레벨을 가져와서 동적 반경 계산
            const currentZoom = mapInstanceRef.current.getZoom();
            const clusterRadius = mapOptimization.getClusterRadius(currentZoom);

            const index = createClusterIndex(selectedRegion, {
                radius: clusterRadius,
                minPoints: mapOptimization.clusterMinPoints,
            });

            // 데이터 로드
            index.load(geoJsonPoints);
            if (cancelled) return false;
            clusterIndexRef.current = index;
            setClusterIndexVersion((version) => version + 1);

            // 초기 클러스터 계산
            const map = mapInstanceRef.current;
            // 줌 레벨 2단위로 묶기 (7,8 → 8, 9,10 → 10, 11,12 → 12)
            const zoom = quantizeNaverClusterZoom(map.getZoom());
            let bounds = null;
            try {
                bounds = map.getBounds();
            } catch {
                bounds = null;
            }
            const bbox = resolveNaverClusterBoundsBbox(bounds);

            const newClusters = getClusters(index, bbox, zoom);
            setClusters((previous) => areClusterFeaturesEqual(previous, newClusters) ? previous : newClusters);

            // 17개 행정구역 클러스터도 계산
            const newRegionalClusters = getRegionalClusters(displayRestaurants);
            setRegionalClusters((previous) => areRegionalClustersEqual(previous, newRegionalClusters) ? previous : newRegionalClusters);

            // 서울 25개 자치구 클러스터 계산 (두 가지 모드)
            // 줌 9-10: 모든 구를 클러스터로 (minClusterSize=1)
            const seoulResultAll = getSeoulDistrictClusters(displayRestaurants, 1);
            setSeoulDistrictClusters((previous) =>
                areRegionalClustersEqual(previous, seoulResultAll.clusters) ? previous : seoulResultAll.clusters
            );

            // 줌 11-12: 마커 3개 이상만 클러스터, 2개 이하는 개별 마커 (minClusterSize=3)
            const seoulResultFiltered = getSeoulDistrictClusters(displayRestaurants, 3);
            setSeoulDistrictClustersFiltered((previous) =>
                areRegionalClustersEqual(previous, seoulResultFiltered.clusters) ? previous : seoulResultFiltered.clusters
            );
            setSeoulIndividualIds((previous) =>
                areStringArraysEqual(previous, seoulResultFiltered.individualRestaurantIds)
                    ? previous
                    : seoulResultFiltered.individualRestaurantIds
            );
            markInitialLoadMilestone('clusterIndexReady', displayRestaurants.length);
            return true;
        };
        const cancelScheduledBuild = scheduleClusterIndexBuild({
            build: buildClusterIndex,
            // The first complete index is needed for visible markers. Yield to
            // the current task without waiting for an idle period; later query
            // changes keep the existing idle queue and timeout.
            scheduleInitial: (callback) => {
                const handle = window.setTimeout(callback, 0);
                return () => window.clearTimeout(handle);
            },
            scheduleRebuild: (callback) => {
                const handle = scheduleIdleWork(callback);
                return () => cancelIdleWork(handle);
            },
        });

        return () => {
            cancelled = true;
            cancelScheduledBuild();
        };
    }, [displayRestaurants, expandedClusterRestaurantIds.length, selectedRegion, isMapInitialized, mapOptimization, scheduleClusterIndexBuild, mapInstanceRef]);

    // [Cluster] 지도 이동/줌 시 클러스터 업데이트
    useEffect(() => {
        // [Fix] 지도가 초기화되지 않았으면 대기
        if (!isMapInitialized || !mapInstanceRef.current || !ENABLE_CLUSTERING) return;

        const maps = window.naver?.maps;
        if (!maps?.Event) return;

        let disposed = false;
        const updateClusters = () => {
            if (disposed || !mapInstanceRef.current) return;

            const map = mapInstanceRef.current;
            // 줌 레벨 2단위로 묶기 (7,8 → 8, 9,10 → 10, 11,12 → 12)
            const zoom = quantizeNaverClusterZoom(map.getZoom());
            let bounds = null;
            let center = null;
            try {
                bounds = map.getBounds();
            } catch {
                bounds = null;
            }
            try {
                center = map.getCenter();
            } catch {
                center = null;
            }
            if (!clusterIndexRef.current) return;

            const bboxPlan = resolveNaverClusterUpdateBbox({
                bounds,
                center,
                zoom,
            });

            if (bboxPlan.shouldWarnMissingCenter) {
                console.error('[지도 이동/줌] center도 가져올 수 없음');
            }
            if (bboxPlan.shouldSkip || !bboxPlan.bbox) {
                return;
            }

            const newClusters = getClusters(clusterIndexRef.current, bboxPlan.bbox, zoom);
            setClusters((previous) => areClusterFeaturesEqual(previous, newClusters) ? previous : newClusters);
        };

        const map = mapInstanceRef.current;
        // Only cluster queries wait for the performance-tier debounce. Expanded
        // markers must restore on the current idle even when cached data is equal.
        const debouncedUpdateClusters = debounce(updateClusters, mapOptimization.idleDebounceMs);
        const handleViewportChange = () => {
            if (disposed || !mapInstanceRef.current) return;
            const viewportKey = getNaverMarkerViewportKey(mapInstanceRef.current, mapRef.current);
            if (lastMarkerViewportRef.current !== viewportKey) {
                lastMarkerViewportRef.current = viewportKey;
                if (expandedClusterRestaurantIds.length > 0) {
                    setMarkerViewportRevision((revision) => revision + 1);
                }
            }
            debouncedUpdateClusters();
        };
        const idleListener = maps.Event.addListener(map, 'idle', handleViewportChange);
        const resizeListener = maps.Event.addListener(map, 'resize', handleViewportChange);

        return () => {
            disposed = true;
            removeNaverMapListener(maps.Event, idleListener);
            removeNaverMapListener(maps.Event, resizeListener);
        };
    }, [clusterIndexVersion, displayRestaurants, expandedClusterRestaurantIds.length, isMapInitialized, mapOptimization.idleDebounceMs, mapInstanceRef, mapRef]);

    // [Render] 줌 레벨에 따라 클러스터 또는 개별 마커 렌더링
    useEffect(() => {
        if (pendingOffscreenMarkerRendersRef.current) {
            pendingOffscreenMarkerRendersRef.current();
            pendingOffscreenMarkerRendersRef.current = null;
            earlyMarkerRenderKeyRef.current = null;
            markerRenderSignatureRef.current = null;
        }
        // [Init] 지도가 초기화되지 않았으면 대기
        if (!isMapInitialized || !mapInstanceRef.current || !window.naver?.maps) return;
        const { naver } = window;
        if (!naver.maps.LatLng || !naver.maps.Point) return;
        const map = mapInstanceRef.current;
        const currentZoom = Math.floor(map.getZoom());
        const retainSmallExpandedSet = expandedClusterRestaurantIds.length > 0
            && expandedClusterRestaurantIds.length <= 1000;
        const deferredMarkerRenders: Array<(() => void) | undefined> = [];
        const markerViewportKey = getNaverMarkerViewportKey(map, mapRef.current);

        // [OPTIMIZATION] 가시영역 확장 계산 (한 번만 수행)
        const extendedBounds = fillExtendedBounds(map, VIEWPORT_PADDING, extendedBoundsRef.current)
            ? extendedBoundsRef.current
            : null;
        const south = extendedBounds ? Math.round(extendedBounds.south * 10000) : 0;
        const west = extendedBounds ? Math.round(extendedBounds.west * 10000) : 0;
        const north = extendedBounds ? Math.round(extendedBounds.north * 10000) : 0;
        const east = extendedBounds ? Math.round(extendedBounds.east * 10000) : 0;
        const selectedRestaurantId = selectedRestaurant?.id ?? '';
        const searchedRestaurantId = markerVisibleActiveSearchedRestaurant?.id ?? '';
        // Retention avoids measured SDK detach/icon churn. Mobile screen-reader
        // exposure still follows the existing padded view and selection exceptions.
        for (const id of expandedClusterRestaurantIds) {
            const marker = markerPool.get(id);
            if (!marker) continue;
            const restaurant = resolveMarkerRestaurant(id);
            const accessible = !isMobileOrTablet || !retainSmallExpandedSet || Boolean(
                restaurant && shouldRenderExpandedClusterMarker(
                    restaurant, selectedRestaurantId, searchedRestaurantId,
                    extendedBounds, VIEWPORT_FILTER_ENABLED,
                ),
            );
            syncRetainedMarkerAccessibility(marker, accessible, mapRef.current);
        }
        const previousEarlyMarkerRenderKey = earlyMarkerRenderKeyRef.current;
        if (
            previousEarlyMarkerRenderKey !== null &&
            previousEarlyMarkerRenderKey.zoom === currentZoom &&
            previousEarlyMarkerRenderKey.south === south &&
            previousEarlyMarkerRenderKey.west === west &&
            previousEarlyMarkerRenderKey.north === north &&
            previousEarlyMarkerRenderKey.east === east &&
            previousEarlyMarkerRenderKey.clusters === clusters &&
            previousEarlyMarkerRenderKey.regionalClusters === regionalClusters &&
            previousEarlyMarkerRenderKey.seoulDistrictClusters === seoulDistrictClusters &&
            previousEarlyMarkerRenderKey.seoulDistrictClustersFiltered === seoulDistrictClustersFiltered &&
            previousEarlyMarkerRenderKey.displayRestaurants === displayRestaurants &&
            previousEarlyMarkerRenderKey.selectedRegion === selectedRegion &&
            previousEarlyMarkerRenderKey.selectedRestaurantId === selectedRestaurantId &&
            previousEarlyMarkerRenderKey.searchedRestaurantId === searchedRestaurantId &&
            previousEarlyMarkerRenderKey.showUserSubmittedMarkers === showUserSubmittedMarkers &&
            previousEarlyMarkerRenderKey.markerKindSignature === markerKindSignature &&
            previousEarlyMarkerRenderKey.expandedClusterRestaurantIds === expandedClusterRestaurantIds &&
            previousEarlyMarkerRenderKey.visibleMarkerReviewBubbles === visibleMarkerReviewBubbles &&
            previousEarlyMarkerRenderKey.isMobileOrTablet === isMobileOrTablet &&
            previousEarlyMarkerRenderKey.markerRenderRetryTick === markerRenderRetryTick &&
            previousEarlyMarkerRenderKey.markerViewportRevision === markerViewportRevision
        ) {
            return;
        }
        earlyMarkerRenderKeyRef.current = {
            zoom: currentZoom,
            south,
            west,
            north,
            east,
            clusters,
            regionalClusters,
            seoulDistrictClusters,
            seoulDistrictClustersFiltered,
            displayRestaurants,
            selectedRegion,
            selectedRestaurantId,
            searchedRestaurantId,
            showUserSubmittedMarkers,
            markerKindSignature,
            expandedClusterRestaurantIds,
            visibleMarkerReviewBubbles,
            isMobileOrTablet,
            markerRenderRetryTick,
            markerViewportRevision,
        };

        // [PERFORMANCE] 렌더링 시작 시간 측정
        perfMonitor.startMeasure('RenderMarkers');

        const effectiveMaxZoom = getClusterMaxZoom(selectedRegion);
        const clusterIndexMaxZoom = getClusterIndexMaxZoom(selectedRegion);
        const {
            shouldCluster,
            shouldUseRegionalCluster,
            shouldUseSeoulDistrictCluster,
            nextIsRegionalClusterMode,
            nextIsSeoulDistrictMode,
            nextIsClusterMode,
            seoulClustersToRender,
            shouldUseSeoulDistrictFiltered,
        } = deriveClusterRenderPlan(
            currentZoom,
            Boolean(selectedRegion),
            effectiveMaxZoom,
            seoulDistrictClusters,
            seoulDistrictClustersFiltered,
        );

        // 모드 설정
        setIsRegionalClusterMode(nextIsRegionalClusterMode);
        setIsSeoulDistrictMode(nextIsSeoulDistrictMode);
        setIsClusterMode(nextIsClusterMode);

        const visibleRestaurants = getVisibleRestaurantsForRender(
            restaurantsForSwipe,
            markerVisibleSelectedRestaurant?.id ?? null,
            extendedBounds,
            VIEWPORT_FILTER_ENABLED,
        );
        const visibleRestaurantIds = expandedClusterRestaurantIds.length > 0
            ? new Set(visibleRestaurants.map((restaurant) => restaurant.id))
            : getVisibleRestaurantIdSet(visibleRestaurants);
        const restaurantsForMarkerRender = expandedClusterRestaurantIds.length > 0
            ? [...visibleRestaurants]
            : visibleRestaurants;
        expandedClusterRestaurantIds.forEach((restaurantId) => {
            if (visibleRestaurantIds.has(restaurantId)) return;

            const restaurant = normalizeNaverMarkerCoordinates(
                resolveMarkerRestaurant(restaurantId),
            );
            if (!restaurant || (!showUserSubmittedMarkers && isUserSubmittedRestaurant(restaurant))) return;

            visibleRestaurantIds.add(restaurantId);
            restaurantsForMarkerRender.push(restaurant);
        });
        const swipeCandidates = buildPostSearchSwipeCandidates({
            visibleRestaurants: restaurantsForMarkerRender,
            allRestaurants: restaurantsForSwipe,
            activeSearchedRestaurant: markerVisibleActiveSearchedRestaurant,
        });
        const contextualRestaurants = getRestaurantsWithRenderableCoordinates(restaurantsForMarkerRender);
        const hasExpandedClusterRestaurants = expandedClusterRestaurantIds.length > 0 && contextualRestaurants.length > 0;
        const contextualRenderMode: HomeMapRenderMode = expandedClusterRestaurantIds.length > 0
            ? 'individual'
            : resolveHomeMapContextualRenderMode({
                shouldUseRegionalCluster,
                shouldUseSeoulDistrictCluster,
                shouldCluster,
            });
        const contextualIneligibilityReason = hasExpandedClusterRestaurants
            ? undefined
            : resolveHomeMapContextualIneligibilityReason({
                renderMode: contextualRenderMode,
                zoom: currentZoom,
                visibleCount: contextualRestaurants.length,
            });
        const isContextualPayloadEligible = !contextualIneligibilityReason;
        const visibleMarkerReviewCandidateRestaurants = getRestaurantsWithRenderableCoordinates(visibleRestaurants);
        const reviewBubbleSeed = isContextualPayloadEligible && !selectedRestaurant
            ? buildVisibleMarkerReviewSeed(currentZoom, extendedBounds)
            : '';
        const reviewBubbleIdSignature = reviewBubbleSeed
            ? buildVisibleRestaurantIdSignature(visibleMarkerReviewCandidateRestaurants)
            : '';
        const cachedReviewBubbleProjection = reviewBubbleProjectionCacheRef.current;
        const reviewBubbleCacheHit = Boolean(
            reviewBubbleSeed &&
            cachedReviewBubbleProjection?.seed === reviewBubbleSeed &&
            cachedReviewBubbleProjection.idSignature === reviewBubbleIdSignature,
        );
        const reviewBubbleCandidateRestaurants = reviewBubbleSeed
            ? reviewBubbleCacheHit
                ? cachedReviewBubbleProjection!.restaurants
                : filterVisibleMarkerReviewBubbleViewportCandidates(visibleMarkerReviewCandidateRestaurants, {
                    isMobile: isMobileOrTablet,
                    map,
                    mapElement: mapRef.current,
                })
            : [];
        const nextReviewBubbleTargets = reviewBubbleCacheHit
            ? cachedReviewBubbleProjection!.targets
            : reviewBubbleCandidateRestaurants.length > 0
                ? selectVisibleMarkerReviewBubbleTargets(reviewBubbleCandidateRestaurants, {
                    limit: isMobileOrTablet
                        ? VISIBLE_MARKER_REVIEW_BUBBLE_MOBILE_LIMIT
                        : VISIBLE_MARKER_REVIEW_BUBBLE_DESKTOP_LIMIT,
                    seed: reviewBubbleSeed,
                })
                : [];
        const nextReviewBubbleTargetSignature = reviewBubbleCacheHit
            ? cachedReviewBubbleProjection!.targetSignature
            : buildVisibleMarkerReviewBubbleTargetSignature(nextReviewBubbleTargets);
        if (reviewBubbleSeed && !reviewBubbleCacheHit) {
            reviewBubbleProjectionCacheRef.current = {
                seed: reviewBubbleSeed,
                idSignature: reviewBubbleIdSignature,
                restaurants: reviewBubbleCandidateRestaurants,
                targets: nextReviewBubbleTargets,
                targetSignature: nextReviewBubbleTargetSignature,
            };
        }
        if (visibleMarkerReviewBubbleTargetSignatureRef.current !== nextReviewBubbleTargetSignature) {
            visibleMarkerReviewBubbleTargetSignatureRef.current = nextReviewBubbleTargetSignature;
            onReviewBubbleTargetsChange(nextReviewBubbleTargets);
        }
        const activeVisibleMarkerReviewBubbles = isContextualPayloadEligible && !selectedRestaurant
            ? visibleMarkerReviewBubbles
            : {};
        const publishedLists = lastPublishedMapListsRef.current;
        if (publishedLists.swipeCandidates !== swipeCandidates) {
            publishedLists.swipeCandidates = swipeCandidates;
            onVisibleRestaurantsChange?.(swipeCandidates);
        }
        const publishedContextualRestaurants = isContextualPayloadEligible
            ? contextualRestaurants
            : EMPTY_CONTEXTUAL_RESTAURANTS;
        if (
            publishedLists.contextualRestaurants !== publishedContextualRestaurants ||
            publishedLists.zoom !== currentZoom ||
            publishedLists.renderMode !== contextualRenderMode ||
            publishedLists.isEligible !== isContextualPayloadEligible ||
            publishedLists.ineligibilityReason !== contextualIneligibilityReason
        ) {
            publishedLists.contextualRestaurants = publishedContextualRestaurants;
            publishedLists.zoom = currentZoom;
            publishedLists.renderMode = contextualRenderMode;
            publishedLists.isEligible = isContextualPayloadEligible;
            publishedLists.ineligibilityReason = contextualIneligibilityReason;
            onContextualRestaurantsChange?.({
                mode: 'domestic',
                restaurants: publishedContextualRestaurants,
                renderMode: contextualRenderMode,
                zoom: currentZoom,
                isEligible: isContextualPayloadEligible,
                ineligibilityReason: contextualIneligibilityReason,
                totalVisibleCount: contextualRestaurants.length,
            });
        }

        const renderTargetIdsForSignature = buildRenderTargetIdsForSignature({
            activeSearchedRestaurant: markerVisibleActiveSearchedRestaurant,
            selectedRestaurant: markerVisibleSelectedRestaurant,
            clusters,
            displayRestaurantIds,
            displayRestaurants,
            mergedRestaurantById,
            nextIsClusterMode,
            nextIsRegionalClusterMode,
            nextIsSeoulDistrictMode,
            regionalClusters,
            restaurantById,
            seoulClustersToRender,
            seoulIndividualIds: shouldUseSeoulDistrictFiltered ? seoulIndividualIds : [],
        });
        const signatureIds = expandedClusterRestaurantIds.length > 0 || hasVisibleMarkerReviewBubbles(activeVisibleMarkerReviewBubbles)
            ? renderTargetIdsForSignature.slice()
            : renderTargetIdsForSignature;
        expandedClusterRestaurantIds.forEach((restaurantId) => {
            signatureIds.push(`expanded-cluster-${restaurantId}`);
        });
        for (const restaurantId in activeVisibleMarkerReviewBubbles) {
            if (!Object.prototype.hasOwnProperty.call(activeVisibleMarkerReviewBubbles, restaurantId)) continue;
            signatureIds.push(buildVisibleMarkerReviewBubbleRenderToken(
                activeVisibleMarkerReviewBubbles[restaurantId],
                isMobileOrTablet,
            ));
        }

        const nextMarkerRenderSignature = buildMarkerRenderSignature({
            zoom: currentZoom,
            bounds: retainSmallExpandedSet ? null : extendedBounds,
            displayRestaurantIds: signatureIds,
            selectedRestaurantId: selectedRestaurant?.id || null,
            searchedRestaurantId: markerVisibleActiveSearchedRestaurant?.id || null,
            isClusterMode: nextIsClusterMode,
            isRegionalClusterMode: nextIsRegionalClusterMode,
            isSeoulDistrictMode: nextIsSeoulDistrictMode,
            markerLayerVersion: composeMarkerLayerVersion(markerKindSignature)
                + (expandedClusterRestaurantIds.length > 0 && !retainSmallExpandedSet ? `:viewport-${markerViewportRevision}` : ''),
            showUserSubmittedMarkers,
        });

        const previousMarkerRenderSignature = markerRenderSignatureRef.current;
        if (previousMarkerRenderSignature && shouldSkipMarkerUpdate(previousMarkerRenderSignature, nextMarkerRenderSignature)) {
            const hasRenderedMarkerDom = markerPool.getStats().activeCount > 0;
            const skippedEmptyThemePlan = resolveSkippedEmptyThemeMarkerPlan({
                displayRestaurantCount: displayRestaurants.length,
                hasRenderedMarkerDom,
            });
            if (skippedEmptyThemePlan === 'skip') {
                perfMonitor.endMeasure('RenderMarkers');
                return;
            }
            if (skippedEmptyThemePlan === 'retry') {
                markerRenderSignatureRef.current = null;
                scheduleMarkerRenderRetry();
            }
        }

        // 헬퍼: 클러스터 마커 렌더링 (중복 로직 제거)
        const renderClusterHelper = (
            markerId: string,
            position: { lat: number, lng: number },
            count: number,
            categories: string[],
            uniqueKey: string | number,
            popularityTier: "fire" | "ember" | "rainbow" | "standard" | undefined,
            onClick: () => void
        ) => {
            const renderPlan = mapOptimization.clusterAnimationEnabled
                ? buildNaverClusterAnimationIconPlan({
                    categories,
                    count,
                    getCurrentIndex: (hash, categoryCount) => {
                        clusterAnimationManager.register(hash);
                        return clusterAnimationManager.getCurrentIndex(hash, categoryCount);
                    },
                    popularityTier,
                    position,
                    uniqueKey,
                })
                : buildNaverClusterMarkerRenderPlan({
                    categories,
                    count,
                    currentIndex: 0,
                    popularityTier,
                    position,
                });

            markerPool.acquire(
                markerId,
                reuseMarkerLatLng(
                    markerPool.get(markerId)?.getPosition(),
                    renderPlan.position.lat,
                    renderPlan.position.lng,
                    () => new naver.maps.LatLng(renderPlan.position.lat, renderPlan.position.lng),
                ),
                { content: renderPlan.content, anchor: anchorForMarker(markerId, renderPlan.anchor.x, renderPlan.anchor.y) },
                map,
                onClick
            );
        };
        const anchorForMarker = (id: string, x: number, y: number) => reuseMarkerAnchor(
            markerPool.get(id)?.getIcon()?.anchor ?? null,
            x,
            y,
            () => new naver.maps.Point(x, y),
        );
        const createIndividualMarkerPosition = (restaurant: { id: string }, lat: number, lng: number) => {
            const offset = overlappingMarkerOffsets.get(restaurant.id);
            const current = markerPool.get(restaurant.id)?.getPosition();
            if (!offset || offset.count <= 1) {
                return reuseMarkerLatLng(current, lat, lng, () => new naver.maps.LatLng(lat, lng));
            }
            const basePosition = new naver.maps.LatLng(lat, lng);
            return resolveNaverOverlappingMarkerPosition({
                basePosition,
                createPoint: (x, y) => new naver.maps.Point(x, y),
                offset: overlappingMarkerOffsets.get(restaurant.id),
                projection: map.getProjection(),
            });
        };

        const expandedClusterRestaurantIdSet = new Set(expandedClusterRestaurantIds);
        const shouldSkipExpandedClusterMarker = (restaurantIds: string[]) =>
            restaurantIds.length > 0 && restaurantIds.every((restaurantId) => expandedClusterRestaurantIdSet.has(restaurantId));
        const shouldRenderExpandedMarker = (restaurant: Restaurant) =>
            shouldRenderExpandedClusterMarker(
                restaurant,
                markerVisibleSelectedRestaurant?.id ?? null,
                markerVisibleActiveSearchedRestaurant?.id ?? null,
                extendedBounds,
                VIEWPORT_FILTER_ENABLED && !retainSmallExpandedSet,
            );
        const renderedExpandedSources = new Map<string, Restaurant>();
        const renderExpandedClusterIndividuals = (activeIds: Set<string>) => {
            if (expandedClusterRestaurantIds.length === 0) return;
            expandedClusterRestaurantIds.forEach((restaurantId) => {
                const sourceRestaurant = resolveMarkerRestaurant(restaurantId);
                const restaurant = normalizeNaverMarkerCoordinates(sourceRestaurant);
                if (!restaurant || (!showUserSubmittedMarkers && isUserSubmittedRestaurant(restaurant))) return;
                if (!shouldRenderExpandedMarker(restaurant)) return;
                if (sourceRestaurant) renderedExpandedSources.set(restaurant.id, sourceRestaurant);

                activeIds.add(restaurant.id);
                const render = () => {
                const isSelected = selectedRestaurant?.id === restaurant.id;
                const visual = getNaverIndividualMarkerVisual(restaurant, isSelected);
                const bubble = activeVisibleMarkerReviewBubbles[restaurant.id];
                const markerContent = wrapNaverMarkerContentWithReviewBubble(
                    visual.content,
                    bubble,
                    isMobileOrTablet,
                );

                const marker = markerPool.acquire(
                    restaurant.id,
                    createIndividualMarkerPosition(restaurant, restaurant.lat, restaurant.lng),
                    { content: markerContent, anchor: anchorForMarker(restaurant.id, visual.anchor.x, visual.anchor.y) },
                    map,
                    () => onMarkerSelect(restaurant)
                );
                syncRetainedMarkerAccessibility(marker,
                    !isMobileOrTablet || !retainSmallExpandedSet || inInitialViewport, mapRef.current);
                };
                const inInitialViewport = shouldRenderExpandedClusterMarker(
                    restaurant, markerVisibleSelectedRestaurant?.id ?? null,
                    markerVisibleActiveSearchedRestaurant?.id ?? null,
                    extendedBounds, VIEWPORT_FILTER_ENABLED,
                );
                if (retainSmallExpandedSet && !inInitialViewport && !markerPool.has(restaurant.id)) {
                    deferredMarkerRenders.push(render);
                } else {
                    render();
                }
            });
        };

        const emptyClusterCleanupPlan = resolveEmptyClusterMarkerCleanupPlan({
            displayRestaurantCount: displayRestaurants.length,
            clusterCount: shouldUseRegionalCluster ? regionalClusters.length : 1,
            expandedRestaurantCount: expandedClusterRestaurantIds.length,
        });
        if (emptyClusterCleanupPlan === 'release') {
            markerPool.releaseExcept(new Set());
            lastMarkerViewportRef.current = markerViewportKey;
            markerRenderSignatureRef.current = nextMarkerRenderSignature;
            resetMarkerRenderRetry();
            perfMonitor.endMeasure('RenderMarkers');
            return;
        }

        if (shouldUseRegionalCluster) {
            // ===== 17개 행정구역 중앙 클러스터 모드 =====
            if (emptyClusterCleanupPlan === 'retry') {
                markerRenderSignatureRef.current = null;
                scheduleMarkerRenderRetry();
                perfMonitor.endMeasure('RenderMarkers');
                return;
            }
            const activeIds = new Set<string>();
            renderExpandedClusterIndividuals(activeIds);

            regionalClusters.forEach((cluster) => {
                if (shouldSkipExpandedClusterMarker(cluster.restaurantIds)) {
                    return;
                }

                const markerId = `regional-${cluster.region}`;
                activeIds.add(markerId);

                    renderClusterHelper(
                        markerId,
                        cluster.center,
                        cluster.count,
                        cluster.categories,
                        cluster.region,
                        cluster.popularityTier,
                        () => {
                            setExpandedClusterRestaurantIds(cluster.restaurantIds);
                            onClusterExpand({
                                center: cluster.center,
                                islandViewport: resolveNaverIslandClusterViewportByRegion(cluster.region),
                                resolveTargetZoom: () => getRegionalClusterTargetZoom(map.getZoom(), clusterIndexMaxZoom),
                            });
                        }
                    );
            });

            // 사용하지 않는 마커 반환
            if (expandedClusterRestaurantIds.length === 0 || activeIds.size > 0
                || (extendedBounds && !contextualRestaurants.some(shouldRenderExpandedMarker))) {
                markerPool.releaseExcept(activeIds);
                lastMarkerViewportRef.current = markerViewportKey;
            }
            if (activeIds.size === 0 && displayRestaurants.length > 0
                && (expandedClusterRestaurantIds.length === 0 || !extendedBounds
                    || contextualRestaurants.some(shouldRenderExpandedMarker))) {
                markerRenderSignatureRef.current = null;
                scheduleMarkerRenderRetry();
            } else {
                markerRenderSignatureRef.current = nextMarkerRenderSignature;
                if (deferredMarkerRenders.length === 0) resetMarkerRenderRetry();
            }
            perfMonitor.endMeasure('RenderMarkers');
            if (shouldReportNaverMarkerRenderPerformance({
                activeMarkerCount: activeIds.size,
                isDevelopment: process.env.NODE_ENV === 'development',
            })) {
                perfMonitor.report();
            }

        } else {
            // ===== 복합 모드: 서울 자치구 (선택적) + Supercluster/개별 마커 =====
            const activeIds = new Set<string>();
            renderExpandedClusterIndividuals(activeIds);

            // 1. 서울 자치구 클러스터 (우선 순위 레이어)
            // 줌 9-10: 모든 자치구 25개 클러스터 (seoulDistrictClusters)
            // 줌 11-12: 마커 3개 이상인 구만 클러스터 (seoulDistrictClustersFiltered)
            if (seoulClustersToRender.length > 0) {
                seoulClustersToRender.forEach((cluster) => {
                    if (shouldSkipExpandedClusterMarker(cluster.restaurantIds)) {
                        return;
                    }

                    const markerId = `seoul-dist-${cluster.region}`;
                    activeIds.add(markerId);

                    renderClusterHelper(
                        markerId,
                        cluster.center,
                        cluster.count,
                        cluster.categories,
                        cluster.region,
                        cluster.popularityTier,
                        () => {
                            setExpandedClusterRestaurantIds(cluster.restaurantIds);
                            onClusterExpand({
                                center: cluster.center,
                                islandViewport: null,
                                resolveTargetZoom: () => getSeoulDistrictTargetZoom(map.getZoom(), clusterIndexMaxZoom),
                            });
                        }
                    );
                });
            }

            // 1-2. 서울 자치구 개별 마커 (줌 11-12에서만, 마커 2개 이하인 구)
            if (shouldUseSeoulDistrictFiltered && seoulIndividualIds.length > 0) {
                getSeoulIndividualRestaurantsForRender({
                    displayRestaurants,
                    seoulIndividualIds,
                }).forEach((restaurant) => {
                    activeIds.add(restaurant.id);
                    const isSelected = selectedRestaurant?.id === restaurant.id;
                    const visual = getNaverIndividualMarkerVisual(restaurant, isSelected);
                    const bubble = activeVisibleMarkerReviewBubbles[restaurant.id];
                    const markerContent = wrapNaverMarkerContentWithReviewBubble(
                        visual.content,
                        bubble,
                        isMobileOrTablet,
                    );

                    markerPool.acquire(
                        restaurant.id,
                        createIndividualMarkerPosition(restaurant, restaurant.lat, restaurant.lng),
                        { content: markerContent, anchor: anchorForMarker(restaurant.id, visual.anchor.x, visual.anchor.y) },
                        map,
                        () => onMarkerSelect(restaurant)
                    );
                });
            }

            // 2. 표준 로직 (Supercluster 또는 개별 마커)
            // [Fix] 서울 자치구 모드에서도 서울 외 지역은 Supercluster로 표시
            if (shouldCluster || shouldUseSeoulDistrictCluster) {
                if (clusters.length > 0) {
                    clusters.forEach((feature) => {
                        const [lng, lat] = feature.geometry.coordinates;

                        // [CRITICAL Logic] Seoul District Mode가 켜져있고, 이 마커/클러스터가 서울 안에 있다면 건너뜀
                        // (이미 Seoul District Cluster로 표현되었으므로 중복 렌더링 방지)
                        if (shouldHideInSeoulDistrictMode({
                            address: feature.properties.address,
                            isPointInSeoul: isPointInSeoul(lat, lng),
                            shouldUseSeoulDistrictCluster,
                        })) {
                            return;
                        }

                        if (isCluster(feature)) {
                            const clusterId = feature.properties.cluster_id!;
                            const markerId = `cluster-${clusterId}`;
                            activeIds.add(markerId);

                            if (expandedClusterRestaurantIds.length > 0) {
                                let clusterRestaurantIds: string[] = [];
                                try {
                                    clusterRestaurantIds = expandCluster(clusterIndexRef.current!, clusterId);
                                } catch {
                                    clusterRestaurantIds = [];
                                }
                                if (shouldSkipExpandedClusterMarker(clusterRestaurantIds)) {
                                    return;
                                }
                            }

                            if (mapOptimization.clusterAnimationEnabled) {
                                clusterAnimationManager.register(clusterId);
                            }

                            let categories: string[];
                            try {
                                categories = getClusterCategories(clusterIndexRef.current!, clusterId);
                            } catch { categories = []; }

                            renderClusterHelper(
                                markerId,
                                { lat, lng },
                                feature.properties.point_count || 0,
                                categories,
                                clusterId,
                                feature.properties.popularityTier,
                                () => {
                                    let expandedRestaurantIds: string[] = [];
                                    try {
                                        expandedRestaurantIds = expandCluster(clusterIndexRef.current!, clusterId);
                                        setExpandedClusterRestaurantIds(expandedRestaurantIds);
                                    } catch {
                                        setExpandedClusterRestaurantIds([]);
                                    }
                                    onClusterExpand({
                                        center: { lat, lng },
                                        islandViewport: resolveNaverIslandClusterViewportForRestaurants(
                                            expandedRestaurantIds
                                                .map((restaurantId) => resolveMarkerRestaurant(restaurantId))
                                                .filter(Boolean) as Restaurant[],
                                        ),
                                        resolveTargetZoom: () => {
                                            const expansionZoom = clusterIndexRef.current!.getClusterExpansionZoom(clusterId);
                                            return getSuperclusterTargetZoom(map.getZoom(), expansionZoom, clusterIndexMaxZoom);
                                        },
                                    });
                                }
                            );
                        } else {
                            // 클러스터 모드 내의 개별 마커
                            const restaurantId = feature.properties.restaurantId;
                            activeIds.add(restaurantId);
                            const category = feature.properties.category;
                            const isSelected = selectedRestaurant?.id === restaurantId;
                            const restaurant = resolveMarkerRestaurant(restaurantId);
                            const visual = getNaverIndividualMarkerVisual(restaurant ?? { categories: [], category }, isSelected);
                            const bubble = restaurant ? activeVisibleMarkerReviewBubbles[restaurant.id] : undefined;
                            const markerContent = wrapNaverMarkerContentWithReviewBubble(
                                visual.content,
                                bubble,
                                isMobileOrTablet,
                            );
                            const normalizedRestaurant = normalizeNaverMarkerCoordinates(restaurant);
                            const position = normalizedRestaurant
                                ? createIndividualMarkerPosition(normalizedRestaurant, normalizedRestaurant.lat, normalizedRestaurant.lng)
                                : reuseMarkerLatLng(
                                    markerPool.get(restaurantId)?.getPosition(),
                                    lat,
                                    lng,
                                    () => new naver.maps.LatLng(lat, lng),
                                );

                            markerPool.acquire(
                                restaurantId,
                                position,
                                { content: markerContent, anchor: anchorForMarker(restaurantId, visual.anchor.x, visual.anchor.y) },
                                map,
                                () => {
                                    if (restaurant) {
                                        onMarkerSelect(restaurant);
                                    }
                                }
                            );
                        }
                    });
                }
            } else {
                // 개별 마커 모드 (클러스터링 없음)
                contextualRestaurants.forEach(restaurant => {
                    // Expanded markers already rendered from this same source need
                    // no second SDK icon read/options/click-handler replacement.
                    // A different source object still reaches the later renderer.
                    if (renderedExpandedSources.get(restaurant.id) === restaurant) return;
                    if (restaurant.lat == null || restaurant.lng == null) return;
                    if (expandedClusterRestaurantIds.length > 0 && !shouldRenderExpandedMarker(restaurant)) return;
                    // [Logic] Seoul District Mode가 켜져있다면, 서울 내부의 개별 마커는 숨김 (District Cluster가 대신함)
                    if (shouldHideInSeoulDistrictMode({
                        address: restaurant.road_address || restaurant.jibun_address || '',
                        isPointInSeoul: isPointInSeoul(restaurant.lat, restaurant.lng),
                        shouldUseSeoulDistrictCluster,
                    })) {
                        return;
                    }

                    activeIds.add(restaurant.id);
                    const isSelected = selectedRestaurant?.id === restaurant.id;
                    const visual = getNaverIndividualMarkerVisual(restaurant, isSelected);
                    const bubble = activeVisibleMarkerReviewBubbles[restaurant.id];
                    const markerContent = wrapNaverMarkerContentWithReviewBubble(
                        visual.content,
                        bubble,
                        isMobileOrTablet,
                    );

                    markerPool.acquire(
                        restaurant.id,
                        createIndividualMarkerPosition(restaurant, restaurant.lat, restaurant.lng),
                        { content: markerContent, anchor: anchorForMarker(restaurant.id, visual.anchor.x, visual.anchor.y) },
                        map,
                        () => onMarkerSelect(restaurant)
                    );
                });
            }

            // Cleanup
            if (expandedClusterRestaurantIds.length === 0 || activeIds.size > 0
                || (extendedBounds && !contextualRestaurants.some(shouldRenderExpandedMarker))) {
                markerPool.releaseExcept(activeIds);
                // Data-driven culling can precede idle. A quick return must
                // compare against this rendered viewport, not the last idle.
                lastMarkerViewportRef.current = markerViewportKey;
            }
            if (activeIds.size === 0 && displayRestaurants.length > 0
                && (expandedClusterRestaurantIds.length === 0 || !extendedBounds
                    || contextualRestaurants.some(shouldRenderExpandedMarker))) {
                markerRenderSignatureRef.current = null;
                scheduleMarkerRenderRetry();
            } else {
                markerRenderSignatureRef.current = nextMarkerRenderSignature;
                if (deferredMarkerRenders.length === 0) resetMarkerRenderRetry();
            }
            if (hasVisibleMarkerReviewBubbles(activeVisibleMarkerReviewBubbles)) {
                scheduleVisibleMarkerReviewBubbleClamp();
            }

            // [PERFORMANCE] 렌더링 종료 시간 측정 및 로그 (개발 모드)
            perfMonitor.endMeasure('RenderMarkers');
            if (shouldReportNaverMarkerRenderPerformance({
                activeMarkerCount: activeIds.size,
                isDevelopment: process.env.NODE_ENV === 'development',
            })) {
                perfMonitor.report();
            }
        }

        if (deferredMarkerRenders.length > 0) {
            markerRenderSignatureRef.current = null;
            const cancel = deferMarkerRenders(deferredMarkerRenders, (finished) => {
                pendingOffscreenMarkerRendersRef.current = null;
                markerRenderSignatureRef.current = finished ? nextMarkerRenderSignature : null;
                if (finished) resetMarkerRenderRetry();
                else scheduleMarkerRenderRetry();
            });
            pendingOffscreenMarkerRendersRef.current = cancel;
            return () => {
                cancel();
                if (pendingOffscreenMarkerRendersRef.current === cancel) {
                    pendingOffscreenMarkerRendersRef.current = null;
                    earlyMarkerRenderKeyRef.current = null;
                    markerRenderSignatureRef.current = null;
                }
            };
        }
    }, [clusters, regionalClusters, seoulDistrictClusters, seoulDistrictClustersFiltered, seoulIndividualIds, activeSearchedRestaurant, displayRestaurants, displayRestaurantIds, expandedClusterRestaurantIds, markerKindSignature, markerRenderRetryTick, markerViewportRevision, markerVisibleActiveSearchedRestaurant, markerVisibleSelectedRestaurant, restaurantById, mergedRestaurantById, restaurantsForSwipe, overlappingMarkerOffsets, selectedRegion, selectedRestaurant, showUserSubmittedMarkers, isClusterMode, isRegionalClusterMode, isSeoulDistrictMode, isMapInitialized, isMobileOrTablet, visibleMarkerReviewBubbles, onClusterExpand, onVisibleRestaurantsChange, onContextualRestaurantsChange, onMarkerSelect, onReviewBubbleTargetsChange, resetMarkerRenderRetry, scheduleMarkerRenderRetry, resolveMarkerRestaurant, mapOptimization.clusterAnimationEnabled, mapInstanceRef, mapRef, markerRenderSignatureRef]);

    // [Animation] 카테고리 이모지 순환 업데이트
    useEffect(() => {
        if (!mapOptimization.clusterAnimationEnabled) return;
        if (!isClusterMode && !isRegionalClusterMode && !isSeoulDistrictMode) return;

        // 애니메이션 업데이트 시 클러스터 마커 HTML 갱신
        const cleanup = clusterAnimationManager.addListener(() => {
            const applyClusterIcon = (
                markerId: string,
                iconPlan: { content: string; anchor: { x: number; y: number } },
            ) => {
                // The pool owns rendered content and accessibility state. Direct
                // srcset writes left its descriptor stale on a later reacquire.
                markerPool.update(markerId, { icon: {
                    content: iconPlan.content,
                    anchor: new window.naver.maps.Point(iconPlan.anchor.x, iconPlan.anchor.y),
                } });
            };

            if (isRegionalClusterMode) {
                regionalClusters.forEach((cluster) => {
                    const markerId = `regional-${cluster.region}`;
                    const marker = markerPool.get(markerId);

                    if (marker) {
                        const iconPlan = buildNaverClusterAnimationIconPlan({
                            categories: cluster.categories,
                            count: cluster.count,
                            getCurrentIndex: (hash, categoryCount) =>
                                clusterAnimationManager.getCurrentIndex(hash, categoryCount),
                            popularityTier: cluster.popularityTier,
                            position: cluster.center,
                            uniqueKey: cluster.region,
                        });

                        applyClusterIcon(markerId, iconPlan);
                    }
                });
            }
            // 복합 모드: 서울 자치구 모드가 활성화된 경우, 해당 애니메이션 로직 실행
            if (isSeoulDistrictMode) {
                // Seoul District 모드 - 25개 자치구 클러스터 업데이트
                seoulDistrictClusters.forEach((cluster) => {
                    const markerId = `seoul-dist-${cluster.region}`;
                    const marker = markerPool.get(markerId);

                    if (marker) {
                        const iconPlan = buildNaverClusterAnimationIconPlan({
                            categories: cluster.categories,
                            count: cluster.count,
                            getCurrentIndex: (hash, categoryCount) =>
                                clusterAnimationManager.getCurrentIndex(hash, categoryCount),
                            popularityTier: cluster.popularityTier,
                            position: cluster.center,
                            uniqueKey: cluster.region,
                        });
                        applyClusterIcon(markerId, iconPlan);
                    }
                });
            }

            // 복합 모드: 클러스터 모드가 활성화된 경우, 표준 애니메이션 로직도 실행
            if (isClusterMode) {
                // 기존 Supercluster 클러스터 모드
                clusters.forEach((feature) => {
                    if (isCluster(feature)) {
                        const clusterId = feature.properties.cluster_id!;
                        const markerId = `cluster-${clusterId}`;
                        const marker = markerPool.get(markerId);

                        if (marker && clusterIndexRef.current) {
                            let categories: string[] = [];
                            try {
                                categories = getClusterCategories(clusterIndexRef.current, clusterId);
                            } catch {
                                // ignore
                            }

                            const [lng, lat] = feature.geometry.coordinates;
                            const iconPlan = buildNaverClusterAnimationIconPlan({
                                categories,
                                count: feature.properties.point_count || 0,
                                getCurrentIndex: (hash, categoryCount) =>
                                    clusterAnimationManager.getCurrentIndex(hash, categoryCount),
                                popularityTier: feature.properties.popularityTier,
                                position: { lat, lng },
                                uniqueKey: clusterId,
                            });

                            applyClusterIcon(markerId, iconPlan);
                        }
                    }
                });
            }
        });

        return cleanup;
    }, [mapOptimization.clusterAnimationEnabled, isClusterMode, isRegionalClusterMode, isSeoulDistrictMode, clusters, regionalClusters, seoulDistrictClusters]);

    return { resolveMarkerRestaurant };
}
