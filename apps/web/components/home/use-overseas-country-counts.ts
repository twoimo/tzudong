'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { mergeRestaurants } from '@/hooks/use-restaurants';
import { supabase } from '@/integrations/supabase/client';
import { OVERSEAS_REGIONS, OVERSEAS_REGION_LIST } from '@/constants/overseas-regions';
import type { Restaurant } from '@/types/restaurant';

export function useOverseasCountryCounts(mapMode: 'domestic' | 'overseas') {
    const { data: globalRestaurants = [] } = useQuery({
        queryKey: ['global-restaurants-count'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('restaurants')
                .select('*, name:approved_name')
                .eq('status', 'approved');

            if (error) {
                console.error('글로벌 맛집 데이터 조회 실패:', error);
                return [];
            }

            return mergeRestaurants((data || []) as Restaurant[]);
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
