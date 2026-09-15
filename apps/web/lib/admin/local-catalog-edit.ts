import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';
import { isBoundLocalDevelopmentRequest } from '@/lib/security/local-development-boundary';

const fields = ['approved_name', 'categories', 'lat', 'lng', 'road_address', 'jibun_address',
  'english_address', 'youtube_link', 'tzuyang_review'] as const;
const field = z.enum(fields);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().uuid();
const nullableText = z.string().max(1000).nullable();
const values = z.object({
  approved_name: nullableText,
  categories: z.array(z.string().max(64)).max(30).nullable(),
  lat: z.number().finite().min(-90).max(90).nullable(),
  lng: z.number().finite().min(-180).max(180).nullable(),
  road_address: nullableText, jibun_address: nullableText, english_address: nullableText,
  youtube_link: nullableText, tzuyang_review: z.string().max(20000).nullable(),
}).partial().strict();
const patch = values.extend({
  approved_name: z.string().trim().min(1).max(300).optional(),
  categories: z.array(z.string().trim().min(1).max(64)).max(30).optional(),
  lat: z.number().finite().min(-90).max(90).optional(),
  lng: z.number().finite().min(-180).max(180).optional(),
}).refine(value => Object.keys(value).length > 0)
  .refine(value => ('lat' in value) === ('lng' in value))
  .refine(value => !['road_address', 'jibun_address', 'english_address'].some(key => key in value) || 'lat' in value);

export const localCatalogEditRequest = z.discriminatedUnion('phase', [
  z.object({ phase: z.literal('preview'), patch }).strict(),
  z.object({ phase: z.literal('apply'), patch, previewSha256: hash, operationId: uuid,
    confirmation: z.literal('변경 적용') }).strict(),
  z.object({ phase: z.literal('readback'), operationId: uuid }).strict(),
]);
const previewResult = z.object({ before: values, after: values, before_sha256: hash, preview_sha256: hash }).strict();
const applyResult = z.object({ operation_id: uuid, after_sha256: hash,
  changed_fields: z.array(field).min(1).max(fields.length), replayed: z.boolean() }).strict();
const readbackResult = z.object({ operation_id: uuid, restaurant_id: uuid, after_sha256: hash, current_sha256: hash.nullable(),
  matches: z.boolean(), changed_fields: z.array(field).min(1).max(fields.length), values }).strict();

type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{
  data: unknown; error: { code?: string } | null;
}>;

export function admitsLocalCatalogEdit(request: Request, env: NodeJS.ProcessEnv) {
  return isBoundLocalDevelopmentRequest(request, env);
}

const reply = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
});

function rpcFailure(code: string | undefined) {
  if (code === '42501') return reply({ error: 'CATALOG_EDIT_FORBIDDEN' }, 403);
  if (code === '40001' || code === '23505') return reply({ error: 'CATALOG_EDIT_CONFLICT' }, 409);
  if (code === '22023') return reply({ error: 'CATALOG_EDIT_INVALID' }, 400);
  if (code === 'P0002') return reply({ error: 'CATALOG_EDIT_NOT_FOUND' }, 404);
  return reply({ error: 'CATALOG_EDIT_UNAVAILABLE' }, 503);
}

/** Called only after the route's session-aware requireAdmin gate. */
export async function executeLocalCatalogEdit(request: Request, restaurantId: string, actorId: string,
  rpc: Rpc, env: NodeJS.ProcessEnv = process.env) {
  if (!admitsLocalCatalogEdit(request, env)) return reply({ error: 'LOCAL_WORKSPACE_REQUIRED' }, 403);
  if (!isTrustedSameOriginMutation(request, env)) {
    return reply({ error: 'CATALOG_EDIT_FORBIDDEN' }, 403);
  }
  if (!uuid.safeParse(restaurantId).success || !uuid.safeParse(actorId).success) {
    return reply({ error: 'CATALOG_EDIT_INVALID' }, 400);
  }
  const body = await readBoundedJsonRequest(request, 36 * 1024);
  if (!body.ok) return reply({ error: 'CATALOG_EDIT_INVALID' }, 400);
  const parsed = localCatalogEditRequest.safeParse(body.value);
  if (!parsed.success) return reply({ error: 'CATALOG_EDIT_INVALID' }, 400);
  const input = parsed.data;
  const identity = { p_actor: actorId, p_restaurant: restaurantId };
  let applying = false;
  let applied = false;
  let expectedAfterHash: string | undefined;
  try {
    if (input.phase === 'preview') {
      const result = await rpc('prepare_local_restaurant_catalog_edit', { ...identity, p_patch: input.patch });
      if (result.error) return rpcFailure(result.error.code);
      const preview = previewResult.safeParse(result.data);
      if (!preview.success) return reply({ error: 'CATALOG_EDIT_UNAVAILABLE' }, 503);
      return reply({ ok: true, operationId: randomUUID(), preview: preview.data });
    }
    if (input.phase === 'apply') {
      applying = true;
      const result = await rpc('apply_local_restaurant_catalog_edit', { ...identity, p_patch: input.patch,
        p_preview_sha256: input.previewSha256, p_operation: input.operationId });
      if (result.error) {
        if (['42501', '40001', '23505', '22023', 'P0002', 'PGRST202', '42883'].includes(result.error.code ?? '')) {
          return rpcFailure(result.error.code);
        }
        return reply({ error: 'CATALOG_EDIT_OUTCOME_UNKNOWN', operationId: input.operationId }, 202);
      }
      const receipt = applyResult.safeParse(result.data);
      if (!receipt.success || receipt.data.operation_id !== input.operationId) {
        return reply({ error: 'CATALOG_EDIT_OUTCOME_UNKNOWN', operationId: input.operationId }, 202);
      }
      applied = true;
      expectedAfterHash = receipt.data.after_sha256;
    }
    const result = await rpc('readback_local_restaurant_catalog_edit', { p_actor: actorId, p_operation: input.operationId });
    if (result.error && !applying) return rpcFailure(result.error.code);
    const readback = readbackResult.safeParse(result.data);
    if (result.error || !readback.success || readback.data.operation_id !== input.operationId
        || readback.data.restaurant_id !== restaurantId
        || (expectedAfterHash && readback.data.after_sha256 !== expectedAfterHash)) {
      return reply({ error: 'CATALOG_EDIT_READBACK_PENDING', operationId: input.operationId, applied }, 202);
    }
    if (!readback.data.matches || readback.data.current_sha256 !== readback.data.after_sha256) {
      return reply({ error: 'CATALOG_EDIT_READBACK_CHANGED', operationId: input.operationId, applied }, 409);
    }
    return reply({ ok: true, operationId: input.operationId, readback: readback.data });
  } catch {
    return applying
      ? reply({ error: applied ? 'CATALOG_EDIT_READBACK_PENDING' : 'CATALOG_EDIT_OUTCOME_UNKNOWN',
        operationId: input.phase === 'preview' ? undefined : input.operationId, applied }, 202)
      : reply({ error: 'CATALOG_EDIT_UNAVAILABLE' }, 503);
  }
}
