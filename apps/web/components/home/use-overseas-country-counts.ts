'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { mergeRestaurants } from '@/hooks/use-restaurants';
import { fetchSupabaseRows } from '@/lib/supabase-rest-client';
import { OVERSEAS_REGIONS, OVERSEAS_REGION_LIST } from '@/constants/overseas-regions';
import type { Restaurant } from '@/types/restaurant';

export function useOverseasCountryCounts(mapMode: 'domestic' | 'overseas') {
    const { data: globalRestaurants = [] } = useQuery({
        queryKey: ['global-restaurants-count'],
        queryFn: async () => {
            try {
                const data = await fetchSupabaseRows<Restaurant>('restaurants', [
                    ['select', 'id, name:approved_name, approved_name, road_address, jibun_address, english_address, categories, status, review_count'],
                    ['status', 'eq.approved'],
                ]);
                return mergeRestaurants(data);
            } catch (error) {
                console.error('글로벌 맛집 데이터 조회 실패:', error);
                return [];
            }
        },
        enabled: mapMode === 'overseas',
    });

    return useMemo(() => {
        const counts: Record<string, number> = {};
        OVERSEAS_REGION_LIST.forEach((region) => {
            counts[region] = 0;
        });

        globalRestaurants.forEach((restaurant) => {
            const address = restaurant.english_address || restaurant.road_address || restaurant.jibun_address || '';
            const lowerAddress = address.toLowerCase();

            OVERSEAS_REGION_LIST.forEach((regionKey) => {
                const config = OVERSEAS_REGIONS[regionKey];
                const isMatch = config.keywords.some((keyword) =>
                    lowerAddress.includes(keyword.toLowerCase())
                );

                if (isMatch) {
                    counts[regionKey] = (counts[regionKey] || 0) + 1;
                }
            });
        });

        return counts;
    }, [globalRestaurants]);
}
