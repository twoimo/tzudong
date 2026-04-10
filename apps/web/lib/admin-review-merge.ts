'use client';

import { supabase } from '@/integrations/supabase/client';

const ADMIN_REVIEW_MERGE_RPC = 'merge_restaurant_records_for_admin_review';

interface AdminReviewMergeRpcPayload {
  p_target_restaurant_id: string;
  p_source_restaurant_id: string;
  p_admin_user_id: string;
  p_expected_target_updated_at: string;
  p_new_youtube_link: string | null;
  p_new_youtube_meta: Record<string, unknown> | null;
  p_new_tzuyang_review: string | null;
  p_new_category: string | null;
}

interface AdminReviewMergeRpcResponse {
  success: boolean;
  message: string | null;
  target_restaurant_id: string | null;
  source_restaurant_id: string | null;
}

interface AdminReviewMergeRpcClient {
  rpc: (
    fn: string,
    args: AdminReviewMergeRpcPayload
  ) => Promise<{
    data: AdminReviewMergeRpcResponse | AdminReviewMergeRpcResponse[] | null;
    error: { message?: string } | null;
  }>;
}

const rpcClient = supabase as unknown as AdminReviewMergeRpcClient;

export interface MergeAdminReviewRestaurantParams {
  targetRestaurantId: string;
  sourceRestaurantId: string;
  adminUserId: string;
  expectedTargetUpdatedAt: string;
  incomingYoutubeLink: string | null;
  incomingYoutubeMeta: Record<string, unknown> | null;
  incomingTzuyangReview: string | null;
  incomingCategory: string | null;
}

export async function mergeAdminReviewRestaurant(params: MergeAdminReviewRestaurantParams): Promise<AdminReviewMergeRpcResponse> {
  const { data, error } = await rpcClient.rpc(ADMIN_REVIEW_MERGE_RPC, {
    p_target_restaurant_id: params.targetRestaurantId,
    p_source_restaurant_id: params.sourceRestaurantId,
    p_admin_user_id: params.adminUserId,
    p_expected_target_updated_at: params.expectedTargetUpdatedAt,
    p_new_youtube_link: params.incomingYoutubeLink,
    p_new_youtube_meta: params.incomingYoutubeMeta,
    p_new_tzuyang_review: params.incomingTzuyangReview,
    p_new_category: params.incomingCategory,
  });

  if (error) {
    throw new Error(error.message || '병합 RPC 호출에 실패했습니다.');
  }

  const result = Array.isArray(data) ? data[0] : data;

  if (!result?.success) {
    throw new Error(result?.message || '병합에 실패했습니다.');
  }

  return result;
}
