import { validateEditRestaurantRequest, type EditRestaurantRequestFormData } from './edit-restaurant-request-flow';
import { isValidClientRequestKey, normalizeRestaurantSubmissionPhone } from './restaurant-submission-submit-contract';
import { normalizeCanonicalYouTubeWatchUrl } from './youtube-url';

export const MAX_EDIT_SUBMISSION_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type RestaurantEditSubmitBody = {
  clientRequestKey: string;
  restaurantId: string;
  payload: EditRestaurantRequestFormData;
};
export type SavedRestaurantEdit = {
  ok: true;
  code: 'EDIT_SUBMISSION_SAVED';
  id: string;
  status: 'pending';
  itemCount: number;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function text(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length <= maximum;
}
function businessPhone(value: unknown): value is string {
  if (!text(value, 40)) return false;
  if (!value.trim()) return true;
  return /^[\d().\s-]+$/.test(value)
    && /^(?:02\d{7,8}|0[3-6]\d{7,8}|1[5-8]\d{6,7})$/.test(normalizeRestaurantSubmissionPhone(value));
}

/** The business-phone field follows the existing submission boundary. All other fields remain subject to privacy sanitization. */
export function isRestaurantEditSubmitBody(value: unknown): value is RestaurantEditSubmitBody {
  if (!record(value) || !exactKeys(value, ['clientRequestKey', 'restaurantId', 'payload'])
    || !isValidClientRequestKey(value.clientRequestKey) || value.clientRequestKey !== value.clientRequestKey.trim()
    || typeof value.restaurantId !== 'string' || !UUID.test(value.restaurantId)) return false;
  const payload = value.payload;
  if (!record(payload) || !exactKeys(payload, ['requestKind', 'name', 'address', 'phone', 'category', 'youtube_reviews'])
    || (payload.requestKind !== 'edit' && payload.requestKind !== 'closure')
    || !text(payload.name, 160) || !text(payload.address, 500) || !businessPhone(payload.phone)
    || !Array.isArray(payload.category) || payload.category.length > 10
    || !payload.category.every(category => text(category, 50) && Boolean(category.trim()))
    || new Set(payload.category.map(category => category.trim())).size !== payload.category.length
    || !Array.isArray(payload.youtube_reviews) || payload.youtube_reviews.length < 1 || payload.youtube_reviews.length > 100) return false;
  if (!payload.youtube_reviews.every(item => record(item)
    && exactKeys(item, ['youtube_link', 'tzuyang_review', 'restaurant_id'])
    && text(item.youtube_link, 2_048) && normalizeCanonicalYouTubeWatchUrl(item.youtube_link) !== null
    && text(item.tzuyang_review, 4_000) && typeof item.restaurant_id === 'string' && UUID.test(item.restaurant_id))) return false;
  const restaurantId = value.restaurantId.toLowerCase();
  return payload.youtube_reviews.some(item => item.restaurant_id.toLowerCase() === restaurantId)
    && validateEditRestaurantRequest(payload as EditRestaurantRequestFormData) === null;
}

export function canonicalizeRestaurantEditPayload(payload: EditRestaurantRequestFormData): EditRestaurantRequestFormData {
  return {
    requestKind: payload.requestKind,
    name: payload.name.trim(),
    address: payload.address.trim(),
    phone: payload.phone.trim(),
    category: payload.category.map(category => category.trim()).sort((a, b) => a.localeCompare(b, 'ko')),
    youtube_reviews: payload.youtube_reviews.map(item => ({
      youtube_link: normalizeCanonicalYouTubeWatchUrl(item.youtube_link) ?? item.youtube_link.trim(),
      tzuyang_review: item.tzuyang_review.trim(),
      restaurant_id: item.restaurant_id.toLowerCase(),
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}

export function restaurantEditPayloadFingerprint(restaurantId: string, payload: EditRestaurantRequestFormData) {
  return JSON.stringify({ restaurantId: restaurantId.toLowerCase(), payload: canonicalizeRestaurantEditPayload(payload) });
}

export function isSavedRestaurantEdit(value: unknown, itemCount: number): value is SavedRestaurantEdit {
  return record(value) && exactKeys(value, ['ok', 'code', 'id', 'status', 'itemCount'])
    && value.ok === true && value.code === 'EDIT_SUBMISSION_SAVED'
    && typeof value.id === 'string' && UUID.test(value.id)
    && value.status === 'pending' && value.itemCount === itemCount;
}
