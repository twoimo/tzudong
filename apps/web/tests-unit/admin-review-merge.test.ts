import { beforeEach, describe, expect, mock, test } from 'bun:test';

const rpc = mock();

mock.module('@/integrations/supabase/client', () => ({
  supabase: {
    rpc,
  },
}));

const loadMergeModule = () => import('../lib/admin-review-merge');

const baseParams = {
  targetRestaurantId: 'target-restaurant-id',
  sourceRestaurantId: 'source-restaurant-id',
  adminUserId: 'admin-user-id',
  expectedTargetUpdatedAt: '2026-04-10T10:00:00.000Z',
  incomingYoutubeLink: 'https://youtube.com/watch?v=test',
  incomingYoutubeMeta: { title: '테스트 영상' } satisfies Record<string, unknown>,
  incomingTzuyangReview: '새 리뷰',
  incomingCategory: '한식',
};

describe('mergeAdminReviewRestaurant', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  test('calls the admin-review merge RPC with the expected payload', async () => {
    rpc.mockResolvedValueOnce({
      data: [
        {
          success: true,
          message: '병합 완료',
          target_restaurant_id: baseParams.targetRestaurantId,
          source_restaurant_id: baseParams.sourceRestaurantId,
        },
      ],
      error: null,
    });

    const { mergeAdminReviewRestaurant } = await loadMergeModule();
    const result = await mergeAdminReviewRestaurant(baseParams);

    expect(rpc).toHaveBeenCalledWith('merge_restaurant_records_for_admin_review', {
      p_target_restaurant_id: baseParams.targetRestaurantId,
      p_source_restaurant_id: baseParams.sourceRestaurantId,
      p_admin_user_id: baseParams.adminUserId,
      p_expected_target_updated_at: baseParams.expectedTargetUpdatedAt,
      p_new_youtube_link: baseParams.incomingYoutubeLink,
      p_new_youtube_meta: baseParams.incomingYoutubeMeta,
      p_new_tzuyang_review: baseParams.incomingTzuyangReview,
      p_new_category: baseParams.incomingCategory,
    });
    expect(result.success).toBe(true);
  });

  test('throws the RPC message when the merge contract reports a handled failure', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        success: false,
        message: '다른 관리자가 이미 데이터를 수정했습니다. 다시 시도해주세요.',
        target_restaurant_id: null,
        source_restaurant_id: null,
      },
      error: null,
    });

    const { mergeAdminReviewRestaurant } = await loadMergeModule();

    await expect(mergeAdminReviewRestaurant(baseParams)).rejects.toThrow(
      '다른 관리자가 이미 데이터를 수정했습니다. 다시 시도해주세요.'
    );
  });

  test('throws the transport error when Supabase rejects the RPC call', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'permission denied',
      },
    });

    const { mergeAdminReviewRestaurant } = await loadMergeModule();

    await expect(mergeAdminReviewRestaurant(baseParams)).rejects.toThrow('permission denied');
  });
});
