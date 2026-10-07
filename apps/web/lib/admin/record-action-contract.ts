import { z } from 'zod';

export const RECORD_ACTION_CONFIRMATION = '변경 적용' as const;
export const RECORD_ACTION_ENDPOINT = '/api/admin/record-actions';
export const RECORD_CATEGORIES = ['치킨', '중식', '돈까스·회', '피자', '패스트푸드', '찜·탕', '족발·보쌈', '분식', '카페·디저트', '한식', '고기', '양식', '아시안', '야식', '도시락'] as const;
const id = z.uuid();
const text = z.string().trim().max(4000);
const nullableText = text.nullable().optional();
const categories = z.array(z.enum(RECORD_CATEGORIES)).min(1).max(15).refine(v => new Set(v).size === v.length);
const youtube = z.string().trim().regex(/^https:\/\/(?:www\.)?youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/);
const changeFields = z.strictObject({
  approved_name: z.string().trim().min(1).max(160).optional(), phone: z.string().trim().max(80).nullable().optional(),
  categories: categories.optional(), youtube_link: youtube.nullable().optional(), tzuyang_review: nullableText,
  road_address: nullableText, jibun_address: nullableText, english_address: nullableText,
  address_elements: z.union([z.array(z.record(z.string(), z.unknown())), z.record(z.string(), z.unknown())]).nullable().optional(),
  lat: z.number().finite().min(-90).max(90).optional(), lng: z.number().finite().min(-180).max(180).optional(),
  geocoding_success: z.boolean().optional(),
  youtube_meta: z.strictObject({title: text.optional(), published_at: text.optional(), duration: z.number().nonnegative().optional(),
    is_shorts: z.boolean().optional(), is_ads: z.boolean().optional(), what_ads: z.array(text).max(20).nullable().optional()}).optional(),
});
const changes = changeFields.refine(value => Object.keys(value).length > 0);
export type RestaurantRecordChanges = z.infer<typeof changes>;
const note = z.string().trim().max(500).optional();
const reason = z.string().trim().min(1).max(500);
const payloads = {
  'restaurant.approve': z.strictObject({changes: changes.optional()}),
  'restaurant.edit': z.strictObject({changes:changeFields, perTargetChanges:z.array(z.strictObject({id,changes})).max(25).optional(), removeIds:z.array(id).max(25).optional(), additions:z.array(changes).max(25).optional()}),
  'restaurant.create': z.strictObject({changes, additions:z.array(changes).max(24).optional()}),
  'restaurant.delete': z.strictObject({reason}),
  'restaurant.restore': z.strictObject({}),
  'restaurant.register_missing': z.strictObject({changes}),
  'restaurant.merge': z.strictObject({mergeTargetId: id, incomingChanges:changes.optional()}),
  'restaurant.hold': z.strictObject({reason}),
  'submission.approve': z.strictObject({items: z.array(z.strictObject({id, decision: z.enum(['approve', 'reject']), changes: changes.optional(), reason: reason.optional()})).min(1).max(25), note}),
  'submission.reject': z.strictObject({reason}),
  'submission.delete': z.strictObject({reason}),
  'submission.edit': z.strictObject({changes: z.strictObject({restaurant_name: z.string().trim().min(1).max(100),
    restaurant_address: nullableText, restaurant_phone: z.string().trim().max(80).nullable().optional(), restaurant_categories: categories.refine(value => value.length <= 5)}),
    itemChanges: z.array(z.strictObject({id, youtube_link: youtube, tzuyang_review: nullableText})).max(25)}),
  'review.approve': z.strictObject({note}),
  'review.reject': z.strictObject({reason}),
  'review.delete': z.strictObject({reason}),
  'recommendation.approve': z.strictObject({note}),
  'recommendation.reject': z.strictObject({reason}),
} as const;
export type RecordAction = keyof typeof payloads;
export type RecordActionPayload = z.infer<(typeof payloads)[RecordAction]>;
export type RecordActionRequest = {
  phase: 'preview' | 'apply'; operationId: string; action: RecordAction; targetIds: string[];
  payload: RecordActionPayload; previewHash?: string; confirmation?: typeof RECORD_ACTION_CONFIRMATION;
};
export type RecordActionReceipt = {
  operationId: string; action: RecordAction; state: 'preview' | 'applied'; previewHash: string;
  targetIds: string[]; auditId: string | null; expiresAt: string;
  readback: Array<{id: string; kind: string; status: string; fingerprint: string | null}>;
  mediaCleanupPending: boolean;
  mediaCleanupUnmanaged?: boolean;
};

export function parseRecordActionRequest(value: unknown): RecordActionRequest | null {
  const base = z.strictObject({phase: z.enum(['preview', 'apply']), operationId: id, action: z.string(),
    targetIds: z.array(id).max(25), payload: z.unknown(), previewHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    confirmation: z.literal(RECORD_ACTION_CONFIRMATION).optional()}).safeParse(value);
  if (!base.success || !Object.hasOwn(payloads, base.data.action)) return null;
  const action = base.data.action as RecordAction;
  const parsed = payloads[action].safeParse(base.data.payload);
  const targets = base.data.targetIds;
  if (!parsed.success || new Set(targets).size !== targets.length) return null;
  if (action === 'restaurant.create' ? targets.length !== 0 : action === 'restaurant.merge' ? targets.length !== 2 : action === 'restaurant.edit' ? targets.length < 1 : targets.length !== 1) return null;
  if (action === 'restaurant.edit') {
    const edit=parsed.data as {changes: Record<string,unknown>;perTargetChanges?:Array<{id:string}>;removeIds?:string[];additions?:unknown[]};
    const rows=edit.perTargetChanges?.map(row=>row.id)??[], removed=edit.removeIds??[];
    if (!Object.keys(edit.changes).length && !rows.length && !removed.length && !edit.additions?.length) return null;
    if (new Set(rows).size!==rows.length || new Set(removed).size!==removed.length || [...rows,...removed].some(id=>!targets.includes(id)) || rows.some(id=>removed.includes(id)) || targets.length+(edit.additions?.length??0)>25 || targets.length-removed.length+(edit.additions?.length??0)<1) return null;
  }
  if (action === 'restaurant.merge' && !targets.includes((parsed.data as {mergeTargetId: string}).mergeTargetId)) return null;
  if (base.data.phase === 'apply' && (!base.data.previewHash || base.data.confirmation !== RECORD_ACTION_CONFIRMATION)) return null;
  if (base.data.phase === 'preview' && (base.data.previewHash || base.data.confirmation)) return null;
  return {...base.data, action, targetIds: [...targets].sort(), payload: parsed.data};
}

export function isRecordActionReceipt(value: unknown): value is RecordActionReceipt {
  return z.strictObject({operationId: id, action: z.enum(Object.keys(payloads) as [RecordAction, ...RecordAction[]]),
    state: z.enum(['preview', 'applied']), previewHash: z.string().regex(/^[a-f0-9]{64}$/), targetIds: z.array(id).max(25),
    auditId: id.nullable(), expiresAt: z.string(), readback: z.array(z.strictObject({id,kind:z.string(),status:z.string(),fingerprint:z.string().nullable()})).max(64),
    mediaCleanupPending:z.boolean(),mediaCleanupUnmanaged:z.boolean().optional()}).safeParse(value).success;
}
