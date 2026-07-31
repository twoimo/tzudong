'use client';

/**
 * Search analytics is disabled until an approved aggregate-only endpoint and
 * retention contract are available.
 */
export async function incrementSearchCount(_restaurantId: string): Promise<{
    success: boolean;
    reason: string;
    message: string;
}> {
    return {
        success: true,
        reason: 'analytics_disabled',
        message: '검색 집계가 비활성화되어 있습니다.',
    };
}
