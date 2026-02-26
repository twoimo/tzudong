/**
 * 유튜버 맛집 데이터 훅
 * restaurants 테이블에서 유튜버 관련 데이터를 가져옵니다.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface YoutuberRestaurant {
    id: string;
    unique_id: string;
    name: string;
    phone: string | null;
    categories: string[];
    status: 'pending' | 'verified' | 'rejected' | 'approved' | 'deleted';
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
    youtuber_review?: string | null;

    // 주소 정보
    origin_address: string | null;
    road_address: string | null;
    jibun_address: string | null;

    // 좌표
    lat: number | null;
    lng: number | null;
    geocoding_success: boolean;

    // 추가 메타
    confidence?: string;
    address_source?: string | null;

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
                .from('restaurants')
                .select('id, trace_id, approved_name, origin_name, phone, categories, status, source_type, channel_name, youtube_link, youtube_meta, reasoning_basis, tzuyang_review, origin_address, road_address, jibun_address, lat, lng, geocoding_success, created_at, updated_at', {
                    count: 'exact'
                })
                .in('source_type', ['geminiCLI', 'perplexity'])
                .order('created_at', { ascending: false })
                .limit(limit);

            // 필터 적용
            if (youtuberName) {
                query = query.eq('channel_name', youtuberName);
            }

            if (youtuberChannel) {
                query = query.eq('channel_name', youtuberChannel);
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

            const mapped = (data || []).map((row: {
                id: string;
                trace_id: string | null;
                approved_name: string | null;
                origin_name: string | null;
                phone: string | null;
                categories: string[] | null;
                status: string;
                source_type: string;
                channel_name: string | null;
                youtube_link: string | null;
                youtube_meta: { title?: string; publishedAt?: string; duration?: number } | null;
                reasoning_basis: string | null;
                tzuyang_review: string | null;
                origin_address: Record<string, unknown> | null;
                road_address: string | null;
                jibun_address: string | null;
                lat: number | null;
                lng: number | null;
                geocoding_success: boolean | null;
                created_at: string;
                updated_at: string;
            }): YoutuberRestaurant => ({
                id: row.id,
                unique_id: row.trace_id || '',
                name: row.approved_name || row.origin_name || '이름 없음',
                phone: row.phone,
                categories: row.categories || [],
                status: (row.status === 'pending' || row.status === 'verified' || row.status === 'rejected' || row.status === 'approved' || row.status === 'deleted')
                    ? row.status
                    : 'pending',
                source_type: row.source_type,
                youtuber_name: row.channel_name || '알수없음',
                youtuber_channel: row.channel_name,
                youtube_link: row.youtube_link,
                youtube_meta: row.youtube_meta,
                reasoning_basis: row.reasoning_basis,
                tzuyang_review: row.tzuyang_review,
                youtuber_review: null,
                origin_address: row.origin_address ? JSON.stringify(row.origin_address) : null,
                road_address: row.road_address,
                jibun_address: row.jibun_address,
                lat: row.lat === null ? null : Number(row.lat),
                lng: row.lng === null ? null : Number(row.lng),
                geocoding_success: !!row.geocoding_success,
                created_at: row.created_at,
                updated_at: row.updated_at
            }));

            setRestaurants(mapped);
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
                    .from('restaurants')
                    .select('channel_name')
                    .in('source_type', ['geminiCLI', 'perplexity'])
                    .not('channel_name', 'is', null)
                    .not('channel_name', 'eq', '');

                if (error) throw error;

                // 유튜버별로 그룹화
                type YoutuberRow = { channel_name: string };
                const grouped = ((data || []) as YoutuberRow[]).reduce((acc, item) => {
                    const key = item.channel_name;
                    if (!acc[key]) {
                        acc[key] = {
                            name: item.channel_name,
                            channel: item.channel_name,
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
