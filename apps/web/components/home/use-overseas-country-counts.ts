'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchSupabaseExactCount } from '@/lib/supabase-rest-client';
import { buildOverseasRegionAddressOrFilter } from '@/lib/overseas-region-matching';
import { OVERSEAS_REGION_LIST } from '@/constants/overseas-regions';

/**
 * 해외 지역 선택 UI에 표시되는 지역별 맛집 개수.
 *
 * 이전 구현은 approved 전체 행(751행, 약 0.5MB)을 내려받아 클라이언트에서
 * mergeRestaurants와 문자열 매칭으로 개수를 계산했습니다. 이제 지역별 개수는
 * 응답 본문이 없는 PostgREST HEAD count로 서버 집계하고, 집계에 쓰는 조건은
 * OverseasMap 마커가 쓰는 지역 키워드 필터와 동일합니다(표시 개수와 실제
 * 마커가 어긋나지 않음). 개별 지역 집계 실패는 0으로 안전하게 기본처리 합니다.
 */
export function useOverseasCountryCounts(mapMode: 'domestic' | 'overseas') {
    const { data: counts } = useQuery({
        queryKey: ['overseas-region-counts-v2', OVERSEAS_REGION_LIST.join(',')],
        queryFn: async () => {
            const entries = await Promise.all(
                OVERSEAS_REGION_LIST.map(async (regionKey) => {
                    const orFilter = buildOverseasRegionAddressOrFilter(regionKey, '%');
                    if (!orFilter) return [regionKey, 0] as const;
                    try {
                        const total = await fetchSupabaseExactCount('restaurants', [
                            ['status', 'eq.approved'],
                            ['or', '(' + orFilter + ')'],
                        ]);
                        return [regionKey, total] as const;
                    } catch {
                        return [regionKey, 0] as const;
                    }
                }),
            );
            return Object.fromEntries(entries) as Record<string, number>;
        },
        enabled: mapMode === 'overseas',
        staleTime: 10 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        refetchOnWindowFocus: false,
    });

    return useMemo(() => {
        const empty: Record<string, number> = {};
        OVERSEAS_REGION_LIST.forEach((region) => {
            empty[region] = 0;
        });
        return counts ?? empty;
    }, [counts]);
}
