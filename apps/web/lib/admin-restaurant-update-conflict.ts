import { supabase } from '@/integrations/supabase/client';
import { extractVideoIdFromYoutubeLink } from '@/lib/dashboard/helpers';

export interface ActiveRestaurantIdentityConflict {
  id: string;
  name: string;
  status: string | null;
  road_address: string | null;
  jibun_address: string | null;
  youtube_link: string | null;
  updated_at: string | null;
}

type SupabaseRestaurantIdentityRow = {
  id: string;
  approved_name: string | null;
  origin_name: string | null;
  naver_name: string | null;
  google_name: string | null;
  status: string | null;
  road_address: string | null;
  jibun_address: string | null;
  youtube_link: string | null;
  updated_at: string | null;
};

function normalizeIdentityName(value: string | null | undefined): string | null {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return normalized || null;
}

function resolveIdentityName(row: Pick<SupabaseRestaurantIdentityRow, 'approved_name' | 'origin_name' | 'naver_name' | 'google_name'>): string | null {
  return row.approved_name?.trim()
    || row.origin_name?.trim()
    || row.naver_name?.trim()
    || row.google_name?.trim()
    || null;
}

export function isActiveRestaurantIdentityConflictError(error: unknown): boolean {
  const maybeError = error as { code?: string; status?: number; message?: string; details?: string; hint?: string } | null;
  const combined = [maybeError?.message, maybeError?.details, maybeError?.hint].filter(Boolean).join(' ');

  return maybeError?.code === '23505'
    || maybeError?.status === 409
    || /duplicate key value violates unique constraint/i.test(combined)
    || /idx_restaurants_active_video_identity/i.test(combined);
}

export function formatActiveRestaurantIdentityConflictMessage(params: {
  restaurantName: string;
  conflict?: ActiveRestaurantIdentityConflict | null;
}): string {
  if (params.conflict) {
    const address = params.conflict.road_address || params.conflict.jibun_address || '주소 미확인';
    return `같은 YouTube 영상에 이미 활성 상태의 "${params.conflict.name}" 레코드가 있습니다 (${address}). 기존 레코드를 병합/삭제 처리한 뒤 다시 저장해주세요.`;
  }

  return `같은 YouTube 영상에 이미 활성 상태의 "${params.restaurantName}" 레코드가 있어 저장할 수 없습니다. 중복 레코드를 먼저 병합/삭제 처리해주세요.`;
}

export async function findActiveRestaurantIdentityConflict(params: {
  restaurantId: string;
  restaurantName: string;
  youtubeLink: string | null | undefined;
}): Promise<ActiveRestaurantIdentityConflict | null> {
  const videoId = extractVideoIdFromYoutubeLink(params.youtubeLink || '');
  const targetIdentity = normalizeIdentityName(params.restaurantName);

  if (!videoId || !targetIdentity) {
    return null;
  }

  const { data, error } = await supabase
    .from('restaurants')
    .select('id, approved_name, origin_name, naver_name, google_name, status, road_address, jibun_address, youtube_link, updated_at')
    .neq('status', 'deleted')
    .neq('id', params.restaurantId);

  if (error) {
    throw error;
  }

  const rows = (data || []) as SupabaseRestaurantIdentityRow[];
  const conflict = rows.find((row) => {
    const rowVideoId = extractVideoIdFromYoutubeLink(row.youtube_link || '');
    if (!rowVideoId || rowVideoId !== videoId) return false;

    return normalizeIdentityName(resolveIdentityName(row)) === targetIdentity;
  });

  if (!conflict) {
    return null;
  }

  return {
    id: conflict.id,
    name: resolveIdentityName(conflict) || params.restaurantName,
    status: conflict.status,
    road_address: conflict.road_address,
    jibun_address: conflict.jibun_address,
    youtube_link: conflict.youtube_link,
    updated_at: conflict.updated_at,
  };
}
