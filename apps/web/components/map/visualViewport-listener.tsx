// [모바일/태블릿] visualViewport 변화 감지 (브라우저 UI 숨김/표시)
// 삼성 브라우저, 크롬, 사파리 등의 주소창/하단 네비게이션 동적 변화 실시간 대응
useEffect(() => {
    if (!mapInstanceRef.current || !isMobileOrTablet) return;

    const visualViewport = window.visualViewport;
    if (!visualViewport) return;

    const map = mapInstanceRef.current;
    let updateTimer: NodeJS.Timeout;

    const handleViewportChange = () => {
        // Debounce to prevent excessive updates
        clearTimeout(updateTimer);
        updateTimer = setTimeout(() => {
            if (!selectedRestaurant && !selectedRegion) return;

            // Trigger map resize
            naver.maps.Event.trigger(map, 'resize');

            // 현재 선택된 레스토랑이나 지역의 중심 재조정
            // 별도의 state 변경 없이 지도 중심만 업데이트
            // 메인 useEffect의 로직을 재실행하지 않고 여기서 직접 처리
        }, 100);
    };

    // visualViewport resize: 브라우저 UI(주소창, 하단 네비게이션) 변화
    // visualViewport scroll: iOS Safari의 경우 스크롤 시 주소창 숨김/표시
    visualViewport.addEventListener('resize', handleViewportChange);
    visualViewport.addEventListener('scroll', handleViewportChange);

    return () => {
        clearTimeout(updateTimer);
        if (visualViewport) {
            visualViewport.removeEventListener('resize', handleViewportChange);
            visualViewport.removeEventListener('scroll', handleViewportChange);
        }
    };
}, [isMobileOrTablet, isMapInitialized, selectedRestaurant, selectedRegion]);
