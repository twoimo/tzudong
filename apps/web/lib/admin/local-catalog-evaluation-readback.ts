import type { EvaluationRecord } from '@/types/evaluation';
import type { CatalogEditValues } from './local-catalog-edit-client';

/** Update display state only from the verified business-field readback. */
export function applyCatalogReadback(record: EvaluationRecord, values: CatalogEditValues): EvaluationRecord {
  const next = { ...record };
  for (const key of ['approved_name', 'categories', 'lat', 'lng', 'road_address', 'jibun_address', 'english_address'] as const) {
    if (Object.hasOwn(values, key)) Object.assign(next, { [key]: values[key] });
  }
  if (typeof values.approved_name === 'string') next.name = values.approved_name;
  if (Object.hasOwn(values, 'youtube_link')) {
    next.youtube_link = values.youtube_link ?? '';
    next.youtube_links = values.youtube_link ? [values.youtube_link] : [];
    if (values.youtube_link !== record.youtube_link) next.youtube_meta = null;
  }
  if (record.restaurant_info) {
    const info = { ...record.restaurant_info };
    if (typeof values.approved_name === 'string') info.name = values.approved_name;
    if (Object.hasOwn(values, 'categories')) info.category = values.categories?.[0] ?? '';
    if (Object.hasOwn(values, 'tzuyang_review')) info.tzuyang_review = values.tzuyang_review ?? '';
    if (['lat', 'lng', 'road_address', 'jibun_address', 'english_address'].some(key => Object.hasOwn(values, key))) {
      info.naver_address_info = {
        road_address: next.road_address,
        jibun_address: next.jibun_address ?? '',
        english_address: next.english_address,
        address_elements: next.address_elements,
        x: next.lng?.toString() ?? '', y: next.lat?.toString() ?? '',
      };
    }
    next.restaurant_info = info;
  }
  return next;
}
