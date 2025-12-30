/**
 * 유튜버 맛집 데이터 훅
 * youtuber_restaurant 테이블에서 데이터를 가져옵니다.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface YoutuberRestaurant {
    id: string;
    unique_id: string;
    name: string;
    phone: string | null;
    categories: string[];
    status: 'pending' | 'verified' | 'rejected';
    source_type: string;
    
    // 유튜버 정보
    youtuber_name: string;
    youtuber_channel: string | null;
    
    // 유튜브 정보
    youtube_link: string | null;
    youtube_meta: {
        title?: string;
        publishedAt?: string;
        duration?: number;
    } | null;
    
    // 평가 정보
    reasoning_basis: string | null;
    tzuyang_review: string | null;
    
    // 주소 정보
    origin_address: string | null;
    road_address: string | null;
    jibun_address: string | null;
    
    // 좌표
    lat: number | null;
    lng: number | null;
    geocoding_success: boolean;
    
    // 추가 메타
    map_url: string | null;
    map_type: string | null;
    confidence: string;
    address_source: string | null;
    
    // 타임스탬프
    created_at: string;
    updated_at: string;
}

interface UseYoutuberRestaurantsOptions {
    youtuberName?: string;
    youtuberChannel?: string;
    status?: 'pending' | 'verified' | 'rejected';
    limit?: number;
    onlyWithCoordinates?: boolean;
}

interface UseYoutuberRestaurantsReturn {
    restaurants: YoutuberRestaurant[];
    isLoading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
    totalCount: number;
}

export function useYoutuberRestaurants(
    options: UseYoutuberRestaurantsOptions = {}
): UseYoutuberRestaurantsReturn {
    const {
        youtuberName,
        youtuberChannel,
        status,
        limit = 1000,
        onlyWithCoordinates = true
    } = options;

    const [restaurants, setRestaurants] = useState<YoutuberRestaurant[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [totalCount, setTotalCount] = useState(0);

    const fetchRestaurants = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            let query = supabase
                .from('youtuber_restaurant')
                .select('*', { count: 'exact' })
                .order('created_at', { ascending: false })
                .limit(limit);

            // 필터 적용
            if (youtuberName) {
                query = query.eq('youtuber_name', youtuberName);
            }

            if (youtuberChannel) {
                query = query.eq('youtuber_channel', youtuberChannel);
            }

            if (status) {
                query = query.eq('status', status);
            }

            if (onlyWithCoordinates) {
                query = query.not('lat', 'is', null).not('lng', 'is', null);
            }

            const { data, error: fetchError, count } = await query;

            if (fetchError) {
                throw fetchError;
            }

            setRestaurants((data as YoutuberRestaurant[]) || []);
            setTotalCount(count || 0);
        } catch (err) {
            console.error('유튜버 맛집 데이터 조회 실패:', err);
            setError(err instanceof Error ? err : new Error('데이터 조회 실패'));
            setRestaurants([]);
        } finally {
            setIsLoading(false);
        }
    }, [youtuberName, youtuberChannel, status, limit, onlyWithCoordinates]);

    useEffect(() => {
        fetchRestaurants();
    }, [fetchRestaurants]);

    return {
        restaurants,
        isLoading,
        error,
        refetch: fetchRestaurants,
        totalCount
    };
}

/**
 * 특정 유튜버 목록 가져오기
 */
export function useYoutuberList() {
    const [youtubers, setYoutubers] = useState<Array<{ name: string; channel: string; count: number }>>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        async function fetchYoutubers() {
            try {
                const { data, error } = await supabase
                    .from('youtuber_restaurant')
                    .select('youtuber_name, youtuber_channel');

                if (error) throw error;

                // 유튜버별로 그룹화
                const grouped = (data || []).reduce((acc, item) => {
                    const key = item.youtuber_name;
                    if (!acc[key]) {
                        acc[key] = {
                            name: item.youtuber_name,
                            channel: item.youtuber_channel || '',
                            count: 0
                        };
                    }
                    acc[key].count++;
                    return acc;
                }, {} as Record<string, { name: string; channel: string; count: number }>);

                setYoutubers(Object.values(grouped).sort((a, b) => b.count - a.count));
            } catch (err) {
                console.error('유튜버 목록 조회 실패:', err);
            } finally {
                setIsLoading(false);
            }
        }

        fetchYoutubers();
    }, []);

    return { youtubers, isLoading };
}

export default useYoutuberRestaurants;
