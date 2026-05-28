import { supabase } from '@/integrations/supabase/client';
import { extractVideoIdFromYoutubeLink } from '@/lib/dashboard/helpers';

export interface SameVideoDuplicateWarningRow {
  id: string;
  approved_name?: string | null;
  origin_name?: string | null;
  naver_name?: string | null;
  google_name?: string | null;
  name?: string | null;
  restaurant_name?: string | null;
  phone?: string | null;
  status?: string | null;
  road_address?: string | null;
  jibun_address?: string | null;
  youtube_link?: string | null;
  updated_by_admin_id?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface SameVideoDuplicateWarningCandidate {
  id: string;
  name: string;
  status: string | null;
  address: string | null;
  adminTouched: boolean;
  rule: 'exact_identity' | 'same_phone_similar_name' | 'same_address_similar_name' | 'near_coordinate_similar_name';
  confidence: number;
}

function normalizeIdentityName(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\[[^\]]+\]|\([^)]*추정[^)]*\)|\([^)]*또는[^)]*\)/g, ' ')
    .replace(/[\s·・ㆍ._\-–—,，()（）\[\]{}<>《》"'`´’‘“”]/g, '')
    .replace(/본점$|점$|입구$/g, '')
    .trim();
}

function resolveIdentityName(row: SameVideoDuplicateWarningRow): string {
  return row.approved_name?.trim()
    || row.restaurant_name?.trim()
    || row.name?.trim()
    || row.origin_name?.trim()
    || row.naver_name?.trim()
    || row.google_name?.trim()
    || '';
}

function displayName(row: SameVideoDuplicateWarningRow): string {
  return row.approved_name?.trim()
    || row.naver_name?.trim()
    || row.google_name?.trim()
    || row.restaurant_name?.trim()
    || row.name?.trim()
    || row.origin_name?.trim()
    || '이름 없음';
}

function addressKey(row: SameVideoDuplicateWarningRow): string {
  return normalizeIdentityName(row.jibun_address || row.road_address || '');
}

function phoneKey(row: SameVideoDuplicateWarningRow): string {
  return String(row.phone || '').replace(/\D/g, '');
}

function levenshtein(left: string, right: string): number {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array(right.length + 1);
  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j < current.length; j += 1) previous[j] = current[j];
  }
  return previous[right.length];
}

function nameSimilarity(left: SameVideoDuplicateWarningRow, right: SameVideoDuplicateWarningRow): number {
  const leftName = normalizeIdentityName(resolveIdentityName(left));
  const rightName = normalizeIdentityName(resolveIdentityName(right));
  if (!leftName || !rightName) return 0;
  if (leftName === rightName) return 1;
  if ((leftName.length >= 4 && rightName.includes(leftName)) || (rightName.length >= 4 && leftName.includes(rightName))) return 0.96;
  return 1 - levenshtein(leftName, rightName) / Math.max(leftName.length, rightName.length);
}

function coordDistanceMeters(left: SameVideoDuplicateWarningRow, right: SameVideoDuplicateWarningRow): number {
  if (typeof left.lat !== 'number' || typeof left.lng !== 'number' || typeof right.lat !== 'number' || typeof right.lng !== 'number') return Infinity;
  const radius = 6371000;
  const toRad = (value: number) => value * Math.PI / 180;
  const dLat = toRad(right.lat - left.lat);
  const dLng = toRad(right.lng - left.lng);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(left.lat)) * Math.cos(toRad(right.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(a));
}

function classifyCandidate(target: SameVideoDuplicateWarningRow, candidate: SameVideoDuplicateWarningRow): Pick<SameVideoDuplicateWarningCandidate, 'rule' | 'confidence'> | null {
  const targetIdentity = normalizeIdentityName(resolveIdentityName(target));
  const candidateIdentity = normalizeIdentityName(resolveIdentityName(candidate));
  const sameIdentity = Boolean(targetIdentity && targetIdentity === candidateIdentity);
  const sameAddress = Boolean(addressKey(target) && addressKey(target) === addressKey(candidate));
  const targetPhone = phoneKey(target);
  const candidatePhone = phoneKey(candidate);
  const samePhone = Boolean(targetPhone && candidatePhone && targetPhone.length >= 7 && targetPhone === candidatePhone);
  const similarity = nameSimilarity(target, candidate);
  const distance = coordDistanceMeters(target, candidate);

  if (sameIdentity) return { rule: 'exact_identity', confidence: 1 };
  if (samePhone && similarity >= 0.72) return { rule: 'same_phone_similar_name', confidence: 0.98 };
  if (sameAddress && similarity >= 0.82) return { rule: 'same_address_similar_name', confidence: 0.97 };
  if (Number.isFinite(distance) && distance <= 20 && similarity >= 0.86) return { rule: 'near_coordinate_similar_name', confidence: 0.96 };
  return null;
}

export function findSameVideoDuplicateWarningCandidates(
  target: SameVideoDuplicateWarningRow,
  rows: SameVideoDuplicateWarningRow[],
): SameVideoDuplicateWarningCandidate[] {
  const targetVideoId = extractVideoIdFromYoutubeLink(target.youtube_link || '');
  if (!targetVideoId || target.status === 'deleted') return [];

  return rows
    .filter((row) => row.id !== target.id && row.status !== 'deleted')
    .filter((row) => extractVideoIdFromYoutubeLink(row.youtube_link || '') === targetVideoId)
    .map((row) => {
      const evidence = classifyCandidate(target, row);
      if (!evidence) return null;
      return {
        id: row.id,
        name: displayName(row),
        status: row.status ?? null,
        address: row.jibun_address || row.road_address || null,
        adminTouched: Boolean(row.updated_by_admin_id),
        ...evidence,
      } satisfies SameVideoDuplicateWarningCandidate;
    })
    .filter((candidate): candidate is SameVideoDuplicateWarningCandidate => Boolean(candidate))
    .sort((left, right) => right.confidence - left.confidence || left.name.localeCompare(right.name));
}

export function formatSameVideoDuplicateWarning(candidates: SameVideoDuplicateWarningCandidate[]): string {
  if (candidates.length === 0) return '';
  const first = candidates[0];
  const suffix = candidates.length > 1 ? ` 외 ${candidates.length - 1}건` : '';
  return `같은 영상에서 중복 후보 ${candidates.length}건이 있습니다: ${first.name}${suffix}. 승인/삭제/수정 전 같은 맛집인지 확인하세요.`;
}

export async function fetchSameVideoDuplicateWarningCandidates(
  target: SameVideoDuplicateWarningRow,
): Promise<SameVideoDuplicateWarningCandidate[]> {
  const targetVideoId = extractVideoIdFromYoutubeLink(target.youtube_link || '');
  if (!targetVideoId) return [];

  const { data, error } = await supabase
    .from('restaurants')
    .select('id, approved_name, origin_name, naver_name, google_name, phone, status, road_address, jibun_address, youtube_link, updated_by_admin_id, lat, lng')
    .neq('status', 'deleted');

  if (error) throw error;

  return findSameVideoDuplicateWarningCandidates(target, (data || []) as SameVideoDuplicateWarningRow[]);
}
