import { useEffect } from 'react';
import { Restaurant, Region } from '@/types/restaurant';

interface UseRestaurantPopupListenerProps {
    mapMode: 'domestic' | 'overseas';
    moveToRestaurant: ((restaurant: Restaurant) => void) | null;
    setSelectedRegion: React.Dispatch<React.SetStateAction<Region | null>>;
    setSelectedRestaurant: React.Dispatch<React.SetStateAction<Restaurant | null>>;
    setSearchedRestaurant: React.Dispatch<React.SetStateAction<Restaurant | null>>;
}

export function useRestaurantPopupListener(props: UseRestaurantPopupListenerProps) {
    const { mapMode, moveToRestaurant, setSelectedRegion, setSelectedRestaurant, setSearchedRestaurant } = props;

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const handleRestaurantSelected = (event: any) => {
            const { restaurant, region } = event.detail;
            console.log('[HomeClient] restaurant-selected 이벤트 수신:', restaurant?.name, region);

            // 국내 맛집인 경우만 처리
            if (mapMode === 'domestic' && region) {
                setSelectedRegion(region as Region);
                setSelectedRestaurant(restaurant);
                setSearchedRestaurant(restaurant);

                // 약간의 딜레이를 주어 지도가 준비된 후 이동
                setTimeout(() => {
                    if (moveToRestaurant) {
                        console.log('[HomeClient] 지도 이동 함수 호출');
                        moveToRestaurant(restaurant);
                    }
                }, 300);
            }
        };

        window.addEventListener('restaurant-selected', handleRestaurantSelected);

        return () => {
            window.removeEventListener('restaurant-selected', handleRestaurantSelected);
        };
    }, [mapMode, moveToRestaurant, setSelectedRegion, setSelectedRestaurant, setSearchedRestaurant]);
}
