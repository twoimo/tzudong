// 이 파일은 NaverMapView.tsx에 추가할 클러스터링 로직의 코드 스니펫입니다.
// 실제 파일에 직접 삽입하기 위한 참고용입니다.

// ========================================
// 1. 클러스터 인덱스 생성 및 업데이트
// ========================================
// displayRestaurants가 변경되거나 selectedRegion이 변경될 때
// Supercluster 인덱스를 재생성하고 초기 클러스터를 계산합니다.

useEffect(() => {
    if (!ENABLE_CLUSTERING || !mapInstanceRef.current) return;
    if (displayRestaurants.length === 0) {
        setClusters([]);
        return;
    }

    perfMonitor.startMeasure('cluster-index-creation');

    // 1. GeoJSON 변환
    const geoJsonPoints = restaurantsToGeoJSON(displayRestaurants);

    // 2. 클러스터 인덱스 생성 (지역별 동적 maxZoom)
    const index = createClusterIndex(selectedRegion, {
        radius: CLUSTER_RADIUS,
        minPoints: 2,
    });

    // 3. 데이터 로드
    index.load(geoJsonPoints);
    clusterIndexRef.current = index;

    perfMonitor.endMeasure('cluster-index-creation');

    // 4. 초기 클러스터 계산
    updateClustersForCurrentView();

}, [displayRestaurants, selectedRegion]);

// ========================================
// 2. 현재 뷰포트의 클러스터 업데이트
// ========================================
const updateClustersForCurrentView = useCallback(() => {
    if (!clusterIndexRef.current || !mapInstanceRef.current) return;

    const map = mapInstanceRef.current;
    const zoom = Math.floor(map.getZoom());
    const bounds = map.getBounds();

    if (!bounds) return;

    perfMonitor.startMeasure('cluster-calculation');

    const bbox: [number, number, number, number] = [
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth(),
    ];

    const newClusters = getClusters(clusterIndexRef.current, bbox, zoom);
    setClusters(newClusters);

    perfMonitor.endMeasure('cluster-calculation');
}, []);

// ========================================
// 3. 지도 이동/줌 시 클러스터 업데이트
// ========================================
useEffect(() => {
    if (!mapInstanceRef.current || !ENABLE_CLUSTERING) return;

    const map = mapInstanceRef.current;
    const { naver } = window;

    // 디바운스된 업데이트 함수
    const debouncedUpdate = debounce(updateClustersForCurrentView, MAP_UPDATE_DEBOUNCE_MS);

    // 이벤트 리스너 등록
    const dragEndListener = naver.maps.Event.addListener(map, 'dragend', debouncedUpdate);
    const zoomChangedListener = naver.maps.Event.addListener(map, 'zoom_changed', debouncedUpdate);

    return () => {
        naver.maps.Event.removeListener(dragEndListener);
        naver.maps.Event.removeListener(zoomChangedListener);
    };
}, [updateClustersForCurrentView]);

// ========================================
// 4. 클러스터/마커 렌더링 (핵심 로직)
// ========================================
useEffect(() => {
    if (!mapInstanceRef.current || !window.naver) return;

    const map = mapInstanceRef.current;
    const { naver } = window;
    const currentZoom = Math.floor(map.getZoom());

    // 지역 기본 줌 레벨 가져오기
    const regionKey = selectedRegion && selectedRegion in REGION_MAP_CONFIG
        ? selectedRegion
        : '전국';
    const regionZoom = REGION_MAP_CONFIG[regionKey as keyof typeof REGION_MAP_CONFIG].zoom;

    // 🔥 지역 기본 줌 이상이면 클러스터링 비활성화
    const shouldCluster = ENABLE_CLUSTERING
        && displayRestaurants.length >= CLUSTER_THRESHOLD
        && currentZoom < regionZoom;

    setIsClusterMode(shouldCluster);

    perfMonitor.startMeasure('marker-rendering');

    if (shouldCluster) {
        // ===== 클러스터 모드 =====
        renderClusters();
    } else {
        // ===== 개별 마커 모드 =====
        renderIndividualMarkers();
    }

    perfMonitor.endMeasure('marker-rendering');

}, [clusters, displayRestaurants, selectedRegion, isClusterMode]);

// ========================================
// 5. 클러스터 렌더링 함수
// ========================================
const renderClusters = useCallback(() => {
    if (!mapInstanceRef.current || !window.naver) return;

    const map = mapInstanceRef.current;
    const { naver } = window;

    // 현재 표시되어야 할 ID 수집
    const activeIds = new Set<string | number>();

    clusters.forEach((feature) => {
        if (isCluster(feature)) {
            // 클러스터 마커
            const clusterId = feature.properties.cluster_id!;
            const count = getClusterCount(feature);
            const [lng, lat] = feature.geometry.coordinates;

            activeIds.add(`cluster-${clusterId}`);

            // 클러스터 애니메이션 등록
            clusterAnimationManager.register(clusterId);

            // 카테고리 목록 가져오기
            const categories = getClusterCategories(clusterIndexRef.current!, clusterId);
            const currentIndex = clusterAnimationManager.getCurrentIndex(clusterId, categories.length);

            // HTML 생성
            const html = createClusterMarkerHTML(feature, categories, currentIndex);

            // 마커 획득 또는 생성
            const marker = markerPool.acquire(
                `cluster-${clusterId}`,
                new naver.maps.LatLng(lat, lng),
                { content: html, anchor: new naver.maps.Point(24, 24) },
                map
            );

            // 클릭 이벤트: 줌인 또는 확장
            naver.maps.Event.clearListeners(marker, 'click');
            naver.maps.Event.addListener(marker, 'click', () => {
                // expansion zoom 계산
                const expansionZoom = clusterIndexRef.current!.getClusterExpansionZoom(clusterId);
                map.morph(new naver.maps.LatLng(lat, lng), expansionZoom, {
                    duration: 400,
                    easing: 'easeOutCubic',
                });
            });
        } else {
            // 개별 포인트
            const restaurantId = feature.properties.restaurantId;
            const [lng, lat] = feature.geometry.coordinates;
            const category = feature.properties.category;

            activeIds.add(restaurantId);

            // 선택 여부 확인
            const isSelected = selectedRestaurant?.id === restaurantId;

            // HTML 생성
            const html = createIndividualMarkerHTML(category, isSelected);

            // 마커 획득 또는 생성
            const marker = markerPool.acquire(
                restaurantId,
                new naver.maps.LatLng(lat, lng),
                { content: html, anchor: new naver.maps.Point(isSelected ? 18 : 14, isSelected ? 18 : 14) },
                map
            );

            // 클릭 이벤트
            naver.maps.Event.clearListeners(marker, 'click');
            naver.maps.Event.addListener(marker, 'click', () => {
                const restaurant = displayRestaurants.find(r => r.id === restaurantId);
                if (restaurant) {
                    if (onMarkerClick) {
                        onMarkerClick(restaurant);
                    } else {
                        if (onRestaurantSelect) {
                            onRestaurantSelect(restaurant);
                        }
                        setInternalPanelOpen(true);
                    }
                }
            });
        }
    });

    // 사용하지 않는 마커 반환
    markerPool.releaseExcept(activeIds);

}, [clusters, selectedRestaurant, displayRestaurants, onMarkerClick, onRestaurantSelect]);

// ========================================
// 6. 개별 마커 렌더링 함수 (기존 로직 재사용)
// ========================================
const renderIndividualMarkers = useCallback(() => {
    if (!mapInstanceRef.current || !window.naver) return;

    const map = mapInstanceRef.current;
    const { naver } = window;

    // 가시영역 필터링
    const visibleRestaurants = VIEWPORT_FILTER_ENABLED
        ? displayRestaurants.filter(r => {
            if (r.id === selectedRestaurant?.id || r.id === searchedRestaurant?.id) {
                return true;
            }
            return isRestaurantInViewport(r, map);
        })
        : displayRestaurants;

    const activeIds = new Set<string>();

    visibleRestaurants.forEach((restaurant) => {
        if (!restaurant.lat || !restaurant.lng) return;

        activeIds.add(restaurant.id);

        const isSelected = selectedRestaurant?.id === restaurant.id;
        const category = Array.isArray(restaurant.categories)
            ? restaurant.categories[0]
            : restaurant.category || '기타';

        const html = createIndividualMarkerHTML(category, isSelected);

        const marker = markerPool.acquire(
            restaurant.id,
            new naver.maps.LatLng(restaurant.lat, restaurant.lng),
            { content: html, anchor: new naver.maps.Point(isSelected ? 18 : 14, isSelected ? 18 : 14) },
            map
        );

        // 클릭 이벤트
        naver.maps.Event.clearListeners(marker, 'click');
        naver.maps.Event.addListener(marker, 'click', () => {
            if (onMarkerClick) {
                onMarkerClick(restaurant);
            } else {
                if (onRestaurantSelect) {
                    onRestaurantSelect(restaurant);
                }
                setInternalPanelOpen(true);
            }
        });
    });

    // 사용하지 않는 마커 반환
    markerPool.releaseExcept(activeIds);

}, [displayRestaurants, selectedRestaurant, searchedRestaurant, onMarkerClick, onRestaurantSelect]);

// ========================================
// 7. 클러스터 애니메이션 리스너
// ========================================
useEffect(() => {
    if (!isClusterMode) return;

    // 애니메이션 업데이트 시 클러스터 마커 HTML 갱신
    const cleanup = clusterAnimationManager.addListener(() => {
        // 모든 클러스터 마커의 아이콘 업데이트
        clusters.forEach((feature) => {
            if (isCluster(feature)) {
                const clusterId = feature.properties.cluster_id!;
                const marker = markerPool.get(`cluster-${clusterId}`);

                if (marker) {
                    const categories = getClusterCategories(clusterIndexRef.current!, clusterId);
                    const currentIndex = clusterAnimationManager.getCurrentIndex(clusterId, categories.length);
                    const html = createClusterMarkerHTML(feature, categories, currentIndex);

                    marker.setIcon({
                        content: html,
                        anchor: new window.naver.maps.Point(24, 24),
                    });
                }
            }
        });
    });

    return cleanup;
}, [isClusterMode, clusters]);
